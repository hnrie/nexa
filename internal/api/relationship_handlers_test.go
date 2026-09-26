package api

import (
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"evilion.xyz/chat/internal/store"
)

func TestFriendRequestsAndBlocks(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	tokC, idC := register(t, ts, "carol")
	gb := connectGW(t, ts, tokB)
	if res, body := do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "alice"}); res.StatusCode != 400 || errCode(body) != "self" {
		t.Errorf("self: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "ghost"}); res.StatusCode != 404 {
		t.Errorf("unknown: %d %v", res.StatusCode, body)
	}
	res, body := do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "Bob"})
	if res.StatusCode != 200 || body["type"] != "outgoing" {
		t.Fatalf("request: %d %v", res.StatusCode, body)
	}
	if ev := gb.next("relationship_add", 3*time.Second); ev == nil || ev["type"] != "incoming" || ev["user"].(map[string]any)["id"] != idA {
		t.Errorf("bob sees incoming: %v", ev)
	}
	if res, body = do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "bob"}); res.StatusCode != 400 || errCode(body) != "already_sent" {
		t.Errorf("duplicate: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/users/@me/relationships", tokB, nil)
	list := body["_list"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["type"] != "incoming" {
		t.Errorf("bob list: %v", body)
	}
	if res, body = do(t, ts, "PUT", "/api/v1/users/@me/relationships/"+idC, tokB, nil); res.StatusCode != 404 {
		t.Errorf("accept nonexistent: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "PUT", "/api/v1/users/@me/relationships/"+idA, tokB, nil); res.StatusCode != 200 || body["type"] != "friend" {
		t.Fatalf("accept: %d %v", res.StatusCode, body)
	}
	if ev := gb.next("relationship_add", 3*time.Second); ev == nil || ev["type"] != "friend" {
		t.Errorf("bob sees friend: %v", ev)
	}
	// reciprocal request auto-accepts
	do(t, ts, "POST", "/api/v1/users/@me/relationships", tokC, map[string]any{"username": "bob"})
	if res, body = do(t, ts, "POST", "/api/v1/users/@me/relationships", tokB, map[string]any{"username": "carol"}); res.StatusCode != 200 || body["type"] != "friend" {
		t.Errorf("reciprocal: %d %v", res.StatusCode, body)
	}
	// mutual friends: alice and carol share bob
	do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "carol"})
	do(t, ts, "PUT", "/api/v1/users/@me/relationships/"+idA, tokC, nil)
	res, body = do(t, ts, "GET", "/api/v1/users/"+idC+"/profile", tokA, nil)
	if mf := body["mutual_friends"].([]any); len(mf) != 1 || mf[0] != idB {
		t.Errorf("mutual friends: %v", body)
	}
	// remove friend
	if res, _ = do(t, ts, "DELETE", "/api/v1/users/@me/relationships/"+idC, tokA, nil); res.StatusCode != 204 {
		t.Error("remove")
	}
	res, body = do(t, ts, "GET", "/api/v1/users/@me/relationships", tokC, nil)
	for _, it := range body["_list"].([]any) {
		if it.(map[string]any)["user"].(map[string]any)["id"] == idA {
			t.Error("carol should no longer list alice")
		}
	}
	// block
	if res, _ = do(t, ts, "PUT", "/api/v1/users/@me/blocks/"+idB, tokA, nil); res.StatusCode != 204 {
		t.Error("block")
	}
	if ev := gb.next("relationship_remove", 3*time.Second); ev == nil || ev["user_id"] != idA {
		t.Errorf("bob loses the friendship: %v", ev)
	}
	if res, body = do(t, ts, "POST", "/api/v1/users/@me/relationships", tokB, map[string]any{"username": "alice"}); res.StatusCode != 403 || errCode(body) != "blocked" {
		t.Errorf("blocked request: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/users/@me/relationships", tokA, nil)
	if l := body["_list"].([]any); len(l) != 1 || l[0].(map[string]any)["type"] != "blocked" {
		t.Errorf("alice list: %v", body)
	}
	if res, _ = do(t, ts, "DELETE", "/api/v1/users/@me/relationships/"+idB, tokA, nil); res.StatusCode != 404 {
		t.Error("blocked rows are not removed via relationships delete")
	}
	if res, _ = do(t, ts, "DELETE", "/api/v1/users/@me/blocks/"+idB, tokA, nil); res.StatusCode != 204 {
		t.Error("unblock")
	}
	if res, body = do(t, ts, "POST", "/api/v1/users/@me/relationships", tokB, map[string]any{"username": "alice"}); res.StatusCode != 200 || body["type"] != "outgoing" {
		t.Errorf("request after unblock: %d %v", res.StatusCode, body)
	}
}

// Blocking someone who has blocked you adds your own block; it does not lift
// theirs, so it cannot be used to get back in touch.
func TestBlockingBackKeepsTheOtherBlock(t *testing.T) {
	srv, ts := newTestServer(t)
	aliceTok, aliceID := register(t, ts, "alice")
	malTok, malID := register(t, ts, "mallory")
	if res, _ := do(t, ts, "PUT", "/api/v1/users/@me/blocks/"+malID, aliceTok, nil); res.StatusCode != 204 {
		t.Fatalf("alice blocks: %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "PUT", "/api/v1/users/@me/blocks/"+aliceID, malTok, nil); res.StatusCode != 204 {
		t.Fatalf("mallory blocks back: %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "DELETE", "/api/v1/users/@me/blocks/"+aliceID, malTok, nil); res.StatusCode != 204 {
		t.Fatalf("mallory unblocks: %d", res.StatusCode)
	}
	rel, err := srv.Store.Relationship(t.Context(), modID(aliceID), modID(malID))
	if err != nil || rel.Type != "blocked" {
		t.Fatalf("alice's block went: %+v %v", rel, err)
	}
	if res, body := do(t, ts, "POST", "/api/v1/users/@me/relationships", malTok, map[string]any{"username": "alice"}); res.StatusCode != 403 || errCode(body) != "blocked" {
		t.Errorf("mallory's request: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "POST", "/api/v1/users/@me/channels", malTok, map[string]any{"recipient_ids": []string{aliceID}}); res.StatusCode < 400 {
		t.Errorf("mallory opened a DM: %d", res.StatusCode)
	}
}

// A request that passed the block check just before a block landed is
// refused rather than written over the block.
func TestARequestDoesNotOverwriteABlock(t *testing.T) {
	srv, ts := newTestServer(t)
	register(t, ts, "alice")
	_, aliceID := register(t, ts, "alice2")
	_, bobID := register(t, ts, "bob")
	ctx := t.Context()
	if err := srv.Store.Block(ctx, modID(bobID), modID(aliceID)); err != nil {
		t.Fatal(err)
	}
	if err := srv.Store.SetRelationshipPair(ctx, modID(aliceID), modID(bobID), "outgoing", "incoming"); !errors.Is(err, store.ErrBlocked) {
		t.Fatalf("pair over a block: %v", err)
	}
	if rel, err := srv.Store.Relationship(ctx, modID(bobID), modID(aliceID)); err != nil || rel.Type != "blocked" {
		t.Errorf("bob's block: %+v %v", rel, err)
	}
}

// sealedNote stands in for a note sealed on the sender's device: the server
// never opens one, so any bytes of a sealed box's size will do.
func sealedNote(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i * 7)
	}
	return b
}

func notePath(id string) string { return "/api/v1/users/@me/relationships/" + id + "/note" }

// A friend request's note goes on the recipient's row, reaches them live and
// in their list, can only be put there by whoever sent the request while it
// is pending, and goes when the request is answered.
func TestFriendRequestNote(t *testing.T) {
	srv, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	tokC, idC := register(t, ts, "carol")
	note := b64(sealedNote(80))

	// nothing sent yet
	if res, body := do(t, ts, "PUT", notePath(idB), tokA, map[string]any{"note": note}); res.StatusCode != 404 || errCode(body) != "no_request" {
		t.Errorf("note before any request: %d %v", res.StatusCode, body)
	}
	gb := connectGW(t, ts, tokB)
	if res, body := do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "bob"}); res.StatusCode != 200 || body["type"] != "outgoing" {
		t.Fatalf("request: %d %v", res.StatusCode, body)
	}
	if ev := gb.next("relationship_add", 3*time.Second); ev == nil || ev["type"] != "incoming" || ev["note"] != nil {
		t.Fatalf("bob sees the request, with no note yet: %v", ev)
	}

	// only a sealed box, in standard base64, is taken
	for name, bad := range map[string]string{
		"missing":      "",
		"not base64":   "this is not base64!",
		"url alphabet": base64.URLEncoding.EncodeToString(append(sealedNote(80), 0xfb, 0xff)),
		"too short":    b64(sealedNote(59)),
		"too long":     b64(sealedNote(1025)),
		"line breaks":  note[:40] + "\n" + note[40:],
	} {
		if res, body := do(t, ts, "PUT", notePath(idB), tokA, map[string]any{"note": bad}); res.StatusCode != 400 || errCode(body) != "invalid_note" {
			t.Errorf("%s: %d %v", name, res.StatusCode, body)
		}
	}
	if rel, err := srv.Store.Relationship(t.Context(), modID(idB), modID(idA)); err != nil || rel.Note != "" {
		t.Fatalf("a refused note was kept: %+v %v", rel, err)
	}

	// unpadded is fine, and kept padded; the smallest and largest sizes pass
	if res, body := do(t, ts, "PUT", notePath(idB), tokA, map[string]any{"note": base64.RawStdEncoding.EncodeToString(sealedNote(61))}); res.StatusCode != 204 {
		t.Errorf("raw base64: %d %v", res.StatusCode, body)
	}
	if rel, _ := srv.Store.Relationship(t.Context(), modID(idB), modID(idA)); rel == nil || rel.Note != b64(sealedNote(61)) {
		t.Errorf("raw base64 stored as %+v", rel)
	}
	for _, n := range []int{60, 1024} {
		if res, body := do(t, ts, "PUT", notePath(idB), tokA, map[string]any{"note": b64(sealedNote(n))}); res.StatusCode != 204 {
			t.Errorf("%d bytes: %d %v", n, res.StatusCode, body)
		}
	}

	// the note itself: bob hears of it, and it is in his list but not in alice's
	if res, body := do(t, ts, "PUT", notePath(idB), tokA, map[string]any{"note": note}); res.StatusCode != 204 {
		t.Fatalf("note: %d %v", res.StatusCode, body)
	}
	for {
		ev := gb.next("relationship_add", 3*time.Second)
		if ev == nil {
			t.Fatal("bob was not told about the note")
		}
		if ev["note"] == note {
			if ev["type"] != "incoming" || ev["user"].(map[string]any)["id"] != idA {
				t.Errorf("note event: %v", ev)
			}
			break
		}
	}
	_, body := do(t, ts, "GET", "/api/v1/users/@me/relationships", tokB, nil)
	if l := body["_list"].([]any); len(l) != 1 || l[0].(map[string]any)["note"] != note {
		t.Errorf("bob's list: %v", body)
	}
	_, body = do(t, ts, "GET", "/api/v1/users/@me/relationships", tokA, nil)
	if l := body["_list"].([]any); len(l) != 1 || l[0].(map[string]any)["type"] != "outgoing" || l[0].(map[string]any)["note"] != nil {
		t.Errorf("alice's list: %v", body)
	}
	// and in the list the gateway hands bob when he connects
	ready := connectGWReady(t, ts, tokB).ready
	if rels, _ := ready["relationships"].([]any); len(rels) != 1 || rels[0].(map[string]any)["note"] != note {
		t.Errorf("bob's ready: %v", ready["relationships"])
	}

	// Only the sender, and only while it is pending. Bob received the request
	// rather than sent it; carol has nothing pending with bob at all; and
	// carol's own request to alice is hers to annotate, not alice's.
	if res, body := do(t, ts, "PUT", notePath(idA), tokB, map[string]any{"note": note}); res.StatusCode != 404 {
		t.Errorf("the recipient set a note: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PUT", notePath(idB), tokC, map[string]any{"note": note}); res.StatusCode != 404 {
		t.Errorf("a stranger set a note: %d %v", res.StatusCode, body)
	}
	do(t, ts, "POST", "/api/v1/users/@me/relationships", tokC, map[string]any{"username": "alice"})
	if res, body := do(t, ts, "PUT", notePath(idC), tokA, map[string]any{"note": note}); res.StatusCode != 404 {
		t.Errorf("a note on a request received: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PUT", notePath("not-an-id"), tokA, map[string]any{"note": note}); res.StatusCode != 404 {
		t.Errorf("bad id: %d %v", res.StatusCode, body)
	}

	// accepting makes them friends, and the note goes with the request
	if res, body := do(t, ts, "PUT", "/api/v1/users/@me/relationships/"+idA, tokB, nil); res.StatusCode != 200 || body["type"] != "friend" {
		t.Fatalf("accept: %d %v", res.StatusCode, body)
	}
	if ev := gb.next("relationship_add", 3*time.Second); ev == nil || ev["type"] != "friend" || ev["note"] != nil {
		t.Errorf("bob's friend event: %v", ev)
	}
	for _, pair := range [][2]string{{idB, idA}, {idA, idB}} {
		if rel, err := srv.Store.Relationship(t.Context(), modID(pair[0]), modID(pair[1])); err != nil || rel.Type != "friend" || rel.Note != "" {
			t.Errorf("after accepting: %+v %v", rel, err)
		}
	}
	_, body = do(t, ts, "GET", "/api/v1/users/@me/relationships", tokB, nil)
	if l := body["_list"].([]any); len(l) != 1 || l[0].(map[string]any)["note"] != nil {
		t.Errorf("bob's list after accepting: %v", body)
	}
	// a friend is not a pending request
	if res, body := do(t, ts, "PUT", notePath(idB), tokA, map[string]any{"note": note}); res.StatusCode != 404 || errCode(body) != "no_request" {
		t.Errorf("note to a friend: %d %v", res.StatusCode, body)
	}
}

// A note does not outlive its request: not into a block, and not into the
// same request sent again after it was taken back.
func TestRequestNoteDoesNotOutliveItsRequest(t *testing.T) {
	srv, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	note := b64(sealedNote(100))
	ask := func() {
		t.Helper()
		if res, body := do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "bob"}); res.StatusCode != 200 || body["type"] != "outgoing" {
			t.Fatalf("request: %d %v", res.StatusCode, body)
		}
		if res, body := do(t, ts, "PUT", notePath(idB), tokA, map[string]any{"note": note}); res.StatusCode != 204 {
			t.Fatalf("note: %d %v", res.StatusCode, body)
		}
	}
	bobsRow := func() *store.Relationship {
		t.Helper()
		rel, err := srv.Store.Relationship(t.Context(), modID(idB), modID(idA))
		if err != nil {
			t.Fatalf("bob's row: %v", err)
		}
		return rel
	}

	ask()
	if res, _ := do(t, ts, "DELETE", "/api/v1/users/@me/relationships/"+idB, tokA, nil); res.StatusCode != 204 {
		t.Fatal("take back")
	}
	if res, body := do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "bob"}); res.StatusCode != 200 {
		t.Fatalf("ask again: %d %v", res.StatusCode, body)
	}
	if rel := bobsRow(); rel.Type != "incoming" || rel.Note != "" {
		t.Errorf("the request sent again carries the old note: %+v", rel)
	}

	if res, body := do(t, ts, "PUT", notePath(idB), tokA, map[string]any{"note": note}); res.StatusCode != 204 {
		t.Fatalf("note: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "PUT", "/api/v1/users/@me/blocks/"+idA, tokB, nil); res.StatusCode != 204 {
		t.Fatal("block")
	}
	if rel := bobsRow(); rel.Type != "blocked" || rel.Note != "" {
		t.Errorf("the block kept the note: %+v", rel)
	}
	if res, body := do(t, ts, "PUT", notePath(idB), tokA, map[string]any{"note": note}); res.StatusCode != 404 {
		t.Errorf("a note to someone who blocked you: %d %v", res.StatusCode, body)
	}
}

// A note says something to somebody, so it is closed to a muted account the
// way a friend request is, rather than open like the private nickname.
func TestRequestNoteIsClosedToAMutedAccount(t *testing.T) {
	_, ts := newTestServer(t)
	modTok, _ := register(t, ts, "owner")
	tokA, idA := register(t, ts, "alice")
	_, idB := register(t, ts, "bob")
	if res, body := do(t, ts, "POST", "/api/v1/users/@me/relationships", tokA, map[string]any{"username": "bob"}); res.StatusCode != 200 {
		t.Fatalf("request: %d %v", res.StatusCode, body)
	}
	mustAct(t, ts, modTok, idA, map[string]any{"action": "mute", "reason": "spam", "duration_ms": 3600000})
	if res, body := do(t, ts, "PUT", notePath(idB), tokA, map[string]any{"note": b64(sealedNote(80))}); res.StatusCode != 403 || errCode(body) != "account_muted" {
		t.Errorf("muted note: %d %v", res.StatusCode, body)
	}
}
