package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/store"
)

const (
	maxServerName  = 100
	maxNickname    = 32
	maxTopic       = 1024
	maxServerRoles = 250
	maxServerChans = 500
	maxBanReason   = 512
)

func (s *Server) serverRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/servers", s.authed(s.handleServerCreate))
	mux.Handle("GET /api/v1/servers/{id}", s.authed(s.handleServerGet))
	mux.Handle("PATCH /api/v1/servers/{id}", s.authed(s.handleServerPatch))
	mux.Handle("DELETE /api/v1/servers/{id}", s.authed(s.handleServerDelete))
	mux.Handle("PUT /api/v1/servers/{id}/icon", s.authed(s.handleServerImage("icon")))
	mux.Handle("DELETE /api/v1/servers/{id}/icon", s.authed(s.handleServerImageDelete("icon")))
	mux.Handle("PUT /api/v1/servers/{id}/banner", s.authed(s.handleServerImage("banner")))
	mux.Handle("DELETE /api/v1/servers/{id}/banner", s.authed(s.handleServerImageDelete("banner")))
	mux.Handle("POST /api/v1/servers/{id}/leave", s.authed(s.handleServerLeave))
	mux.Handle("POST /api/v1/servers/{id}/transfer", s.authed(s.handleServerTransfer))
	mux.Handle("GET /api/v1/servers/{id}/channels", s.authed(s.handleServerChannels))
	mux.Handle("POST /api/v1/servers/{id}/channels", s.authed(s.handleServerChannelCreate))
	mux.Handle("PATCH /api/v1/servers/{id}/channels", s.authed(s.handleServerChannelPositions))
	mux.Handle("DELETE /api/v1/channels/{id}", s.authed(s.handleServerChannelDelete))
	mux.Handle("PUT /api/v1/channels/{id}/permissions/{target}", s.authed(s.handleOverwritePut))
	mux.Handle("DELETE /api/v1/channels/{id}/permissions/{target}", s.authed(s.handleOverwriteDelete))
	mux.Handle("GET /api/v1/servers/{id}/roles", s.authed(s.handleRoles))
	mux.Handle("POST /api/v1/servers/{id}/roles", s.authed(s.handleRoleCreate))
	mux.Handle("PATCH /api/v1/servers/{id}/roles", s.authed(s.handleRolePositions))
	mux.Handle("PATCH /api/v1/servers/{id}/roles/{rid}", s.authed(s.handleRolePatch))
	mux.Handle("DELETE /api/v1/servers/{id}/roles/{rid}", s.authed(s.handleRoleDelete))
	mux.Handle("GET /api/v1/servers/{id}/members", s.authed(s.handleMembers))
	mux.Handle("GET /api/v1/servers/{id}/members/{uid}", s.authed(s.handleMemberGet))
	mux.Handle("PATCH /api/v1/servers/{id}/members/{uid}", s.authed(s.handleMemberPatch))
	mux.Handle("DELETE /api/v1/servers/{id}/members/{uid}", s.authed(s.handleMemberKick))
	mux.Handle("PUT /api/v1/servers/{id}/members/{uid}/roles/{rid}", s.authed(s.handleMemberRole(true)))
	mux.Handle("DELETE /api/v1/servers/{id}/members/{uid}/roles/{rid}", s.authed(s.handleMemberRole(false)))
	mux.Handle("GET /api/v1/servers/{id}/bans", s.authed(s.handleBans))
	mux.Handle("PUT /api/v1/servers/{id}/bans/{uid}", s.authed(s.handleBanPut))
	mux.Handle("DELETE /api/v1/servers/{id}/bans/{uid}", s.authed(s.handleBanDelete))
	mux.Handle("GET /api/v1/servers/{id}/invites", s.authed(s.handleServerInvites))
	mux.Handle("POST /api/v1/channels/{id}/invites", s.authed(s.handleInviteCreate))
	mux.HandleFunc("GET /api/v1/invites/{code}", s.handleInvitePreview)
	mux.Handle("POST /api/v1/invites/{code}", s.authed(s.handleInviteJoin))
	mux.Handle("DELETE /api/v1/invites/{code}", s.authed(s.handleInviteDelete))
	mux.Handle("GET /api/v1/servers/{id}/audit-log", s.authed(s.handleAuditLog))
	mux.Handle("GET /api/v1/servers/{id}/keys", s.authed(s.handleServerKeys))
}

// serverCtx loads the server from {id} and checks the caller holds need.
func (s *Server) serverCtx(w http.ResponseWriter, r *http.Request, need perms.Perm) (*store.Server, *store.User, perms.Perm) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, nil, 0
	}
	srv, err := s.Store.ServerByID(r.Context(), id)
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, nil, 0
	}
	p, err := s.Store.ServerPerms(r.Context(), srv.ID, me.ID)
	if err != nil {
		WriteError(w, err)
		return nil, nil, 0
	}
	if p == 0 {
		WriteError(w, ErrNotFound)
		return nil, nil, 0
	}
	if need != 0 && !p.Has(need) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You do not have permission to do that."))
		return nil, nil, 0
	}
	return srv, me, p
}

func (s *Server) audit(r *http.Request, serverID, actor ids.ID, action, targetType string, target *ids.ID, changes any, reason string) {
	var raw json.RawMessage
	if changes != nil {
		raw, _ = json.Marshal(changes)
	}
	if err := s.Store.Audit(r.Context(), &store.AuditEntry{ServerID: serverID, ActorID: actor, Action: action, TargetType: targetType, TargetID: target, Changes: raw, Reason: reason}); err != nil {
		s.Log.Warn("audit", "err", err)
	}
}

func (s *Server) emitServer(ctx context.Context, serverID ids.ID, event string, data any) {
	members, err := s.Store.MemberIDs(ctx, serverID)
	if err != nil {
		return
	}
	s.Bcast.EmitUsers(members, event, data)
}

// visibility maps user → set of viewable channel ids; used to diff after permission changes.
type visibility map[ids.ID]map[ids.ID]bool

func (s *Server) snapshotVisibility(ctx context.Context, serverID ids.ID) (visibility, error) {
	members, err := s.Store.MemberIDs(ctx, serverID)
	if err != nil {
		return nil, err
	}
	out := visibility{}
	for _, uid := range members {
		vis, err := s.Store.ViewableServerChannels(ctx, serverID, uid)
		if err != nil {
			return nil, err
		}
		set := map[ids.ID]bool{}
		for id := range vis {
			set[id] = true
		}
		out[uid] = set
	}
	return out, nil
}

// syncVisibility emits channel_create/channel_delete to members whose view of
// the server changed, and channel_update for a changed channel to those who
// still see it. It also flags conversations whose viewer set shrank.
func (s *Server) syncVisibility(ctx context.Context, serverID ids.ID, before visibility, changed *ids.ID) {
	after, err := s.snapshotVisibility(ctx, serverID)
	if err != nil {
		return
	}
	chans, err := s.Store.ServerChannels(ctx, serverID)
	if err != nil {
		return
	}
	byID := map[ids.ID]*store.Channel{}
	for _, c := range chans {
		byID[c.ID] = c
	}
	shrank := map[ids.ID]bool{}
	for uid, now := range after {
		prev := before[uid]
		for chID := range now {
			if !prev[chID] {
				if c := byID[chID]; c != nil {
					s.Bcast.EmitUsers([]ids.ID{uid}, "channel_create", c)
				}
			} else if changed != nil && chID == *changed {
				if c := byID[chID]; c != nil {
					s.Bcast.EmitUsers([]ids.ID{uid}, "channel_update", c)
				}
			}
		}
		for chID := range prev {
			if !now[chID] {
				s.Bcast.EmitUsers([]ids.ID{uid}, "channel_delete", map[string]any{"id": chID})
				shrank[chID] = true
			}
		}
	}
	for chID := range shrank {
		if c := byID[chID]; c != nil && c.KeyConvID == chID {
			tr := true
			_ = s.Store.SetKeyFlags(ctx, chID, &tr, nil)
			if viewers, err := s.Store.ChannelViewers(ctx, chID); err == nil {
				s.Bcast.EmitUsers(viewers, "key_rotation_needed", map[string]any{"conv_id": chID})
			}
		}
	}
	for chID := range byID {
		s.Bcast.KeysMaybeNeeded(byID[chID].KeyConvID)
	}
}

