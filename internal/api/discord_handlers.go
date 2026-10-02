package api

import (
	"cmp"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/discordsync"
	"evilion.xyz/chat/internal/gateway"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// Discord activity sync: a person links their Discord account, and what
// Discord says they are doing shows as their activity here
// (internal/discordsync). It is on when DISCORD_CLIENT_ID,
// DISCORD_CLIENT_SECRET and DISCORD_BOT_TOKEN are all set.

// WireDiscord makes the Discord service when it is configured. It needs the
// server secret to keep tokens, so it comes after that is set.
func (s *Server) WireDiscord(hub *gateway.Hub) {
	c := s.Cfg
	if c.DiscordClientID == "" || c.DiscordClientSecret == "" || c.DiscordBotToken == "" || hub == nil {
		return
	}
	s.Discord = discordsync.New(discordsync.Config{
		ClientID: c.DiscordClientID, ClientSecret: c.DiscordClientSecret, BotToken: c.DiscordBotToken,
		GuildID: c.DiscordGuildID, PublicURL: c.PublicURL, RedirectURL: c.DiscordRedirectURL, API: cmp.Or(s.discordAPI, c.DiscordAPIURL),
	}, s.Store, hub, s.sealDiscordToken, s.openDiscordToken, s.ProxyURL, s.Log)
}

// StartDiscord connects the bot, until ctx ends.
func (s *Server) StartDiscord(ctx context.Context) {
	if s.Discord == nil {
		return
	}
	s.Log.Info("discord activity sync on", "redirect", s.Discord.Redirect())
	s.background.Go(func() { s.Discord.Run(ctx) })
}

func (s *Server) discordRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/connections/discord", s.authed(s.handleDiscordState))
	mux.Handle("POST /api/v1/connections/discord/authorize", s.authed(s.handleDiscordAuthorize))
	mux.Handle("PATCH /api/v1/connections/discord", s.authed(s.handleDiscordPrefs))
	mux.Handle("DELETE /api/v1/connections/discord", s.authed(s.handleDiscordUnlink))
	mux.Handle("POST /api/v1/connections/discord/rejoin", s.authed(s.handleDiscordRejoin))
	// Discord sends the person here, with no token of ours: the state says who it is
	mux.HandleFunc("GET /api/v1/connections/discord/callback", s.handleDiscordCallback)
}

var errDiscordOff = E(http.StatusNotFound, "discord_unavailable", "Discord activity sync is not set up.")

func (s *Server) handleDiscordState(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	if s.Discord == nil {
		out := map[string]any{"available": false, "linked": nil}
		// what is missing, for whoever can fix it
		if me.Flags&store.FlagAdmin != 0 {
			out["bot"] = map[string]any{"connected": false, "configured": false}
		}
		WriteJSON(w, http.StatusOK, out)
		return
	}
	st, err := s.Discord.StateOf(r.Context(), me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	if me.Flags&store.FlagAdmin == 0 {
		WriteJSON(w, http.StatusOK, st)
		return
	}
	connected, guild, lastErr := s.Discord.Status()
	WriteJSON(w, http.StatusOK, struct {
		discordsync.State
		Bot map[string]any `json:"bot"`
	}{st, map[string]any{"configured": true, "connected": connected, "guild_id": guild, "error": lastErr, "redirect": s.Discord.Redirect()}})
}

// discordLimited holds back linking and rejoining, each of which calls Discord.
func (s *Server) discordLimited(w http.ResponseWriter, uid ids.ID) bool {
	if ok, retry := s.limDiscord.Allow("discord:" + uid.String()); !ok {
		w.Header().Set("Retry-After", retryAfter(retry))
		WriteError(w, ErrRateLimited)
		return true
	}
	return false
}

func (s *Server) handleDiscordAuthorize(w http.ResponseWriter, r *http.Request) {
	if s.Discord == nil {
		WriteError(w, errDiscordOff)
		return
	}
	me := auth.UserFrom(r.Context())
	if s.discordLimited(w, me.ID) {
		return
	}
	// back to the address this was started from, which is not always where Discord returns to
	back := ""
	if addr, kind := s.originAddress(r.Header.Get("Origin")); kind != notOurs {
		back = addr
	}
	WriteJSON(w, http.StatusOK, map[string]string{"url": s.Discord.AuthorizeURL(me.ID, back)})
}

// handleDiscordCallback is where Discord sends the person back. It finishes
// the link and goes on to the Activity settings, saying how it went.
func (s *Server) handleDiscordCallback(w http.ResponseWriter, r *http.Request) {
	result := "failed"
	back := ""
	if s.Discord != nil {
		q := r.URL.Query()
		back = s.Discord.Back(q.Get("state"))
		_, result = s.Discord.Callback(r.Context(), q.Get("code"), q.Get("state"), q.Get("error"))
	}
	// where the link was started, when that is one of Nexa's addresses; a
	// moved one sends its browser on to the new address by itself
	if _, kind := s.originAddress(back); kind == notOurs {
		back = strings.TrimRight(s.Cfg.PublicURL, "/")
	}
	dest := back + "/channels/@me?" + url.Values{"settings": {"activity"}, "discord": {result}}.Encode()
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, dest, http.StatusSeeOther)
}

