package gateway

import (
	"context"
	"log/slog"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// Hub tracks connections and fans events out.
type Hub struct {
	st   *store.Store
	auth *auth.Authenticator
	log  *slog.Logger
	seq  atomic.Uint64

	mu    sync.RWMutex
	conns map[ids.ID]map[*conn]struct{}

	originPatterns   []string
	heartbeatTimeout time.Duration
	identifyTimeout  time.Duration
	sendBuffer       int

	// Hooks the server layer (Phase 2) sets to extend DM-only behaviour.
	// ViewerResolver lists users who may see a server channel.
	ViewerResolver func(ctx context.Context, channelID ids.ID) ([]ids.ID, error)
	// Access reports whether uid may act in a server channel.
	Access func(ctx context.Context, uid, channelID ids.ID) (bool, error)
	// Interested lists extra users who should receive uid's presence (server co-members).
	Interested func(ctx context.Context, uid ids.ID) ([]ids.ID, error)
	// ReadyExtras adds server data to the ready payload.
	ReadyExtras func(ctx context.Context, u *store.User, p *ReadyPayload) error
	// ExtraChannels lists server channels whose read states belong in ready.
	ExtraChannels func(ctx context.Context, uid ids.ID) ([]ids.ID, error)
	// VoiceOp handles voice_state / voice_signal ops (Phase 4).
	VoiceOp func(ctx context.Context, c *Conn, op string, data []byte)
	// OnDisconnect runs when a user's last connection closes (voice cleanup).
	OnDisconnect func(ctx context.Context, uid ids.ID)
	// OnConnClose runs when any connection closes; voice states belong to one session.
	OnConnClose func(ctx context.Context, uid, sessionID ids.ID)
}

// New creates a hub.
func New(st *store.Store, authn *auth.Authenticator, log *slog.Logger, publicURL string) *Hub {
	h := &Hub{st: st, auth: authn, log: log, conns: map[ids.ID]map[*conn]struct{}{},
		heartbeatTimeout: 60 * time.Second, identifyTimeout: 10 * time.Second, sendBuffer: 256}
	if u, err := url.Parse(publicURL); err == nil && u.Host != "" {
		h.originPatterns = append(h.originPatterns, u.Host)
	}
	h.originPatterns = append(h.originPatterns, "localhost:*", "127.0.0.1:*")
	return h
}

// Run sweeps dead connections until ctx ends.
func (h *Hub) Run(ctx context.Context) {
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			h.sweep()
		}
	}
}

func (h *Hub) sweep() {
	now := time.Now()
	var stale []*conn
	h.mu.RLock()
	for _, set := range h.conns {
		for c := range set {
			if now.Sub(c.lastBeat()) > h.heartbeatTimeout {
				stale = append(stale, c)
			}
		}
	}
	h.mu.RUnlock()
	for _, c := range stale {
		c.close(websocket.StatusPolicyViolation, "heartbeat timeout")
	}
}

func (h *Hub) nextSeq() uint64 { return h.seq.Add(1) }

// register adds a connection; returns true when it is the user's first.
func (h *Hub) register(c *conn) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.conns[c.user.ID]
	if set == nil {
		set = map[*conn]struct{}{}
		h.conns[c.user.ID] = set
	}
	set[c] = struct{}{}
	return len(set) == 1
}

// unregister removes a connection; returns true when it was the user's last.
func (h *Hub) unregister(c *conn) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.conns[c.user.ID]
	if set == nil {
		return false
	}
	delete(set, c)
	if len(set) == 0 {
		delete(h.conns, c.user.ID)
		return true
	}
	return false
}

// Online reports whether the user has any open connection.
func (h *Hub) Online(uid ids.ID) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.conns[uid]) > 0
}

// OnlineUsers lists users with at least one connection.
func (h *Hub) OnlineUsers() []ids.ID {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]ids.ID, 0, len(h.conns))
	for uid := range h.conns {
		out = append(out, uid)
	}
	return out
}

// ConnectionCount returns the number of open connections.
func (h *Hub) ConnectionCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	n := 0
	for _, set := range h.conns {
		n += len(set)
	}
	return n
}

// EmitUsers sends an event to every connection of the given users.
func (h *Hub) EmitUsers(userIDs []ids.ID, t string, d any) {
	if len(userIDs) == 0 {
		return
	}
	frame := ServerFrame{T: t, S: h.nextSeq(), D: d}
	h.mu.RLock()
	defer h.mu.RUnlock()
	seen := make(map[ids.ID]bool, len(userIDs))
	for _, uid := range userIDs {
		if seen[uid] {
			continue
		}
		seen[uid] = true
		for c := range h.conns[uid] {
			c.enqueue(frame)
		}
	}
}

// EmitUsersExcept sends to users but skips one connection (the originator).
func (h *Hub) emitUsersExcept(userIDs []ids.ID, except *conn, t string, d any) {
	frame := ServerFrame{T: t, S: h.nextSeq(), D: d}
	h.mu.RLock()
	defer h.mu.RUnlock()
	seen := map[ids.ID]bool{}
	for _, uid := range userIDs {
		if seen[uid] {
			continue
		}
		seen[uid] = true
		for c := range h.conns[uid] {
			if c != except {
				c.enqueue(frame)
			}
		}
	}
}

// EmitAll sends to every connection.
func (h *Hub) EmitAll(t string, d any) {
	frame := ServerFrame{T: t, S: h.nextSeq(), D: d}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, set := range h.conns {
		for c := range set {
			c.enqueue(frame)
		}
	}
}

