package api

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/store"
)

// mayTalkYet holds back a newcomer for as long as the server asks: an
// account younger than its verify_account_minutes, or a membership younger
// than its verify_member_minutes, cannot talk there yet. Anyone with a role,
// and anyone who may manage the server, is past it. It answers false having
// written the refusal.
func (s *Server) mayTalkYet(w http.ResponseWriter, r *http.Request, ch *store.Channel, me *store.User) bool {
	if ch.ServerID == nil {
		return true
	}
	ctx := r.Context()
	srv, err := s.Store.ServerByID(ctx, *ch.ServerID)
	if err != nil || (srv.VerifyAccountMinutes == 0 && srv.VerifyMemberMinutes == 0) || srv.OwnerID == me.ID {
		return true
	}
	p, err := s.Store.ServerPerms(ctx, srv.ID, me.ID)
	if err != nil || p.Has(perms.ManageServer) || p.Has(perms.Administrator) {
		return true
	}
	m, err := s.Store.Member(ctx, srv.ID, me.ID)
	if err != nil || len(m.RoleIDs) > 0 {
		return true
	}
	now := time.Now()
	wait := time.Duration(0)
	if srv.VerifyAccountMinutes > 0 {
		ready := time.UnixMilli(me.CreatedAt).Add(time.Duration(srv.VerifyAccountMinutes) * time.Minute)
		wait = max(wait, ready.Sub(now))
	}
	if srv.VerifyMemberMinutes > 0 {
		ready := time.UnixMilli(m.JoinedAt).Add(time.Duration(srv.VerifyMemberMinutes) * time.Minute)
		wait = max(wait, ready.Sub(now))
	}
	if wait <= 0 {
		return true
	}
	// the wait itself rides in Retry-After, for the app to count down
	w.Header().Set("Retry-After", retryAfter(wait))
	WriteError(w, E(http.StatusForbidden, "verification_wait", "This server asks new members to wait a little before they talk."))
	return false
}

// externalEmoji reports whether a reaction is a custom emoji from somewhere
// other than the channel's own server.
func (s *Server) externalEmoji(ctx context.Context, ch *store.Channel, emoji string) bool {
	if ch.ServerID == nil {
		return false
	}
	m := customID.FindStringSubmatch(emoji)
	if m == nil {
		return false
	}
	id, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil {
		return false
	}
	e, err := s.Store.EmojiByID(ctx, ids.ID(id))
	return err != nil || e.ServerID != *ch.ServerID
}

var customID = regexp.MustCompile(`:([0-9]{1,20})$`)

// slowmodeLeft says how long someone still has to wait to send in a channel
// with slow mode on; 0 when they need not, which is anyone who may manage the
// channel or its messages, or who may skip it.
func (s *Server) slowmodeLeft(ctx context.Context, ch *store.Channel, me *store.User) time.Duration {
	if ch.SlowmodeSeconds <= 0 || s.isDM(ch) {
		return 0
	}
	p, err := s.Store.PermsIn(ctx, ch, me.ID)
	if err != nil || p.Has(perms.ManageMessages) || p.Has(perms.ManageChannels) || p.Has(perms.BypassSlowmode) || (store.IsThread(ch.Type) && p.Has(perms.ManageThreads)) {
		return 0
	}
	last, err := s.Store.LastMessageAt(ctx, ch.ID, me.ID)
	if err != nil || last <= 0 {
		return 0
	}
	return time.Duration(ch.SlowmodeSeconds)*time.Second - time.Since(time.UnixMilli(last))
}

// auditDeletes records messages a moderator took down that other people wrote.
func (s *Server) auditDeletes(r *http.Request, ch *store.Channel, me *store.User, authors map[ids.ID]ids.ID) {
	if ch.ServerID == nil || len(authors) == 0 {
		return
	}
	byAuthor := map[ids.ID]int{}
	for _, a := range authors {
		if a != me.ID {
			byAuthor[a]++
		}
	}
	for author, n := range byAuthor {
		target := author
		action := "message_delete"
		if n > 1 {
			action = "message_bulk_delete"
		}
		s.audit(r, *ch.ServerID, me.ID, action, "user", &target, map[string]any{"channel_id": ch.ID, "count": n}, "")
	}
}
