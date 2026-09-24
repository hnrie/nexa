package gateway

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

type testEnv struct {
	st  *store.Store
	hub *Hub
	ts  *httptest.Server
}

func newEnv(t *testing.T) *testEnv {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	st := store.New(d)
	hub := New(st, &auth.Authenticator{Store: st, TTL: time.Hour}, slog.New(slog.NewTextHandler(io.Discard, nil)), "http://localhost")
	ts := httptest.NewServer(hub)
	t.Cleanup(func() { hub.CloseAll(websocket.StatusGoingAway, "test over"); ts.Close(); d.Close() })
	return &testEnv{st: st, hub: hub, ts: ts}
}

func (e *testEnv) user(t *testing.T, name string) (*store.User, string) {
	t.Helper()
	u := &store.User{Username: name, DisplayName: name, AuthHash: "h", KDFSalt: []byte{1}, KDFParams: "{}", PublicKey: []byte{1}, EncPrivateKey: []byte{1}}
	if err := e.st.CreateUser(context.Background(), u); err != nil {
		t.Fatal(err)
	}
	tok, hash := auth.NewToken()
	if err := e.st.CreateSession(context.Background(), &store.Session{UserID: u.ID, TokenHash: hash}); err != nil {
		t.Fatal(err)
	}
	return u, tok
}

type client struct {
	ws     *websocket.Conn
	t      *testing.T
	frames chan map[string]any
	done   chan struct{}
	err    error
}

// dial opens a socket and reads every frame into a channel; a read context
// timeout would close the connection in coder/websocket, so tests must never
// read with a deadline directly.
func (e *testEnv) dial(t *testing.T) *client {
	t.Helper()
	ws, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(e.ts.URL, "http"), &websocket.DialOptions{HTTPHeader: map[string][]string{"Origin": {"http://localhost"}}})
	if err != nil {
		t.Fatal(err)
	}
	c := &client{ws: ws, t: t, frames: make(chan map[string]any, 256), done: make(chan struct{})}
	go func() {
		defer close(c.done)
		for {
			_, raw, err := ws.Read(context.Background())
			if err != nil {
				c.err = err
				return
			}
			var f map[string]any
			if json.Unmarshal(raw, &f) == nil {
				c.frames <- f
			}
		}
	}()
	t.Cleanup(func() { ws.Close(websocket.StatusNormalClosure, "") })
	return c
}

func (c *client) send(op string, d any) {
	b, _ := json.Marshal(map[string]any{"op": op, "d": d})
	if err := c.ws.Write(context.Background(), websocket.MessageText, b); err != nil {
		c.t.Fatal(err)
	}
}

// next returns the next frame of type t, discarding others, or nil on timeout.
func (c *client) next(t string, timeout time.Duration) map[string]any {
	deadline := time.After(timeout)
	for {
		select {
		case f := <-c.frames:
			if f["t"] == t {
				return f
			}
		case <-deadline:
			return nil
		case <-c.done:
			return nil
		}
	}
}

// presence waits for a presence frame about uid with the given status.
func (c *client) presence(uid ids.ID, status string, timeout time.Duration) map[string]any {
	deadline := time.After(timeout)
	for {
		select {
		case f := <-c.frames:
			if f["t"] != "presence" {
				continue
			}
			d, _ := f["d"].(map[string]any)
			if d["user_id"] == uid.String() && d["status"] == status {
				return d
			}
		case <-deadline:
			return nil
		case <-c.done:
			return nil
		}
	}
}

func (c *client) identify(token string) map[string]any {
	c.send("identify", map[string]string{"token": token})
	return c.next("ready", 3*time.Second)
}

// closeStatus waits for the connection to end and returns the close code.
func closeStatus(c *client) websocket.StatusCode {
	select {
	case <-c.done:
		return websocket.CloseStatus(c.err)
	case <-time.After(3 * time.Second):
		return -2
	}
}

func TestIdentifyRejectsBadToken(t *testing.T) {
	e := newEnv(t)
	c := e.dial(t)
	c.send("identify", map[string]string{"token": "nope"})
	if st := closeStatus(c); st != 4001 {
		t.Errorf("bad token close status = %d", st)
	}
	c2 := e.dial(t)
	c2.send("heartbeat", nil)
	if st := closeStatus(c2); st != 4000 {
		t.Errorf("non-identify first frame close status = %d", st)
	}
}

