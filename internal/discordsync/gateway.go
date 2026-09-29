// Package discordsync shows what people are doing on Discord as their
// activity on Nexa. A person links their Discord account with Discord's OAuth,
// which also adds that account to a small Discord server made for this; Nexa's
// bot sits in that server, hears each linked member's presence over Discord's
// gateway, and hands their activities (a song, a game, a stream) to the hub,
// which shows them beside the desktop app's Rich Presence.
package discordsync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/url"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

// The gateway intents the bot asks for: the server itself, its members
// joining and leaving, and their presence. The last two are privileged and
// have to be switched on for the application in Discord's Developer Portal.
const (
	IntentGuilds         = 1 << 0
	IntentGuildMembers   = 1 << 1
	IntentGuildPresences = 1 << 8
)

// Gateway opcodes.
const (
	opDispatch       = 0
	opHeartbeat      = 1
	opIdentify       = 2
	opResume         = 6
	opReconnect      = 7
	opRequestMembers = 8
	opInvalidSession = 9
	opHello          = 10
	opHeartbeatAck   = 11
)

// FatalError is a close from Discord that no retry can fix: a wrong token,
// intents the application is not allowed, a version it no longer speaks.
type FatalError struct {
	Code   websocket.StatusCode
	Reason string
}

func (e *FatalError) Error() string {
	return fmt.Sprintf("discord gateway closed for good (%d %s): %s", int(e.Code), e.Reason, fatalCodes[e.Code])
}

var fatalCodes = map[websocket.StatusCode]string{
	4004: "the bot token was refused",
	4010: "invalid shard",
	4011: "sharding required",
	4012: "invalid API version",
	4013: "invalid intents",
	4014: "the Presence or Server Members intent is not switched on for this application in the Developer Portal",
}

// freshCodes are closes after which the session cannot be resumed.
var freshCodes = map[websocket.StatusCode]bool{4007: true, 4009: true}

type frame struct {
	Op int             `json:"op"`
	D  json.RawMessage `json:"d,omitempty"`
	S  *int64          `json:"s,omitempty"`
	T  string          `json:"t,omitempty"`
}

// Gateway is one bot connection to Discord's gateway, kept up while Run runs:
// identified with Intents, resumed after a drop where Discord allows it, and
// identified afresh where it does not, waiting longer after each failure.
type Gateway struct {
	Token   string
	Intents int
	// URL says where to connect for a fresh session (Discord's GET /gateway/bot).
	URL func(ctx context.Context) (string, error)
	// Dispatch receives every event in order, on the goroutine that reads the socket.
	Dispatch func(event string, data json.RawMessage)
	// OnClose runs whenever a connection ends, before any wait to reconnect.
	OnClose func()
	Log     *slog.Logger

	seq       atomic.Int64
	sessionID string
	resumeURL string

	mu   sync.Mutex
	conn *websocket.Conn
}

