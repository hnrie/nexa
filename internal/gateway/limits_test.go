package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"evilion.xyz/chat/internal/ids"
)

// dialFrom opens a socket that looks as though it came from ip. The test
// server listens on loopback, which ClientIP treats as "the proxy did not say"
// and so reads the forwarded header — which is also how the real deployment
// behind cloudflared sees an address.
func (e *testEnv) dialFrom(t *testing.T, ip string) (*websocket.Conn, error) {
	t.Helper()
	ws, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(e.ts.URL, "http"),
		&websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"http://localhost"}, "X-Forwarded-For": {ip}}})
	if err == nil {
		t.Cleanup(func() { ws.Close(websocket.StatusNormalClosure, "") })
	}
	return ws, err
}

// identifyOn sends identify and reports whether ready came back.
func identifyOn(t *testing.T, ws *websocket.Conn, token string) (websocket.StatusCode, bool) {
	t.Helper()
	if err := ws.Write(context.Background(), websocket.MessageText, []byte(`{"op":"identify","d":{"token":"`+token+`"}}`)); err != nil {
		return websocket.CloseStatus(err), false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		_, raw, err := ws.Read(ctx)
		if err != nil {
			return websocket.CloseStatus(err), false
		}
		if strings.Contains(string(raw), `"t":"ready"`) {
			return 0, true
		}
	}
}

// One account must not be able to hold sockets without end: each accepted one
// runs the whole ready build, so the cap is what keeps a loop of identifies
// from taking the database with it.
func TestConnectionsPerAccountAreCapped(t *testing.T) {
	e := newEnv(t)
	e.hub.SetLimits(3, 0, 0, 0)
	_, tok := e.user(t, "capped")
	for i := 0; i < 3; i++ {
		ws, err := e.dialFrom(t, "203.0.113.7")
		if err != nil {
			t.Fatalf("connection %d refused: %v", i, err)
		}
		if _, ok := identifyOn(t, ws, tok); !ok {
			t.Fatalf("connection %d got no ready", i)
		}
	}
	ws, err := e.dialFrom(t, "203.0.113.7")
	if err != nil {
		t.Fatalf("the socket past the cap must be accepted and then closed, not refused: %v", err)
	}
	code, ok := identifyOn(t, ws, tok)
	if ok {
		t.Fatal("a fourth connection was let in past a cap of three")
	}
	if code != CloseTooManyConnections {
		t.Errorf("close code = %d, want %d so the client knows not to retry at once", code, CloseTooManyConnections)
	}
	if n := e.hub.ConnectionCount(); n != 3 {
		t.Errorf("hub holds %d connections, want 3", n)
	}
}

// A connection that ends gives its place back; otherwise a day of ordinary
// reconnects would lock a person out of their own account.
func TestClosedConnectionFreesItsPlace(t *testing.T) {
	e := newEnv(t)
	e.hub.SetLimits(2, 0, 0, 0)
	_, tok := e.user(t, "freed")
	first, err := e.dialFrom(t, "203.0.113.8")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := identifyOn(t, first, tok); !ok {
		t.Fatal("no ready for the first connection")
	}
	second, err := e.dialFrom(t, "203.0.113.8")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := identifyOn(t, second, tok); !ok {
		t.Fatal("no ready for the second connection")
	}
	first.Close(websocket.StatusNormalClosure, "bye")
	deadline := time.Now().Add(3 * time.Second)
	for e.hub.ConnectionCount() > 1 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	third, err := e.dialFrom(t, "203.0.113.8")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := identifyOn(t, third, tok); !ok {
		t.Fatal("the place the closed connection held was never given back")
	}
}

// Registration is open, so one address making several accounts must not add up
// to an unbounded number of sockets.
func TestConnectionsPerAddressAreCapped(t *testing.T) {
	e := newEnv(t)
	e.hub.SetLimits(2, 2, 0, 0)
	_, tokA := e.user(t, "addra")
	_, tokB := e.user(t, "addrb")
	for i, tok := range []string{tokA, tokA} {
		ws, err := e.dialFrom(t, "203.0.113.9")
		if err != nil {
			t.Fatalf("connection %d refused: %v", i, err)
		}
		if _, ok := identifyOn(t, ws, tok); !ok {
			t.Fatalf("connection %d got no ready", i)
		}
	}
	ws, err := e.dialFrom(t, "203.0.113.9")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := identifyOn(t, ws, tokB); ok {
		t.Fatal("a second account from the same address walked past the address cap")
	}
	// another address is unaffected
	other, err := e.dialFrom(t, "203.0.113.10")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := identifyOn(t, other, tokB); !ok {
		t.Fatal("a different address must not be held to the first one's count")
	}
}

// A socket that never identifies needs no account at all, and holds a
// goroutine for the whole identify timeout.
func TestUnidentifiedSocketsAreCapped(t *testing.T) {
	e := newEnv(t)
	e.hub.SetLimits(0, 0, 0, 2)
	for i := 0; i < 2; i++ {
		if _, err := e.dialFrom(t, "203.0.113.11"); err != nil {
			t.Fatalf("silent socket %d refused: %v", i, err)
		}
	}
	if _, err := e.dialFrom(t, "203.0.113.11"); err == nil {
		t.Fatal("a third socket that never identifies was accepted")
	}
	// and an address that has not been sitting silent still gets in
	if _, err := e.dialFrom(t, "203.0.113.12"); err != nil {
		t.Fatalf("an unrelated address was refused: %v", err)
	}
}

