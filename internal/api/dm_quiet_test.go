package api

import (
	"net/http/httptest"
	"slices"
	"testing"
	"time"
)

// frameSeen is one gateway frame a test client received.
type frameSeen struct {
	t string
	d map[string]any
}

// until collects the frames g receives until stop accepts one (which is
// included), or returns what it has, with false, once timeout passes.
func (g *gw) until(timeout time.Duration, stop func(f frameSeen) bool) ([]frameSeen, bool) {
	var out []frameSeen
	deadline := time.After(timeout)
	for {
		select {
		case raw := <-g.frames:
			f := frameSeen{}
			f.t, _ = raw["t"].(string)
			f.d, _ = raw["d"].(map[string]any)
			out = append(out, f)
			if stop != nil && stop(f) {
				return out, true
			}
		case <-deadline:
			return out, false
		}
	}
}

// naming lists, in order, the types of the frames that are about channel id:
// the channel itself, something in it, its key conversation or a subchat of it.
func naming(frames []frameSeen, id string) []string {
	var out []string
	for _, f := range frames {
		if f.d != nil && (f.d["id"] == id || f.d["channel_id"] == id || f.d["conv_id"] == id || f.d["parent_id"] == id) {
			out = append(out, f.t)
		}
	}
	return out
}

// before reports whether a appears in list, and before the first b.
func before(list []string, a, b string) bool {
	i, j := slices.Index(list, a), slices.Index(list, b)
	return i >= 0 && (j < 0 || i < j)
}

func dmListed(t *testing.T, ts *httptest.Server, token, dm string) bool {
	t.Helper()
	res, body := do(t, ts, "GET", "/api/v1/users/@me/channels", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, body)
	}
	for _, c := range body["_list"].([]any) {
		if c.(map[string]any)["id"] == dm {
			return true
		}
	}
	return false
}

func startDM(t *testing.T, ts *httptest.Server, token, otherID string) string {
	t.Helper()
	res, body := do(t, ts, "POST", "/api/v1/users/@me/channels", token, map[string]any{"recipient_ids": []string{otherID}})
	if res.StatusCode != 201 {
		t.Fatalf("start dm: %d %v", res.StatusCode, body)
	}
	return body["id"].(string)
}

// Opening a DM with someone does not put it in their sidebar: their first
// sight of it is the first message, which they can read.
func TestNewDMWaitsForTheFirstMessage(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	ga := connectGW(t, ts, tokA)
	gb := connectGW(t, ts, tokB)
	dm := startDM(t, ts, tokA, idB)
	if ev := ga.nextFor("channel_create", "id", dm, 3*time.Second); ev == nil {
		t.Error("the one who opened it should have it on every device")
	}
	if res, _ := do(t, ts, "POST", "/api/v1/channels/"+dm+"/typing", tokA, nil); res.StatusCode != 204 {
		t.Fatalf("typing: %d", res.StatusCode)
	}
	if got, _ := gb.until(700*time.Millisecond, nil); len(naming(got, dm)) > 0 {
		t.Errorf("bob heard about a DM nobody has written in: %v", naming(got, dm))
	}
	if dmListed(t, ts, tokB, dm) || !dmListed(t, ts, tokA, dm) {
		t.Errorf("listed for bob %v, for alice %v", dmListed(t, ts, tokB, dm), dmListed(t, ts, tokA, dm))
	}
	fresh := connectGWReady(t, ts, tokB)
	for _, c := range fresh.ready["channels"].([]any) {
		if c.(map[string]any)["id"] == dm {
			t.Error("bob's ready brings the DM")
		}
	}
	fresh.close()

	// the first message: the conversation reaches bob, then the message
	epoch := createEpoch(t, ts, tokA, dm)
	if res, body := sendMsg(t, ts, tokA, dm, dm, epoch, "hello", "first", nil); res.StatusCode != 201 {
		t.Fatalf("send: %d %v", res.StatusCode, body)
	}
	got, ok := gb.until(3*time.Second, func(f frameSeen) bool { return f.t == "message_create" && f.d["channel_id"] == dm })
	if seq := naming(got, dm); !ok || !before(seq, "channel_create", "message_create") {
		t.Fatalf("bob should get the conversation before its first message: %v", seq)
	}
	if !dmListed(t, ts, tokB, dm) {
		t.Error("bob's list lacks the DM after the first message")
	}
	res, body := do(t, ts, "GET", "/api/v1/channels/"+dm+"/messages", tokB, nil)
	if res.StatusCode != 200 || len(body["_list"].([]any)) != 1 {
		t.Fatalf("bob reads: %d %v", res.StatusCode, body)
	}
	// and holds the key it was sealed with
	res, body = do(t, ts, "GET", "/api/v1/keys/grants", tokB, nil)
	found := false
	for _, g := range body["_list"].([]any) {
		if g := g.(map[string]any); g["conv_id"] == dm && int(g["epoch"].(float64)) == epoch {
			found = true
		}
	}
	if res.StatusCode != 200 || !found {
		t.Errorf("bob has no key for the DM: %d %v", res.StatusCode, body)
	}
	// typing reaches him from now on
	do(t, ts, "POST", "/api/v1/channels/"+dm+"/typing", tokA, nil)
	if ev := gb.nextFor("typing", "channel_id", dm, 3*time.Second); ev == nil {
		t.Error("typing should reach bob once he has the conversation")
	}
}

