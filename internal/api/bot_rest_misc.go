package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"evilion.xyz/chat/internal/botproto"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/store"
)

// The bot API's smaller routes: where the gateway is, invites by their code,
// stickers and their packs, the application itself and its emoji, and the
// routes of things this server does not have (selling, activities, stage
// events), which answer the way the protocol does when there are none.

func (s *Server) botMiscRoutes(mux *http.ServeMux) {
	s.botHandle(mux, "GET", "/gateway", authNone, s.botGatewayInfo)
	s.botHandle(mux, "GET", "/gateway/bot", authBot, s.botGatewayBotInfo)
	s.botHandle(mux, "GET", "/voice/regions", authNone, s.botVoiceRegions)
	s.botHandle(mux, "GET", "/invites/{code}", authNone, s.botInviteGet)
	s.botHandle(mux, "DELETE", "/invites/{code}", authBot, s.botInviteDelete)
	s.botHandle(mux, "GET", "/stickers/{sticker}", authBotOrBearer, s.botStickerGet)
	s.botHandle(mux, "GET", "/sticker-packs", authBotOrBearer, s.botStickerPacks)
	s.botHandle(mux, "GET", "/sticker-packs/{pack}", authBotOrBearer, s.botStickerPack)
	s.botHandle(mux, "GET", "/applications/@me", authBot, s.botApplicationGet)
	s.botHandle(mux, "PATCH", "/applications/@me", authBot, s.botApplicationPatch)
	s.botHandle(mux, "GET", "/applications/{app}/emojis", authBot, s.botAppEmojis, bucketed("read"))
	s.botHandle(mux, "GET", "/applications/{app}/emojis/{emoji}", authBot, s.botAppEmojiGet, bucketed("read"))
	s.botHandle(mux, "POST", "/applications/{app}/emojis", authBot, s.botAppEmojiCreate, bucketed("emoji"))
	s.botHandle(mux, "PATCH", "/applications/{app}/emojis/{emoji}", authBot, s.botAppEmojiEdit, bucketed("emoji"))
	s.botHandle(mux, "DELETE", "/applications/{app}/emojis/{emoji}", authBot, s.botAppEmojiDelete, bucketed("emoji"))
	// nothing is sold here: no SKUs, entitlements or subscriptions
	empty := func(w http.ResponseWriter, r *http.Request) { WriteJSON(w, http.StatusOK, []any{}) }
	s.botHandle(mux, "GET", "/applications/{app}/skus", authBot, empty)
	s.botHandle(mux, "GET", "/applications/{app}/entitlements", authBot, empty)
	s.botHandle(mux, "GET", "/skus/{sku}/subscriptions", authBot, empty)
	s.botHandle(mux, "GET", "/applications/{app}/role-connections/metadata", authBot, empty)
	s.botHandle(mux, "GET", "/soundboard-default-sounds", authBotOrBearer, empty)
	unknownEntitlement := func(w http.ResponseWriter, r *http.Request) {
		writeBotError(w, dErr(http.StatusNotFound, 10069, "Unknown Entitlement"), nil)
	}
	s.botHandle(mux, "GET", "/applications/{app}/entitlements/{entitlement}", authBot, unknownEntitlement)
	s.botHandle(mux, "POST", "/applications/{app}/entitlements/{entitlement}/consume", authBot, unknownEntitlement)
	s.botHandle(mux, "DELETE", "/applications/{app}/entitlements/{entitlement}", authBot, unknownEntitlement)
	s.botHandle(mux, "POST", "/applications/{app}/entitlements", authBot, func(w http.ResponseWriter, r *http.Request) {
		writeBotError(w, dErr(http.StatusNotFound, 10070, "Unknown SKU"), nil)
	})
	s.botHandle(mux, "GET", "/skus/{sku}/subscriptions/{subscription}", authBot, func(w http.ResponseWriter, r *http.Request) {
		writeBotError(w, dErr(http.StatusNotFound, 10071, "Unknown Subscription"), nil)
	})
	s.botHandle(mux, "PUT", "/applications/{app}/role-connections/metadata", authBot, func(w http.ResponseWriter, r *http.Request) {
		writeBotError(w, dErrFeatureUnavailable("Linked roles"), nil)
	})
	s.botHandle(mux, "GET", "/applications/{app}/activity-instances/{instance}", authBot, func(w http.ResponseWriter, r *http.Request) {
		writeBotError(w, dErr(http.StatusNotFound, 10097, "Unknown Activity Instance"), nil)
	})
	stage := func(w http.ResponseWriter, r *http.Request) {
		writeBotError(w, dErr(http.StatusNotFound, 10067, "Unknown Stage Instance"), nil)
	}
	s.botHandle(mux, "GET", "/stage-instances/{channel}", authBot, stage)
	s.botHandle(mux, "PATCH", "/stage-instances/{channel}", authBot, stage)
	s.botHandle(mux, "DELETE", "/stage-instances/{channel}", authBot, stage)
	s.botHandle(mux, "POST", "/stage-instances", authBot, func(w http.ResponseWriter, r *http.Request) {
		writeBotError(w, dErrFeatureUnavailable("Stage channels"), nil)
	})
	s.botHandle(mux, "GET", "/soundboard-sounds/{sound}", authBotOrBearer, func(w http.ResponseWriter, r *http.Request) {
		writeBotError(w, dErr(http.StatusNotFound, 10097, "Unknown Soundboard Sound"), nil)
	})
	// anything else under the bot API's paths is not found, in the
	// protocol's shape, rather than falling through to the app's pages
	for _, prefix := range botPrefixes {
		mux.HandleFunc(prefix+"/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Via", "1.1 nexa")
			writeBotError(w, dErrUnknownEntity, nil)
		})
	}
}

