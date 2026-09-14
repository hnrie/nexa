package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"golang.org/x/time/rate"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
	"evilion.xyz/chat/internal/textutil"
)

const (
	readLimit    = 1 << 16
	writeTimeout = 10 * time.Second
	// typingCooldown sits well below the composer's 8 s resend interval, so a
	// refresh that arrives a little early on a jittery link is not dropped.
	typingCooldown = 5 * time.Second
	// typingTTL is how long receivers show an indicator; after it a stop is moot.
	typingTTL = 10 * time.Second
	// typingKeep is how many channels a connection remembers before it forgets
	// the ones whose indicators have run out.
	typingKeep = 32

	// A connection may send opRate frames a second with bursts of opBurst. The
	// burst covers the client flushing its offline queue and a call's ICE
	// candidates; past that the socket is closed.
	opRate  = 20
	opBurst = 100
	// Each presence op writes to the database and fans out to every co-member.
	presenceEvery = 2 * time.Second
	presenceBurst = 5
	// Activity changes reach co-members at most this often, like Discord's
	// five updates per twenty seconds; the latest waits for its turn.
	activityEvery = 4 * time.Second
	activityBurst = 5
	// maxActivityBytes bounds one activity as sent.
	maxActivityBytes = 8 << 10
	// Voice signals are relayed to one peer, so their bytes are budgeted to
	// keep a flood from filling that peer's send buffer.
	signalBytesRate  = 128 << 10
	signalBytesBurst = 512 << 10

	maxStatusText  = 128
	maxStatusEmoji = 64

	// CloseSessionRevoked tells the client its session is gone; it signs out.
	CloseSessionRevoked websocket.StatusCode = 4001
	// CloseRateLimited tells the client it sent too much; it reconnects.
	CloseRateLimited websocket.StatusCode = 4008
)

// Conn is the exported view of a connection for hook implementers.
type Conn struct {
	c *conn
}

// User returns the connection's user.
func (x *Conn) User() *store.User { return x.c.user }

// SessionID returns the session id.
func (x *Conn) SessionID() ids.ID { return x.c.session.ID }

// ID identifies this one connection. Every tab and every reconnect of a device
// shares the session, so state owned by a single socket is keyed by this.
func (x *Conn) ID() ids.ID { return x.c.id }

// Send enqueues a frame to this connection only.
func (x *Conn) Send(t string, d any) { x.c.enqueue(ServerFrame{T: t, S: x.c.hub.nextSeq(), D: d}) }

type conn struct {
	id      ids.ID
	hub     *Hub
	ws      *websocket.Conn
	user    *store.User
	session *store.Session
	send    chan ServerFrame
	closed  chan struct{}
	once    sync.Once
	beat    atomic.Int64
	typing  map[ids.ID]time.Time
	typMu   sync.Mutex

	ops         *rate.Limiter
	presence    *rate.Limiter
	signalBytes *rate.Limiter

	// Activities this connection reported, resolved and cleaned. Payloads that
	// arrive while one is being resolved wait in actPending, latest only.
	actMu      sync.Mutex
	acts       []Activity
	actsAt     time.Time
	actPending *[]json.RawMessage
	actBusy    bool
	actLimit   *rate.Limiter
	actTimer   *time.Timer

	// Until ready is queued the connection is registered but not live: events
	// wait in pending, so nothing emitted while ready is built is lost or
	// arrives ahead of it.
	live    atomic.Bool
	revoked atomic.Bool
	pendMu  sync.Mutex
	pending []ServerFrame
}

func (c *conn) lastBeat() time.Time { return time.UnixMilli(c.beat.Load()) }