// Viewers lists the users who can see a channel.
func (h *Hub) Viewers(ctx context.Context, channelID ids.ID) ([]ids.ID, error) {
	ch, err := h.st.ChannelByID(ctx, channelID)
	if err != nil {
		return nil, err
	}
	if ch.Type == "dm" || ch.Type == "group_dm" {
		return ch.Recipients, nil
	}
	if h.ViewerResolver != nil {
		return h.ViewerResolver(ctx, channelID)
	}
	return nil, nil
}

// CanAccess reports whether uid may read/act in a channel.
func (h *Hub) CanAccess(ctx context.Context, uid, channelID ids.ID) (bool, error) {
	ch, err := h.st.ChannelByID(ctx, channelID)
	if err != nil {
		return false, err
	}
	if ch.Type == "dm" || ch.Type == "group_dm" {
		return h.st.IsParticipant(ctx, channelID, uid)
	}
	if h.Access != nil {
		return h.Access(ctx, uid, channelID)
	}
	return false, nil
}

// EmitChannel sends an event to everyone who can see the channel.
func (h *Hub) EmitChannel(channelID ids.ID, t string, d any) {
	viewers, err := h.Viewers(context.Background(), channelID)
	if err != nil {
		h.log.Warn("emit channel: viewers", "channel", channelID, "err", err)
		return
	}
	h.EmitUsers(viewers, t, d)
}

// interestedIn lists users who should see uid's presence and profile changes.
func (h *Hub) interestedIn(ctx context.Context, uid ids.ID) []ids.ID {
	out := []ids.ID{uid}
	if friends, err := h.st.Friends(ctx, uid); err == nil {
		out = append(out, friends...)
	}
	if chans, err := h.st.DMChannelsForUser(ctx, uid); err == nil {
		for _, ch := range chans {
			out = append(out, ch.Recipients...)
		}
	}
	if h.Interested != nil {
		if more, err := h.Interested(ctx, uid); err == nil {
			out = append(out, more...)
		}
	}
	return out
}

// UserUpdated broadcasts a profile change (api.Broadcaster).
func (h *Hub) UserUpdated(u *store.User) {
	ctx := context.Background()
	h.EmitUsers(h.interestedIn(ctx, u.ID), EvUserUpdate, u.Public())
	// presence carries the custom status too
	h.broadcastPresence(ctx, u)
}

// KeysMaybeNeeded tells online holders of a conversation's latest key about
// members who still lack a grant (api.Broadcaster).
func (h *Hub) KeysMaybeNeeded(convID ids.ID) {
	ctx := context.Background()
	epoch, ok, err := h.st.LatestEpoch(ctx, convID)
	if err != nil || !ok {
		return
	}
	entitled, err := h.st.Entitled(ctx, convID)
	if err != nil {
		return
	}
	lacking, err := h.st.UsersLackingGrant(ctx, convID, epoch, entitled)
	if err != nil || len(lacking) == 0 {
		return
	}
	holders, err := h.st.HoldersOf(ctx, convID, epoch)
	if err != nil {
		return
	}
	var online []ids.ID
	for _, uid := range holders {
		if h.Online(uid) {
			online = append(online, uid)
		}
	}
	h.EmitUsers(online, EvKeysNeeded, store.KeyNeed{ConvID: convID, Epoch: epoch, UserIDs: lacking})
}

// PresenceOf computes a user's presence as others see it.
func (h *Hub) PresenceOf(ctx context.Context, u *store.User) Presence {
	p := Presence{UserID: u.ID, Status: "offline"}
	if !h.Online(u.ID) {
		return p
	}
	p.StatusText, p.StatusEmoji, p.StatusExpiresAt = u.StatusText, u.StatusEmoji, u.StatusExpiresAt
	if p.StatusExpiresAt != nil && *p.StatusExpiresAt < time.Now().UnixMilli() {
		p.StatusText, p.StatusEmoji, p.StatusExpiresAt = "", "", nil
	}
	switch u.PresencePref {
	case "idle", "dnd":
		p.Status = u.PresencePref
	case "invisible":
		p.Status = "offline"
	default:
		p.Status = "online"
	}
	return p
}

// selfPresence is what the user's own devices see (invisible stays visible to self).
func (h *Hub) selfPresence(ctx context.Context, u *store.User) Presence {
	p := h.PresenceOf(ctx, u)
	if u.PresencePref == "invisible" && h.Online(u.ID) {
		p.Status = "invisible"
	}
	return p
}

// broadcastPresence pushes the user's current presence to interested users.
func (h *Hub) broadcastPresence(ctx context.Context, u *store.User) {
	interested := h.interestedIn(ctx, u.ID)
	others := interested[:0:0]
	for _, id := range interested {
		if id != u.ID {
			others = append(others, id)
		}
	}
	h.EmitUsers(others, EvPresence, h.PresenceOf(ctx, u))
	h.EmitUsers([]ids.ID{u.ID}, EvPresence, h.selfPresence(ctx, u))
}

// CloseAll disconnects every client (shutdown).
func (h *Hub) CloseAll(code websocket.StatusCode, reason string) {
	h.mu.RLock()
	var all []*conn
	for _, set := range h.conns {
		for c := range set {
			all = append(all, c)
		}
	}
	h.mu.RUnlock()
	for _, c := range all {
		c.close(code, reason)
	}
}

func hostOf(origin string) string {
	u, err := url.Parse(origin)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Host)
}