func (s *Server) handleDiscordPrefs(w http.ResponseWriter, r *http.Request) {
	if s.Discord == nil {
		WriteError(w, errDiscordOff)
		return
	}
	var body struct {
		Show  *bool `json:"show"`
		Kinds *int  `json:"kinds"`
	}
	if err := ReadJSON(w, r, &body, 1<<10); err != nil {
		WriteError(w, err)
		return
	}
	me := auth.UserFrom(r.Context())
	cur, err := s.Discord.StateOf(r.Context(), me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	if cur.Linked == nil {
		WriteError(w, E(http.StatusNotFound, "not_linked", "No Discord account is linked."))
		return
	}
	show, kinds := cur.Linked.Show, cur.Linked.Kinds
	if body.Show != nil {
		show = *body.Show
	}
	if body.Kinds != nil {
		if *body.Kinds < 0 || *body.Kinds&^store.DiscordKindsAll != 0 {
			WriteError(w, E(http.StatusBadRequest, "bad_kinds", "Those kinds of activity are not ones there are."))
			return
		}
		kinds = *body.Kinds
	}
	if err := s.Discord.SetPrefs(r.Context(), me.ID, show, kinds); err != nil {
		WriteError(w, discordError(err))
		return
	}
	s.handleDiscordState(w, r)
}

func (s *Server) handleDiscordUnlink(w http.ResponseWriter, r *http.Request) {
	if s.Discord == nil {
		WriteError(w, errDiscordOff)
		return
	}
	if err := s.Discord.Unlink(r.Context(), auth.UserFrom(r.Context()).ID); err != nil {
		WriteError(w, discordError(err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDiscordRejoin(w http.ResponseWriter, r *http.Request) {
	if s.Discord == nil {
		WriteError(w, errDiscordOff)
		return
	}
	me := auth.UserFrom(r.Context())
	if s.discordLimited(w, me.ID) {
		return
	}
	if err := s.Discord.Rejoin(r.Context(), me.ID); err != nil {
		WriteError(w, discordError(err))
		return
	}
	s.handleDiscordState(w, r)
}

func discordError(err error) error {
	switch {
	case errors.Is(err, discordsync.ErrNotLinked):
		return E(http.StatusNotFound, "not_linked", "No Discord account is linked.")
	case errors.Is(err, discordsync.ErrReauthorize):
		return E(http.StatusConflict, "reauthorize", "Discord needs you to connect your account again.")
	}
	var apiErr *discordsync.APIError
	if errors.As(err, &apiErr) {
		return E(http.StatusBadGateway, "discord_error", "Discord did not accept that. Try again in a moment.")
	}
	if strings.Contains(err.Error(), "activity server") {
		return E(http.StatusBadGateway, "discord_join_failed", "Discord would not add your account to the activity server.")
	}
	return err
}

// sealDiscordToken keeps an OAuth token so the bot can add its account to the
// activity server again later, and nobody who only has the database can use it.
func (s *Server) sealDiscordToken(token string) ([]byte, error) {
	gcm, err := s.discordSeal()
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(token), nil), nil
}

func (s *Server) openDiscordToken(sealed []byte) (string, error) {
	gcm, err := s.discordSeal()
	if err != nil {
		return "", err
	}
	if len(sealed) < gcm.NonceSize() {
		return "", errors.New("sealed token is truncated")
	}
	out, err := gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], nil)
	return string(out), err
}

func (s *Server) discordSeal() (cipher.AEAD, error) {
	block, err := aes.NewCipher(s.derivedKey("discord-token-v1"))
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
