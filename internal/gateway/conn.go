package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

const (
	readLimit      = 1 << 16
	writeTimeout   = 10 * time.Second
	typingCooldown = 8 * time.Second
)

// Conn is the exported view of a connection for hook implementers.
type Conn struct {
	c *conn
}

// User returns the connection's user.
func (x *Conn) User() *store.User { return x.c.user }

// SessionID returns the session id.
func (x *Conn) SessionID() ids.ID { return x.c.session.ID }

// Send enqueues a frame to this connection only.
func (x *Conn) Send(t string, d any) { x.c.enqueue(ServerFrame{T: t, S: x.c.hub.nextSeq(), D: d}) }

type conn struct {
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
}

func (c *conn) lastBeat() time.Time { return time.UnixMilli(c.beat.Load()) }

func (c *conn) enqueue(f ServerFrame) {
	select {
	case c.send <- f:
	default:
		c.close(websocket.StatusPolicyViolation, "slow consumer")
	}
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

// ServeHTTP upgrades the request and runs the connection until it ends.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.originPatterns, CompressionMode: websocket.CompressionContextTakeover})
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
	c := &conn{hub: h, ws: ws, user: user, session: session, send: make(chan ServerFrame, h.sendBuffer), closed: make(chan struct{}), typing: map[ids.ID]time.Time{}}
	c.beat.Store(time.Now().UnixMilli())

	ready, err := h.buildReady(ctx, user, session)
	if err != nil {
		h.log.Error("ready", "user", user.ID, "err", err)
		_ = ws.Close(4002, "ready failed")
		return
	}
	first := h.register(c)
	c.enqueue(ServerFrame{T: EvReady, S: h.nextSeq(), D: ready})
	if first {
		h.broadcastPresence(ctx, user)
	}

	go c.writeLoop()
	c.readLoop(ctx)

	last := h.unregister(c)
	c.close(websocket.StatusNormalClosure, "bye")
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
		var d presenceData
		if err := json.Unmarshal(f.D, &d); err != nil {
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
			if d.StatusText != nil {
				t := *d.StatusText
				if len(t) > 128 {
					t = t[:128]
				}
				p.StatusText = &t
			}
			if d.StatusEmoji != nil {
				e := *d.StatusEmoji
				if len(e) > 64 {
					e = e[:64]
				}
				p.StatusEmoji = &e
			}
			if d.StatusExpiresAt != nil {
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
	case OpTyping:
		var d typingData
		if err := json.Unmarshal(f.D, &d); err != nil || d.ChannelID.IsZero() {
			return
		}
		c.typMu.Lock()
		last, seen := c.typing[d.ChannelID]
		now := time.Now()
		if seen && now.Sub(last) < typingCooldown {
			c.typMu.Unlock()
			return
		}
		c.typing[d.ChannelID] = now
		c.typMu.Unlock()
		h.Typing(ctx, c.user.ID, d.ChannelID)
	case OpVoiceState, OpVoiceSignal, OpSubscribe:
		if h.VoiceOp != nil {
			h.VoiceOp(ctx, &Conn{c: c}, f.Op, f.D)
		}
	}
}

// Typing broadcasts a typing indicator after checking access.
func (h *Hub) Typing(ctx context.Context, uid, channelID ids.ID) {
	ok, err := h.CanAccess(ctx, uid, channelID)
	if err != nil || !ok {
		return
	}
	viewers, err := h.Viewers(ctx, channelID)
	if err != nil {
		return
	}
	var others []ids.ID
	for _, v := range viewers {
		if v != uid {
			others = append(others, v)
		}
	}
	h.EmitUsers(others, EvTyping, map[string]any{"channel_id": channelID, "user_id": uid, "ts": time.Now().UnixMilli()})
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