// --- servers -------------------------------------------------------------

func (s *Server) handleServerCreate(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	var req struct {
		Name string `json:"name"`
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	name, ok := cleanServerName(req.Name)
	if !ok {
		WriteError(w, E(http.StatusBadRequest, "invalid_name", "Server names are 1–100 characters."))
		return
	}
	srv, err := s.Store.CreateServer(r.Context(), me.ID, name)
	if err != nil {
		WriteError(w, err)
		return
	}
	view, _, err := s.serverView(r.Context(), srv, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitUsers([]ids.ID{me.ID}, "server_create", view)
	WriteJSON(w, http.StatusCreated, view)
}

func (s *Server) handleServerGet(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	view, users, err := s.serverView(r.Context(), srv, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"server": view, "users": users})
}

func (s *Server) handleServerPatch(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, perms.ManageServer)
	if srv == nil {
		return
	}
	var raw map[string]json.RawMessage
	if err := ReadJSON(w, r, &raw, 16<<10); err != nil {
		WriteError(w, err)
		return
	}
	var p store.ServerPatch
	changes := map[string]any{}
	if v, ok := raw["name"]; ok {
		var name string
		if json.Unmarshal(v, &name) != nil {
			WriteError(w, E(http.StatusBadRequest, "invalid_name", "Server names are 1–100 characters."))
			return
		}
		clean, ok := cleanServerName(name)
		if !ok {
			WriteError(w, E(http.StatusBadRequest, "invalid_name", "Server names are 1–100 characters."))
			return
		}
		p.Name = &clean
		changes["name"] = clean
	}
	if v, ok := raw["description"]; ok {
		var d string
		if string(v) != "null" && json.Unmarshal(v, &d) != nil {
			WriteError(w, E(http.StatusBadRequest, "invalid_description", "Description is malformed."))
			return
		}
		clean, ok := CleanText(d, 1000)
		if !ok {
			WriteError(w, E(http.StatusBadRequest, "invalid_description", "Descriptions are at most 1000 characters."))
			return
		}
		p.Description = &clean
		changes["description"] = clean
	}
	if v, ok := raw["system_channel_id"]; ok {
		if string(v) == "null" {
			var nilID *ids.ID
			p.SystemChannelID = &nilID
		} else {
			var id ids.ID
			if json.Unmarshal(v, &id) != nil {
				WriteError(w, E(http.StatusBadRequest, "invalid_channel", "system_channel_id is malformed."))
				return
			}
			ch, err := s.Store.ChannelByID(r.Context(), id)
			if err != nil || ch.ServerID == nil || *ch.ServerID != srv.ID || ch.Type != "text" {
				WriteError(w, E(http.StatusBadRequest, "invalid_channel", "The system channel must be a text channel of this server."))
				return
			}
			idp := &id
			p.SystemChannelID = &idp
		}
		changes["system_channel_id"] = string(v)
	}
	if v, ok := raw["default_notifications"]; ok {
		var n int
		if json.Unmarshal(v, &n) != nil || (n != 0 && n != 1) {
			WriteError(w, E(http.StatusBadRequest, "invalid_value", "default_notifications must be 0 or 1."))
			return
		}
		p.DefaultNotifications = &n
		changes["default_notifications"] = n
	}
	if err := s.Store.UpdateServer(r.Context(), srv.ID, p); err != nil {
		WriteError(w, err)
		return
	}
	updated, _ := s.Store.ServerByID(r.Context(), srv.ID)
	s.audit(r, srv.ID, me.ID, "server_update", "server", &srv.ID, changes, "")
	s.emitServer(r.Context(), srv.ID, "server_update", updated)
	WriteJSON(w, http.StatusOK, updated)
}

func (s *Server) handleServerImage(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		srv, me, _ := s.serverCtx(w, r, perms.ManageServer)
		if srv == nil {
			return
		}
		lim := s.limitsFor(map[bool]string{true: "banner", false: "icon"}[kind == "banner"])
		r.Body = http.MaxBytesReader(w, r.Body, lim.MaxBytes+1)
		b, err := s.Media.PutPublic(r.Context(), map[bool]string{true: "banner", false: "icon"}[kind == "banner"], r.Body, lim, me.ID)
		if err != nil {
			WriteError(w, err)
			return
		}
		bid := b.ID
		ptr := &bid
		var old *ids.ID
		p := store.ServerPatch{}
		if kind == "banner" {
			old = srv.BannerID
			p.BannerID = &ptr
		} else {
			old = srv.IconID
			p.IconID = &ptr
		}
		if err := s.Store.UpdateServer(r.Context(), srv.ID, p); err != nil {
			WriteError(w, err)
			return
		}
		if old != nil && *old != b.ID {
			_ = s.Store.AddBlobRef(r.Context(), *old, -1)
		}
		updated, _ := s.Store.ServerByID(r.Context(), srv.ID)
		s.audit(r, srv.ID, me.ID, "server_update", "server", &srv.ID, map[string]any{kind: b.ID}, "")
		s.emitServer(r.Context(), srv.ID, "server_update", updated)
		WriteJSON(w, http.StatusOK, updated)
	}
}

func (s *Server) handleServerImageDelete(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		srv, me, _ := s.serverCtx(w, r, perms.ManageServer)
		if srv == nil {
			return
		}
		var nilID *ids.ID
		var old *ids.ID
		p := store.ServerPatch{}
		if kind == "banner" {
			old, p.BannerID = srv.BannerID, &nilID
		} else {
			old, p.IconID = srv.IconID, &nilID
		}
		if err := s.Store.UpdateServer(r.Context(), srv.ID, p); err != nil {
			WriteError(w, err)
			return
		}
		if old != nil {
			_ = s.Store.AddBlobRef(r.Context(), *old, -1)
		}
		updated, _ := s.Store.ServerByID(r.Context(), srv.ID)
		s.audit(r, srv.ID, me.ID, "server_update", "server", &srv.ID, map[string]any{kind: nil}, "")
		s.emitServer(r.Context(), srv.ID, "server_update", updated)
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *Server) handleServerDelete(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	if srv.OwnerID != me.ID {
		WriteError(w, E(http.StatusForbidden, "not_owner", "Only the owner can delete a server."))
		return
	}
	members, _ := s.Store.MemberIDs(r.Context(), srv.ID)
	if err := s.Store.DeleteServer(r.Context(), srv.ID); err != nil {
		WriteError(w, err)
		return
	}
	s.Bcast.EmitUsers(members, "server_delete", map[string]any{"id": srv.ID})
	w.WriteHeader(http.StatusNoContent)
}

// removeMember drops a membership, tells everyone, and flags keys for rotation.
func (s *Server) removeMember(r *http.Request, srv *store.Server, uid ids.ID, event string, extra map[string]any) error {
	ctx := r.Context()
	visible, _ := s.Store.ViewableServerChannels(ctx, srv.ID, uid)
	if err := s.Store.RemoveMember(ctx, srv.ID, uid); err != nil {
		return err
	}
	payload := map[string]any{"server_id": srv.ID, "user_id": uid}
	for k, v := range extra {
		payload[k] = v
	}
	s.emitServer(ctx, srv.ID, event, payload)
	s.Bcast.EmitUsers([]ids.ID{uid}, "server_delete", map[string]any{"id": srv.ID})
	// rotate the server root and every private channel the user could read
	convs := []ids.ID{srv.ID}
	chans, _ := s.Store.ServerChannels(ctx, srv.ID)
	for _, c := range chans {
		if _, ok := visible[c.ID]; ok && c.KeyConvID == c.ID {
			convs = append(convs, c.ID)
		}
	}
	tr := true
	remaining, _ := s.Store.MemberIDs(ctx, srv.ID)
	for _, conv := range convs {
		_ = s.Store.SetKeyFlags(ctx, conv, &tr, nil)
		targets := remaining
		if conv != srv.ID {
			targets, _ = s.Store.ChannelViewers(ctx, conv)
		}
		s.Bcast.EmitUsers(targets, "key_rotation_needed", map[string]any{"conv_id": conv})
	}
	return nil
}

