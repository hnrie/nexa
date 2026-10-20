package api

import (
	"net/http"
	"sort"
	"strconv"

	"evilion.xyz/chat/internal/botproto"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// The bot API's user routes: the bot's own account (or, with an OAuth2
// token, the person who granted it), someone else's, the servers it is in,
// and its direct messages.

func (s *Server) botUserRoutes(mux *http.ServeMux) {
	s.botHandle(mux, "GET", "/users/@me", authBotOrBearer, s.botMe, scoped("identify"), bucketed("read"))
	s.botHandle(mux, "PATCH", "/users/@me", authBot, s.botMePatch)
	s.botHandle(mux, "GET", "/users/{user}", authBot, s.botUserGet, bucketed("read"))
	s.botHandle(mux, "GET", "/users/@me/guilds", authBotOrBearer, s.botMyGuilds, scoped("guilds"), bucketed("read"))
	s.botHandle(mux, "GET", "/users/@me/guilds/{guild}/member", authBotOrBearer, s.botMyMember, scoped("guilds.members.read"), bucketed("read"))
	s.botHandle(mux, "DELETE", "/users/@me/guilds/{guild}", authBot, s.botLeaveGuild)
	s.botHandle(mux, "POST", "/users/@me/channels", authBot, s.botDMCreate)
	s.botHandle(mux, "GET", "/users/@me/connections", authBearer, func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, http.StatusOK, []any{})
	}, scoped("connections"))
	roleConnection := func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]any{"platform_name": nil, "platform_username": nil, "metadata": map[string]any{}})
	}
	s.botHandle(mux, "GET", "/users/@me/applications/{app}/role-connection", authBearer, roleConnection)
	s.botHandle(mux, "PUT", "/users/@me/applications/{app}/role-connection", authBearer, func(w http.ResponseWriter, r *http.Request) {
		writeBotError(w, dErrFeatureUnavailable("Linked roles"), nil)
	})
	s.botHandle(mux, "DELETE", "/users/@me/applications/{app}/role-connection", authBearer, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
}

// botMe is the token's own account: the bot's, or the person's who granted
// an OAuth2 token.
func (s *Server) botMe(w http.ResponseWriter, r *http.Request) {
	b := botOf(r)
	bld := s.builderFor(r, b)
	u := bld.userObj(b.user)
	mfa, verified := false, true
	u.MFAEnabled, u.Verified = &mfa, &verified
	u.Locale = "en-US"
	if b.isBot() {
		u.Verified = &verified
	} else {
		if m, err := s.Store.MFAFor(r.Context(), b.user.ID); err == nil && m != nil && m.Enabled {
			on := true
			u.MFAEnabled = &on
		}
		zero := 0
		u.PremiumType = &zero
		if b.hasScope("email") {
			// accounts here have no email address
			u.Email = nil
		}
		bio := b.user.AboutMe
		u.Bio = &bio
	}
	WriteJSON(w, http.StatusOK, u)
}

func (s *Server) botMePatch(w http.ResponseWriter, r *http.Request) {
	b := botOf(r)
	raw, derr := readBotObject(w, r, s.Cfg.MaxAvatarBytes*3+64<<10)
	if derr != nil {
		writeBotError(w, derr, nil)
		return
	}
	bot, err := s.patchBotUser(r, b.user.ID, raw)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	u := s.builderFor(r, b).userObj(bot)
	mfa, verified := false, true
	u.MFAEnabled, u.Verified = &mfa, &verified
	WriteJSON(w, http.StatusOK, u)
}

func (s *Server) botUserGet(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r, "user")
	if !ok {
		writeBotError(w, dErrUnknownUser, nil)
		return
	}
	u, err := s.Store.UserByID(r.Context(), id)
	if err != nil {
		writeBotError(w, dErrUnknownUser, nil)
		return
	}
	WriteJSON(w, http.StatusOK, s.builderFor(r, botOf(r)).userObj(u))
}

// dPartialGuild is a server in someone's list of servers.
type dPartialGuild struct {
	ID                       snow     `json:"id"`
	Name                     string   `json:"name"`
	Icon                     *string  `json:"icon"`
	Banner                   *string  `json:"banner"`
	Owner                    bool     `json:"owner"`
	Permissions              string   `json:"permissions"`
	Features                 []string `json:"features"`
	ApproximateMemberCount   *int     `json:"approximate_member_count,omitempty"`
	ApproximatePresenceCount *int     `json:"approximate_presence_count,omitempty"`
}