// An address the proxy in front did not name arrives as loopback. Holding the
// whole instance to one address's allowance would shut everyone out, so the
// per-address caps stand down there and only the instance-wide one applies.
func TestUnknownAddressesShareNoAllowance(t *testing.T) {
	e := newEnv(t)
	e.hub.SetLimits(0, 1, 0, 1)
	_, tok := e.user(t, "loopback")
	for i := 0; i < 3; i++ {
		c := e.dial(t)
		if c.identify(tok) == nil {
			t.Fatalf("connection %d from an unnamed address was refused", i)
		}
	}
}

// The whole instance has a ceiling too, so no combination of accounts and
// addresses takes the process past a known number of goroutines.
func TestInstanceWideCap(t *testing.T) {
	e := newEnv(t)
	e.hub.SetLimits(0, 0, 2, 0)
	_, tokA := e.user(t, "insta")
	_, tokB := e.user(t, "instb")
	for i, tok := range []string{tokA, tokB} {
		ws, err := e.dialFrom(t, "203.0.113.20")
		if err != nil {
			t.Fatalf("connection %d refused: %v", i, err)
		}
		if _, ok := identifyOn(t, ws, tok); !ok {
			t.Fatalf("connection %d got no ready", i)
		}
	}
	if _, err := e.dialFrom(t, "203.0.113.21"); err == nil {
		t.Fatal("the instance cap let a third connection through")
	}
}

// The profile a connection holds is replaced whenever a presence change
// re-reads it, and that runs on the rate limiter's timer goroutine — a
// different one from the read loop that answers ops and from the hook the
// voice layer calls. The readers below run for as long as the writer does; what
// the test asserts is what -race says while they overlap.
func TestConnectionUserIsSafeToReadWhileItIsReplaced(t *testing.T) {
	e := newEnv(t)
	u, _ := e.user(t, "swapped")
	ctx := context.Background()
	c := &conn{id: ids.New(), hub: e.hub, userID: u.ID, send: make(chan ServerFrame, 8), closed: make(chan struct{}), typing: map[ids.ID]time.Time{}}
	c.user.Store(u)

	writing := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { // what flushPresence does off the timer
		defer wg.Done()
		defer close(writing)
		for i := 0; i < 30; i++ {
			c.applyPresence(ctx, json.RawMessage(`{"status":"`+[]string{"online", "idle", "dnd"}[i%3]+`"}`))
		}
	}()
	reader := func(read func()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-writing:
					return
				default:
				}
				read()
			}
		}()
	}
	x := &Conn{c: c}
	reader(func() { // what the voice layer does off the read loop
		if got := x.User(); got == nil || got.ID != u.ID {
			t.Errorf("the connection's user changed identity: %v", got)
			runtime.Goexit()
		}
	})
	reader(func() { _ = e.hub.Online(c.userID) }) // and what the sweeps do off the hub's ticker
	wg.Wait()
}

// rawSocket opens a real websocket pair and returns the server side, so a test
// can build a conn without going through identify.
func rawSocket(t *testing.T) *websocket.Conn {
	t.Helper()
	got := make(chan *websocket.Conn, 1)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		got <- ws
		<-r.Context().Done()
	}))
	client, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(ts.URL, "http"), nil)
	if err != nil {
		ts.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { client.CloseNow(); ts.Close() })
	select {
	case ws := <-got:
		return ws
	case <-time.After(3 * time.Second):
		ts.Close()
		t.Fatal("no server-side socket")
		return nil
	}
}

// goLive runs holding pendMu, which Hub.EmitUsers reaches while holding
// h.mu.RLock — and one blocked reader of an RWMutex queues every waiting
// writer behind it. A blocking send in there would therefore stop register,
// unregister and every later emitter on the whole instance, so it must never
// block, whatever the send buffer is set to.
func TestGoLiveNeverBlocks(t *testing.T) {
	e := newEnv(t)
	u, _ := e.user(t, "golive")
	newConn := func() *conn {
		c := &conn{id: ids.New(), hub: e.hub, userID: u.ID, ws: rawSocket(t),
			send: make(chan ServerFrame, 4), closed: make(chan struct{}), typing: map[ids.ID]time.Time{}}
		c.user.Store(u)
		return c
	}
	ranWithin := func(t *testing.T, what string, fn func()) {
		t.Helper()
		done := make(chan struct{})
		go func() { fn(); close(done) }()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatalf("%s blocked; every emitter on the instance would block with it", what)
		}
	}

	// as many pending frames as enqueue allows, with ready taking the last slot
	full := newConn()
	for i := 0; i < cap(full.send)-1; i++ {
		full.enqueue(ServerFrame{T: "x"})
	}
	ranWithin(t, "goLive with a full pending list", func() { full.goLive(ServerFrame{T: EvReady}) })
	if !full.live.Load() {
		t.Error("a connection whose frames all fit should have gone live")
	}
	if len(full.send) != cap(full.send) {
		t.Errorf("%d frames queued, want the buffer full at %d", len(full.send), cap(full.send))
	}

	// and if the buffer somehow has no room, it gives the connection up rather
	// than waiting for a reader that has not been started yet
	over := newConn()
	for i := 0; i < cap(over.send); i++ {
		over.send <- ServerFrame{T: "x"}
	}
	over.pending = []ServerFrame{{T: "y"}}
	ranWithin(t, "goLive with no room", func() { over.goLive(ServerFrame{T: EvReady}) })
	select {
	case <-over.closed:
	default:
		t.Error("a connection that could not be given its ready should have been closed")
	}
	if over.live.Load() {
		t.Error("it must not be marked live")
	}
}