// Someone opening a DM that was opened with them, before anything was said
// in it, gets that conversation, in their sidebar.
func TestNewDMOpenedFromTheOtherSide(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	gb := connectGW(t, ts, tokB)
	dm := startDM(t, ts, tokA, idB)
	res, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokB, map[string]any{"recipient_ids": []string{idA}})
	if res.StatusCode != 200 || body["id"] != dm {
		t.Fatalf("bob opens it: %d %v", res.StatusCode, body)
	}
	if ev := gb.nextFor("channel_create", "id", dm, 3*time.Second); ev == nil {
		t.Error("bob's devices should get the conversation")
	}
	if !dmListed(t, ts, tokB, dm) {
		t.Error("bob's list lacks it")
	}
}

// A call rings in a conversation the other person has not been shown yet:
// they get the conversation first, so the ring has somewhere to answer.
func TestNewDMCallShowsTheConversation(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	ga := connectGW(t, ts, tokA)
	gb := connectGW(t, ts, tokB)
	dm := startDM(t, ts, tokA, idB)
	ga.op(t, "voice_state", map[string]any{"channel_id": dm})
	got, ok := gb.until(3*time.Second, func(f frameSeen) bool { return f.t == "call_ring" })
	if seq := naming(got, dm); !ok || !before(seq, "channel_create", "call_ring") {
		t.Fatalf("bob should get the conversation before the ring: %v", seq)
	}
	if ring := got[len(got)-1]; ring.d["from"] != idA || ring.d["channel_id"] != dm {
		t.Errorf("ring: %v", ring.d)
	}
	if !dmListed(t, ts, tokB, dm) {
		t.Error("bob's list lacks the DM he is being called in")
	}
}

// A subchat is listed under its conversation, so starting one in a DM the
// other person has not been shown brings the DM with it.
func TestNewDMSubchatShowsTheConversation(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	gb := connectGW(t, ts, tokB)
	dm := startDM(t, ts, tokA, idB)
	res, body := do(t, ts, "POST", "/api/v1/channels/"+dm+"/subchats", tokA, map[string]any{"name": "Plans"})
	if res.StatusCode != 201 {
		t.Fatalf("subchat: %d %v", res.StatusCode, body)
	}
	sub := body["id"].(string)
	got, ok := gb.until(3*time.Second, func(f frameSeen) bool { return f.t == "channel_create" && f.d["id"] == sub })
	if !ok || len(got) < 2 || got[len(got)-2].t != "channel_create" || got[len(got)-2].d["id"] != dm {
		t.Fatalf("bob should get the DM, then its subchat: %v", naming(got, dm))
	}
	if !dmListed(t, ts, tokB, dm) {
		t.Error("bob's list lacks the DM")
	}
}

// A new account takes direct messages from friends and people it shares a
// server with; the other choices work as they did.
func TestDMPrivacyFriendsAndServerMembers(t *testing.T) {
	_, ts := newTestServer(t)
	register(t, ts, "owner") // the first account is the Nexa admin
	tokB, idB := registerDefault(t, ts, "bob")
	if _, me := do(t, ts, "GET", "/api/v1/users/@me", tokB, nil); me["dm_privacy"] != "friends_servers" {
		t.Fatalf("a new account's dm_privacy: %v", me["dm_privacy"])
	}
	tokStranger, _ := register(t, ts, "alice")
	tokC, idC := register(t, ts, "carol")
	tokD, _ := register(t, ts, "dave")
	tokE, _ := register(t, ts, "eve")
	friend(t, ts, tokC, "bob", tokB, idC)
	den := createServer(t, ts, tokB, "Den")
	code := inviteFor(t, ts, tokB, channelNamed(den, "general")["id"].(string))
	join(t, ts, tokD, code)
	join(t, ts, tokE, code)

	open := func(token string) (int, string) {
		res, body := do(t, ts, "POST", "/api/v1/users/@me/channels", token, map[string]any{"recipient_ids": []string{idB}})
		return res.StatusCode, errCode(body)
	}
	if status, code := open(tokStranger); status != 403 || code != "dm_friends_servers" {
		t.Errorf("a stranger with no server in common: %d %s", status, code)
	}
	if status, _ := open(tokC); status != 200 && status != 201 {
		t.Errorf("a friend: %d", status)
	}
	if status, _ := open(tokD); status != 201 {
		t.Errorf("someone in a server with bob: %d", status)
	}
	// the other choices are as they were
	do(t, ts, "PATCH", "/api/v1/users/@me", tokB, map[string]any{"dm_privacy": "friends"})
	if status, code := open(tokE); status != 403 || code != "dm_friends_only" {
		t.Errorf("friends only, someone in a server with bob: %d %s", status, code)
	}
	if status, _ := open(tokC); status != 200 {
		t.Errorf("friends only, a friend: %d", status)
	}
	do(t, ts, "PATCH", "/api/v1/users/@me", tokB, map[string]any{"dm_privacy": "nobody"})
	if status, code := open(tokE); status != 403 || code != "dm_closed" {
		t.Errorf("nobody: %d %s", status, code)
	}
	do(t, ts, "PATCH", "/api/v1/users/@me", tokB, map[string]any{"dm_privacy": "everyone"})
	if status, _ := open(tokStranger); status != 201 {
		t.Errorf("everyone, a stranger: %d", status)
	}
	// and it can be picked again
	if res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tokB, map[string]any{"dm_privacy": "friends_servers"}); res.StatusCode != 200 || body["dm_privacy"] != "friends_servers" {
		t.Errorf("pick friends_servers: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tokB, map[string]any{"dm_privacy": "servers"}); res.StatusCode != 400 || errCode(body) != "invalid_dm_privacy" {
		t.Errorf("a value that does not exist: %d %v", res.StatusCode, body)
	}
}