func TestReadyTypingPresence(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	a, tokA := e.user(t, "a")
	b, tokB := e.user(t, "b")
	cUser, tokC := e.user(t, "c")
	dm, _, _ := e.st.CreateDM(ctx, a.ID, b.ID)
	_ = e.st.SetRelationshipPair(ctx, a.ID, b.ID, "friend", "friend")

	cb := e.dial(t)
	readyB := cb.identify(tokB)
	if readyB == nil {
		t.Fatal("no ready for b")
	}
	d := readyB["d"].(map[string]any)
	if len(d["channels"].([]any)) != 1 || len(d["relationships"].([]any)) != 1 || len(d["users"].([]any)) != 1 || d["user"].(map[string]any)["username"] != "b" {
		t.Errorf("ready payload: %v", d)
	}
	rel := d["relationships"].([]any)[0].(map[string]any)
	if rel["type"] != "friend" || rel["user"].(map[string]any)["username"] != "a" {
		t.Errorf("relationships must carry the other user inline: %v", rel)
	}
	if len(d["presences"].([]any)) != 1 { // only self, a is offline
		t.Errorf("presences: %v", d["presences"])
	}
	if !e.hub.Online(b.ID) {
		t.Error("b should be online")
	}

	ca := e.dial(t)
	if ca.identify(tokA) == nil {
		t.Fatal("no ready for a")
	}
	if cb.presence(a.ID, "online", 3*time.Second) == nil {
		t.Error("b should see a come online")
	}
	cc := e.dial(t)
	if cc.identify(tokC) == nil {
		t.Fatal("no ready for c")
	}

	// typing from a reaches b, not c
	ca.send("typing", map[string]string{"channel_id": dm.ID.String()})
	ty := cb.next("typing", 3*time.Second)
	if ty == nil || ty["d"].(map[string]any)["user_id"] != a.ID.String() {
		t.Errorf("typing not delivered to b: %v", ty)
	}
	if got := cc.next("typing", 500*time.Millisecond); got != nil {
		t.Error("c must not receive typing for a dm it is not in")
	}
	// a stop clears the indicator at once instead of waiting for it to expire
	ca.send("typing", map[string]any{"channel_id": dm.ID.String(), "stop": true})
	stop := cb.next("typing", 3*time.Second)
	if stop == nil || stop["d"].(map[string]any)["stop"] != true {
		t.Errorf("typing stop not delivered: %v", stop)
	}
	// a second stop with nothing running says nothing
	ca.send("typing", map[string]any{"channel_id": dm.ID.String(), "stop": true})
	if got := cb.next("typing", 500*time.Millisecond); got != nil {
		t.Error("a redundant stop must not be broadcast")
	}
	// typing in a conversation a is not part of is dropped
	other, _, err := e.st.CreateDM(ctx, b.ID, cUser.ID)
	if err != nil {
		t.Fatal(err)
	}
	if other.ID == dm.ID {
		t.Fatal("expected a separate conversation between b and c")
	}
	ca.send("typing", map[string]string{"channel_id": other.ID.String()})
	if got := cb.next("typing", 500*time.Millisecond); got != nil {
		t.Errorf("typing in a channel the sender cannot access must be dropped: %v", got)
	}

	// presence op: a goes dnd with a custom status; b sees it
	ca.send("presence", map[string]any{"status": "dnd", "status_text": "busy", "status_emoji": "🔥"})
	pres := cb.presence(a.ID, "dnd", 3*time.Second)
	if pres == nil || pres["status_text"] != "busy" || pres["status_emoji"] != "🔥" {
		t.Errorf("dnd presence: %v", pres)
	}
	ua, _ := e.st.UserByID(ctx, a.ID)
	if ua.PresencePref != "dnd" || ua.StatusText != "busy" {
		t.Error("presence op should persist")
	}
	// invisible shows offline to others, invisible to self
	ca.send("presence", map[string]any{"status": "invisible"})
	if cb.presence(a.ID, "offline", 3*time.Second) == nil {
		t.Error("invisible → others see offline")
	}
	if ca.presence(a.ID, "invisible", 3*time.Second) == nil {
		t.Error("self sees invisible")
	}

	// EmitUsers reaches all of a user's connections
	ca2 := e.dial(t)
	if ca2.identify(tokA) == nil {
		t.Fatal("second connection for a")
	}
	e.hub.EmitUsers([]ids.ID{a.ID}, "custom", map[string]int{"x": 1})
	if ca.next("custom", 2*time.Second) == nil || ca2.next("custom", 2*time.Second) == nil {
		t.Error("both connections should get the event")
	}
	// heartbeat ack
	ca.send("heartbeat", nil)
	if ca.next("heartbeat_ack", 2*time.Second) == nil {
		t.Error("no heartbeat ack")
	}
	// disconnect: a's last connection closing sends offline to b
	ca.ws.Close(websocket.StatusNormalClosure, "")
	ca2.ws.Close(websocket.StatusNormalClosure, "")
	// a was invisible (offline to b) — go online again first so the disconnect is observable
	ca3 := e.dial(t)
	if ca3.identify(tokA) == nil {
		t.Fatal("third connection for a")
	}
	ca3.send("presence", map[string]any{"status": "online"})
	if cb.presence(a.ID, "online", 3*time.Second) == nil {
		t.Fatal("a back online")
	}
	ca3.ws.Close(websocket.StatusNormalClosure, "")
	if cb.presence(a.ID, "offline", 3*time.Second) == nil {
		t.Error("offline on disconnect")
	}
	deadline := time.Now().Add(2 * time.Second)
	for e.hub.Online(a.ID) && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if e.hub.Online(a.ID) {
		t.Error("a should be offline")
	}
}