// dErrFeatureUnavailable is the answer for something this server does not
// have, said plainly.
func dErrFeatureUnavailable(what string) *dError {
	return dErr(http.StatusBadRequest, 50024, what+" are not available on this server.")
}

// --- shared helpers -----------------------------------------------------------------------

// rawBody is a body callNexa sends as it is, for the app's routes that take
// a picture's bytes rather than JSON.
type rawBody struct {
	data        []byte
	contentType string
}

// imageData reads a picture sent the way the protocol sends them, as a data
// URI ("data:image/png;base64,...").
func imageData(v string) (*rawBody, error) {
	head, body, ok := strings.Cut(v, ",")
	if !ok || !strings.HasPrefix(head, "data:image/") || !strings.HasSuffix(head, ";base64") {
		return nil, dFormError("IMAGE_INVALID", "Invalid image data")
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(body))
	if err != nil {
		if data, err = base64.RawStdEncoding.DecodeString(strings.TrimRight(strings.TrimSpace(body), "=")); err != nil {
			return nil, dFormError("IMAGE_INVALID", "Invalid image data")
		}
	}
	return &rawBody{data: data, contentType: strings.TrimSuffix(strings.TrimPrefix(head, "data:"), ";base64")}, nil
}

// --- the gateway's address ------------------------------------------------------------------

func (s *Server) botGatewayInfo(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]any{"url": s.botGatewayURL()})
}

// botSessionsPerDay is how many sessions a bot may start a day, as the
// protocol counts them.
const botSessionsPerDay = 1000

func (s *Server) botGatewayBotInfo(w http.ResponseWriter, r *http.Request) {
	b := botOf(r)
	servers, _ := s.Store.BotServers(r.Context(), b.user.ID)
	shards := len(servers)/1000 + 1
	remaining, resetAfter := s.bots.sessionStarts(b.user.ID)
	WriteJSON(w, http.StatusOK, map[string]any{"url": s.botGatewayURL(), "shards": shards,
		"session_start_limit": map[string]any{"total": botSessionsPerDay, "remaining": remaining, "reset_after": resetAfter.Milliseconds(), "max_concurrency": 1}})
}