func (c *conn) enqueue(f ServerFrame) {
	if !c.live.Load() {
		c.pendMu.Lock()
		if !c.live.Load() {
			// ready takes one slot of the send buffer when it goes out
			if len(c.pending) >= cap(c.send)-1 {
				c.pendMu.Unlock()
				c.close(websocket.StatusPolicyViolation, "slow consumer")
				return
			}
			c.pending = append(c.pending, f)
			c.pendMu.Unlock()
			return
		}
		c.pendMu.Unlock()
	}
	select {
	case c.send <- f:
	default:
		c.close(websocket.StatusPolicyViolation, "slow consumer")
	}
}

// goLive queues ready and then everything emitted while it was built; from
// then on events go straight to the send buffer.
func (c *conn) goLive(ready ServerFrame) {
	c.pendMu.Lock()
	defer c.pendMu.Unlock()
	if c.revoked.Load() {
		// the session ended while ready was built: send none of it
		c.close(CloseSessionRevoked, "session revoked")
		return
	}
	// Nothing reached the buffer before this, and pending holds fewer frames
	// than it has room for, so none of these sends block.
	c.send <- ready
	for _, f := range c.pending {
		c.send <- f
	}
	c.pending = nil
	c.live.Store(true)
}

// close ends the connection once. The close handshake waits for the peer's
// reply, so it runs in its own goroutine and never blocks a caller such as
// the sweeper or an emitter.
func (c *conn) close(code websocket.StatusCode, reason string) {
	c.once.Do(func() {
		close(c.closed)
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = c.ws.Close(code, reason)
			<-ctx.Done()
			_ = c.ws.CloseNow()
		}()
	})
}

// frameRevoked marks where a revoked connection's queue ends; it is never sent.
const frameRevoked = "\x00revoked"

// revoke ends a connection whose session is gone. Its ops are ignored at once,
// but frames already queued, such as session_expired, still go out before the
// close unless the client stops reading.
func (c *conn) revoke() {
	c.revoked.Store(true)
	c.enqueue(ServerFrame{T: frameRevoked})
	time.AfterFunc(writeTimeout, func() { c.close(CloseSessionRevoked, "session revoked") })
}

// ServeHTTP upgrades the request and runs the connection until it ends.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.originPatterns, CompressionMode: websocket.CompressionNoContextTakeover})
	if err != nil {
		return
	}
	ws.SetReadLimit(readLimit)
	ctx := r.Context()

	// identify
	idCtx, cancel := context.WithTimeout(ctx, h.identifyTimeout)
	_, raw, err := ws.Read(idCtx)
	cancel()
	if err != nil {
		_ = ws.Close(4000, "identify timeout")
		return
	}
	var frame ClientFrame
	if err := json.Unmarshal(raw, &frame); err != nil || frame.Op != OpIdentify {
		_ = ws.Close(4000, "expected identify")
		return
	}
	var idd identifyData
	_ = json.Unmarshal(frame.D, &idd)
	user, session := h.auth.Resolve(ctx, idd.Token)
	if user == nil {
		_ = ws.Close(4001, "authentication failed")
		return
	}
	c := &conn{id: ids.New(), hub: h, ws: ws, user: user, session: session, send: make(chan ServerFrame, h.sendBuffer), closed: make(chan struct{}), typing: map[ids.ID]time.Time{},
		ops: rate.NewLimiter(opRate, opBurst), presence: rate.NewLimiter(rate.Every(presenceEvery), presenceBurst), signalBytes: rate.NewLimiter(signalBytesRate, signalBytesBurst),
		actLimit: rate.NewLimiter(rate.Every(activityEvery), activityBurst)}
	c.beat.Store(time.Now().UnixMilli())

	// Register before building ready, so events fired meanwhile are held for
	// this connection instead of reaching nobody.
	first := h.register(c)
	ready, err := h.buildReady(ctx, user, session)
	if err != nil {
		h.log.Error("ready", "user", user.ID, "err", err)
		h.unregister(c)
		c.close(4002, "ready failed")
		return
	}
	c.goLive(ServerFrame{T: EvReady, S: h.nextSeq(), D: ready})
	if first {
		h.broadcastPresence(ctx, user)
	}

	go c.writeLoop()
	c.readLoop(ctx)

	last := h.unregister(c)
	c.close(websocket.StatusNormalClosure, "bye")
	if h.OnConnClose != nil {
		h.OnConnClose(context.Background(), user.ID, c.id)
	}
	// what this connection was doing ends with it; the user's other devices may still say something
	if c.dropActivities() && !last {
		h.broadcastUser(context.Background(), user.ID)
	}
	if last {
		bg := context.Background()
		if u, err := h.st.UserByID(bg, user.ID); err == nil {
			h.broadcastPresence(bg, u)
		}
		if h.OnDisconnect != nil {
			h.OnDisconnect(bg, user.ID)
		}
	}
}

