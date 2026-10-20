package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/store"
)

// Following an announcement channel brings what it publishes into a channel
// of another server. Publishing stays end-to-end encrypted: the publisher's
// app seals each copy to the follow's public key, and the private key
// travels sealed with the following channel's own key, so nobody but the
// people of that channel (and certainly not this server) can open it. A copy
// says where it came from, and that the original was deleted once it is.

const (
	followKeyLen = 32
	// maxCopy bounds one sealed copy: a message's envelope, with its sealed key.
	maxCopy = maxEnvelopeBytes + 1024
)

func (s *Server) followRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/channels/{id}/followers", s.stepUpUser(s.stepBuild, s.handleFollowCreate))
	mux.Handle("GET /api/v1/channels/{id}/followers", s.authed(s.handleFollowerKeys))
	mux.Handle("GET /api/v1/channels/{id}/follows", s.authed(s.handleFollowsInto))
	mux.Handle("GET /api/v1/servers/{id}/follows", s.authed(s.handleServerFollows))
	mux.Handle("PUT /api/v1/follows/{fid}/secret", s.authed(s.handleFollowSecret))
	mux.Handle("DELETE /api/v1/follows/{fid}", s.authed(s.handleFollowDelete))
	mux.Handle("POST /api/v1/channels/{id}/messages/{mid}/crosspost", s.authed(s.handleCrosspost))
}

// crosspostInfo is what a copy says about where it came from.
type crosspostInfo struct {
	FollowID     ids.ID  `json:"follow_id"`
	ServerID     ids.ID  `json:"server_id"`
	ServerName   string  `json:"server_name"`
	ServerIconID *ids.ID `json:"server_icon_id"`
	ChannelID    ids.ID  `json:"channel_id"`
	ChannelName  string  `json:"channel_name"`
	MessageID    ids.ID  `json:"message_id"`
	Deleted      bool    `json:"deleted,omitempty"`
}

// sealedCopy is a published copy as the publisher's app seals it: the
// message sealed with a key of its own, that key sealed to the follow.
type sealedCopy struct {
	V   int    `json:"v"`
	Key string `json:"key"`
	IV  string `json:"iv"`
	CT  string `json:"ct"`
}

func validCopy(raw json.RawMessage) bool {
	if len(raw) == 0 || len(raw) > maxCopy {
		return false
	}
	var c sealedCopy
	if json.Unmarshal(raw, &c) != nil || c.V != 2 || c.Key == "" || c.CT == "" {
		return false
	}
	for _, f := range []string{c.Key, c.IV, c.CT} {
		if _, err := base64.StdEncoding.DecodeString(f); err != nil {
			return false
		}
	}
	iv, _ := base64.StdEncoding.DecodeString(c.IV)
	return len(iv) == 12
}

// announcementCtx loads the announcement channel a route names, with what the
// caller may do in it.
func (s *Server) announcementCtx(w http.ResponseWriter, r *http.Request) (*store.Channel, *store.User, perms.Perm) {
	ch, me := s.channel(w, r, NeedView)
	if ch == nil {
		return nil, nil, 0
	}
	if ch.Type != store.ChannelAnnouncement {
		WriteError(w, E(http.StatusBadRequest, "not_announcement", "Only announcement channels can be followed."))
		return nil, nil, 0
	}
	p, err := s.Store.PermsIn(r.Context(), ch, me.ID)
	if err != nil {
		WriteError(w, err)
		return nil, nil, 0
	}
	return ch, me, p
}