// sessionStarts is how many more sessions a bot may start today, and when
// the oldest of today's starts stops counting.
func (rt *botRuntime) sessionStarts(bot ids.ID) (int, time.Duration) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.pruneStarts(bot)
	list := rt.starts[bot]
	reset := time.Duration(0)
	if len(list) > 0 {
		reset = time.Until(list[0].Add(24 * time.Hour))
	}
	return botSessionsPerDay - len(list), reset
}

// startSession counts a session a bot starts; false once it has started as
// many today as it may.
func (rt *botRuntime) startSession(bot ids.ID) bool {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.pruneStarts(bot)
	if len(rt.starts[bot]) >= botSessionsPerDay {
		return false
	}
	rt.starts[bot] = append(rt.starts[bot], time.Now())
	return true
}

func (rt *botRuntime) pruneStarts(bot ids.ID) {
	list := rt.starts[bot]
	cut := time.Now().Add(-24 * time.Hour)
	i := 0
	for i < len(list) && list[i].Before(cut) {
		i++
	}
	if i == len(list) {
		delete(rt.starts, bot)
		return
	}
	rt.starts[bot] = list[i:]
}

// voiceRegions are the regions a call can be in. Calls here go through one
// network, which is the one region there is.
func voiceRegions() []map[string]any {
	return []map[string]any{{"id": "automatic", "name": "Automatic", "optimal": true, "deprecated": false, "custom": false}}
}

func (s *Server) botVoiceRegions(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, voiceRegions())
}

// --- invites by code ------------------------------------------------------------------------

func (s *Server) botInviteGet(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	inv, err := s.Store.InviteByCode(ctx, r.PathValue("code"))
	if err != nil || (inv.ExpiresAt != nil && *inv.ExpiresAt < time.Now().UnixMilli()) || (inv.MaxUses > 0 && inv.Uses >= inv.MaxUses) {
		writeBotError(w, dErrUnknownInvite, nil)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if inv.ServerID != nil {
		srv, err := s.Store.ServerByID(ctx, *inv.ServerID)
		if err != nil {
			writeBotError(w, dErrUnknownInvite, nil)
			return
		}
		if srv.NSFW && r.URL.Query().Get("nsfw") != "1" {
			writeBotError(w, dErr(http.StatusForbidden, 50013, "Confirm that you are 18 or older to view this invite."), nil)
			return
		}
	}
	b := s.builder(ctx, nil, nil)
	out := b.inviteObj(inv, false)
	if boolQuery(r, "with_counts", false) && inv.ServerID != nil {
		if n, err := s.Store.MemberCount(ctx, *inv.ServerID); err == nil {
			out.ApproximateMemberCount = &n
			online := s.onlineCount(ctx, *inv.ServerID)
			out.ApproximatePresenceCount = &online
		}
	}
	WriteJSON(w, http.StatusOK, out)
}

func (s *Server) botInviteDelete(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	code := r.PathValue("code")
	inv, err := s.Store.InviteByCode(ctx, code)
	if err != nil {
		writeBotError(w, dErrUnknownInvite, nil)
		return
	}
	ans := s.callNexa(r, s.handleInviteDelete, http.MethodDelete, map[string]string{"code": code}, nil, nil)
	if !ans.ok() {
		writeBotError(w, ans.err(), dErrUnknownInvite)
		return
	}
	WriteJSON(w, http.StatusOK, s.builderFor(r, botOf(r)).inviteObj(inv, false))
}

// onlineCount is about how many of a server's members are online.
func (s *Server) onlineCount(ctx context.Context, serverID ids.ID) int {
	if s.hub == nil {
		return 0
	}
	members, err := s.Store.MemberIDs(ctx, serverID)
	if err != nil {
		return 0
	}
	return len(s.hub.OnlineAmong(members))
}

// --- stickers ----------------------------------------------------------------------------------

func (s *Server) botStickerGet(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "sticker")
	if !ok {
		writeBotError(w, dErrUnknownSticker, nil)
		return
	}
	ctx := r.Context()
	st, err := s.Store.StickerByID(ctx, id)
	if err != nil {
		writeBotError(w, dErrUnknownSticker, nil)
		return
	}
	pack, err := s.Store.PackByID(ctx, st.PackID)
	if err != nil || pack.Kind == "emoji" {
		writeBotError(w, dErrUnknownSticker, nil)
		return
	}
	// a server's stickers are its members' to look at; a public pack's anyone's
	if !pack.Public {
		if pack.ServerID == nil {
			writeBotError(w, dErrUnknownSticker, nil)
			return
		}
		if member, _ := s.Store.IsMember(ctx, *pack.ServerID, botOf(r).user.ID); !member {
			writeBotError(w, dErrUnknownSticker, nil)
			return
		}
	}
	WriteJSON(w, http.StatusOK, s.builderFor(r, botOf(r)).stickerObj(st, pack))
}

