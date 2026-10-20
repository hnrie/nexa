package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// Deleting an account takes everything it made with it, whoever deletes it:
// its messages everywhere, its uploads, the servers and group chats it owns,
// its packs, reactions and votes. Someone deleting their own account takes
// their one-to-one conversations too, whole, for both people in them; a
// moderator deleting one leaves those to the person on the other side, and the
// case says what went.

// purgeOptions says what else goes with an account.
type purgeOptions struct {
	// DMs deletes its one-to-one conversations whole, for both people in them.
	DMs bool
}

// purgeTimeout bounds one deletion. It runs on a context of its own, so a
// moderator closing the tab does not leave an account half deleted.
const purgeTimeout = 10 * time.Minute

// purgeBatch is how many messages go per transaction.
const purgeBatch = 500

// maxReactionEvents bounds how many removed reactions open channels are told
// about one by one; beyond it they are gone all the same, and show so on reload.
const maxReactionEvents = 2000

// deleteDetails is what a deletion case records.
type deleteDetails struct {
	Counts   store.PurgeCounts `json:"counts"`
	Complete bool              `json:"complete"`
}

func (s *Server) actDelete(w http.ResponseWriter, r *http.Request, target *store.User, c *store.ModCase, log *store.ModLogEntry, req modActionReq) {
	ctx := r.Context()
	me := auth.UserFrom(ctx)
	if req.Confirm != target.Username {
		WriteError(w, E(http.StatusBadRequest, "confirm_mismatch", "Type their username exactly to confirm."))
		return
	}
	// A deletion that failed part way is finished by asking again: the case
	// it opened is picked up, rather than a second one opened beside it.
	resumed := false
	if cases, err := s.Store.ModCasesForUser(ctx, target.ID); err == nil {
		for _, prev := range cases {
			var d deleteDetails
			if prev.Action == store.ActionDelete && json.Unmarshal(prev.Details, &d) == nil && !d.Complete {
				c, resumed = prev, true
				break
			}
		}
	}
	if !resumed {
		counts, err := s.Store.PurgePreview(ctx, target.ID)
		if err != nil {
			WriteError(w, err)
			return
		}
		now := time.Now().UnixMilli()
		c.CreatedAt = now
		// nobody is left to answer in its thread
		c.Status, c.ClosedAt, c.ClosedBy = store.CaseClosed, &now, &me.ID
		c.Details = mustJSON(deleteDetails{Counts: counts})
		log.Details = c.Details
		if err := s.Store.OpenModCase(ctx, c, log); err != nil {
			WriteError(w, err)
			return
		}
		// Signing in stops now, so nothing new is added while the rest goes.
		if _, err := s.Store.ChangeUserFlags(ctx, target.ID, store.FlagDisabled, 0); err != nil {
			WriteError(w, err)
			return
		}
		// Their open tabs hear why before they are signed out: the notice is
		// queued ahead of the close.
		s.notifyMember(ctx, c)
		s.emitLog(ctx, log)
	}
	if err := s.Store.DeleteUserSessions(ctx, target.ID, 0); err != nil {
		s.Log.Warn("moderation: delete sessions", "user", target.ID.String(), "err", err)
	}
	s.Bcast.EmitUsers([]ids.ID{target.ID}, "session_expired", map[string]any{"reason": "deleted"})
	s.Bcast.CloseUserSessions(target.ID, 0)

	pctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), purgeTimeout)
	defer cancel()
	if err := s.purgeAccount(r.WithContext(pctx), target.ID, purgeOptions{}); err != nil {
		s.Log.Error("moderation: delete account", "user", target.ID.String(), "case", c.ID.String(), "err", err)
		s.emitCaseStaff(pctx, c)
		WriteError(w, E(http.StatusInternalServerError, "delete_incomplete", "The account is signed out and disabled, but not everything was deleted. Try again to finish."))
		return
	}
	var d deleteDetails
	_ = json.Unmarshal(c.Details, &d)
	d.Complete = true
	c.Details = mustJSON(d)
	if err := s.Store.SetModCaseDetails(pctx, c.ID, c.Details); err != nil {
		s.Log.Warn("moderation: record deletion", "case", c.ID.String(), "err", err)
	}
	if fresh, err := s.Store.ModCaseByID(pctx, c.ID); err == nil {
		c = fresh
	}
	s.emitCaseStaff(pctx, c)
	cs := s.caseStateFor(pctx, c.UserID)
	WriteJSON(w, http.StatusCreated, map[string]any{"case": toStaffCase(c, cs, nil), "people": s.people(pctx, casePeople(c)...)})
}