// Run keeps the connection up until ctx ends or Discord closes it for good.
func (g *Gateway) Run(ctx context.Context) error {
	backoff := time.Second
	for {
		began := time.Now()
		err := g.session(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var fatal *FatalError
		if errors.As(err, &fatal) {
			return err
		}
		if time.Since(began) > time.Minute {
			backoff = time.Second
		}
		wait := backoff/2 + time.Duration(rand.Int64N(int64(backoff)))
		g.Log.Info("discord gateway disconnected; reconnecting", "err", err, "in", wait.Round(time.Millisecond), "resume", g.sessionID != "")
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
		backoff = min(backoff*2, 2*time.Minute)
	}
}

// Send sends one gateway message on the open connection.
func (g *Gateway) Send(ctx context.Context, op int, d any) error {
	g.mu.Lock()
	c := g.conn
	g.mu.Unlock()
	if c == nil {
		return errors.New("discord gateway is not connected")
	}
	return g.write(ctx, c, op, d)
}

// RequestMembers asks for members of a guild, with their presences; the
// answer comes back as GUILD_MEMBERS_CHUNK events. With no users it asks for
// everyone.
func (g *Gateway) RequestMembers(ctx context.Context, guildID string, userIDs []string, nonce string) error {
	d := map[string]any{"guild_id": guildID, "presences": true, "nonce": nonce}
	if len(userIDs) > 0 {
		d["user_ids"] = userIDs
	} else {
		d["query"] = ""
		d["limit"] = 0
	}
	return g.Send(ctx, opRequestMembers, d)
}

func (g *Gateway) write(ctx context.Context, c *websocket.Conn, op int, d any) error {
	raw, err := json.Marshal(map[string]any{"op": op, "d": d})
	if err != nil {
		return err
	}
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return c.Write(wctx, websocket.MessageText, raw)
}

// session is one connection, from dial to close.
func (g *Gateway) session(ctx context.Context) error {
	url := g.resumeURL
	resuming := g.sessionID != "" && url != ""
	if !resuming {
		g.sessionID, g.resumeURL = "", ""
		u, err := g.URL(ctx)
		if err != nil {
			return err
		}
		url = u
	}
	dialCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	c, _, err := websocket.Dial(dialCtx, withQuery(url), nil)
	cancel()
	if err != nil {
		return err
	}
	// a server's GUILD_CREATE and member chunks are the largest messages; the activity server is small
	c.SetReadLimit(32 << 20)
	g.mu.Lock()
	g.conn = c
	g.mu.Unlock()
	defer func() {
		g.mu.Lock()
		g.conn = nil
		g.mu.Unlock()
		// anything but 1000 and 1001 leaves the session open to be resumed
		_ = c.Close(4000, "reconnecting")
		if g.OnClose != nil {
			g.OnClose()
		}
	}()

	sctx, stop := context.WithCancel(ctx)
	defer stop()

	hello, err := g.read(sctx, c)
	if err != nil {
		return err
	}
	if hello.Op != opHello {
		return fmt.Errorf("discord gateway opened with op %d, not hello", hello.Op)
	}
	var h struct {
		Interval int64 `json:"heartbeat_interval"`
	}
	if err := json.Unmarshal(hello.D, &h); err != nil || h.Interval <= 0 {
		return fmt.Errorf("discord gateway hello: %v", err)
	}

	acked := make(chan struct{}, 1)
	beatNow := make(chan struct{}, 1)
	zombie := make(chan struct{})
	go g.heartbeat(sctx, c, time.Duration(h.Interval)*time.Millisecond, acked, beatNow, zombie)

	if resuming {
		err = g.write(sctx, c, opResume, map[string]any{"token": g.Token, "session_id": g.sessionID, "seq": g.seq.Load()})
	} else {
		g.seq.Store(0)
		err = g.write(sctx, c, opIdentify, map[string]any{
			"token":      g.Token,
			"intents":    g.Intents,
			"properties": map[string]string{"os": "linux", "browser": "nexa", "device": "nexa"},
		})
	}
	if err != nil {
		return err
	}

	for {
		f, err := g.read(sctx, c)
		if err != nil {
			select {
			case <-zombie:
				return errors.New("discord gateway stopped acknowledging heartbeats")
			default:
			}
			return g.closed(err)
		}
		if f.S != nil {
			g.seq.Store(*f.S)
		}
		switch f.Op {
		case opDispatch:
			if f.T == "READY" {
				var r struct {
					SessionID string `json:"session_id"`
					ResumeURL string `json:"resume_gateway_url"`
				}
				if json.Unmarshal(f.D, &r) == nil {
					g.sessionID, g.resumeURL = r.SessionID, r.ResumeURL
				}
			}
			if g.Dispatch != nil {
				g.Dispatch(f.T, f.D)
			}
		case opHeartbeat:
			select {
			case beatNow <- struct{}{}:
			default:
			}
		case opHeartbeatAck:
			select {
			case acked <- struct{}{}:
			default:
			}
		case opReconnect:
			return errors.New("discord asked for a reconnect")
		case opInvalidSession:
			var resumable bool
			_ = json.Unmarshal(f.D, &resumable)
			if !resumable {
				g.sessionID, g.resumeURL = "", ""
			}
			// Discord asks for a wait of one to five seconds before identifying again
			select {
			case <-ctx.Done():
			case <-time.After(time.Second + time.Duration(rand.Int64N(int64(4*time.Second)))):
			}
			return errors.New("discord invalidated the session")
		}
	}
}

func (g *Gateway) read(ctx context.Context, c *websocket.Conn) (frame, error) {
	_, raw, err := c.Read(ctx)
	if err != nil {
		return frame{}, err
	}
	var f frame
	if err := json.Unmarshal(raw, &f); err != nil {
		return frame{}, fmt.Errorf("discord gateway sent something that is not JSON: %w", err)
	}
	return f, nil
}

// closed turns the way a connection ended into what to do next.
func (g *Gateway) closed(err error) error {
	code := websocket.CloseStatus(err)
	if reason, ok := fatalCodes[code]; ok {
		return &FatalError{Code: code, Reason: reason}
	}
	if freshCodes[code] {
		g.sessionID, g.resumeURL = "", ""
	}
	return err
}

// heartbeat beats every interval (the first after a random part of one, as
// Discord asks) and whenever Discord asks for one. A beat that goes
// unanswered until the next is due means the connection is dead though open:
// it is closed, to be resumed.
func (g *Gateway) heartbeat(ctx context.Context, c *websocket.Conn, every time.Duration, acked, now <-chan struct{}, zombie chan<- struct{}) {
	timer := time.NewTimer(time.Duration(rand.Int64N(int64(every))))
	defer timer.Stop()
	waiting := false
	beat := func() bool {
		seq := g.seq.Load()
		var d any
		if seq > 0 {
			d = seq
		}
		if err := g.write(ctx, c, opHeartbeat, d); err != nil {
			return false
		}
		waiting = true
		return true
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-acked:
			waiting = false
		case <-now:
			if !beat() {
				return
			}
		case <-timer.C:
			if waiting {
				close(zombie)
				_ = c.Close(4000, "heartbeat not acknowledged")
				return
			}
			if !beat() {
				return
			}
			timer.Reset(every)
		}
	}
}

// withQuery adds the version and encoding every gateway address takes.
func withQuery(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	if u.Path == "" {
		u.Path = "/"
	}
	q := u.Query()
	q.Set("v", "10")
	q.Set("encoding", "json")
	u.RawQuery = q.Encode()
	return u.String()
}