type dStickerPack struct {
	ID             snow       `json:"id"`
	Stickers       []dSticker `json:"stickers"`
	Name           string     `json:"name"`
	SKUID          snow       `json:"sku_id"`
	CoverStickerID *snow      `json:"cover_sticker_id,omitempty"`
	Description    string     `json:"description"`
	BannerAssetID  *snow      `json:"banner_asset_id,omitempty"`
}

func (b *dBuilder) stickerPackObj(p *store.StickerPack) dStickerPack {
	out := dStickerPack{ID: snow(p.ID), Name: p.Name, SKUID: snow(p.ID), CoverStickerID: botproto.SP(p.CoverStickerID), Description: p.Description, Stickers: []dSticker{}}
	for _, st := range p.Stickers {
		out.Stickers = append(out.Stickers, b.stickerObj(st, p))
	}
	return out
}

// botStickerPacks lists the packs anyone may use, which stand in for the
// protocol's standard packs.
func (s *Server) botStickerPacks(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	packs, err := s.Store.PublicPacks(ctx, botOf(r).user.ID, "", 100)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	b := s.builderFor(r, botOf(r))
	out := []dStickerPack{}
	for _, p := range packs {
		if p.Kind == "emoji" {
			continue
		}
		if full, err := s.Store.PackByID(ctx, p.ID); err == nil {
			p = full
		}
		out = append(out, b.stickerPackObj(p))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"sticker_packs": out})
}

func (s *Server) botStickerPack(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "pack")
	if !ok {
		writeBotError(w, dErr(http.StatusNotFound, 10061, "Unknown Sticker Pack"), nil)
		return
	}
	p, err := s.Store.PackByID(r.Context(), id)
	if err != nil || !p.Public || p.Kind == "emoji" {
		writeBotError(w, dErr(http.StatusNotFound, 10061, "Unknown Sticker Pack"), nil)
		return
	}
	WriteJSON(w, http.StatusOK, s.builderFor(r, botOf(r)).stickerPackObj(p))
}

// --- the application ------------------------------------------------------------------------------

func (s *Server) botApplicationGet(w http.ResponseWriter, r *http.Request) {
	b := botOf(r)
	app, err := s.Store.ApplicationByID(r.Context(), b.app.ID)
	if err != nil {
		writeBotError(w, err, dErrUnknownApp)
		return
	}
	WriteJSON(w, http.StatusOK, s.builderFor(r, b).applicationObj(app, true))
}

// botApplicationPatch is the application changing its own settings, as the
// developer portal does.
func (s *Server) botApplicationPatch(w http.ResponseWriter, r *http.Request) {
	b := botOf(r)
	raw, derr := readBotObject(w, r, s.Cfg.MaxAvatarBytes*3+64<<10)
	if derr != nil {
		writeBotError(w, derr, nil)
		return
	}
	if err := s.patchApplication(r, b.app, raw, true); err != nil {
		writeBotError(w, err, dErrUnknownApp)
		return
	}
	app, err := s.Store.ApplicationByID(r.Context(), b.app.ID)
	if err != nil {
		writeBotError(w, err, dErrUnknownApp)
		return
	}
	WriteJSON(w, http.StatusOK, s.builderFor(r, b).applicationObj(app, true))
}