func (c *conn) writeLoop() {
	for {
		select {
		case <-c.closed:
			return
		case f := <-c.send:
			if f.T == frameRevoked {
				c.close(CloseSessionRevoked, "session revoked")
				return
			}
			b, err := json.Marshal(f)
			if err != nil {
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
			err = c.ws.Write(ctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				c.close(websocket.StatusAbnormalClosure, "write failed")
				return
			}
		}
	}
}

func (c *conn) readLoop(ctx context.Context) {
	for {
		_, raw, err := c.ws.Read(ctx)
		if err != nil {
			return
		}
		if c.revoked.Load() {
			continue
		}
		if !c.ops.Allow() {
			c.close(CloseRateLimited, "rate limited")
			return
		}
		var f ClientFrame
		if err := json.Unmarshal(raw, &f); err != nil {
			continue
		}
		c.handle(ctx, f)
		select {
		case <-c.closed:
			return
		default:
		}
	}
}

func (c *conn) handle(ctx context.Context, f ClientFrame) {
	h := c.hub
	switch f.Op {
	case OpHeartbeat:
		c.beat.Store(time.Now().UnixMilli())
		c.enqueue(ServerFrame{T: EvHeartbeatAck})
	case OpPresence:
		c.beat.Store(time.Now().UnixMilli())
		if !c.presence.Allow() {
			return
		}
		var d presenceData
		if err := json.Unmarshal(f.D, &d); err != nil {
			return
		}
		if d.StatusExpiresAt != nil && *d.StatusExpiresAt < 0 {
			return
		}
		var p store.ProfilePatch
		if d.Status != nil {
			switch *d.Status {
			case "online", "idle", "dnd", "invisible":
				p.PresencePref = d.Status
			}
		}
		if d.ClearStatus {
			empty := ""
			var nilExp *int64
			p.StatusText, p.StatusEmoji, p.StatusExpiresAt = &empty, &empty, &nilExp
		} else {
			// The same rules as PATCH /users/@me. Overlong text is cut by
			// characters rather than refused, as there is no reply to show.
			if d.StatusText != nil {
				t, ok := textutil.CleanText(strings.ReplaceAll(*d.StatusText, "\n", " "), maxStatusText)
				if !ok && t != "" {
					t, ok = strings.TrimSpace(string([]rune(t)[:maxStatusText])), true
				}
				if ok {
					p.StatusText = &t
				}
			}
			if d.StatusEmoji != nil {
				if e, ok := textutil.CleanText(*d.StatusEmoji, maxStatusEmoji); ok && !strings.ContainsAny(e, " \n") {
					p.StatusEmoji = &e
				}
			}
			// A new status always sets its expiry: JSON null decodes like a
			// missing field, and must not leave an earlier status's timer behind.
			if d.StatusExpiresAt != nil || d.StatusText != nil || d.StatusEmoji != nil {
				exp := d.StatusExpiresAt
				p.StatusExpiresAt = &exp
			}
		}
		if err := h.st.UpdateProfile(ctx, c.user.ID, p); err != nil {
			return
		}
		u, err := h.st.UserByID(ctx, c.user.ID)
		if err != nil {
			return
		}
		c.user = u
		h.broadcastPresence(ctx, u)
	case OpActivities:
		c.beat.Store(time.Now().UnixMilli())
		var d activitiesData
		if err := json.Unmarshal(f.D, &d); err != nil {
			return
		}
		if len(d.Activities) > maxActivities {
			d.Activities = d.Activities[:maxActivities]
		}
		c.queueActivities(d.Activities)
	case OpTyping:
		var d typingData
		if err := json.Unmarshal(f.D, &d); err != nil || d.ChannelID.IsZero() {
			return
		}
		if d.Stop {
			c.typMu.Lock()
			_, seen := c.typing[d.ChannelID]
			delete(c.typing, d.ChannelID)
			c.typMu.Unlock()
			if seen {
				h.TypingStop(ctx, c.user.ID, d.ChannelID)
			}
			return
		}
		c.typMu.Lock()
		last, seen := c.typing[d.ChannelID]
		c.typMu.Unlock()
		if seen && time.Since(last) < typingCooldown {
			return
		}
		// Access is checked before the channel is remembered, so made-up ids
		// cannot grow the map.
		others, ok := h.typingAudience(ctx, c.user.ID, d.ChannelID)
		if !ok {
			return
		}
		now := time.Now()
		c.typMu.Lock()
		if len(c.typing) >= typingKeep {
			for id, at := range c.typing {
				if now.Sub(at) > typingTTL {
					delete(c.typing, id)
				}
			}
		}
		c.typing[d.ChannelID] = now
		c.typMu.Unlock()
		h.EmitUsers(others, EvTyping, map[string]any{"channel_id": d.ChannelID, "user_id": c.user.ID, "ts": now.UnixMilli()})
	case OpVoiceSignal:
		if !c.signalBytes.AllowN(time.Now(), len(f.D)) {
			return
		}
		if h.VoiceOp != nil {
			h.VoiceOp(ctx, &Conn{c: c}, f.Op, f.D)
		}
	case OpVoiceState, OpSubscribe:
		if h.VoiceOp != nil {
			h.VoiceOp(ctx, &Conn{c: c}, f.Op, f.D)
		}
	}
}

// TypingStop clears a typing indicator immediately (the author sent or cleared the box).
func (h *Hub) TypingStop(ctx context.Context, uid, channelID ids.ID) {
	ok, err := h.CanAccess(ctx, uid, channelID)
	if err != nil || !ok {
		return
	}
	viewers, err := h.Viewers(ctx, channelID)
	if err != nil {
		return
	}
	others := make([]ids.ID, 0, len(viewers))
	for _, v := range viewers {
		if v != uid {
			others = append(others, v)
		}
	}
	h.EmitUsers(others, EvTyping, map[string]any{"channel_id": channelID, "user_id": uid, "ts": time.Now().UnixMilli(), "stop": true})
}

// Typing broadcasts a typing indicator after checking access.
func (h *Hub) Typing(ctx context.Context, uid, channelID ids.ID) {
	others, ok := h.typingAudience(ctx, uid, channelID)
	if !ok {
		return
	}
	h.EmitUsers(others, EvTyping, map[string]any{"channel_id": channelID, "user_id": uid, "ts": time.Now().UnixMilli()})
}

// typingAudience reports whether uid may type in a channel, which in a server
// channel means being allowed to send there, and lists who else sees it.
func (h *Hub) typingAudience(ctx context.Context, uid, channelID ids.ID) ([]ids.ID, bool) {
	ch, err := h.st.ChannelByID(ctx, channelID)
	if err != nil {
		return nil, false
	}
	var viewers []ids.ID
	if ch.Type == "dm" || ch.Type == "group_dm" {
		if ok, err := h.st.IsParticipant(ctx, channelID, uid); err != nil || !ok {
			return nil, false
		}
		// a block closes a 1:1 conversation both ways, typing included
		if blocked, err := h.st.DMBlocked(ctx, ch, uid); err != nil || blocked {
			return nil, false
		}
		viewers = ch.Recipients
	} else {
		if h.SendAccess == nil || h.ViewerResolver == nil {
			return nil, false
		}
		if ok, err := h.SendAccess(ctx, uid, channelID); err != nil || !ok {
			return nil, false
		}
		if viewers, err = h.ViewerResolver(ctx, channelID); err != nil {
			return nil, false
		}
	}
	others := make([]ids.ID, 0, len(viewers))
	for _, v := range viewers {
		if v != uid {
			others = append(others, v)
		}
	}
	return others, true
}

// buildReady assembles the initial state for a user.
func (h *Hub) buildReady(ctx context.Context, u *store.User, session *store.Session) (*ReadyPayload, error) {
	p := &ReadyPayload{SessionID: session.ID, Servers: []any{}, VoiceStates: []any{}, Presences: []Presence{}, Users: []store.PublicUser{}}
	p.User = map[string]any{"id": u.ID, "username": u.Username, "display_name": u.DisplayName, "avatar_id": u.AvatarID, "banner_id": u.BannerID,
		"about_me": u.AboutMe, "pronouns": u.Pronouns, "accent_color": u.AccentColor, "status_text": u.StatusText, "status_emoji": u.StatusEmoji,
		"status_expires_at": u.StatusExpiresAt, "public_key": u.PublicKey, "created_at": u.CreatedAt, "flags": u.Flags, "presence_pref": u.PresencePref,
		"dm_privacy": u.DMPrivacy, "has_recovery": u.RecoveryAuthHash != ""}
	var err error
	if p.Channels, err = h.st.DMChannelsForUser(ctx, u.ID); err != nil {
		return nil, err
	}
	rels, err := h.st.Relationships(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	chanIDs := make([]ids.ID, 0, len(p.Channels))
	userSet := map[ids.ID]bool{}
	for _, ch := range p.Channels {
		chanIDs = append(chanIDs, ch.ID)
		for _, r := range ch.Recipients {
			userSet[r] = true
		}
	}
	for _, r := range rels {
		userSet[r.TargetID] = true
	}
	if h.ExtraChannels != nil {
		more, err := h.ExtraChannels(ctx, u.ID)
		if err != nil {
			return nil, err
		}
		chanIDs = append(chanIDs, more...)
	}
	if p.ReadStates, err = h.st.ReadStatesFor(ctx, u.ID, chanIDs); err != nil {
		return nil, err
	}
	if p.KeyGrants, err = h.st.GrantsForUser(ctx, u.ID); err != nil {
		return nil, err
	}
	if p.Settings, err = h.st.GetSettings(ctx, u.ID); err != nil {
		return nil, err
	}
	delete(userSet, u.ID)
	userIDs := make([]ids.ID, 0, len(userSet))
	for id := range userSet {
		userIDs = append(userIDs, id)
	}
	users, err := h.st.UsersByIDs(ctx, userIDs)
	if err != nil {
		return nil, err
	}
	for _, id := range userIDs {
		if usr := users[id]; usr != nil {
			p.Users = append(p.Users, usr.Public())
			if h.Online(id) {
				p.Presences = append(p.Presences, h.PresenceOf(ctx, usr))
			}
		}
	}
	p.Relationships = make([]store.RelationshipView, 0, len(rels))
	for _, r := range rels {
		if usr := users[r.TargetID]; usr != nil {
			p.Relationships = append(p.Relationships, store.RelationshipView{User: usr.Public(), Type: r.Type, Nickname: r.Nickname, CreatedAt: r.CreatedAt})
		}
	}
	p.Presences = append(p.Presences, h.selfPresence(ctx, u))
	if h.ReadyExtras != nil {
		if err := h.ReadyExtras(ctx, u, p); err != nil {
			return nil, err
		}
	}
	return p, nil
}

var errClosed = errors.New("connection closed")