func (s *Server) handleServerLeave(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	if srv.OwnerID == me.ID {
		WriteError(w, E(http.StatusBadRequest, "owner_cannot_leave", "Transfer ownership or delete the server first."))
		return
	}
	if err := s.removeMember(r, srv, me.ID, "member_remove", map[string]any{"reason": "leave"}); err != nil {
		WriteError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleServerTransfer(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	if srv.OwnerID != me.ID {
		WriteError(w, E(http.StatusForbidden, "not_owner", "Only the owner can transfer a server."))
		return
	}
	var req struct {
		UserID ids.ID `json:"user_id"`
	}
	if err := ReadJSON(w, r, &req, 1<<10); err != nil {
		WriteError(w, err)
		return
	}
	if ok, _ := s.Store.IsMember(r.Context(), srv.ID, req.UserID); !ok {
		WriteError(w, E(http.StatusBadRequest, "not_member", "The new owner must be a member."))
		return
	}
	if err := s.Store.UpdateServer(r.Context(), srv.ID, store.ServerPatch{OwnerID: &req.UserID}); err != nil {
		WriteError(w, err)
		return
	}
	updated, _ := s.Store.ServerByID(r.Context(), srv.ID)
	s.audit(r, srv.ID, me.ID, "server_transfer", "user", &req.UserID, nil, "")
	s.emitServer(r.Context(), srv.ID, "server_update", updated)
	WriteJSON(w, http.StatusOK, updated)
}

// --- channels ------------------------------------------------------------

func (s *Server) handleServerChannels(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	view, _, err := s.serverView(r.Context(), srv, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, view.Channels)
}

// cleanServerName collapses whitespace in a server or role name.
func cleanServerName(name string) (string, bool) {
	clean, ok := CleanText(strings.Join(strings.Fields(name), " "), maxServerName)
	return clean, ok && clean != ""
}

func cleanChannelName(name, typ string) (string, bool) {
	clean, ok := CleanText(strings.ReplaceAll(name, "\n", " "), maxServerName)
	if !ok || clean == "" {
		return "", false
	}
	if typ == "text" {
		clean = strings.ToLower(strings.Join(strings.Fields(clean), "-"))
	}
	return clean, true
}

func (s *Server) handleServerChannelCreate(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, perms.ManageChannels)
	if srv == nil {
		return
	}
	var req struct {
		Type     string  `json:"type"`
		Name     string  `json:"name"`
		ParentID *ids.ID `json:"parent_id"`
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	if !OneOf(req.Type, "text", "voice", "category") {
		WriteError(w, E(http.StatusBadRequest, "invalid_type", "type must be text, voice or category."))
		return
	}
	name, ok := cleanChannelName(req.Name, req.Type)
	if !ok {
		WriteError(w, E(http.StatusBadRequest, "invalid_name", "Channel names are 1–100 characters."))
		return
	}
	if req.Type == "category" {
		req.ParentID = nil
	} else if req.ParentID != nil {
		parent, err := s.Store.ChannelByID(r.Context(), *req.ParentID)
		if err != nil || parent.ServerID == nil || *parent.ServerID != srv.ID || parent.Type != "category" {
			WriteError(w, E(http.StatusBadRequest, "invalid_parent", "parent_id must be a category of this server."))
			return
		}
	}
	existing, _ := s.Store.ServerChannels(r.Context(), srv.ID)
	if len(existing) >= maxServerChans {
		WriteError(w, E(http.StatusBadRequest, "too_many_channels", "This server has reached the channel limit."))
		return
	}
	before, _ := s.snapshotVisibility(r.Context(), srv.ID)
	ch, err := s.Store.CreateServerChannel(r.Context(), srv.ID, req.Type, name, req.ParentID)
	if err != nil {
		WriteError(w, err)
		return
	}
	s.audit(r, srv.ID, me.ID, "channel_create", "channel", &ch.ID, map[string]any{"name": name, "type": req.Type}, "")
	s.syncVisibility(r.Context(), srv.ID, before, nil)
	WriteJSON(w, http.StatusCreated, ch)
}

func (s *Server) handleServerChannelPositions(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, perms.ManageChannels)
	if srv == nil {
		return
	}
	var req []struct {
		ID       ids.ID          `json:"id"`
		Position int             `json:"position"`
		ParentID json.RawMessage `json:"parent_id"`
	}
	if err := ReadJSON(w, r, &req, 64<<10); err != nil {
		WriteError(w, err)
		return
	}
	chans, _ := s.Store.ServerChannels(r.Context(), srv.ID)
	byID := map[ids.ID]*store.Channel{}
	for _, c := range chans {
		byID[c.ID] = c
	}
	var list []store.ChannelPosition
	for _, item := range req {
		c := byID[item.ID]
		if c == nil {
			WriteError(w, E(http.StatusBadRequest, "invalid_channel", "One of the channels is not in this server."))
			return
		}
		pos := store.ChannelPosition{ID: item.ID, Position: item.Position}
		if len(item.ParentID) > 0 {
			pos.ParentSet = true
			if string(item.ParentID) != "null" {
				var pid ids.ID
				if json.Unmarshal(item.ParentID, &pid) != nil {
					WriteError(w, E(http.StatusBadRequest, "invalid_parent", "parent_id is malformed."))
					return
				}
				parent := byID[pid]
				if parent == nil || parent.Type != "category" || c.Type == "category" {
					WriteError(w, E(http.StatusBadRequest, "invalid_parent", "Channels can only be moved into categories."))
					return
				}
				pos.ParentID = &pid
			}
		}
		list = append(list, pos)
	}
	if err := s.Store.SetChannelPositions(r.Context(), srv.ID, list); err != nil {
		WriteError(w, err)
		return
	}
	s.audit(r, srv.ID, me.ID, "channel_positions", "server", &srv.ID, req, "")
	updated, _ := s.Store.ServerChannels(r.Context(), srv.ID)
	// every member receives the new order for the channels they can see
	members, _ := s.Store.MemberIDs(r.Context(), srv.ID)
	for _, uid := range members {
		vis, err := s.Store.ViewableServerChannels(r.Context(), srv.ID, uid)
		if err != nil {
			continue
		}
		out := []map[string]any{}
		for _, c := range updated {
			if _, ok := vis[c.ID]; ok {
				out = append(out, map[string]any{"id": c.ID, "position": c.Position, "parent_id": c.ParentID})
			}
		}
		s.Bcast.EmitUsers([]ids.ID{uid}, "channel_positions", map[string]any{"server_id": srv.ID, "channels": out})
	}
	WriteJSON(w, http.StatusOK, updated)
}

// handleServerChannelPatch backs PATCH /channels/{id} for server channels.
func (s *Server) handleServerChannelPatch(w http.ResponseWriter, r *http.Request, ch *store.Channel, me *store.User) {
	p, _, err := s.Store.ChannelPerms(r.Context(), ch.ID, me.ID)
	if err != nil || !p.Has(perms.ManageChannels) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Manage Channels to edit this channel."))
		return
	}
	var req struct {
		Name            *string `json:"name"`
		Topic           *string `json:"topic"`
		NSFW            *bool   `json:"nsfw"`
		SlowmodeSeconds *int    `json:"slowmode_seconds"`
		UserLimit       *int    `json:"user_limit"`
	}
	if err := ReadJSON(w, r, &req, 8<<10); err != nil {
		WriteError(w, err)
		return
	}
	var patch store.ChannelPatch
	changes := map[string]any{}
	if req.Name != nil {
		name, ok := cleanChannelName(*req.Name, ch.Type)
		if !ok {
			WriteError(w, E(http.StatusBadRequest, "invalid_name", "Channel names are 1–100 characters."))
			return
		}
		patch.Name = &name
		changes["name"] = name
	}
	if req.Topic != nil {
		topic, ok := CleanText(*req.Topic, maxTopic)
		if !ok {
			WriteError(w, E(http.StatusBadRequest, "invalid_topic", "Topics are at most 1024 characters."))
			return
		}
		patch.Topic = &topic
		changes["topic"] = topic
	}
	if req.NSFW != nil {
		patch.NSFW = req.NSFW
		changes["nsfw"] = *req.NSFW
	}
	if req.SlowmodeSeconds != nil {
		if *req.SlowmodeSeconds < 0 || *req.SlowmodeSeconds > 21600 {
			WriteError(w, E(http.StatusBadRequest, "invalid_slowmode", "Slow mode is 0–21600 seconds."))
			return
		}
		patch.SlowmodeSeconds = req.SlowmodeSeconds
		changes["slowmode_seconds"] = *req.SlowmodeSeconds
	}
	if req.UserLimit != nil {
		if *req.UserLimit < 0 || *req.UserLimit > 99 {
			WriteError(w, E(http.StatusBadRequest, "invalid_limit", "User limit is 0–99."))
			return
		}
		patch.UserLimit = req.UserLimit
		changes["user_limit"] = *req.UserLimit
	}
	if err := s.Store.UpdateChannel(r.Context(), ch.ID, patch); err != nil {
		WriteError(w, err)
		return
	}
	updated, _ := s.Store.ChannelByID(r.Context(), ch.ID)
	s.audit(r, *ch.ServerID, me.ID, "channel_update", "channel", &ch.ID, changes, "")
	s.Bcast.EmitChannel(ch.ID, "channel_update", updated)
	WriteJSON(w, http.StatusOK, updated)
}

