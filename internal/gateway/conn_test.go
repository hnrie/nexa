package gateway

import (
	"context"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// connsOf returns the hub's open connections for a user.
func (e *testEnv) connsOf(uid ids.ID) []*conn {
	e.hub.mu.RLock()
	defer e.hub.mu.RUnlock()
	var out []*conn
	for c := range e.hub.conns[uid] {
		out = append(out, c)
	}
	return out
}

// roundTrip waits until the server has handled every frame sent so far.
func (c *client) roundTrip() {
	c.t.Helper()
	c.send("heartbeat", nil)
	if c.next("heartbeat_ack", 3*time.Second) == nil {
		c.t.Fatal("no heartbeat ack")
	}
}

func TestRevokedSessionsAreDisconnected(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	u, tok1 := e.user(t, "phone")
	tok2, hash := auth.NewToken()
	desk := &store.Session{UserID: u.ID, TokenHash: hash}
	if err := e.st.CreateSession(ctx, desk); err != nil {
		t.Fatal(err)
	}
	phone := e.dial(t)
	if phone.identify(tok1) == nil {
		t.Fatal("ready for phone")
	}
	desktop := e.dial(t)
	if desktop.identify(tok2) == nil {
		t.Fatal("ready for desktop")
	}

	// a password change keeps the device that made it and drops the rest
	e.hub.CloseUserSessions(u.ID, desk.ID)
	if st := closeStatus(phone); st != CloseSessionRevoked {
		t.Errorf("phone close status = %d", st)
	}
	desktop.roundTrip()

	e.hub.CloseSession(desk.ID)
	if st := closeStatus(desktop); st != CloseSessionRevoked {
		t.Errorf("desktop close status = %d", st)
	}
}

func TestSweepClosesDeletedAndDisabledSessions(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	a, tokA := e.user(t, "a")
	b, tokB := e.user(t, "b")
	ca := e.dial(t)
	if ca.identify(tokA) == nil {
		t.Fatal("ready a")
	}
	cb := e.dial(t)
	if cb.identify(tokB) == nil {
		t.Fatal("ready b")
	}
	if err := e.st.DeleteUserSessions(ctx, a.ID, 0); err != nil {
		t.Fatal(err)
	}
	if err := e.st.SetUserFlags(ctx, b.ID, store.FlagDisabled); err != nil {
		t.Fatal(err)
	}
	e.hub.sweepSessions(ctx)
	if st := closeStatus(ca); st != CloseSessionRevoked {
		t.Errorf("deleted session close status = %d", st)
	}
	if st := closeStatus(cb); st != CloseSessionRevoked {
		t.Errorf("disabled account close status = %d", st)
	}

	_, tokC := e.user(t, "c")
	cc := e.dial(t)
	if cc.identify(tokC) == nil {
		t.Fatal("ready c")
	}
	e.hub.sweepSessions(ctx)
	cc.roundTrip() // a live session stays connected
}

// The ready carries the server's clock, which the apps measure their own against.
func TestReadyCarriesTheServerClock(t *testing.T) {
	e := newEnv(t)
	_, tok := e.user(t, "a")
	before := time.Now().UnixMilli()
	ready := e.dial(t).identify(tok)
	if ready == nil {
		t.Fatal("ready")
	}
	d, _ := ready["d"].(map[string]any)
	now, _ := d["now"].(float64)
	if int64(now) < before || int64(now) > time.Now().UnixMilli() {
		t.Errorf("now = %v, want between %d and now", d["now"], before)
	}
}

func TestTypingRemembersOnlyAccessibleChannels(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	a, tokA := e.user(t, "a")
	b, _ := e.user(t, "b")
	dm, _, err := e.st.CreateDM(ctx, a.ID, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	ca := e.dial(t)
	if ca.identify(tokA) == nil {
		t.Fatal("ready")
	}
	// within the typing budget, so every one is judged on access
	for i := 0; i < 4; i++ {
		ca.send("typing", map[string]string{"channel_id": ids.New().String()})
	}
	ca.send("typing", map[string]string{"channel_id": dm.ID.String()})
	ca.roundTrip()
	conns := e.connsOf(a.ID)
	if len(conns) != 1 {
		t.Fatalf("connections = %d", len(conns))
	}
	c := conns[0]
	c.typMu.Lock()
	n := len(c.typing)
	_, has := c.typing[dm.ID]
	c.typMu.Unlock()
	if n != 1 || !has {
		t.Errorf("typing map holds %d entries (dm remembered: %v), want only the dm", n, has)
	}
}

// Rotating through channels to dodge the per-channel cooldown gets an account
// five indicators in ten seconds, and no more.
func TestTypingBudgetSpansChannels(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	a, tokA := e.user(t, "a")
	b, tokB := e.user(t, "b")
	var dms []ids.ID
	for i := 0; i < 7; i++ {
		// seven people, seven conversations with a and b both in them
		other, _ := e.user(t, "o"+string(rune('a'+i)))
		g, err := e.st.CreateGroupDM(ctx, a.ID, []ids.ID{b.ID, other.ID}, "g")
		if err != nil {
			t.Fatal(err)
		}
		dms = append(dms, g.ID)
	}
	cb := e.dial(t)
	if cb.identify(tokB) == nil {
		t.Fatal("ready b")
	}
	ca := e.dial(t)
	if ca.identify(tokA) == nil {
		t.Fatal("ready a")
	}
	for _, id := range dms {
		ca.send("typing", map[string]string{"channel_id": id.String()})
	}
	ca.roundTrip()
	got := 0
	for cb.next("typing", 300*time.Millisecond) != nil {
		got++
	}
	if got != 5 {
		t.Errorf("b saw %d typing indicators from seven channels at once, want the budget's 5", got)
	}
}

// Presence reaches friends and co-members, not someone who merely shares a
// conversation, and never anyone blocked either way — though a block leaves
// them sharing that conversation.
func TestPresenceAudienceLeavesOutBlocksAndConversations(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	a, tokA := e.user(t, "a")
	friend, tokF := e.user(t, "friend")
	stranger, tokS := e.user(t, "stranger")
	if err := e.st.SetRelationshipPair(ctx, a.ID, friend.ID, "friend", "friend"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.st.CreateDM(ctx, a.ID, stranger.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.st.CreateDM(ctx, a.ID, friend.ID); err != nil {
		t.Fatal(err)
	}
	cf, cs := e.dial(t), e.dial(t)
	if cf.identify(tokF) == nil || cs.identify(tokS) == nil {
		t.Fatal("ready")
	}
	ca := e.dial(t)
	readyA := ca.identify(tokA)
	if readyA == nil {
		t.Fatal("ready a")
	}
	if cf.presence(a.ID, "online", 3*time.Second) == nil {
		t.Error("a friend sees a come online")
	}
	if cs.presence(a.ID, "online", 500*time.Millisecond) != nil {
		t.Error("someone a only shares a DM with must not see a's presence")
	}
	// and a's ready lists the friend's presence, not the stranger's
	pres := map[string]bool{}
	for _, p := range readyA["d"].(map[string]any)["presences"].([]any) {
		pres[p.(map[string]any)["user_id"].(string)] = true
	}
	if !pres[friend.ID.String()] || pres[stranger.ID.String()] {
		t.Errorf("a's ready presences: %v", pres)
	}

	// the friend blocks a: a's status stops reaching them, though their DM stays
	if err := e.st.Block(ctx, friend.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	ca.send("presence", map[string]any{"status": "dnd", "status_text": "somewhere"})
	if got := cf.presence(a.ID, "dnd", 700*time.Millisecond); got != nil {
		t.Errorf("a blocked person still watches a's status: %v", got)
	}
	// a's profile changes stop too
	u, _ := e.st.UserByID(ctx, a.ID)
	e.hub.UserUpdated(u)
	if got := cf.next("user_update", 500*time.Millisecond); got != nil {
		t.Errorf("user_update reached someone who blocked a: %v", got)
	}
	// while someone a only shares a DM with does get the profile change
	if cs.next("user_update", 2*time.Second) == nil {
		t.Error("a DM partner should still see a's name and picture change")
	}
}

func TestPresenceStatusIsCleaned(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	a, tokA := e.user(t, "a")
	ca := e.dial(t)
	if ca.identify(tokA) == nil {
		t.Fatal("ready")
	}
	waitFor := func(check func(u *store.User) bool) *store.User {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for {
			u, err := e.st.UserByID(ctx, a.ID)
			if err == nil && check(u) {
				return u
			}
			if time.Now().After(deadline) {
				t.Fatalf("status never matched: %+v", u)
			}
			time.Sleep(20 * time.Millisecond)
		}
	}

	// a timed status, then one set to never clear: the old timer must go
	past := time.Now().Add(-time.Hour).UnixMilli()
	ca.send("presence", map[string]any{"status_text": "Lunch", "status_emoji": "🍜", "status_expires_at": past})
	waitFor(func(u *store.User) bool { return u.StatusText == "Lunch" && u.StatusExpiresAt != nil })
	ca.send("presence", map[string]any{"status_text": "On vacation", "status_emoji": "🌴", "status_expires_at": nil})
	u := waitFor(func(u *store.User) bool { return u.StatusText == "On vacation" })
	if u.StatusExpiresAt != nil {
		t.Errorf("don't-clear status kept the old expiry %d", *u.StatusExpiresAt)
	}
	if p := e.hub.PresenceOf(ctx, u); p.StatusText != "On vacation" {
		t.Errorf("presence hides the new status: %+v", p)
	}

	// long non-Latin text is cut by characters, and bidi overrides and
	// newlines are cleaned as the REST endpoint does
	ca.send("presence", map[string]any{"status_text": "‮Привет\nмир " + strings.Repeat("я", 200), "status_emoji": "a b"})
	u = waitFor(func(u *store.User) bool { return strings.HasPrefix(u.StatusText, "Привет") })
	if !utf8.ValidString(u.StatusText) || utf8.RuneCountInString(u.StatusText) != maxStatusText {
		t.Errorf("status text = %q (%d runes)", u.StatusText, utf8.RuneCountInString(u.StatusText))
	}
	if !strings.HasPrefix(u.StatusText, "Привет мир я") {
		t.Errorf("status text not cleaned: %q", u.StatusText)
	}
	if u.StatusEmoji != "🌴" {
		t.Errorf("an emoji with a space must be ignored, got %q", u.StatusEmoji)
	}
}

func TestFloodingOpsClosesTheSocket(t *testing.T) {
	e := newEnv(t)
	_, tok := e.user(t, "a")
	c := e.dial(t)
	if c.identify(tok) == nil {
		t.Fatal("ready")
	}
	for i := 0; i < opBurst+50; i++ {
		b := []byte(`{"op":"heartbeat"}`)
		if err := c.ws.Write(context.Background(), websocket.MessageText, b); err != nil {
			break
		}
	}
	if st := closeStatus(c); st != CloseRateLimited {
		t.Errorf("close status = %d", st)
	}
}

func TestEventsDuringReadyArriveAfterIt(t *testing.T) {
	c := &conn{send: make(chan ServerFrame, 8), closed: make(chan struct{})}
	c.enqueue(ServerFrame{T: "early", S: 1})
	c.enqueue(ServerFrame{T: "early", S: 2})
	c.goLive(ServerFrame{T: EvReady})
	c.enqueue(ServerFrame{T: "late", S: 3})
	want := []string{EvReady, "early", "early", "late"}
	for i, w := range want {
		select {
		case f := <-c.send:
			if f.T != w {
				t.Errorf("frame %d = %s, want %s", i, f.T, w)
			}
		default:
			t.Fatalf("frame %d missing", i)
		}
	}
}