func (s *Server) botMyGuilds(w http.ResponseWriter, r *http.Request) {
	b := botOf(r)
	ctx := r.Context()
	servers, err := s.Store.ServersForUser(ctx, b.user.ID)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	sort.Slice(servers, func(i, j int) bool { return servers[i].ID < servers[j].ID })
	q := r.URL.Query()
	limit := 200
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 200 {
			writeBotError(w, dFormError("NUMBER_TYPE_MAX", "int value should be between 1 and 200.", "limit"), nil)
			return
		}
		limit = n
	}
	var before, after int64
	if v := q.Get("before"); v != "" {
		before, _ = botproto.Parse(v)
	}
	if v := q.Get("after"); v != "" {
		after, _ = botproto.Parse(v)
	}
	withCounts := boolQuery(r, "with_counts", false)
	bld := s.builderFor(r, b)
	out := []dPartialGuild{}
	// before reads backwards from it, as the protocol pages
	if before != 0 {
		for i := len(servers) - 1; i >= 0 && len(out) < limit; i-- {
			if int64(servers[i].ID) < before {
				out = append(out, s.partialGuild(r, bld, servers[i], b.user.ID, withCounts))
			}
		}
		for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
			out[i], out[j] = out[j], out[i]
		}
	} else {
		for _, srv := range servers {
			if int64(srv.ID) <= after {
				continue
			}
			out = append(out, s.partialGuild(r, bld, srv, b.user.ID, withCounts))
			if len(out) >= limit {
				break
			}
		}
	}
	WriteJSON(w, http.StatusOK, out)
}

func (s *Server) partialGuild(r *http.Request, b *dBuilder, srv *store.Server, uid ids.ID, withCounts bool) dPartialGuild {
	p, _ := s.Store.ServerPerms(r.Context(), srv.ID, uid)
	out := dPartialGuild{ID: snow(srv.ID), Name: srv.Name, Icon: b.hash(srv.IconID), Banner: b.hash(srv.BannerID), Owner: srv.OwnerID == uid,
		Permissions: permString(p), Features: guildFeatures(srv)}
	if withCounts {
		if n, err := s.Store.MemberCount(r.Context(), srv.ID); err == nil {
			out.ApproximateMemberCount = &n
			online := s.onlineCount(r.Context(), srv.ID)
			out.ApproximatePresenceCount = &online
		}
	}
	return out
}

func (s *Server) botMyMember(w http.ResponseWriter, r *http.Request) {
	b := botOf(r)
	gid, ok := pathID(r, "guild")
	if !ok {
		writeBotError(w, dErrUnknownGuild, nil)
		return
	}
	m, err := s.Store.Member(r.Context(), gid, b.user.ID)
	if err != nil {
		writeBotError(w, dErrUnknownGuild, nil)
		return
	}
	bld := s.builderFor(r, b)
	bld.preloadMembers([]*store.Member{m})
	WriteJSON(w, http.StatusOK, bld.memberObj(m, true))
}

// botLeaveGuild is the bot leaving a server.
func (s *Server) botLeaveGuild(w http.ResponseWriter, r *http.Request) {
	b := botOf(r)
	gid, ok := pathID(r, "guild")
	if !ok {
		writeBotError(w, dErrUnknownGuild, nil)
		return
	}
	ctx := r.Context()
	srv, err := s.Store.ServerByID(ctx, gid)
	if err != nil {
		writeBotError(w, dErrUnknownGuild, nil)
		return
	}
	if member, _ := s.Store.IsMember(ctx, gid, b.user.ID); !member {
		writeBotError(w, dErrUnknownGuild, nil)
		return
	}
	if srv.OwnerID == b.user.ID {
		writeBotError(w, dErr(http.StatusBadRequest, 50055, "Invalid Guild"), nil)
		return
	}
	if err := s.removeMember(r, srv, b.user.ID, "member_remove", map[string]any{"reason": "leave"}); err != nil {
		writeBotError(w, err, nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// botDMCreate opens a direct message with someone. A bot may write to
// people it shares a server with (or who wrote to it), as the protocol
// allows, and never to someone who closed their messages to it.
func (s *Server) botDMCreate(w http.ResponseWriter, r *http.Request) {
	b := botOf(r)
	ctx := r.Context()
	var body struct {
		RecipientID  snow  `json:"recipient_id"`
		AccessTokens []any `json:"access_tokens"`
	}
	if err := ReadJSON(w, r, &body, 8<<10); err != nil {
		writeBotError(w, dErrBadJSON, nil)
		return
	}
	if len(body.AccessTokens) > 0 {
		writeBotError(w, dErrFeatureUnavailable("Group direct messages made by bots"), nil)
		return
	}
	target, err := s.Store.UserByID(ctx, ids.ID(body.RecipientID))
	if err != nil || target.Flags&store.FlagDeleted != 0 || isWebhookAccount(target) || isSystem(target) || target.ID == b.user.ID {
		writeBotError(w, dErrUnknownUser, nil)
		return
	}
	if target.Flags&store.FlagBot != 0 {
		writeBotError(w, dErrCannotDM, nil)
		return
	}
	ab, ba, err := s.Store.Blocked(ctx, b.user.ID, target.ID)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	exists, err := s.Store.DMExists(ctx, b.user.ID, target.ID)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	shared, err := s.Store.ShareServer(ctx, b.user.ID, target.ID)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	if ab || ba || target.DMPrivacy == store.DMNobody || (!exists && (!shared || target.DMPrivacy == store.DMFriends)) {
		writeBotError(w, dErrCannotDM, nil)
		return
	}
	ch, created, err := s.Store.StartDM(ctx, b.user.ID, target.ID)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	if created {
		s.Bcast.EmitUsers([]ids.ID{b.user.ID}, "channel_create", ch)
	}
	dc, ok := s.builderFor(r, b).channelObj(ch)
	if !ok {
		writeBotError(w, dErrUnknownChannel, nil)
		return
	}
	WriteJSON(w, http.StatusOK, dc)
}