func (s *Server) handleServerChannelDelete(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	ch, err := s.Store.ChannelByID(r.Context(), id)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	if ch.Type == "subchat" {
		if !hasID(ch.Recipients, me.ID) {
			WriteError(w, ErrNotFound)
			return
		}
		s.handleSubchatDelete(w, r, ch, me)
		return
	}
	if s.isDM(ch) {
		// the same verb closes or deletes a conversation
		s.handleDMDelete(w, r)
		return
	}
	if ch.ServerID == nil {
		WriteError(w, ErrNotFound)
		return
	}
	p, _, err := s.Store.ChannelPerms(r.Context(), ch.ID, me.ID)
	if err != nil || p == 0 {
		WriteError(w, ErrNotFound)
		return
	}
	if !p.Has(perms.ManageChannels) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Manage Channels to delete this channel."))
		return
	}
	viewers, _ := s.Store.ChannelViewers(r.Context(), ch.ID)
	s.voiceChannelDeleted(r.Context(), ch)
	if err := s.Store.DeleteChannel(r.Context(), ch.ID); err != nil {
		WriteError(w, err)
		return
	}
	s.audit(r, *ch.ServerID, me.ID, "channel_delete", "channel", &ch.ID, map[string]any{"name": ch.Name}, "")
	s.Bcast.EmitUsers(viewers, "channel_delete", map[string]any{"id": ch.ID, "server_id": ch.ServerID})
	if ch.Type == "category" {
		// children were unparented: tell viewers their new shape
		if updated, err := s.Store.ServerChannels(r.Context(), *ch.ServerID); err == nil {
			for _, c := range updated {
				if c.ParentID == nil && c.Type != "category" {
					s.Bcast.EmitChannel(c.ID, "channel_update", c)
				}
			}
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// channelManageCtx loads a server channel and requires ManageRoles (overwrite edits).
func (s *Server) channelManageCtx(w http.ResponseWriter, r *http.Request) (*store.Channel, *store.User, perms.Perm) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, nil, 0
	}
	ch, err := s.Store.ChannelByID(r.Context(), id)
	if err != nil || ch.ServerID == nil {
		WriteError(w, ErrNotFound)
		return nil, nil, 0
	}
	p, _, err := s.Store.ChannelPerms(r.Context(), ch.ID, me.ID)
	if err != nil || p == 0 {
		WriteError(w, ErrNotFound)
		return nil, nil, 0
	}
	if !p.Has(perms.ManageRoles) && !p.Has(perms.ManageChannels) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Manage Roles or Manage Channels to edit permissions."))
		return nil, nil, 0
	}
	return ch, me, p
}