// --- the application's emoji ---------------------------------------------------------------------

// appEmojiTarget checks the {app} of an emoji route is the caller's.
func (s *Server) appEmojiTarget(w http.ResponseWriter, r *http.Request) *store.Application {
	b := botOf(r)
	id, ok := pathID(r, "app")
	if !ok || id != b.app.ID {
		writeBotError(w, dErrMissingAccess, nil)
		return nil
	}
	return b.app
}

func (s *Server) botAppEmojis(w http.ResponseWriter, r *http.Request) {
	app := s.appEmojiTarget(w, r)
	if app == nil {
		return
	}
	list, err := s.Store.ApplicationEmojis(r.Context(), app.ID)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	b := s.builderFor(r, botOf(r))
	out := make([]dEmoji, 0, len(list))
	for _, e := range list {
		out = append(out, b.appEmojiObj(e, app))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"items": out})
}

// appEmoji loads the {emoji} of an application emoji route.
func (s *Server) appEmoji(w http.ResponseWriter, r *http.Request, app *store.Application) *store.ApplicationEmoji {
	id, ok := pathID(r, "emoji")
	if !ok {
		writeBotError(w, dErrUnknownEmoji, nil)
		return nil
	}
	e, err := s.Store.ApplicationEmojiByBlob(r.Context(), app.ID, id)
	if err != nil {
		writeBotError(w, dErrUnknownEmoji, nil)
		return nil
	}
	return e
}

func (s *Server) botAppEmojiGet(w http.ResponseWriter, r *http.Request) {
	app := s.appEmojiTarget(w, r)
	if app == nil {
		return
	}
	if e := s.appEmoji(w, r, app); e != nil {
		WriteJSON(w, http.StatusOK, s.builderFor(r, botOf(r)).appEmojiObj(e, app))
	}
}

// emojiName checks an emoji's name the way the protocol does.
func emojiName(v string) (string, bool) {
	if len(v) < 2 || len(v) > 32 {
		return "", false
	}
	for _, c := range v {
		if !(c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
			return "", false
		}
	}
	return v, true
}

func (s *Server) botAppEmojiCreate(w http.ResponseWriter, r *http.Request) {
	app := s.appEmojiTarget(w, r)
	if app == nil {
		return
	}
	var body struct {
		Name  string `json:"name"`
		Image string `json:"image"`
	}
	if err := ReadJSON(w, r, &body, s.Cfg.MaxEmojiBytes*2+16<<10); err != nil {
		writeBotError(w, dErrBadJSON, nil)
		return
	}
	name, ok := emojiName(body.Name)
	if !ok {
		writeBotError(w, dFormError("BASE_TYPE_BAD_LENGTH", "Must be between 2 and 32 in length.", "name"), nil)
		return
	}
	img, err := imageData(body.Image)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	ctx := r.Context()
	blob, err := s.Media.PutPublic(ctx, "emoji", bytes.NewReader(img.data), s.limitsFor("emoji"), app.ID)
	if err != nil {
		if errors.Is(err, media.ErrTooLarge) {
			writeBotError(w, dErr(http.StatusBadRequest, 50138, "Failed to resize asset below the maximum size: 262144"), nil)
			return
		}
		writeBotError(w, err, nil)
		return
	}
	e := &store.ApplicationEmoji{ApplicationID: app.ID, Name: name, BlobID: blob.ID, Animated: blob.Animated}
	if err := s.Store.CreateApplicationEmoji(ctx, e); err != nil {
		s.releaseBlob(ctx, blob.ID)
		if errors.Is(err, store.ErrAlreadyExists) {
			writeBotError(w, dFormError("APPLICATION_EMOJI_NAME_ALREADY_TAKEN", "Emoji name already taken", "name"), nil)
			return
		}
		if errors.Is(err, store.ErrTooMany) {
			writeBotError(w, dErr(http.StatusBadRequest, 30008, "Maximum number of emojis reached (2000)"), nil)
			return
		}
		writeBotError(w, err, nil)
		return
	}
	WriteJSON(w, http.StatusCreated, s.builderFor(r, botOf(r)).appEmojiObj(e, app))
}

