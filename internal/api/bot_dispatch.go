package api

import (
	"context"
	"encoding/json"
	"time"

	"evilion.xyz/chat/internal/botproto"
	"evilion.xyz/chat/internal/gateway"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// translateLoop turns the hub's events into the protocol's, one at a time,
// in the order they came.
func (sess *botSession) translateLoop() {
	for {
		select {
		case <-sess.stop:
			return
		case f := <-sess.inbox:
			func() {
				defer func() {
					if r := recover(); r != nil {
						sess.s.Log.Error("bot gateway: translating panicked", "event", f.T, "panic", r)
					}
				}()
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				sess.translate(ctx, f)
			}()
		}
	}
}

// eventChannel is a channel events say they are about, read fresh; nil for
// one the bot does not see as a channel (a subchat).
func (sess *botSession) eventChannel(ctx context.Context, id ids.ID) *store.Channel {
	ch, err := sess.s.Store.ChannelByID(ctx, id)
	if err != nil || ch.Type == "subchat" {
		return nil
	}
	return ch
}

func scopeOf(ch *store.Channel) botproto.Scope {
	if store.IsDMLike(ch.Type) {
		return botproto.InDM
	}
	return botproto.InGuild
}

// translate turns one of the hub's events into the protocol's.
func (sess *botSession) translate(ctx context.Context, f gateway.ServerFrame) {
	raw, err := json.Marshal(f.D)
	if err != nil {
		return
	}
	b := sess.builder(ctx)
	switch f.T {
	case gateway.EvMessageCreate, gateway.EvMessageUpdate:
		var m store.Message
		if json.Unmarshal(raw, &m) != nil {
			return
		}
		ch := sess.eventChannel(ctx, m.ChannelID)
		if ch == nil || !sess.onShard(ch.ServerID) {
			return
		}
		event := "MESSAGE_CREATE"
		if f.T == gateway.EvMessageUpdate {
			event = "MESSAGE_UPDATE"
		}
		if !sess.wants(event, scopeOf(ch)) {
			return
		}
		// the hub sends reactions loaded for nobody; the bot's own come from the store
		if full, err := sess.s.Store.MessageByID(ctx, m.ID, sess.bot.ID); err == nil {
			full.Webhook, full.Thread = m.Webhook, m.Thread
			m = *full
		}
		msg := b.messageObj(&m, ch, msgOpts{member: ch.ServerID != nil, content: sess.intent&botproto.IntentMessageContent != 0})
		sess.emit(event, msg)

	case gateway.EvMessageDelete:
		var d struct {
			ID        ids.ID `json:"id"`
			ChannelID ids.ID `json:"channel_id"`
		}
		if json.Unmarshal(raw, &d) != nil {
			return
		}
		ch := sess.eventChannel(ctx, d.ChannelID)
		if ch == nil || !sess.onShard(ch.ServerID) {
			return
		}
		sess.emitIf("MESSAGE_DELETE", scopeOf(ch), map[string]any{"id": snow(d.ID), "channel_id": snow(d.ChannelID), "guild_id": botproto.SP(ch.ServerID)})

	case gateway.EvMessageDeleteBulk:
		var d struct {
			ChannelID ids.ID   `json:"channel_id"`
			IDs       []ids.ID `json:"ids"`
		}
		if json.Unmarshal(raw, &d) != nil {
			return
		}
		ch := sess.eventChannel(ctx, d.ChannelID)
		if ch == nil || !sess.onShard(ch.ServerID) {
			return
		}
		sess.emitIf("MESSAGE_DELETE_BULK", scopeOf(ch), map[string]any{"ids": botproto.Snows(d.IDs), "channel_id": snow(d.ChannelID), "guild_id": botproto.SP(ch.ServerID)})

	case gateway.EvReactionAdd, gateway.EvReactionRemove, gateway.EvReactionRemoveAll, gateway.EvReactionRemoveEmoji:
		var d struct {
			ChannelID ids.ID `json:"channel_id"`
			MessageID ids.ID `json:"message_id"`
			UserID    ids.ID `json:"user_id"`
			Emoji     string `json:"emoji"`
		}
		if json.Unmarshal(raw, &d) != nil {
			return
		}
		ch := sess.eventChannel(ctx, d.ChannelID)
		if ch == nil || !sess.onShard(ch.ServerID) {
			return
		}
		ev := map[string]any{"channel_id": snow(d.ChannelID), "message_id": snow(d.MessageID), "guild_id": botproto.SP(ch.ServerID)}
		switch f.T {
		case gateway.EvReactionAdd:
			ev["user_id"], ev["emoji"], ev["burst"], ev["burst_colors"], ev["type"] = snow(d.UserID), reactionEmoji(d.Emoji), false, []string{}, 0
			if m, err := sess.s.Store.MessageByID(ctx, d.MessageID, 0); err == nil {
				ev["message_author_id"] = snow(m.AuthorID)
			}
			if ch.ServerID != nil {
				if mem, err := sess.s.Store.Member(ctx, *ch.ServerID, d.UserID); err == nil {
					ev["member"] = b.memberObj(mem, true)
				}
			}
			sess.emitIf("MESSAGE_REACTION_ADD", scopeOf(ch), ev)
		case gateway.EvReactionRemove:
			ev["user_id"], ev["emoji"], ev["burst"], ev["type"] = snow(d.UserID), reactionEmoji(d.Emoji), false, 0
			sess.emitIf("MESSAGE_REACTION_REMOVE", scopeOf(ch), ev)
		case gateway.EvReactionRemoveAll:
			sess.emitIf("MESSAGE_REACTION_REMOVE_ALL", scopeOf(ch), ev)
		case gateway.EvReactionRemoveEmoji:
			ev["emoji"] = reactionEmoji(d.Emoji)
			sess.emitIf("MESSAGE_REACTION_REMOVE_EMOJI", scopeOf(ch), ev)
		}

	case gateway.EvTyping:
		var d struct {
			ChannelID ids.ID `json:"channel_id"`
			UserID    ids.ID `json:"user_id"`
			TS        int64  `json:"ts"`
			Stop      bool   `json:"stop"`
		}
		if json.Unmarshal(raw, &d) != nil || d.Stop {
			return
		}
		ch := sess.eventChannel(ctx, d.ChannelID)
		if ch == nil || !sess.onShard(ch.ServerID) {
			return
		}
		ev := map[string]any{"channel_id": snow(d.ChannelID), "user_id": snow(d.UserID), "timestamp": d.TS / 1000}
		// Discord omits guild_id for direct-message events. Some bot libraries
		// treat an explicit null as malformed and stop their gateway session.
		if ch.ServerID != nil {
			ev["guild_id"] = snow(*ch.ServerID)
		}
		if ch.ServerID != nil {
			if mem, err := sess.s.Store.Member(ctx, *ch.ServerID, d.UserID); err == nil {
				ev["member"] = b.memberObj(mem, true)
			}
		}
		sess.emitIf("TYPING_START", scopeOf(ch), ev)

	case gateway.EvChannelCreate, gateway.EvChannelUpdate:
		var c store.Channel
		if json.Unmarshal(raw, &c) != nil {
			return
		}
		// a direct conversation reaches a bot with its first message, not before
		if c.ServerID == nil || !sess.onShard(c.ServerID) {
			return
		}
		ch := sess.eventChannel(ctx, c.ID)
		if ch == nil {
			return
		}
		dc, ok := b.channelObj(ch)
		if !ok {
			return
		}
		_, known := sess.knownChannel(ch.ID)
		sess.remember(dc)
		event := "CHANNEL_UPDATE"
		if !known {
			event = "CHANNEL_CREATE"
		}
		if store.IsThread(ch.Type) {
			event = map[string]string{"CHANNEL_UPDATE": "THREAD_UPDATE", "CHANNEL_CREATE": "THREAD_CREATE"}[event]
		}
		sess.emitIf(event, botproto.InGuild, dc)

	case gateway.EvChannelDelete:
		var d struct {
			ID       ids.ID  `json:"id"`
			ServerID *ids.ID `json:"server_id"`
		}
		if json.Unmarshal(raw, &d) != nil {
			return
		}
		dc, ok := sess.forget(d.ID)
		if !ok || dc.GuildID == nil {
			return
		}
		gid := dc.GuildID.ID()
		if !sess.onShard(&gid) {
			return
		}
		if dc.Type == dChanPublicThread || dc.Type == dChanPrivateThread || dc.Type == dChanAnnouncementThread {
			sess.emitIf("THREAD_DELETE", botproto.InGuild, map[string]any{"id": dc.ID, "guild_id": dc.GuildID, "parent_id": dc.ParentID, "type": dc.Type})
			return
		}
		sess.emitIf("CHANNEL_DELETE", botproto.InGuild, dc)

	case gateway.EvChannelPositions:
		var d struct {
			ServerID ids.ID `json:"server_id"`
			Channels []struct {
				ID ids.ID `json:"id"`
			} `json:"channels"`
		}
		if json.Unmarshal(raw, &d) != nil || !sess.onShard(&d.ServerID) {
			return
		}
		for _, c := range d.Channels {
			if ch := sess.eventChannel(ctx, c.ID); ch != nil {
				if dc, ok := b.channelObj(ch); ok {
					sess.remember(dc)
					sess.emitIf("CHANNEL_UPDATE", botproto.InGuild, dc)
				}
			}
		}

	case gateway.EvThreadCreate:
		var d struct {
			ID ids.ID `json:"id"`
		}
		if json.Unmarshal(raw, &d) != nil {
			return
		}
		th := sess.eventChannel(ctx, d.ID)
		if th == nil || !sess.onShard(th.ServerID) {
			return
		}
		dc, ok := b.channelObj(th)
		if !ok {
			return
		}
		_, known := sess.knownChannel(th.ID)
		sess.remember(dc)
		if known {
			sess.emitIf("THREAD_UPDATE", botproto.InGuild, dc)
			return
		}
		ev := struct {
			dChannel
			NewlyCreated bool `json:"newly_created"`
		}{dc, time.Since(th.ID.Time()) < 30*time.Second}
		sess.emitIf("THREAD_CREATE", botproto.InGuild, ev)

	case gateway.EvThreadDelete:
		var d struct {
			ID ids.ID `json:"id"`
		}
		if json.Unmarshal(raw, &d) != nil {
			return
		}
		dc, ok := sess.forget(d.ID)
		if !ok || dc.GuildID == nil {
			return
		}
		gid := dc.GuildID.ID()
		if sess.onShard(&gid) {
			sess.emitIf("THREAD_DELETE", botproto.InGuild, map[string]any{"id": dc.ID, "guild_id": dc.GuildID, "parent_id": dc.ParentID, "type": dc.Type})
		}

	case gateway.EvThreadMembersUpdate:
		var d struct {
			ThreadID    ids.ID   `json:"thread_id"`
			ServerID    *ids.ID  `json:"server_id"`
			Added       []ids.ID `json:"added"`
			Removed     []ids.ID `json:"removed"`
			MemberCount int      `json:"member_count"`
		}
		if json.Unmarshal(raw, &d) != nil || d.ServerID == nil || !sess.onShard(d.ServerID) {
			return
		}
		self := hasID(d.Added, sess.bot.ID) || hasID(d.Removed, sess.bot.ID)
		if !self && sess.intent&botproto.IntentGuildMembers == 0 {
			return
		}
		added := []dThreadMember{}
		now := time.Now().UnixMilli()
		for _, uid := range d.Added {
			var mem *store.Member
			if m, err := sess.s.Store.Member(ctx, *d.ServerID, uid); err == nil {
				mem = m
			}
			added = append(added, b.threadMemberObj(store.ThreadMember{ThreadID: d.ThreadID, UserID: uid, JoinedAt: now}, mem))
		}
		sess.emit("THREAD_MEMBERS_UPDATE", map[string]any{"id": snow(d.ThreadID), "guild_id": snow(*d.ServerID), "member_count": d.MemberCount,
			"added_members": added, "removed_member_ids": botproto.Snows(d.Removed)})

	case gateway.EvServerCreate:
		var d struct {
			ID ids.ID `json:"id"`
		}
		if json.Unmarshal(raw, &d) != nil || !sess.onShard(&d.ID) {
			return
		}
		if srv, err := sess.s.Store.ServerByID(ctx, d.ID); err == nil {
			sess.emitGuildCreate(ctx, srv)
		}

	case gateway.EvServerUpdate:
		var d struct {
			ID ids.ID `json:"id"`
		}
		if json.Unmarshal(raw, &d) != nil || !sess.onShard(&d.ID) {
			return
		}
		if srv, err := sess.s.Store.ServerByID(ctx, d.ID); err == nil {
			sess.emitIf("GUILD_UPDATE", botproto.InGuild, b.guildObj(srv))
		}

	case gateway.EvServerDelete:
		var d struct {
			ID ids.ID `json:"id"`
		}
		if json.Unmarshal(raw, &d) != nil || !sess.onShard(&d.ID) {
			return
		}
		sess.mu.Lock()
		delete(sess.guilds, d.ID)
		for id, c := range sess.channels {
			if c.GuildID != nil && c.GuildID.ID() == d.ID {
				delete(sess.channels, id)
			}
		}
		sess.mu.Unlock()
		sess.emitIf("GUILD_DELETE", botproto.InGuild, map[string]any{"id": snow(d.ID)})

	case gateway.EvMemberAdd:
		var d struct {
			ServerID ids.ID       `json:"server_id"`
			Member   store.Member `json:"member"`
		}
		if json.Unmarshal(raw, &d) != nil || !sess.onShard(&d.ServerID) {
			return
		}
		mem, err := sess.s.Store.Member(ctx, d.ServerID, d.Member.UserID)
		if err != nil {
			return
		}
		ev := struct {
			dMember
			GuildID snow `json:"guild_id"`
		}{b.memberObj(mem, true), snow(d.ServerID)}
		sess.emitIf("GUILD_MEMBER_ADD", botproto.InGuild, ev)

	case gateway.EvMemberUpdate:
		var d store.Member
		if json.Unmarshal(raw, &d) != nil || !sess.onShard(&d.ServerID) {
			return
		}
		mem, err := sess.s.Store.Member(ctx, d.ServerID, d.UserID)
		if err != nil {
			return
		}
		ev := struct {
			dMember
			GuildID snow `json:"guild_id"`
		}{b.memberObj(mem, true), snow(d.ServerID)}
		// a bot always hears about its own membership
		if d.UserID == sess.bot.ID {
			sess.emit("GUILD_MEMBER_UPDATE", ev)
			return
		}
		sess.emitIf("GUILD_MEMBER_UPDATE", botproto.InGuild, ev)

	case gateway.EvMemberRemove:
		var d struct {
			ServerID ids.ID `json:"server_id"`
			UserID   ids.ID `json:"user_id"`
		}
		if json.Unmarshal(raw, &d) != nil || !sess.onShard(&d.ServerID) || d.UserID == sess.bot.ID {
			return
		}
		sess.emitIf("GUILD_MEMBER_REMOVE", botproto.InGuild, map[string]any{"guild_id": snow(d.ServerID), "user": b.userByID(d.UserID)})

	case gateway.EvRoleCreate, gateway.EvRoleUpdate:
		var r store.Role
		if json.Unmarshal(raw, &r) != nil || !sess.onShard(&r.ServerID) {
			return
		}
		if fresh, err := sess.s.Store.RoleByID(ctx, r.ID); err == nil {
			r = *fresh
		}
		event := "GUILD_ROLE_CREATE"
		if f.T == gateway.EvRoleUpdate {
			event = "GUILD_ROLE_UPDATE"
		}
		sess.emitIf(event, botproto.InGuild, map[string]any{"guild_id": snow(r.ServerID), "role": b.roleObj(&r)})

	case gateway.EvRoleDelete:
		var d struct {
			ID       ids.ID `json:"id"`
			ServerID ids.ID `json:"server_id"`
		}
		if json.Unmarshal(raw, &d) != nil || !sess.onShard(&d.ServerID) {
			return
		}
		sess.emitIf("GUILD_ROLE_DELETE", botproto.InGuild, map[string]any{"guild_id": snow(d.ServerID), "role_id": snow(d.ID)})

	case gateway.EvPresence:
		var p gateway.Presence
		if json.Unmarshal(raw, &p) != nil || p.UserID == sess.bot.ID || !sess.wants("PRESENCE_UPDATE", botproto.InGuild) {
			return
		}
		for _, gid := range sess.sharedGuilds(ctx, p.UserID) {
			g := gid
			sess.emit("PRESENCE_UPDATE", b.presenceObj(p, &g))
		}

	case gateway.EvUserUpdate:
		var u store.PublicUser
		if json.Unmarshal(raw, &u) != nil {
			return
		}
		if u.ID == sess.bot.ID {
			if fresh, err := sess.s.Store.UserByID(ctx, u.ID); err == nil {
				sess.bot = fresh
				sess.emit("USER_UPDATE", sess.selfUser(sess.builder(ctx)))
			}
			return
		}
		if sess.intent&botproto.IntentGuildMembers == 0 {
			return
		}
		for _, gid := range sess.sharedGuilds(ctx, u.ID) {
			if mem, err := sess.s.Store.Member(ctx, gid, u.ID); err == nil {
				sess.emit("GUILD_MEMBER_UPDATE", struct {
					dMember
					GuildID snow `json:"guild_id"`
				}{b.memberObj(mem, true), snow(gid)})
			}
		}

	case gateway.EvVoiceState:
		var d struct {
			UserID       ids.ID  `json:"user_id"`
			ChannelID    *ids.ID `json:"channel_id"`
			OldChannelID *ids.ID `json:"old_channel_id"`
			SessionID    ids.ID  `json:"session_id"`
			SelfMute     bool    `json:"self_mute"`
			SelfDeaf     bool    `json:"self_deaf"`
			Video        bool    `json:"video"`
			Streaming    bool    `json:"streaming"`
			ServerMute   bool    `json:"server_mute"`
			ServerDeaf   bool    `json:"server_deaf"`
			Suppress     bool    `json:"suppress"`
		}
		if json.Unmarshal(raw, &d) != nil {
			return
		}
		where := d.ChannelID
		if where == nil {
			where = d.OldChannelID
		}
		if where == nil {
			return
		}
		ch := sess.eventChannel(ctx, *where)
		if ch == nil || ch.ServerID == nil || !sess.onShard(ch.ServerID) {
			return
		}
		st := b.voiceStateObj(ch.ServerID, d.ChannelID, d.UserID, d.SessionID, d.SelfMute, d.SelfDeaf, d.Video, d.Streaming, d.ServerMute, d.ServerDeaf, true)
		st.Suppress = d.Suppress
		sess.emitIf("VOICE_STATE_UPDATE", botproto.InGuild, st)

	case gateway.EvEmojiUpdate:
		var d struct {
			ServerID ids.ID `json:"server_id"`
		}
		if json.Unmarshal(raw, &d) != nil || !sess.onShard(&d.ServerID) {
			return
		}
		list, err := sess.s.Store.ServerEmojis(ctx, d.ServerID)
		if err != nil {
			return
		}
		emojis := make([]dEmoji, 0, len(list))
		for _, e := range list {
			emojis = append(emojis, b.emojiObj(e, true))
		}
		sess.emitIf("GUILD_EMOJIS_UPDATE", botproto.InGuild, map[string]any{"guild_id": snow(d.ServerID), "emojis": emojis})

	case gateway.EvStickerUpdate:
		var d struct {
			Pack *struct {
				ServerID *ids.ID `json:"server_id"`
			} `json:"pack"`
		}
		if json.Unmarshal(raw, &d) != nil || d.Pack == nil || d.Pack.ServerID == nil || !sess.onShard(d.Pack.ServerID) {
			return
		}
		sess.emitIf("GUILD_STICKERS_UPDATE", botproto.InGuild, map[string]any{"guild_id": snow(*d.Pack.ServerID), "stickers": b.guildStickers(*d.Pack.ServerID)})

	case gateway.EvPinUpdate:
		var d struct {
			ChannelID ids.ID `json:"channel_id"`
			Pinned    bool   `json:"pinned"`
		}
		if json.Unmarshal(raw, &d) != nil {
			return
		}
		ch := sess.eventChannel(ctx, d.ChannelID)
		if ch == nil || !sess.onShard(ch.ServerID) {
			return
		}
		ev := map[string]any{"channel_id": snow(d.ChannelID), "guild_id": botproto.SP(ch.ServerID), "last_pin_timestamp": nil}
		if at, err := sess.s.Store.LastPinAt(ctx, d.ChannelID); err == nil && at > 0 {
			ev["last_pin_timestamp"] = botproto.Timestamp(at)
		}
		sess.emitIf("CHANNEL_PINS_UPDATE", scopeOf(ch), ev)

	case gateway.EvBanAdd, gateway.EvBanRemove:
		var d struct {
			ServerID ids.ID `json:"server_id"`
			UserID   ids.ID `json:"user_id"`
		}
		if json.Unmarshal(raw, &d) != nil || !sess.onShard(&d.ServerID) {
			return
		}
		event := "GUILD_BAN_ADD"
		if f.T == gateway.EvBanRemove {
			event = "GUILD_BAN_REMOVE"
		}
		sess.emitIf(event, botproto.InGuild, map[string]any{"guild_id": snow(d.ServerID), "user": b.userByID(d.UserID)})

	case gateway.EvInviteCreate:
		var inv store.Invite
		if json.Unmarshal(raw, &inv) != nil || inv.ServerID == nil || !sess.onShard(inv.ServerID) {
			return
		}
		maxAge := 0
		if inv.ExpiresAt != nil {
			maxAge = int((*inv.ExpiresAt - inv.CreatedAt) / 1000)
		}
		ev := map[string]any{"channel_id": botproto.SP(inv.ChannelID), "code": inv.Code, "created_at": botproto.Timestamp(inv.CreatedAt), "guild_id": snow(*inv.ServerID),
			"inviter": b.userByID(inv.InviterID), "max_age": maxAge, "max_uses": inv.MaxUses, "temporary": false, "uses": inv.Uses, "expires_at": botproto.TimestampP(inv.ExpiresAt)}
		sess.emitIf("INVITE_CREATE", botproto.InGuild, ev)

	case gateway.EvInviteDelete:
		var d struct {
			ServerID  ids.ID  `json:"server_id"`
			ChannelID *ids.ID `json:"channel_id"`
			Code      string  `json:"code"`
		}
		if json.Unmarshal(raw, &d) != nil || !sess.onShard(&d.ServerID) {
			return
		}
		sess.emitIf("INVITE_DELETE", botproto.InGuild, map[string]any{"guild_id": snow(d.ServerID), "channel_id": botproto.SP(d.ChannelID), "code": d.Code})

	case gateway.EvWebhooksUpdate:
		var d struct {
			ServerID  ids.ID `json:"server_id"`
			ChannelID ids.ID `json:"channel_id"`
		}
		if json.Unmarshal(raw, &d) != nil || !sess.onShard(&d.ServerID) {
			return
		}
		sess.emitIf("WEBHOOKS_UPDATE", botproto.InGuild, map[string]any{"guild_id": snow(d.ServerID), "channel_id": snow(d.ChannelID)})

	case gateway.EvPollVoteAdd, gateway.EvPollVoteRemove:
		var d pollVoteEvent
		if json.Unmarshal(raw, &d) != nil {
			return
		}
		ch := sess.eventChannel(ctx, d.ChannelID)
		if ch == nil || !sess.onShard(ch.ServerID) {
			return
		}
		event := "MESSAGE_POLL_VOTE_ADD"
		if f.T == gateway.EvPollVoteRemove {
			event = "MESSAGE_POLL_VOTE_REMOVE"
		}
		sess.emitIf(event, scopeOf(ch), map[string]any{"user_id": snow(d.UserID), "channel_id": snow(d.ChannelID), "message_id": snow(d.MessageID),
			"guild_id": botproto.SP(ch.ServerID), "answer_id": d.AnswerID})

	case gateway.EvAuditLogEntry:
		var e store.AuditEntry
		if json.Unmarshal(raw, &e) != nil || !sess.onShard(&e.ServerID) {
			return
		}
		if entry, ok := b.auditEntryObj(&e); ok {
			ev := struct {
				dAuditEntry
				GuildID snow `json:"guild_id"`
			}{entry, snow(e.ServerID)}
			sess.emitIf("GUILD_AUDIT_LOG_ENTRY_CREATE", botproto.InGuild, ev)
		}

	case gateway.EvAutomodEvent:
		var e store.AutomodEvent
		if json.Unmarshal(raw, &e) != nil || !sess.onShard(&e.ServerID) {
			return
		}
		if evs, ok := b.automodExecutionObj(&e, sess.intent&botproto.IntentMessageContent != 0); ok {
			for _, ev := range evs {
				sess.emitIf("AUTO_MODERATION_ACTION_EXECUTION", botproto.InGuild, ev)
			}
		}

	case gateway.EvAutomodRulesUpdate:
		var d struct {
			ServerID ids.ID          `json:"server_id"`
			Rule     json.RawMessage `json:"rule"`
			Deleted  *ids.ID         `json:"deleted"`
			Created  bool            `json:"created"`
		}
		if json.Unmarshal(raw, &d) != nil || !sess.onShard(&d.ServerID) {
			return
		}
		sess.automodRuleEvent(ctx, b, d.ServerID, d.Rule, d.Deleted, d.Created)
	}
}

// sharedGuilds lists the servers of this shard the bot shares with someone.
func (sess *botSession) sharedGuilds(ctx context.Context, uid ids.ID) []ids.ID {
	theirs, err := sess.s.Store.ServerIDsOf(ctx, uid)
	if err != nil {
		return nil
	}
	sess.mu.Lock()
	defer sess.mu.Unlock()
	out := []ids.ID{}
	for _, id := range theirs {
		if sess.guilds[id] {
			out = append(out, id)
		}
	}
	return out
}

// deliverInteraction hands an interaction to one of its bot's sessions whose
// shard has its server (shard 0, for anywhere else): a connected one when
// there is one. A session waiting for its library to resume only gets it when
// nothing else can, since a bot that restarted starts a new session and never
// comes back for what waits in the old one, which would leave the person's
// interaction unanswered.
func (s *Server) deliverInteraction(app ids.ID, guild *ids.ID, payload any) bool {
	var waiting *botSession
	for _, sess := range s.bots.sessionsOf(app) {
		if !sess.onShard(guild) {
			continue
		}
		if sess.connected() {
			sess.emit("INTERACTION_CREATE", payload)
			return true
		}
		if waiting == nil {
			waiting = sess
		}
	}
	if waiting == nil {
		return false
	}
	waiting.emit("INTERACTION_CREATE", payload)
	return true
}

// tellBot sends one event, needing no intent, to every session of a bot
// whose shard it belongs to (an application command's permissions changed,
// an entitlement).
func (s *Server) tellBot(app ids.ID, guild *ids.ID, event string, payload any) {
	for _, sess := range s.bots.sessionsOf(app) {
		if sess.onShard(guild) {
			sess.emit(event, payload)
		}
	}
}