// handleFollowCreate follows an announcement channel into a channel the caller
// manages webhooks in.
func (s *Server) handleFollowCreate(w http.ResponseWriter, r *http.Request) {
	source, me, _ := s.announcementCtx(w, r)
	if source == nil {
		return
	}
	ctx := r.Context()
	var req struct {
		TargetID  ids.ID          `json:"target_channel_id"`
		PublicKey string          `json:"public_key"`
		Secret    json.RawMessage `json:"secret"`
	}
	if err := ReadJSON(w, r, &req, 16<<10); err != nil {
		WriteError(w, err)
		return
	}
	target, err := s.Store.ChannelByID(ctx, req.TargetID)
	if err != nil || target.ServerID == nil || target.Type != "text" {
		WriteError(w, E(http.StatusBadRequest, "invalid_target", "Announcements are followed into a text channel."))
		return
	}
	if target.ID == source.ID {
		WriteError(w, E(http.StatusBadRequest, "invalid_target", "A channel cannot follow itself."))
		return
	}
	tp, err := s.Store.PermsIn(ctx, target, me.ID)
	if err != nil || !tp.Has(perms.ViewChannel|perms.ManageWebhooks) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Manage Webhooks in the channel the posts go to."))
		return
	}
	pub, err := base64.StdEncoding.DecodeString(req.PublicKey)
	if err != nil || len(pub) != followKeyLen {
		WriteError(w, E(http.StatusBadRequest, "invalid_key", "The follow's key is malformed."))
		return
	}
	env, ok := validEnvelope(req.Secret)
	if !ok || env.Conv != target.KeyConvID {
		WriteError(w, E(http.StatusBadRequest, "invalid_key", "The follow's key has to be sealed for the channel the posts go to."))
		return
	}
	me2 := me.ID
	f := &store.Follow{SourceID: source.ID, TargetID: target.ID, ServerID: *target.ServerID, CreatorID: &me2, PublicKey: pub, Secret: string(req.Secret)}
	switch err := s.Store.CreateFollow(ctx, f); {
	case errors.Is(err, store.ErrAlreadyExists):
		WriteError(w, E(http.StatusConflict, "already_following", "That channel already follows this one."))
		return
	case errors.Is(err, store.ErrLimit):
		WriteError(w, E(http.StatusBadRequest, "too_many_follows", "That channel follows as many channels as it can."))
		return
	case err != nil:
		WriteError(w, err)
		return
	}
	srcServer, _ := s.Store.ServerByID(ctx, *source.ServerID)
	name := ""
	if srcServer != nil {
		name = srcServer.Name
	}
	s.audit(r, *target.ServerID, me.ID, "follow_create", "channel", &target.ID, map[string]any{"source_server": name, "source_channel": source.Name}, "")
	s.Bcast.EmitChannel(target.ID, "follows_update", map[string]any{"channel_id": target.ID})
	WriteJSON(w, http.StatusCreated, f)
}

// handleFollowerKeys hands a publisher the keys of the channels following
// this one, and nothing about where they are.
func (s *Server) handleFollowerKeys(w http.ResponseWriter, r *http.Request) {
	source, _, p := s.announcementCtx(w, r)
	if source == nil {
		return
	}
	if !p.Has(perms.SendMessages) && !p.Has(perms.ManageMessages) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You cannot publish here."))
		return
	}
	list, err := s.Store.FollowersOf(r.Context(), source.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, f := range list {
		out = append(out, map[string]any{"id": f.ID, "public_key": f.PublicKey})
	}
	WriteJSON(w, http.StatusOK, map[string]any{"followers": out})
}

// handleFollowsInto lists what a channel follows, with each follow's sealed
// key, for the people of that channel to open what is published into it.
func (s *Server) handleFollowsInto(w http.ResponseWriter, r *http.Request) {
	ch, _ := s.channel(w, r, NeedView)
	if ch == nil {
		return
	}
	list, err := s.Store.FollowsInto(r.Context(), ch.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, s.followViews(r.Context(), list))
}

// followView is a follow with where its posts come from, by name.
type followView struct {
	*store.Follow
	SourceServerName   string  `json:"source_server_name"`
	SourceServerIconID *ids.ID `json:"source_server_icon_id"`
	SourceChannelName  string  `json:"source_channel_name"`
	SourceServerID     *ids.ID `json:"source_server_id"`
}

func (s *Server) followViews(ctx context.Context, list []*store.Follow) []followView {
	out := make([]followView, 0, len(list))
	for _, f := range list {
		v := followView{Follow: f}
		if src, err := s.Store.ChannelByID(ctx, f.SourceID); err == nil {
			v.SourceChannelName = src.Name
			if src.ServerID != nil {
				v.SourceServerID = src.ServerID
				if srv, err := s.Store.ServerByID(ctx, *src.ServerID); err == nil {
					v.SourceServerName, v.SourceServerIconID = srv.Name, srv.IconID
				}
			}
		}
		out = append(out, v)
	}
	return out
}

// handleServerFollows lists every channel a server follows, for its
// Integrations page.
func (s *Server) handleServerFollows(w http.ResponseWriter, r *http.Request) {
	srv, _, p := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	if !p.Has(perms.ManageWebhooks) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Manage Webhooks to see what this server follows."))
		return
	}
	list, err := s.Store.FollowsForServer(r.Context(), srv.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, s.followViews(r.Context(), list))
}