func (s *Server) botAppEmojiEdit(w http.ResponseWriter, r *http.Request) {
	app := s.appEmojiTarget(w, r)
	if app == nil {
		return
	}
	e := s.appEmoji(w, r, app)
	if e == nil {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := ReadJSON(w, r, &body, 4<<10); err != nil {
		writeBotError(w, dErrBadJSON, nil)
		return
	}
	name, ok := emojiName(body.Name)
	if !ok {
		writeBotError(w, dFormError("BASE_TYPE_BAD_LENGTH", "Must be between 2 and 32 in length.", "name"), nil)
		return
	}
	if err := s.Store.RenameApplicationEmoji(r.Context(), app.ID, e.BlobID, name); err != nil {
		if errors.Is(err, store.ErrAlreadyExists) {
			writeBotError(w, dFormError("APPLICATION_EMOJI_NAME_ALREADY_TAKEN", "Emoji name already taken", "name"), nil)
			return
		}
		writeBotError(w, err, dErrUnknownEmoji)
		return
	}
	e.Name = name
	WriteJSON(w, http.StatusOK, s.builderFor(r, botOf(r)).appEmojiObj(e, app))
}

func (s *Server) botAppEmojiDelete(w http.ResponseWriter, r *http.Request) {
	app := s.appEmojiTarget(w, r)
	if app == nil {
		return
	}
	e := s.appEmoji(w, r, app)
	if e == nil {
		return
	}
	if err := s.Store.DeleteApplicationEmoji(r.Context(), app.ID, e.BlobID); err != nil {
		writeBotError(w, err, dErrUnknownEmoji)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// sortedIDs is a set of ids in order.
func sortedIDs(set map[ids.ID]bool) []ids.ID {
	out := make([]ids.ID, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// atoiDefault reads a number from a query, or def.
func atoiDefault(v string, def int) int {
	if n, err := strconv.Atoi(v); err == nil {
		return n
	}
	return def
}

// --- webhooks as the protocol shows them ------------------------------------------------------

type dWebhook struct {
	ID            snow    `json:"id"`
	Type          int     `json:"type"`
	GuildID       *snow   `json:"guild_id,omitempty"`
	ChannelID     *snow   `json:"channel_id"`
	User          *dUser  `json:"user,omitempty"`
	Name          *string `json:"name"`
	Avatar        *string `json:"avatar"`
	Token         string  `json:"token,omitempty"`
	ApplicationID *snow   `json:"application_id"`
	URL           string  `json:"url,omitempty"`
}

// webhookObj is a webhook; withToken adds its token and address, for those
// who may manage it and its own token's holder.
func (s *Server) webhookObj(ctx context.Context, wh *store.Webhook, withToken bool) dWebhook {
	b := s.builder(ctx, nil, nil)
	gid, cid := snow(wh.ServerID), snow(wh.ChannelID)
	name := wh.Name
	out := dWebhook{ID: snow(wh.ID), Type: 1, GuildID: &gid, ChannelID: &cid, Name: &name, Avatar: b.hash(wh.AvatarID)}
	if wh.Type != 0 {
		out.Type = wh.Type
	}
	if wh.CreatorID != nil {
		u := b.userByID(*wh.CreatorID)
		out.User = &u
	}
	if withToken {
		if token, err := s.openWebhookToken(wh.TokenSealed); err == nil {
			out.Token = token
			out.URL = strings.TrimRight(s.Cfg.PublicURL, "/") + "/api/webhooks/" + botproto.OutString(wh.ID) + "/" + token
		}
	}
	return out
}