// purgeAccount removes everything an account made, telling whoever can see
// each thing as it goes, and then its profile. Every step finds only what the
// steps before left, so running it again after a failure finishes the job.
func (s *Server) purgeAccount(r *http.Request, uid ids.ID, opt purgeOptions) error {
	ctx := r.Context()
	// the applications it made go with it, their bots out of every server
	if err := s.deleteOwnedApplications(r, uid); err != nil {
		return err
	}
	// Out of any call before anything else: its sockets are already closed,
	// but that only detaches a call, which would otherwise go on carrying
	// the account's voice for the grace period.
	s.dropVoice(ctx, uid, func(*store.Channel) bool { return true })
	// The servers it owns go, with everything in them; the rest it leaves.
	servers, err := s.Store.ServersForUser(ctx, uid)
	if err != nil {
		return err
	}
	for _, srv := range servers {
		if srv.OwnerID != uid {
			if err := s.removeMember(r, srv, uid, "member_remove", map[string]any{"reason": "account_deleted"}); err != nil {
				return err
			}
			continue
		}
		members, err := s.Store.MemberIDs(ctx, srv.ID)
		if err != nil {
			return err
		}
		chans, err := s.Store.ServerChannels(ctx, srv.ID)
		if err != nil {
			return err
		}
		if err := s.Store.DeleteServer(ctx, srv.ID); err != nil {
			return err
		}
		s.forgetCounts(srv.ID)
		s.voiceServerDeleted(chans, members)
		s.Bcast.EmitUsers(members, "server_delete", map[string]any{"id": srv.ID})
	}
	// The group chats and subchats it owns go; subchats first, so each one's
	// members hear about it before its group does.
	owned, err := s.Store.OwnedConversations(ctx, uid)
	if err != nil {
		return err
	}
	for _, ch := range owned {
		recipients := ch.Recipients
		s.voiceChannelDeleted(ctx, ch)
		if err := s.deleteConversation(ctx, ch); err != nil {
			return err
		}
		ev := map[string]any{"id": ch.ID}
		if ch.ParentID != nil {
			ev["parent_id"] = *ch.ParentID
		}
		s.Bcast.EmitUsers(recipients, "channel_delete", ev)
	}
	// Its one-to-one conversations go whole, when it asked for everything to go.
	if opt.DMs {
		dms, err := s.Store.DirectConversations(ctx, uid)
		if err != nil {
			return err
		}
		for _, ch := range dms {
			recipients := ch.Recipients
			s.voiceChannelDeleted(ctx, ch)
			if err := s.deleteConversation(ctx, ch); err != nil && !errors.Is(err, store.ErrNotFound) {
				return err
			}
			s.Bcast.EmitUsers(recipients, "channel_delete", map[string]any{"id": ch.ID})
		}
	}
	// It leaves the groups other people own.
	groups, err := s.Store.GroupDMsForUser(ctx, uid)
	if err != nil {
		return err
	}
	for _, gid := range groups {
		ch, err := s.Store.ChannelByID(ctx, gid)
		if err != nil {
			continue
		}
		if err := s.removeFromGroup(r, ch, uid); err != nil {
			return err
		}
	}
	// Its messages, everywhere, a batch at a time.
	for {
		batch, err := s.Store.PurgeUserMessages(ctx, uid, purgeBatch)
		if err != nil {
			return err
		}
		if len(batch) == 0 {
			break
		}
		for ch, d := range batch {
			s.Bcast.EmitChannel(ch, "message_delete_bulk", s.bulkDeleteEvent(ctx, ch, d))
		}
	}
	refs, err := s.Store.PurgeUserReactions(ctx, uid, maxReactionEvents)
	if err != nil {
		return err
	}
	for _, ref := range refs {
		s.Bcast.EmitChannel(ref.ChannelID, "reaction_remove", map[string]any{"channel_id": ref.ChannelID, "message_id": ref.MessageID, "user_id": uid, "emoji": ref.Emoji})
	}
	// Its packs go from everyone who installed them.
	packs, err := s.Store.PacksOwnedBy(ctx, uid)
	if err != nil {
		return err
	}
	for _, id := range packs {
		installers, err := s.Store.Installers(ctx, id)
		if err != nil {
			return err
		}
		if err := s.Store.DeletePack(ctx, id); err != nil {
			return err
		}
		s.Bcast.EmitUsers(append(installers, uid), "sticker_update", map[string]any{"pack_id": id, "deleted": true})
	}
	// Files it was still uploading.
	if uploads, err := s.Store.UploadsOf(ctx, uid); err == nil && s.Media != nil {
		for _, id := range uploads {
			s.Media.DiscardSpool(id)
		}
	}
	if err := s.Store.PurgeUserLeftovers(ctx, uid); err != nil {
		return err
	}
	// A linked Discord account: its tokens go, and so does its activity.
	if s.Discord != nil {
		s.Discord.Forget(ctx, uid)
	} else if _, err := s.Store.DeleteDiscordLink(ctx, uid); err != nil && !errors.Is(err, store.ErrNotFound) {
		return err
	}
	// And last the account itself, down to the stand-in row everything else
	// still points at, which nobody can sign in as.
	if err := s.Store.DeleteAccount(ctx, uid); err != nil {
		return err
	}
	if deleted, err := s.Store.UserByID(ctx, uid); err == nil {
		s.Bcast.UserUpdated(deleted)
	}
	// The files it uploaded go now rather than with the next hourly sweep.
	if s.Media != nil {
		go func() {
			gctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()
			if n, err := s.Media.GC(gctx, time.Now().Add(-24*time.Hour).UnixMilli()); err != nil {
				s.Log.Warn("moderation: media sweep", "err", err)
			} else if n > 0 {
				s.Log.Info("moderation: media sweep", "removed", n)
			}
		}()
	}
	return nil
}