// followTarget loads a follow and the channel its posts go to, for someone
// who can see that channel.
func (s *Server) followTarget(w http.ResponseWriter, r *http.Request) (*store.Follow, *store.Channel, *store.User, perms.Perm) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("fid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, nil, nil, 0
	}
	f, err := s.Store.FollowByID(r.Context(), id)
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, nil, nil, 0
	}
	target, err := s.Store.ChannelByID(r.Context(), f.TargetID)
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, nil, nil, 0
	}
	p, err := s.Store.PermsIn(r.Context(), target, me.ID)
	if err != nil || !p.Has(perms.ViewChannel) {
		WriteError(w, ErrNotFound)
		return nil, nil, nil, 0
	}
	return f, target, me, p
}

// handleFollowSecret seals a follow's key again, under the newest key of the
// channel its posts go to, so people who came after a key change can read them.
func (s *Server) handleFollowSecret(w http.ResponseWriter, r *http.Request) {
	f, target, _, _ := s.followTarget(w, r)
	if f == nil {
		return
	}
	var req struct {
		Secret json.RawMessage `json:"secret"`
	}
	if err := ReadJSON(w, r, &req, 16<<10); err != nil {
		WriteError(w, err)
		return
	}
	env, ok := validEnvelope(req.Secret)
	if !ok || env.Conv != target.KeyConvID {
		WriteError(w, E(http.StatusBadRequest, "invalid_key", "The follow's key has to be sealed for this channel."))
		return
	}
	if err := s.Store.SetFollowSecret(r.Context(), f.ID, string(req.Secret)); err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitChannel(target.ID, "follows_update", map[string]any{"channel_id": target.ID})
	w.WriteHeader(http.StatusNoContent)
}

// handleFollowDelete stops following.
func (s *Server) handleFollowDelete(w http.ResponseWriter, r *http.Request) {
	f, target, me, p := s.followTarget(w, r)
	if f == nil {
		return
	}
	if !p.Has(perms.ManageWebhooks) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Manage Webhooks to stop following."))
		return
	}
	if err := s.Store.DeleteFollow(r.Context(), f.ID); err != nil {
		WriteError(w, err)
		return
	}
	s.audit(r, f.ServerID, me.ID, "follow_delete", "channel", &target.ID, map[string]any{"follow_id": f.ID}, "")
	s.Bcast.EmitChannel(target.ID, "follows_update", map[string]any{"channel_id": target.ID})
	w.WriteHeader(http.StatusNoContent)
}

