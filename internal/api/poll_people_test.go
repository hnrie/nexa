package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"evilion.xyz/chat/internal/perms"
)

// personPollBody is the poll a person's client sends beside the ciphertext.
func personPollBody(answers, hours int, multi bool) map[string]any {
	return map[string]any{"answer_count": answers, "duration": hours, "allow_multiselect": multi}
}

// A person's poll: the server stores the numbers it takes votes by, counts
// the votes, refuses edits, and closes it with a line that answers it and
// carries nothing but numbers.
func TestPersonPoll(t *testing.T) {
	srv, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	view := createServer(t, ts, tokA, "S")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	join(t, ts, tokB, inviteFor(t, ts, tokA, general))
	epoch := createEpoch(t, ts, tokA, sid)
	ctx := context.Background()

	res, body := sendMsg(t, ts, tokB, general, sid, epoch, "sealed: lunch? pizza, soup, salad", "p1", map[string]any{"poll": personPollBody(3, 24, true)})
	if res.StatusCode != 201 {
		t.Fatalf("send poll: %d %v", res.StatusCode, body)
	}
	id := body["id"].(string)
	p, err := srv.Store.PollByMessage(ctx, parseHookID(id))
	if err != nil {
		t.Fatalf("no polls row: %v", err)
	}
	if want := time.Now().Add(24 * time.Hour).UnixMilli(); p.Answers != 3 || !p.Multiselect || p.ExpiresAt == nil || *p.ExpiresAt < want-60_000 || *p.ExpiresAt > want+60_000 {
		t.Fatalf("polls row: %+v", p)
	}
	tally, _ := body["poll_results"].(map[string]any)
	if tally == nil || len(tally["answer_counts"].([]any)) != 3 || tally["total_voters"].(float64) != 0 || tally["is_finalized"] != false {
		t.Fatalf("tally in the answer: %v", body)
	}

	// votes count as they do on a webhook's poll, and every page carries the tally
	vote := "/api/v1/channels/" + general + "/polls/" + id + "/answers/@me"
	if res, body := do(t, ts, "PUT", vote, tokA, map[string]any{"answer_ids": []int{1, 3}}); res.StatusCode != 200 {
		t.Fatalf("alice votes: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PUT", vote, tokB, map[string]any{"answer_ids": []int{1}}); res.StatusCode != 200 {
		t.Fatalf("bob votes: %d %v", res.StatusCode, body)
	}
	res, page := do(t, ts, "GET", "/api/v1/channels/"+general+"/messages?limit=50", tokA, nil)
	if res.StatusCode != 200 {
		t.Fatalf("history: %d %v", res.StatusCode, page)
	}
	var found map[string]any
	for _, m := range page["_list"].([]any) {
		if m.(map[string]any)["id"] == id {
			found = m.(map[string]any)
		}
	}
	tally, _ = found["poll_results"].(map[string]any)
	if tally == nil || tally["total_voters"].(float64) != 2 {
		t.Fatalf("tally on the page: %v", found)
	}
	counts := tally["answer_counts"].([]any)
	if c := counts[0].(map[string]any); c["count"].(float64) != 2 || c["me_voted"] != true {
		t.Fatalf("answer 1: %v", c)
	}
	if c := counts[1].(map[string]any); c["count"].(float64) != 0 || c["me_voted"] != false {
		t.Fatalf("answer 2: %v", c)
	}

	// what was voted on stays what it was
	edit := map[string]any{"ciphertext": envelopeFor(sid, epoch, "sealed: something else"), "key_conv_id": sid, "key_epoch": epoch, "mentions": []string{}}
	if res, body := do(t, ts, "PATCH", "/api/v1/channels/"+general+"/messages/"+id, tokB, edit); res.StatusCode != 400 || errCode(body) != "poll_edit" {
		t.Fatalf("edit a poll: %d %v", res.StatusCode, body)
	}

	// time runs out: the line answers the poll, speaks for bob, and holds numbers only
	g := connectGW(t, ts, tokA)
	if _, err := srv.Store.DB().W.ExecContext(ctx, `UPDATE polls SET expires_at = ? WHERE message_id = ?`, time.Now().Add(-time.Minute).UnixMilli(), int64(parseHookID(id))); err != nil {
		t.Fatal(err)
	}
	srv.closePolls(ctx)
	line := g.next("message_create", 3*time.Second)
	if line == nil || line["type"] != "system_poll_result" || line["reply_to_id"] != id || line["author_id"] != idB || line["ciphertext"] != nil {
		t.Fatalf("result line: %v", line)
	}
	if _, ok := line["webhook"]; ok {
		t.Fatalf("a person's result line carries a webhook's words: %v", line)
	}
	if _, ok := line["webhook_id"]; ok {
		t.Fatalf("a person's result line names a webhook: %v", line)
	}
	outcome, _ := line["poll_result"].(map[string]any)
	if outcome == nil || outcome["victor_answer_id"].(float64) != 1 || outcome["victor_answer_votes"].(float64) != 2 || outcome["total_votes"].(float64) != 3 || outcome["total_voters"].(float64) != 2 || len(outcome["answer_counts"].([]any)) != 3 {
		t.Fatalf("outcome: %v", outcome)
	}
	raw, _ := json.Marshal(outcome)
	for _, word := range []string{"lunch", "pizza", "sealed", "text", "question"} {
		if strings.Contains(strings.ToLower(string(raw)), word) {
			t.Fatalf("the outcome says %q: %s", word, raw)
		}
	}
	// read back from the store, the line is the same
	res, body = do(t, ts, "GET", "/api/v1/channels/"+general+"/messages/"+line["id"].(string), tokA, nil)
	if res.StatusCode != 200 || body["poll_result"] == nil || body["webhook"] != nil {
		t.Fatalf("stored line: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PUT", vote, tokA, map[string]any{"answer_ids": []int{2}}); res.StatusCode != 400 || errCode(body) != "poll_closed" {
		t.Fatalf("vote after close: %d %v", res.StatusCode, body)
	}
}

// A poll that is not one is refused before anything is stored.
func TestPersonPollShape(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	view := createServer(t, ts, tokA, "S")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	epoch := createEpoch(t, ts, tokA, sid)
	bad := []any{
		personPollBody(1, 24, false),
		personPollBody(11, 24, false),
		personPollBody(3, 0, false),
		personPollBody(3, 337, false),
		map[string]any{"answer_count": 3, "duration": 24, "allow_multiselect": "yes"},
		map[string]any{"answer_count": 2.5, "duration": 24},
		map[string]any{"duration": 24},
		map[string]any{"answer_count": 3},
		"poll",
		[]int{2, 24},
	}
	for i, p := range bad {
		if res, body := sendMsg(t, ts, tokA, general, sid, epoch, "sealed", fmt.Sprintf("bad%d", i), map[string]any{"poll": p}); res.StatusCode != 400 || errCode(body) != "bad_poll" {
			t.Errorf("poll %v: %d %v", p, res.StatusCode, body)
		}
	}
	// the edges are fine, and so is a poll whose multiselect goes unsaid
	for i, p := range []any{personPollBody(2, 1, false), personPollBody(10, 336, true), map[string]any{"answer_count": 4, "duration": 8}} {
		if res, body := sendMsg(t, ts, tokA, general, sid, epoch, "sealed", fmt.Sprintf("good%d", i), map[string]any{"poll": p}); res.StatusCode != 201 || body["poll_results"] == nil {
			t.Errorf("poll %v: %d %v", p, res.StatusCode, body)
		}
	}
	// a message without one has no tally
	if res, body := sendMsg(t, ts, tokA, general, sid, epoch, "plain words", "plain", map[string]any{"poll": nil}); res.StatusCode != 201 || body["poll_results"] != nil {
		t.Errorf("no poll: %d %v", res.StatusCode, body)
	}
}

// A server can take Create Polls away; a conversation cannot.
func TestPersonPollNeedsCreatePolls(t *testing.T) {
	srv, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	view := createServer(t, ts, tokA, "S")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	join(t, ts, tokB, inviteFor(t, ts, tokA, general))
	epoch := createEpoch(t, ts, tokA, sid)
	if res, body := do(t, ts, "PATCH", "/api/v1/servers/"+sid+"/roles/"+sid, tokA, map[string]any{"permissions": permStr(perms.DefaultEveryone &^ perms.CreatePolls)}); res.StatusCode != 200 {
		t.Fatalf("take Create Polls away: %d %v", res.StatusCode, body)
	}
	if res, body := sendMsg(t, ts, tokB, general, sid, epoch, "sealed", "b1", map[string]any{"poll": personPollBody(2, 24, false)}); res.StatusCode != 403 || errCode(body) != "cannot_create_polls" {
		t.Fatalf("poll without Create Polls: %d %v", res.StatusCode, body)
	}
	var n int
	if err := srv.Store.DB().R.QueryRowContext(context.Background(), `SELECT count(*) FROM polls`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("a refused poll was stored: %d polls (%v)", n, err)
	}
	// the rest of what bob says still goes, and the owner may still ask
	if res, body := sendMsg(t, ts, tokB, general, sid, epoch, "sealed", "b2", nil); res.StatusCode != 201 {
		t.Fatalf("plain message: %d %v", res.StatusCode, body)
	}
	if res, body := sendMsg(t, ts, tokA, general, sid, epoch, "sealed", "a1", map[string]any{"poll": personPollBody(2, 24, false)}); res.StatusCode != 201 {
		t.Fatalf("owner's poll: %d %v", res.StatusCode, body)
	}
	// in a DM there is nobody to ask
	befriend(t, ts, tokA, tokB, "bob", idA)
	res, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idB}})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("open dm: %d %v", res.StatusCode, body)
	}
	dm := body["id"].(string)
	dmEpoch := createEpoch(t, ts, tokA, dm)
	if res, body := sendMsg(t, ts, tokB, dm, dm, dmEpoch, "sealed", "d1", map[string]any{"poll": personPollBody(2, 1, false)}); res.StatusCode != 201 || body["poll_results"] == nil {
		t.Fatalf("poll in a DM: %d %v", res.StatusCode, body)
	}
}