// accountSweep is how often deleted accounts are checked for anything left.
const accountSweep = time.Hour

// finishDeletedAccounts wipes whatever deleted accounts still own: accounts
// deleted before deletion took everything, and any whose deletion stopped part
// way. Each goes the way it was deleted: one a moderator deleted keeps its
// one-to-one conversations for the people on the other side; any other takes
// them too.
func (s *Server) finishDeletedAccounts(ctx context.Context) {
	list, err := s.Store.DeletedAccountsWithLeftovers(ctx)
	if err != nil {
		s.Log.Warn("deleted accounts: finding leftovers", "err", err)
		return
	}
	for _, uid := range list {
		// Who deleted it decides whether the other side keeps its DMs, so an
		// account that cannot be looked up waits for the next sweep rather
		// than being guessed at.
		staff, err := s.Store.DeletedByStaff(ctx, uid)
		if err != nil {
			s.Log.Warn("deleted accounts: who deleted it", "user", uid.String(), "err", err)
			continue
		}
		opt := purgeOptions{DMs: !staff}
		pctx, cancel := context.WithTimeout(ctx, purgeTimeout)
		r, _ := http.NewRequestWithContext(pctx, http.MethodPost, "/", nil)
		if err := s.purgeAccount(r, uid, opt); err != nil {
			s.Log.Warn("deleted accounts: wiping", "user", uid.String(), "err", err)
		} else {
			s.Log.Info("deleted accounts: wiped what was left", "user", uid.String(), "direct_messages", opt.DMs)
		}
		cancel()
		if ctx.Err() != nil {
			return
		}
	}
}

// StartAccountSweep finishes deleted accounts now and then every hour, until
// ctx ends.
func (s *Server) StartAccountSweep(ctx context.Context) {
	s.background.Go(func() {
		s.finishDeletedAccounts(ctx)
		t := time.NewTicker(accountSweep)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.finishDeletedAccounts(ctx)
			}
		}
	})
}