func (s *Server) handleOverwritePut(w http.ResponseWriter, r *http.Request) {
	ch, me, actorPerms := s.channelManageCtx(w, r)
	if ch == nil {
		return
	}
	target, err := ids.Parse(r.PathValue("target"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	var req struct {
		Type  string     `json:"type"`
		Allow perms.Perm `json:"allow"`
		Deny  perms.Perm `json:"deny"`
	}
	if err := ReadJSON(w, r, &req, 2<<10); err != nil {
		WriteError(w, err)
		return
	}
	if !OneOf(req.Type, "role", "member") {
		WriteError(w, E(http.StatusBadRequest, "invalid_type", "type must be role or member."))
		return
	}
	if req.Type == "role" {
		role, err := s.Store.RoleByID(r.Context(), target)
		if err != nil || role.ServerID != *ch.ServerID {
			WriteError(w, E(http.StatusBadRequest, "invalid_target", "That role is not in this server."))
			return
		}
	} else if ok, _ := s.Store.IsMember(r.Context(), *ch.ServerID, target); !ok {
		WriteError(w, E(http.StatusBadRequest, "invalid_target", "That user is not a member."))
		return
	}
	// one can only grant or deny permissions one holds (owners/admins hold all)
	if actorPerms != perms.All && ((req.Allow|req.Deny)&^actorPerms) != 0 {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You cannot manage permissions you do not have."))
		return
	}
	before, _ := s.snapshotVisibility(r.Context(), *ch.ServerID)
	ow := store.Overwrite{ChannelID: ch.ID, TargetID: target, TargetType: req.Type, Allow: req.Allow &^ req.Deny, Deny: req.Deny}
	if err := s.Store.SetOverwrite(r.Context(), ow); err != nil {
		WriteError(w, err)
		return
	}
	s.audit(r, *ch.ServerID, me.ID, "overwrite_update", "channel", &ch.ID, ow, "")
	resp := map[string]any{"overwrite": ow}
	if s.channelBecamePrivate(r.Context(), ch) {
		tr := true
		_ = s.Store.SetKeyFlags(r.Context(), ch.ID, nil, &tr)
		resp["key_actions"] = map[string]any{"needs_own_key": true, "conv_id": ch.ID}
	}
	s.syncVisibility(r.Context(), *ch.ServerID, before, &ch.ID)
	WriteJSON(w, http.StatusOK, resp)
}

// channelBecamePrivate reports whether @everyone can no longer view a channel
// that still encrypts under the server root.
func (s *Server) channelBecamePrivate(ctx context.Context, ch *store.Channel) bool {
	fresh, err := s.Store.ChannelByID(ctx, ch.ID)
	if err != nil || fresh.KeyConvID == ch.ID {
		return false
	}
	roles, err := s.Store.Roles(ctx, *ch.ServerID)
	if err != nil {
		return false
	}
	pr := make([]perms.Role, len(roles))
	for i, ro := range roles {
		pr[i] = perms.Role{ID: ro.ID, Position: ro.Position, Permissions: ro.Permissions}
	}
	po := make([]perms.Overwrite, len(fresh.Overwrites))
	for i, ow := range fresh.Overwrites {
		po[i] = perms.Overwrite{TargetID: ow.TargetID, Kind: ow.TargetType, Allow: ow.Allow, Deny: ow.Deny}
	}
	return !perms.Compute(*ch.ServerID, pr, perms.Member{}, false, po).Has(perms.ViewChannel)
}

func (s *Server) handleOverwriteDelete(w http.ResponseWriter, r *http.Request) {
	ch, me, _ := s.channelManageCtx(w, r)
	if ch == nil {
		return
	}
	target, err := ids.Parse(r.PathValue("target"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	before, _ := s.snapshotVisibility(r.Context(), *ch.ServerID)
	if err := s.Store.DeleteOverwrite(r.Context(), ch.ID, target); err != nil {
		WriteError(w, err)
		return
	}
	s.audit(r, *ch.ServerID, me.ID, "overwrite_delete", "channel", &ch.ID, map[string]any{"target": target}, "")
	s.syncVisibility(r.Context(), *ch.ServerID, before, &ch.ID)
	w.WriteHeader(http.StatusNoContent)
}

// --- roles ---------------------------------------------------------------

func (s *Server) actorHighest(ctx context.Context, srv *store.Server, uid ids.ID) (int, bool) {
	if srv.OwnerID == uid {
		return 1 << 30, true
	}
	if s.Store.IsInstanceAdmin(ctx, uid) {
		// above every role, but still answerable to the server's owner
		return 1<<30 - 1, false
	}
	m, err := s.Store.Member(ctx, srv.ID, uid)
	if err != nil {
		return 0, false
	}
	roles, _ := s.Store.Roles(ctx, srv.ID)
	pr := make([]perms.Role, len(roles))
	for i, ro := range roles {
		pr[i] = perms.Role{ID: ro.ID, Position: ro.Position, Permissions: ro.Permissions}
	}
	return perms.HighestPosition(pr, perms.Member{UserID: uid, RoleIDs: m.RoleIDs}), false
}

func (s *Server) handleRoles(w http.ResponseWriter, r *http.Request) {
	srv, _, _ := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	roles, err := s.Store.Roles(r.Context(), srv.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, roles)
}

type roleBody struct {
	Name        *string     `json:"name"`
	Color       *int        `json:"color"`
	Hoist       *bool       `json:"hoist"`
	Mentionable *bool       `json:"mentionable"`
	Permissions *perms.Perm `json:"permissions"`
}

func (s *Server) handleRoleCreate(w http.ResponseWriter, r *http.Request) {
	srv, me, actorPerms := s.serverCtx(w, r, perms.ManageRoles)
	if srv == nil {
		return
	}
	var req roleBody
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	name := "new role"
	if req.Name != nil {
		clean, ok := cleanServerName(*req.Name)
		if !ok {
			WriteError(w, E(http.StatusBadRequest, "invalid_name", "Role names are 1–100 characters."))
			return
		}
		name = clean
	}
	var p perms.Perm
	if req.Permissions != nil {
		p = *req.Permissions
	}
	if actorPerms != perms.All && (p&^actorPerms) != 0 {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You cannot grant permissions you do not have."))
		return
	}
	color := 0
	if req.Color != nil && *req.Color >= 0 && *req.Color <= 0xFFFFFF {
		color = *req.Color
	}
	roles, _ := s.Store.Roles(r.Context(), srv.ID)
	if len(roles) >= maxServerRoles {
		WriteError(w, E(http.StatusBadRequest, "too_many_roles", "This server has reached the role limit."))
		return
	}
	role, err := s.Store.CreateRole(r.Context(), srv.ID, name, p, color)
	if err != nil {
		WriteError(w, err)
		return
	}
	if (req.Hoist != nil && *req.Hoist) || (req.Mentionable != nil && *req.Mentionable) {
		_ = s.Store.UpdateRole(r.Context(), role.ID, store.RolePatch{Hoist: req.Hoist, Mentionable: req.Mentionable})
		role, _ = s.Store.RoleByID(r.Context(), role.ID)
	}
	s.audit(r, srv.ID, me.ID, "role_create", "role", &role.ID, map[string]any{"name": name}, "")
	s.emitServer(r.Context(), srv.ID, "role_create", role)
	WriteJSON(w, http.StatusCreated, role)
}

func (s *Server) roleCtx(w http.ResponseWriter, r *http.Request) (*store.Server, *store.User, *store.Role, perms.Perm) {
	srv, me, actorPerms := s.serverCtx(w, r, perms.ManageRoles)
	if srv == nil {
		return nil, nil, nil, 0
	}
	rid, err := ids.Parse(r.PathValue("rid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, nil, nil, 0
	}
	role, err := s.Store.RoleByID(r.Context(), rid)
	if err != nil || role.ServerID != srv.ID {
		WriteError(w, ErrNotFound)
		return nil, nil, nil, 0
	}
	highest, isOwner := s.actorHighest(r.Context(), srv, me.ID)
	if role.ID != srv.ID && !perms.CanManageRole(highest, isOwner, perms.Role{ID: role.ID, Position: role.Position}) {
		WriteError(w, E(http.StatusForbidden, "role_hierarchy", "You can only manage roles below your highest role."))
		return nil, nil, nil, 0
	}
	return srv, me, role, actorPerms
}

func (s *Server) handleRolePatch(w http.ResponseWriter, r *http.Request) {
	srv, me, role, actorPerms := s.roleCtx(w, r)
	if srv == nil {
		return
	}
	var req roleBody
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	var p store.RolePatch
	changes := map[string]any{}
	if req.Name != nil && role.ID != srv.ID {
		clean, ok := cleanServerName(*req.Name)
		if !ok {
			WriteError(w, E(http.StatusBadRequest, "invalid_name", "Role names are 1–100 characters."))
			return
		}
		p.Name = &clean
		changes["name"] = clean
	}
	if req.Color != nil {
		if *req.Color < 0 || *req.Color > 0xFFFFFF {
			WriteError(w, E(http.StatusBadRequest, "invalid_color", "color must be 0–16777215."))
			return
		}
		p.Color = req.Color
		changes["color"] = *req.Color
	}
	if req.Hoist != nil && role.ID != srv.ID {
		p.Hoist = req.Hoist
		changes["hoist"] = *req.Hoist
	}
	if req.Mentionable != nil {
		p.Mentionable = req.Mentionable
		changes["mentionable"] = *req.Mentionable
	}
	if req.Permissions != nil {
		diff := *req.Permissions ^ role.Permissions
		if actorPerms != perms.All && (diff&^actorPerms) != 0 {
			WriteError(w, E(http.StatusForbidden, "missing_permission", "You cannot change permissions you do not have."))
			return
		}
		p.Permissions = req.Permissions
		changes["permissions"] = req.Permissions
	}
	before, _ := s.snapshotVisibility(r.Context(), srv.ID)
	if err := s.Store.UpdateRole(r.Context(), role.ID, p); err != nil {
		WriteError(w, err)
		return
	}
	updated, _ := s.Store.RoleByID(r.Context(), role.ID)
	s.audit(r, srv.ID, me.ID, "role_update", "role", &role.ID, changes, "")
	s.emitServer(r.Context(), srv.ID, "role_update", updated)
	if req.Permissions != nil {
		s.syncVisibility(r.Context(), srv.ID, before, nil)
	}
	WriteJSON(w, http.StatusOK, updated)
}

func (s *Server) handleRoleDelete(w http.ResponseWriter, r *http.Request) {
	srv, me, role, _ := s.roleCtx(w, r)
	if srv == nil {
		return
	}
	if role.ID == srv.ID {
		WriteError(w, E(http.StatusBadRequest, "everyone_role", "@everyone cannot be deleted."))
		return
	}
	before, _ := s.snapshotVisibility(r.Context(), srv.ID)
	if err := s.Store.DeleteRole(r.Context(), role.ID); err != nil {
		WriteError(w, err)
		return
	}
	s.audit(r, srv.ID, me.ID, "role_delete", "role", &role.ID, map[string]any{"name": role.Name}, "")
	s.emitServer(r.Context(), srv.ID, "role_delete", map[string]any{"id": role.ID, "server_id": srv.ID})
	s.syncVisibility(r.Context(), srv.ID, before, nil)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRolePositions(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, perms.ManageRoles)
	if srv == nil {
		return
	}
	var req []struct {
		ID       ids.ID `json:"id"`
		Position int    `json:"position"`
	}
	if err := ReadJSON(w, r, &req, 32<<10); err != nil {
		WriteError(w, err)
		return
	}
	highest, isOwner := s.actorHighest(r.Context(), srv, me.ID)
	positions := map[ids.ID]int{}
	for _, item := range req {
		role, err := s.Store.RoleByID(r.Context(), item.ID)
		if err != nil || role.ServerID != srv.ID || role.ID == srv.ID {
			continue
		}
		if !perms.CanManageRole(highest, isOwner, perms.Role{ID: role.ID, Position: role.Position}) || (!isOwner && item.Position >= highest) {
			WriteError(w, E(http.StatusForbidden, "role_hierarchy", "You can only reorder roles below your highest role."))
			return
		}
		positions[item.ID] = item.Position
	}
	if err := s.Store.SetRolePositions(r.Context(), srv.ID, positions); err != nil {
		WriteError(w, err)
		return
	}
	roles, _ := s.Store.Roles(r.Context(), srv.ID)
	s.audit(r, srv.ID, me.ID, "role_positions", "server", &srv.ID, req, "")
	for _, ro := range roles {
		s.emitServer(r.Context(), srv.ID, "role_update", ro)
	}
	WriteJSON(w, http.StatusOK, roles)
}

// --- members -------------------------------------------------------------

func (s *Server) handleMembers(w http.ResponseWriter, r *http.Request) {
	srv, _, _ := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	after, _ := ids.Parse(r.URL.Query().Get("after"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	members, err := s.Store.Members(r.Context(), srv.ID, after, limit, r.URL.Query().Get("q"))
	if err != nil {
		WriteError(w, err)
		return
	}
	list := make([]ids.ID, 0, len(members))
	for _, m := range members {
		list = append(list, m.UserID)
	}
	byID, err := s.Store.UsersByIDs(r.Context(), list)
	if err != nil {
		WriteError(w, err)
		return
	}
	users := make([]store.PublicUser, 0, len(list))
	for _, id := range list {
		if u := byID[id]; u != nil {
			users = append(users, u.Public())
		}
	}
	WriteJSON(w, http.StatusOK, map[string]any{"members": members, "users": users})
}

func (s *Server) memberTarget(w http.ResponseWriter, r *http.Request, srv *store.Server) (*store.Member, bool) {
	uid, err := ids.Parse(r.PathValue("uid"))
	if r.PathValue("uid") == "@me" {
		uid, err = auth.UserFrom(r.Context()).ID, nil
	}
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, false
	}
	m, err := s.Store.Member(r.Context(), srv.ID, uid)
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, false
	}
	return m, true
}

func (s *Server) handleMemberGet(w http.ResponseWriter, r *http.Request) {
	srv, _, _ := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	m, ok := s.memberTarget(w, r, srv)
	if !ok {
		return
	}
	WriteJSON(w, http.StatusOK, m)
}

// canActOn checks role hierarchy between actor and target.
func (s *Server) canActOn(ctx context.Context, srv *store.Server, actor, target ids.ID) bool {
	if actor == target {
		return true
	}
	ah, aOwner := s.actorHighest(ctx, srv, actor)
	th, tOwner := s.actorHighest(ctx, srv, target)
	return perms.CanActOn(ah, th, aOwner, tOwner)
}

func (s *Server) handleMemberPatch(w http.ResponseWriter, r *http.Request) {
	srv, me, actorPerms := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	m, ok := s.memberTarget(w, r, srv)
	if !ok {
		return
	}
	var raw map[string]json.RawMessage
	if err := ReadJSON(w, r, &raw, 16<<10); err != nil {
		WriteError(w, err)
		return
	}
	self := m.UserID == me.ID
	changes := map[string]any{}
	var patch store.MemberPatch
	if v, ok := raw["nick"]; ok {
		need := perms.ManageNicknames
		if self {
			need = perms.ChangeNickname
		}
		if !actorPerms.Has(need) && !actorPerms.Has(perms.ManageNicknames) {
			WriteError(w, E(http.StatusForbidden, "missing_permission", "You cannot change that nickname."))
			return
		}
		if !self && !s.canActOn(r.Context(), srv, me.ID, m.UserID) {
			WriteError(w, E(http.StatusForbidden, "role_hierarchy", "You cannot manage this member."))
			return
		}
		var nick string
		if string(v) != "null" && json.Unmarshal(v, &nick) != nil {
			WriteError(w, E(http.StatusBadRequest, "invalid_nick", "Nickname is malformed."))
			return
		}
		clean, ok := CleanText(strings.ReplaceAll(nick, "\n", " "), maxNickname)
		if !ok {
			WriteError(w, E(http.StatusBadRequest, "invalid_nick", "Nicknames are at most 32 characters."))
			return
		}
		patch.Nickname = &clean
		changes["nick"] = clean
	}
	if v, ok := raw["timeout_until"]; ok {
		if !actorPerms.Has(perms.ModerateMembers) || self || !s.canActOn(r.Context(), srv, me.ID, m.UserID) {
			WriteError(w, E(http.StatusForbidden, "missing_permission", "You cannot time out this member."))
			return
		}
		if string(v) == "null" {
			var nilP *int64
			patch.TimeoutUntil = &nilP
		} else {
			var until int64
			if json.Unmarshal(v, &until) != nil || until < time.Now().UnixMilli() || until > time.Now().Add(28*24*time.Hour).UnixMilli() {
				WriteError(w, E(http.StatusBadRequest, "invalid_timeout", "timeout_until must be a future time within 28 days."))
				return
			}
			up := &until
			patch.TimeoutUntil = &up
		}
		changes["timeout_until"] = string(v)
	}
	var newRoles []ids.ID
	rolesSet := false
	if v, ok := raw["roles"]; ok {
		if !actorPerms.Has(perms.ManageRoles) {
			WriteError(w, E(http.StatusForbidden, "missing_permission", "You need Manage Roles to change roles."))
			return
		}
		if json.Unmarshal(v, &newRoles) != nil {
			WriteError(w, E(http.StatusBadRequest, "invalid_roles", "roles must be a list of role ids."))
			return
		}
		if !self && !s.canActOn(r.Context(), srv, me.ID, m.UserID) {
			WriteError(w, E(http.StatusForbidden, "role_hierarchy", "You cannot manage this member."))
			return
		}
		highest, isOwner := s.actorHighest(r.Context(), srv, me.ID)
		cur := map[ids.ID]bool{}
		for _, id := range m.RoleIDs {
			cur[id] = true
		}
		next := map[ids.ID]bool{}
		for _, id := range newRoles {
			if id == srv.ID {
				continue
			}
			next[id] = true
		}
		for id := range mergeKeys(cur, next) {
			if cur[id] == next[id] {
				continue
			}
			role, err := s.Store.RoleByID(r.Context(), id)
			if err != nil || role.ServerID != srv.ID {
				WriteError(w, E(http.StatusBadRequest, "invalid_roles", "One of the roles is not in this server."))
				return
			}
			if !perms.CanManageRole(highest, isOwner, perms.Role{ID: role.ID, Position: role.Position}) {
				WriteError(w, E(http.StatusForbidden, "role_hierarchy", "You can only assign roles below your highest role."))
				return
			}
		}
		rolesSet = true
		changes["roles"] = newRoles
	}
	before, _ := s.snapshotVisibility(r.Context(), srv.ID)
	if patch.Nickname != nil || patch.TimeoutUntil != nil {
		if err := s.Store.UpdateMember(r.Context(), srv.ID, m.UserID, patch); err != nil {
			WriteError(w, err)
			return
		}
	}
	if rolesSet {
		if err := s.Store.SetMemberRoles(r.Context(), srv.ID, m.UserID, newRoles); err != nil {
			WriteError(w, err)
			return
		}
	}
	updated, _ := s.Store.Member(r.Context(), srv.ID, m.UserID)
	s.audit(r, srv.ID, me.ID, "member_update", "user", &m.UserID, changes, "")
	s.emitServer(r.Context(), srv.ID, "member_update", updated)
	if rolesSet || patch.TimeoutUntil != nil {
		s.syncVisibility(r.Context(), srv.ID, before, nil)
	}
	WriteJSON(w, http.StatusOK, updated)
}

func mergeKeys(a, b map[ids.ID]bool) map[ids.ID]bool {
	out := map[ids.ID]bool{}
	for k := range a {
		out[k] = true
	}
	for k := range b {
		out[k] = true
	}
	return out
}

func (s *Server) handleMemberRole(add bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		srv, me, _ := s.serverCtx(w, r, perms.ManageRoles)
		if srv == nil {
			return
		}
		m, ok := s.memberTarget(w, r, srv)
		if !ok {
			return
		}
		rid, err := ids.Parse(r.PathValue("rid"))
		if err != nil {
			WriteError(w, ErrNotFound)
			return
		}
		role, err := s.Store.RoleByID(r.Context(), rid)
		if err != nil || role.ServerID != srv.ID || role.ID == srv.ID {
			WriteError(w, ErrNotFound)
			return
		}
		highest, isOwner := s.actorHighest(r.Context(), srv, me.ID)
		if !perms.CanManageRole(highest, isOwner, perms.Role{ID: role.ID, Position: role.Position}) || (m.UserID != me.ID && !s.canActOn(r.Context(), srv, me.ID, m.UserID)) {
			WriteError(w, E(http.StatusForbidden, "role_hierarchy", "You can only assign roles below your highest role."))
			return
		}
		before, _ := s.snapshotVisibility(r.Context(), srv.ID)
		if add {
			err = s.Store.AddMemberRole(r.Context(), srv.ID, m.UserID, rid)
		} else {
			err = s.Store.RemoveMemberRole(r.Context(), srv.ID, m.UserID, rid)
		}
		if err != nil {
			WriteError(w, err)
			return
		}
		updated, _ := s.Store.Member(r.Context(), srv.ID, m.UserID)
		s.audit(r, srv.ID, me.ID, map[bool]string{true: "member_role_add", false: "member_role_remove"}[add], "user", &m.UserID, map[string]any{"role": rid}, "")
		s.emitServer(r.Context(), srv.ID, "member_update", updated)
		s.syncVisibility(r.Context(), srv.ID, before, nil)
		WriteJSON(w, http.StatusOK, updated)
	}
}

func (s *Server) handleMemberKick(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, perms.KickMembers)
	if srv == nil {
		return
	}
	m, ok := s.memberTarget(w, r, srv)
	if !ok {
		return
	}
	if m.UserID == me.ID {
		WriteError(w, E(http.StatusBadRequest, "self", "Use leave to remove yourself."))
		return
	}
	if !s.canActOn(r.Context(), srv, me.ID, m.UserID) {
		WriteError(w, E(http.StatusForbidden, "role_hierarchy", "You cannot kick this member."))
		return
	}
	reason := strings.TrimSpace(r.URL.Query().Get("reason"))
	if err := s.removeMember(r, srv, m.UserID, "member_remove", map[string]any{"reason": "kick"}); err != nil {
		WriteError(w, err)
		return
	}
	s.audit(r, srv.ID, me.ID, "member_kick", "user", &m.UserID, nil, reason)
	w.WriteHeader(http.StatusNoContent)
}

// --- bans ----------------------------------------------------------------

func (s *Server) handleBans(w http.ResponseWriter, r *http.Request) {
	srv, _, _ := s.serverCtx(w, r, perms.BanMembers)
	if srv == nil {
		return
	}
	bans, err := s.Store.Bans(r.Context(), srv.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	list := make([]ids.ID, 0, len(bans))
	for _, b := range bans {
		list = append(list, b.UserID)
	}
	byID, _ := s.Store.UsersByIDs(r.Context(), list)
	users := []store.PublicUser{}
	for _, id := range list {
		if u := byID[id]; u != nil {
			users = append(users, u.Public())
		}
	}
	WriteJSON(w, http.StatusOK, map[string]any{"bans": bans, "users": users})
}

func (s *Server) handleBanPut(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, perms.BanMembers)
	if srv == nil {
		return
	}
	uid, err := ids.Parse(r.PathValue("uid"))
	if err != nil || uid == me.ID {
		WriteError(w, ErrNotFound)
		return
	}
	if _, err := s.Store.UserByID(r.Context(), uid); err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	var req struct {
		Reason            string `json:"reason"`
		DeleteMessageDays int    `json:"delete_message_days"`
	}
	if r.ContentLength > 0 {
		if err := ReadJSON(w, r, &req, 4<<10); err != nil {
			WriteError(w, err)
			return
		}
	}
	reason, _ := CleanText(req.Reason, maxBanReason)
	if ok, _ := s.Store.IsMember(r.Context(), srv.ID, uid); ok {
		if !s.canActOn(r.Context(), srv, me.ID, uid) {
			WriteError(w, E(http.StatusForbidden, "role_hierarchy", "You cannot ban this member."))
			return
		}
		if err := s.removeMember(r, srv, uid, "member_remove", map[string]any{"reason": "ban"}); err != nil {
			WriteError(w, err)
			return
		}
	}
	if err := s.Store.Ban(r.Context(), &store.Ban{ServerID: srv.ID, UserID: uid, Reason: reason, BannedBy: me.ID}); err != nil {
		WriteError(w, err)
		return
	}
	if req.DeleteMessageDays > 0 {
		if req.DeleteMessageDays > 7 {
			req.DeleteMessageDays = 7
		}
		since := time.Now().Add(-time.Duration(req.DeleteMessageDays) * 24 * time.Hour).UnixMilli()
		if deleted, err := s.Store.DeleteMessagesByUserSince(r.Context(), srv.ID, uid, since); err == nil {
			for ch, list := range deleted {
				s.Bcast.EmitChannel(ch, "message_delete_bulk", map[string]any{"channel_id": ch, "ids": list})
			}
		}
	}
	s.audit(r, srv.ID, me.ID, "member_ban", "user", &uid, map[string]any{"delete_message_days": req.DeleteMessageDays}, reason)
	s.emitServer(r.Context(), srv.ID, "ban_add", map[string]any{"server_id": srv.ID, "user_id": uid, "reason": reason})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleBanDelete(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, perms.BanMembers)
	if srv == nil {
		return
	}
	uid, err := ids.Parse(r.PathValue("uid"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	if err := s.Store.Unban(r.Context(), srv.ID, uid); err != nil {
		WriteError(w, err)
		return
	}
	s.audit(r, srv.ID, me.ID, "member_unban", "user", &uid, nil, "")
	s.emitServer(r.Context(), srv.ID, "ban_remove", map[string]any{"server_id": srv.ID, "user_id": uid})
	w.WriteHeader(http.StatusNoContent)
}

// --- invites -------------------------------------------------------------

func (s *Server) handleServerInvites(w http.ResponseWriter, r *http.Request) {
	srv, _, _ := s.serverCtx(w, r, perms.ManageServer)
	if srv == nil {
		return
	}
	list, err := s.Store.InvitesForServer(r.Context(), srv.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, list)
}

func (s *Server) handleInviteCreate(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	ch, err := s.Store.ChannelByID(r.Context(), id)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	if ch.Type == "group_dm" {
		// every member of a group can hand out a link to it
		if !hasID(ch.Recipients, me.ID) {
			WriteError(w, ErrNotFound)
			return
		}
	} else if ch.ServerID == nil {
		WriteError(w, ErrNotFound)
		return
	} else {
		p, _, err := s.Store.ChannelPerms(r.Context(), ch.ID, me.ID)
		if err != nil || p == 0 {
			WriteError(w, ErrNotFound)
			return
		}
		if !p.Has(perms.CreateInstantInvite) {
			WriteError(w, E(http.StatusForbidden, "missing_permission", "You cannot create invites here."))
			return
		}
	}
	var req struct {
		MaxAge  int64 `json:"max_age"`
		MaxUses int   `json:"max_uses"`
	}
	if r.ContentLength > 0 {
		if err := ReadJSON(w, r, &req, 1<<10); err != nil {
			WriteError(w, err)
			return
		}
	}
	if req.MaxAge < 0 || req.MaxAge > 30*24*3600 || req.MaxUses < 0 || req.MaxUses > 1000 {
		WriteError(w, E(http.StatusBadRequest, "invalid_invite", "max_age is 0–30 days in seconds and max_uses is 0–1000."))
		return
	}
	in, err := s.Store.CreateInvite(r.Context(), ch.ServerID, &ch.ID, me.ID, req.MaxAge, req.MaxUses)
	if err != nil {
		WriteError(w, err)
		return
	}
	if ch.ServerID == nil {
		s.Bcast.EmitUsers(ch.Recipients, "invite_create", in)
	} else {
		s.audit(r, *ch.ServerID, me.ID, "invite_create", "invite", nil, map[string]any{"code": in.Code, "max_age": req.MaxAge, "max_uses": req.MaxUses}, "")
		s.emitServer(r.Context(), *ch.ServerID, "invite_create", in)
	}
	WriteJSON(w, http.StatusCreated, in)
}

func (s *Server) handleInvitePreview(w http.ResponseWriter, r *http.Request) {
	in, err := s.Store.InviteByCode(r.Context(), r.PathValue("code"))
	if err != nil {
		WriteError(w, E(http.StatusNotFound, "invite_invalid", "This invite is invalid or has expired."))
		return
	}
	if in.ServerID == nil {
		s.groupInvitePreview(w, r, in)
		return
	}
	srv, err := s.Store.ServerByID(r.Context(), *in.ServerID)
	if err != nil {
		WriteError(w, E(http.StatusNotFound, "invite_invalid", "This invite is invalid or has expired."))
		return
	}
	count, _ := s.Store.MemberCount(r.Context(), srv.ID)
	online := 0
	if h, ok := s.Bcast.(interface{ Online(ids.ID) bool }); ok {
		members, _ := s.Store.MemberIDs(r.Context(), srv.ID)
		for _, id := range members {
			if h.Online(id) {
				online++
			}
		}
	}
	resp := map[string]any{"code": in.Code, "server": map[string]any{"id": srv.ID, "name": srv.Name, "icon_id": srv.IconID, "banner_id": srv.BannerID, "description": srv.Description, "member_count": count, "online_count": online}, "expires_at": in.ExpiresAt}
	if in.ChannelID != nil {
		if ch, err := s.Store.ChannelByID(r.Context(), *in.ChannelID); err == nil {
			resp["channel"] = map[string]any{"id": ch.ID, "name": ch.Name, "type": ch.Type}
		}
	}
	if u, err := s.Store.UserByID(r.Context(), in.InviterID); err == nil {
		resp["inviter"] = u.Public()
	}
	WriteJSON(w, http.StatusOK, resp)
}

func (s *Server) handleInviteJoin(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	in, err := s.Store.InviteByCode(r.Context(), r.PathValue("code"))
	if err != nil {
		WriteError(w, E(http.StatusNotFound, "invite_invalid", "This invite is invalid or has expired."))
		return
	}
	if in.ServerID == nil {
		s.groupInviteJoin(w, r, in, me)
		return
	}
	srv, err := s.Store.ServerByID(r.Context(), *in.ServerID)
	if err != nil {
		WriteError(w, E(http.StatusNotFound, "invite_invalid", "This invite is invalid or has expired."))
		return
	}
	if banned, _ := s.Store.IsBanned(r.Context(), srv.ID, me.ID); banned {
		WriteError(w, E(http.StatusForbidden, "banned", "You are banned from this server."))
		return
	}
	member, err := s.Store.AddMember(r.Context(), srv.ID, me.ID)
	if err != nil && err != store.ErrAlreadyExists {
		WriteError(w, err)
		return
	}
	status := http.StatusOK
	if err == nil {
		status = http.StatusCreated
		_ = s.Store.UseInvite(r.Context(), in.Code)
		s.emitServer(r.Context(), srv.ID, "member_add", map[string]any{"server_id": srv.ID, "member": member, "user": me.Public()})
		if srv.SystemChannelID != nil {
			if ch, err := s.Store.ChannelByID(r.Context(), *srv.SystemChannelID); err == nil {
				s.systemMessage(r, ch, me.ID, "system_join", []ids.ID{me.ID}, nil)
			}
		}
		s.Bcast.KeysMaybeNeeded(srv.ID)
	}
	view, users, err := s.serverView(r.Context(), srv, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	if status == http.StatusCreated {
		s.Bcast.EmitUsers([]ids.ID{me.ID}, "server_create", view)
	}
	WriteJSON(w, status, map[string]any{"server": view, "users": users})
}

func (s *Server) handleInviteDelete(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	in, err := s.Store.InviteByCode(r.Context(), r.PathValue("code"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	if in.ServerID == nil {
		// a group DM invite: any member of that group may revoke it
		if in.ChannelID == nil {
			WriteError(w, ErrNotFound)
			return
		}
		ch, err := s.Store.ChannelByID(r.Context(), *in.ChannelID)
		if err != nil || !hasID(ch.Recipients, me.ID) {
			WriteError(w, ErrNotFound)
			return
		}
		if err := s.Store.DeleteInvite(r.Context(), in.Code); err != nil {
			WriteError(w, err)
			return
		}
		s.Bcast.EmitUsers(ch.Recipients, "invite_delete", map[string]any{"channel_id": ch.ID, "code": in.Code})
		w.WriteHeader(http.StatusNoContent)
		return
	}
	p, err := s.Store.ServerPerms(r.Context(), *in.ServerID, me.ID)
	if err != nil || p == 0 {
		WriteError(w, ErrNotFound)
		return
	}
	if in.InviterID != me.ID && !p.Has(perms.ManageServer) {
		WriteError(w, E(http.StatusForbidden, "missing_permission", "You cannot revoke this invite."))
		return
	}
	if err := s.Store.DeleteInvite(r.Context(), in.Code); err != nil {
		WriteError(w, err)
		return
	}
	s.audit(r, *in.ServerID, me.ID, "invite_delete", "invite", nil, map[string]any{"code": in.Code}, "")
	s.emitServer(r.Context(), *in.ServerID, "invite_delete", map[string]any{"server_id": *in.ServerID, "code": in.Code})
	w.WriteHeader(http.StatusNoContent)
}

// --- audit + keys --------------------------------------------------------

func (s *Server) handleAuditLog(w http.ResponseWriter, r *http.Request) {
	srv, _, _ := s.serverCtx(w, r, perms.ViewAuditLog)
	if srv == nil {
		return
	}
	before, _ := ids.Parse(r.URL.Query().Get("before"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	entries, err := s.Store.AuditEntries(r.Context(), srv.ID, before, limit)
	if err != nil {
		WriteError(w, err)
		return
	}
	set := map[ids.ID]bool{}
	var list []ids.ID
	for _, e := range entries {
		if !set[e.ActorID] {
			set[e.ActorID] = true
			list = append(list, e.ActorID)
		}
		if e.TargetType == "user" && e.TargetID != nil && !set[*e.TargetID] {
			set[*e.TargetID] = true
			list = append(list, *e.TargetID)
		}
	}
	byID, _ := s.Store.UsersByIDs(r.Context(), list)
	users := []store.PublicUser{}
	for _, id := range list {
		if u := byID[id]; u != nil {
			users = append(users, u.Public())
		}
	}
	WriteJSON(w, http.StatusOK, map[string]any{"entries": entries, "users": users})
}

func (s *Server) handleServerKeys(w http.ResponseWriter, r *http.Request) {
	srv, me, _ := s.serverCtx(w, r, 0)
	if srv == nil {
		return
	}
	type convInfo struct {
		ConvID ids.ID            `json:"conv_id"`
		Name   string            `json:"name"`
		Epochs []*store.KeyEpoch `json:"epochs"`
		Flags  *store.KeyFlags   `json:"flags"`
	}
	out := []convInfo{}
	eps, _ := s.Store.Epochs(r.Context(), srv.ID)
	flags, _ := s.Store.KeyFlags(r.Context(), srv.ID)
	out = append(out, convInfo{ConvID: srv.ID, Name: srv.Name, Epochs: eps, Flags: flags})
	visible, _ := s.Store.ViewableServerChannels(r.Context(), srv.ID, me.ID)
	chans, _ := s.Store.ServerChannels(r.Context(), srv.ID)
	for _, c := range chans {
		if _, ok := visible[c.ID]; !ok || c.KeyConvID != c.ID {
			continue
		}
		eps, _ := s.Store.Epochs(r.Context(), c.ID)
		flags, _ := s.Store.KeyFlags(r.Context(), c.ID)
		out = append(out, convInfo{ConvID: c.ID, Name: "#" + c.Name, Epochs: eps, Flags: flags})
	}
	WriteJSON(w, http.StatusOK, out)
}
