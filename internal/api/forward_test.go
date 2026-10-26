package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

// A forward carries the original's file over without uploading it again, for
// someone who can read the original, and pings nobody.
func TestForwardKeepsTheFile(t *testing.T) {
	srv, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	tokC, idC := register(t, ts, "carol")
	_, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idB}})
	ab := body["id"].(string)
	createEpoch(t, ts, tokA, ab)
	_, body = do(t, ts, "POST", "/api/v1/users/@me/channels", tokB, map[string]any{"recipient_ids": []string{idC}})
	bc := body["id"].(string)
	createEpoch(t, ts, tokB, bc)

	cipher := bytes.Repeat([]byte{0x42}, 5000)
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/channels/"+ab+"/attachments", bytes.NewReader(cipher))
	req.Header.Set("Authorization", "Bearer "+tokA)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var up map[string]any
	json.NewDecoder(res.Body).Decode(&up)
	res.Body.Close()
	blob := up["blob_id"].(string)
	_, orig := sendMsg(t, ts, tokA, ab, ab, 0, "file", "o1", map[string]any{"attachments": []map[string]any{{"blob_id": blob, "size": 5000}}})
	origID := orig["id"].(string)

	fwd := map[string]any{"channel_id": ab, "message_id": origID}
	// carol cannot read the original, so she cannot pass its file on
	if res, body := sendMsg(t, ts, tokC, bc, bc, 0, "x", "c1", map[string]any{"forward": fwd, "attachments": []map[string]any{{"blob_id": blob, "size": 1}}}); res.StatusCode != 400 || errCode(body) != "bad_forward" {
		t.Fatalf("forward by an outsider: %d %v", res.StatusCode, body)
	}
	// nor can bob attach it without saying it is a forward
	if res, _ := sendMsg(t, ts, tokB, bc, bc, 0, "x", "b0", map[string]any{"attachments": []map[string]any{{"blob_id": blob, "size": 1}}}); res.StatusCode != 400 {
		t.Fatalf("someone else's file without a forward: %d", res.StatusCode)
	}
	res2, body := sendMsg(t, ts, tokB, bc, bc, 0, "file", "b1", map[string]any{"forward": fwd, "mentions": []string{idC}, "attachments": []map[string]any{{"blob_id": blob, "size": 1}}})
	if res2.StatusCode != 201 {
		t.Fatalf("forward: %d %v", res2.StatusCode, body)
	}
	if int64(body["flags"].(float64))&(1<<14) == 0 || len(body["mentions"].([]any)) != 0 {
		t.Fatalf("forwarded message: %v", body)
	}
	// carol can fetch it now, through the conversation it was forwarded to
	r, _ := http.NewRequest("GET", ts.URL+"/media/attachments/"+blob, nil)
	r.Header.Set("Authorization", "Bearer "+tokC)
	rs, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(rs.Body)
	rs.Body.Close()
	if rs.StatusCode != 200 || !bytes.Equal(got, cipher) {
		t.Fatalf("carol's copy: %d", rs.StatusCode)
	}
	// it counts once, against alice, and not at all against bob
	if n, _, _ := srv.Store.UploadedSince(t.Context(), modID(idB), 0); n != 0 {
		t.Fatalf("bob's uploads: %d", n)
	}
}

// A forward is the message and nothing else, and passing things on is limited.
func TestForwardIsHeldBack(t *testing.T) {
	srv, ts := newTestServer(t)
	_ = srv
	tokA, _ := register(t, ts, "alice")
	_, idB := register(t, ts, "bob")
	_, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idB}})
	ab := body["id"].(string)
	createEpoch(t, ts, tokA, ab)
	_, orig := sendMsg(t, ts, tokA, ab, ab, 0, "hi", "o1", nil)
	fwd := map[string]any{"channel_id": ab, "message_id": orig["id"]}
	if res, body := sendMsg(t, ts, tokA, ab, ab, 0, "x", "r1", map[string]any{"forward": fwd, "reply_to_id": orig["id"]}); res.StatusCode != 400 || errCode(body) != "bad_forward" {
		t.Fatalf("forward as a reply: %d %v", res.StatusCode, body)
	}
	// a message that is not in the channel named is not one to forward
	if res, body := sendMsg(t, ts, tokA, ab, ab, 0, "x", "w1", map[string]any{"forward": map[string]any{"channel_id": "1", "message_id": orig["id"]}}); res.StatusCode != 400 || errCode(body) != "bad_forward" {
		t.Fatalf("forward from the wrong channel: %d %v", res.StatusCode, body)
	}
	limited := false
	for i := 0; i < 8; i++ {
		res, _ := sendMsg(t, ts, tokA, ab, ab, 0, "x", "f"+string(rune('a'+i)), map[string]any{"forward": fwd})
		if res.StatusCode == 429 {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("forwarding was never limited")
	}
}