// handleCrosspost publishes a message of an announcement channel into every
// channel following it, or brings its copies up to date after an edit. Its
// author may publish it, as may anyone who may manage messages there.
func (s *Server) handleCrosspost(w http.ResponseWriter, r *http.Request) {
	source, me, p := s.announcementCtx(w, r)
	if source == nil {
		return
	}
	ctx := r.Context()
	mid, err := ids.Parse(r.PathValue("mid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	m, err := s.Store.MessageByID(ctx, mid, me.ID)
	if err != nil || m.ChannelID != source.ID {
		WriteError(w, ErrNotFound)
		return
	}
	if m.Type != "default" && m.Type != "reply" {
		WriteError(w, E(http.StatusBadRequest, "cannot_publish", "Only messages people wrote can be published."))
		return
	}
	if !(m.AuthorID == me.ID && p.Has(perms.SendMessages)) && !p.Has(perms.ManageMessages) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You can publish your own messages, or anyone's with Manage Messages."))
		return
	}
	var req struct {
		Copies []struct {
			FollowID   ids.ID          `json:"follow_id"`
			Ciphertext json.RawMessage `json:"ciphertext"`
		} `json:"copies"`
	}
	if err := ReadJSON(w, r, &req, int64(store.MaxFollowsPerChannel+1)*(maxCopy+256)); err != nil {
		WriteError(w, err)
		return
	}
	existing, err := s.Store.Crossposts(ctx, mid)
	if err != nil {
		WriteError(w, err)
		return
	}
	// a first publish counts against the channel's allowance; an edit
	// carried to copies already out does not
	first := m.Flags&store.MsgFlagPublished == 0
	if first {
		if ok, retry := s.limPublish.Allow("publish:" + source.ID.String()); !ok {
			w.Header().Set("Retry-After", retryAfter(retry))
			WriteError(w, E(http.StatusTooManyRequests, "publish_limit", "This channel has published as much as it can for now. Try again in a while."))
			return
		}
	}
	follows, err := s.Store.FollowersOf(ctx, source.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	byFollow := map[ids.ID]*store.Follow{}
	for _, f := range follows {
		byFollow[f.ID] = f
	}
	copyOf := map[ids.ID]ids.ID{}
	for _, c := range existing {
		if c.FollowID != nil {
			copyOf[*c.FollowID] = c.MessageID
		}
	}
	srv, err := s.Store.ServerByID(ctx, *source.ServerID)
	if err != nil {
		WriteError(w, err)
		return
	}
	author, err := s.webhookUser(ctx)
	if err != nil {
		WriteError(w, err)
		return
	}
	sent := 0
	for _, c := range req.Copies {
		f := byFollow[c.FollowID]
		if f == nil || !validCopy(c.Ciphertext) {
			continue
		}
		info := crosspostInfo{FollowID: f.ID, ServerID: srv.ID, ServerName: srv.Name, ServerIconID: srv.IconID, ChannelID: source.ID, ChannelName: source.Name, MessageID: m.ID}
		plain := mustJSON(info)
		if copyID, ok := copyOf[f.ID]; ok {
			ct := string(c.Ciphertext)
			now := time.Now().UnixMilli()
			if err := s.Store.SetCrosspost(ctx, copyID, &ct, string(plain), &now); err == nil {
				if shared, err := s.Store.MessageByID(ctx, copyID, 0); err == nil {
					s.Bcast.EmitChannel(f.TargetID, "message_update", messageUpdateEvent{shared, mentionsBefore{[]ids.ID{}, []ids.ID{}, false}})
				}
				sent++
			}
			continue
		}
		copyMsg := &store.Message{ChannelID: f.TargetID, AuthorID: author.ID, Type: "crosspost", Ciphertext: c.Ciphertext, Mentions: []ids.ID{}, MentionRoles: []ids.ID{}, Crosspost: plain}
		// the copy holds the post's files too, so the people following can fetch them
		for _, a := range m.Attachments {
			copyMsg.Attachments = append(copyMsg.Attachments, store.Attachment{BlobID: a.BlobID, Size: a.Size})
		}
		if err := s.Store.InsertCrosspost(ctx, copyMsg, m.ID, f.ID); err != nil {
			s.Log.Warn("crosspost", "follow", f.ID.String(), "err", err)
			continue
		}
		if full, err := s.Store.MessageByID(ctx, copyMsg.ID, 0); err == nil {
			s.Bcast.EmitChannel(f.TargetID, "message_create", full)
		}
		sent++
	}
	// published stays published, followed yet or not
	if first {
		if err := s.Store.SetMessageFlags(ctx, m.ID, m.Flags|store.MsgFlagPublished); err != nil {
			WriteError(w, err)
			return
		}
		m.Flags |= store.MsgFlagPublished
		s.audit(r, srv.ID, me.ID, "message_publish", "channel", &source.ID, map[string]any{"message_id": m.ID, "count": sent}, "")
	}
	// the original now shows it was published, to everyone reading it
	if shared, err := s.Store.MessageByID(ctx, m.ID, 0); err == nil {
		shared.Published = true
		s.Bcast.EmitChannel(source.ID, "message_update", messageUpdateEvent{shared, mentionsBefore{m.Mentions, m.MentionRoles, m.MentionEveryone}})
	}
	WriteJSON(w, http.StatusOK, map[string]any{"published": true, "copies": sent})
}

// originalsGone marks the copies of deleted announcements as such: each keeps
// where it came from and loses what it said.
func (s *Server) originalsGone(ctx context.Context, msgs []ids.ID) {
	for _, id := range msgs {
		copies, err := s.Store.Crossposts(ctx, id)
		if err != nil || len(copies) == 0 {
			continue
		}
		for _, c := range copies {
			shared, err := s.Store.MessageByID(ctx, c.MessageID, 0)
			if err != nil {
				continue
			}
			var info crosspostInfo
			_ = json.Unmarshal(shared.Crosspost, &info)
			info.Deleted = true
			if err := s.Store.ClearCrosspost(ctx, c.MessageID, string(mustJSON(info))); err != nil {
				continue
			}
			if fresh, err := s.Store.MessageByID(ctx, c.MessageID, 0); err == nil {
				s.Bcast.EmitChannel(c.ChannelID, "message_update", messageUpdateEvent{fresh, mentionsBefore{[]ids.ID{}, []ids.ID{}, false}})
			}
		}
	}
}