func TestHeartbeatTimeout(t *testing.T) {
	e := newEnv(t)
	e.hub.heartbeatTimeout = 200 * time.Millisecond
	_, tok := e.user(t, "z")
	c := e.dial(t)
	if c.identify(tok) == nil {
		t.Fatal("ready")
	}
	time.Sleep(300 * time.Millisecond)
	e.hub.sweep()
	if st := closeStatus(c); st != websocket.StatusPolicyViolation {
		t.Errorf("expected policy violation close, got %d", st)
	}
}

func TestOriginRejected(t *testing.T) {
	e := newEnv(t)
	_, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(e.ts.URL, "http"), &websocket.DialOptions{HTTPHeader: map[string][]string{"Origin": {"http://evil.example"}}})
	if err == nil {
		t.Error("foreign origin must be rejected")
	}
}

// A status flipped twice in a row must leave everyone on the last one, not on
// whichever change happened to arrive before the rate limit closed.
func TestPresenceChangesCoalesce(t *testing.T) {
	e := newEnv(t)
	a, tokA := e.user(t, "pa")
	b, tokB := e.user(t, "pb")
	ctx := context.Background()
	_, _, _ = e.st.CreateDM(ctx, a.ID, b.ID)
	_ = e.st.SetRelationshipPair(ctx, a.ID, b.ID, "friend", "friend")
	ca := e.dial(t)
	if ca.identify(tokA) == nil {
		t.Fatal("ready a")
	}
	cb := e.dial(t)
	if cb.identify(tokB) == nil {
		t.Fatal("ready b")
	}
	// more changes than the burst allows, sent back to back
	for _, st := range []string{"idle", "online", "idle", "online", "idle", "online", "idle", "dnd"} {
		ca.send("presence", map[string]any{"status": st})
	}
	if d := cb.presence(a.ID, "dnd", 5*time.Second); d == nil {
		t.Fatal("b never saw the last status a set")
	}
	u, err := e.st.UserByID(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if u.PresencePref != "dnd" {
		t.Errorf("stored preference is %q, want dnd", u.PresencePref)
	}
}

func TestAwayOnEveryDeviceShowsIdle(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	a, tokA := e.user(t, "a")
	b, tokB := e.user(t, "b")
	_ = e.st.SetRelationshipPair(ctx, a.ID, b.ID, "friend", "friend")
	away := func(c *client, on bool) { c.send("away", map[string]bool{"away": on}) }
	cb := e.dial(t)
	if cb.identify(tokB) == nil {
		t.Fatal("no ready for b")
	}
	phone := e.dial(t)
	if phone.identify(tokA) == nil {
		t.Fatal("no ready for a's phone")
	}
	if cb.presence(a.ID, "online", 3*time.Second) == nil {
		t.Fatal("a never came online")
	}
	desk := e.dial(t)
	if desk.identify(tokA) == nil {
		t.Fatal("no ready for a's desk")
	}

	// one device left alone is not enough while another is in use
	away(desk, true)
	if cb.presence(a.ID, "idle", 400*time.Millisecond) != nil {
		t.Fatal("idle while the phone is in use")
	}
	// every device left alone: idle
	away(phone, true)
	if cb.presence(a.ID, "idle", 3*time.Second) == nil {
		t.Fatal("never went idle")
	}
	// nothing is stored: the status a chose is still online
	if u, err := e.st.UserByID(ctx, a.ID); err != nil || (u.PresencePref != "" && u.PresencePref != "online") {
		t.Fatalf("away was stored: %+v %v", u, err)
	}
	// back on one device: online
	away(phone, false)
	if cb.presence(a.ID, "online", 3*time.Second) == nil {
		t.Fatal("never came back online")
	}
	// the one device in use closes while the other is away: idle
	phone.ws.Close(websocket.StatusNormalClosure, "")
	if cb.presence(a.ID, "idle", 3*time.Second) == nil {
		t.Fatal("closing the device in use did not leave a idle")
	}
	// a new device in use: online again
	fresh := e.dial(t)
	if fresh.identify(tokA) == nil {
		t.Fatal("no ready for a's new device")
	}
	if cb.presence(a.ID, "online", 3*time.Second) == nil {
		t.Fatal("a new device in use did not bring a back")
	}
	// do not disturb stays do not disturb, however long a is away
	fresh.send("presence", map[string]string{"status": "dnd"})
	if cb.presence(a.ID, "dnd", 3*time.Second) == nil {
		t.Fatal("dnd never showed")
	}
	away(fresh, true)
	if cb.presence(a.ID, "idle", 500*time.Millisecond) != nil {
		t.Error("do not disturb turned idle")
	}
}
