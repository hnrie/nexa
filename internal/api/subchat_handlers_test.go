package api

import (
	"net/http/httptest"
	"testing"
)

// dmBetween returns the DM channel id the two users share.
func dmBetween(t *testing.T, ts *httptest.Server, token, otherID string) string {
	t.Helper()
	res, body := do(t, ts, "POST", "/api/v1/users/@me/channels", token, map[string]any{"recipient_ids": []string{otherID}})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("dm: %d %v", res.StatusCode, body)
	}
	return body["id"].(string)
}

func befriend(t *testing.T, ts *httptest.Server, aTok, bTok, bName, aID string) {
	t.Helper()
	res, body := do(t, ts, "POST", "/api/v1/users/@me/relationships", aTok, map[string]any{"username": bName})
	if res.StatusCode >= 300 {
		t.Fatalf("request: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "PUT", "/api/v1/users/@me/relationships/"+aID, bTok, nil)
	if res.StatusCode != 200 {
		t.Fatalf("accept: %d %v", res.StatusCode, body)
	}
}

func TestAcceptingAFriendOpensTheConversation(t *testing.T) {
	_, ts := newTestServer(t)
	aTok, aID := register(t, ts, "alice")
	bTok, _ := register(t, ts, "bob")

	res, body := do(t, ts, "POST", "/api/v1/users/@me/relationships", aTok, map[string]any{"username": "bob"})
	if res.StatusCode >= 300 {
		t.Fatalf("request: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "PUT", "/api/v1/users/@me/relationships/"+aID, bTok, nil)
	if res.StatusCode != 200 {
		t.Fatalf("accept: %d %v", res.StatusCode, body)
	}
	ch, ok := body["channel"].(map[string]any)
	if !ok || ch["type"] != "dm" {
		t.Fatalf("accepting should hand back the conversation: %v", body)
	}
	// and both sides can see it in their list without asking for it
	for _, tok := range []string{aTok, bTok} {
		res, list := do(t, ts, "GET", "/api/v1/users/@me/channels", tok, nil)
		rows, _ := list["_list"].([]any)
		if res.StatusCode != 200 || len(rows) != 1 {
			t.Fatalf("channel list: %d %v", res.StatusCode, list)
		}
	}
}

func TestSubchatsLiveInsideAConversation(t *testing.T) {
	_, ts := newTestServer(t)
	aTok, aID := register(t, ts, "alice")
	bTok, bID := register(t, ts, "bob")
	befriend(t, ts, aTok, bTok, "bob", aID)
	dm := dmBetween(t, ts, aTok, bID)

	res, body := do(t, ts, "POST", "/api/v1/channels/"+dm+"/subchats", aTok, map[string]any{"name": "  Holiday plans  "})
	if res.StatusCode != 201 {
		t.Fatalf("create: %d %v", res.StatusCode, body)
	}
	sub := body["id"].(string)
	if body["name"] != "Holiday plans" || body["type"] != "subchat" || body["parent_id"] != dm {
		t.Fatalf("subchat shape: %v", body)
	}
	if body["key_conv_id"] != sub {
		t.Errorf("a subchat seals under its own key, not the parent's: %v", body["key_conv_id"])
	}
	recips, _ := body["recipient_ids"].([]any)
	if len(recips) != 2 {
		t.Errorf("both people should be in it: %v", body)
	}

	// the other side sees it listed and can post in it
	res, list := do(t, ts, "GET", "/api/v1/channels/"+dm+"/subchats", bTok, nil)
	rows, _ := list["_list"].([]any)
	if res.StatusCode != 200 || len(rows) != 1 {
		t.Fatalf("list for bob: %d %v", res.StatusCode, list)
	}
	epoch := createEpoch(t, ts, bTok, sub)
	res, body = do(t, ts, "POST", "/api/v1/channels/"+sub+"/messages", bTok, map[string]any{
		"ciphertext":  envelopeFor(sub, epoch, "hello from the subchat"),
		"key_conv_id": sub, "key_epoch": epoch, "mentions": []string{}, "nonce": "n1",
	})
	if res.StatusCode != 201 {
		t.Fatalf("post in subchat: %d %v", res.StatusCode, body)
	}

	// asking a subchat about subchats answers about the conversation it is in
	res, list = do(t, ts, "GET", "/api/v1/channels/"+sub+"/subchats", aTok, nil)
	rows, _ = list["_list"].([]any)
	if res.StatusCode != 200 || len(rows) != 1 {
		t.Fatalf("siblings: %d %v", res.StatusCode, list)
	}

	// an outsider sees nothing
	cTok, _ := register(t, ts, "carol")
	res, _ = do(t, ts, "GET", "/api/v1/channels/"+sub+"/subchats", cTok, nil)
	if res.StatusCode != 404 {
		t.Errorf("outsider: %d", res.StatusCode)
	}
	res, _ = do(t, ts, "POST", "/api/v1/channels/"+dm+"/subchats", cTok, map[string]any{"name": "nope"})
	if res.StatusCode != 404 {
		t.Errorf("outsider create: %d", res.StatusCode)
	}
}

func TestSubchatNameAndLimits(t *testing.T) {
	_, ts := newTestServer(t)
	aTok, aID := register(t, ts, "alice")
	bTok, bID := register(t, ts, "bob")
	befriend(t, ts, aTok, bTok, "bob", aID)
	dm := dmBetween(t, ts, aTok, bID)

	for _, bad := range []string{"", "   "} {
		res, body := do(t, ts, "POST", "/api/v1/channels/"+dm+"/subchats", aTok, map[string]any{"name": bad})
		if res.StatusCode != 400 || errCode(body) != "invalid_name" {
			t.Errorf("name %q: %d %v", bad, res.StatusCode, body)
		}
	}
	res, body := do(t, ts, "POST", "/api/v1/channels/"+dm+"/subchats", aTok, map[string]any{"name": string(make([]byte, 0)) + longName(60)})
	if res.StatusCode != 400 {
		t.Errorf("an over-long name should be refused: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "POST", "/api/v1/channels/"+dm+"/subchats", aTok, map[string]any{"name": "Plans"})
	if res.StatusCode != 201 {
		t.Fatalf("create: %d %v", res.StatusCode, body)
	}
	sub := body["id"].(string)

	// either side of a one-to-one DM can rename or delete it
	res, body = do(t, ts, "PATCH", "/api/v1/channels/"+sub, bTok, map[string]any{"name": "New plans"})
	if res.StatusCode != 200 || body["name"] != "New plans" {
		t.Fatalf("rename: %d %v", res.StatusCode, body)
	}
	cTok, _ := register(t, ts, "carol")
	res, _ = do(t, ts, "DELETE", "/api/v1/channels/"+sub, cTok, nil)
	if res.StatusCode != 404 {
		t.Errorf("outsider delete: %d", res.StatusCode)
	}
	res, _ = do(t, ts, "DELETE", "/api/v1/channels/"+sub, bTok, nil)
	if res.StatusCode != 204 {
		t.Fatalf("delete: %d", res.StatusCode)
	}
	res, list := do(t, ts, "GET", "/api/v1/channels/"+dm+"/subchats", aTok, nil)
	rows, _ := list["_list"].([]any)
	if res.StatusCode != 200 || len(rows) != 0 {
		t.Fatalf("after delete: %d %v", res.StatusCode, list)
	}
}

func longName(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = 'x'
	}
	return string(b)
}

func TestSubchatsHaveNoCallOfTheirOwn(t *testing.T) {
	_, ts := newTestServer(t)
	aTok, aID := register(t, ts, "alice")
	bTok, bID := register(t, ts, "bob")
	befriend(t, ts, aTok, bTok, "bob", aID)
	dm := dmBetween(t, ts, aTok, bID)
	_, body := do(t, ts, "POST", "/api/v1/channels/"+dm+"/subchats", aTok, map[string]any{"name": "Plans"})
	sub := body["id"].(string)

	res, body := do(t, ts, "POST", "/api/v1/channels/"+sub+"/subchats", aTok, map[string]any{"name": "deeper"})
	if res.StatusCode != 201 {
		t.Fatalf("a subchat's siblings are made on the parent: %d %v", res.StatusCode, body)
	}
	if body["parent_id"] != dm {
		t.Errorf("subchats do not nest: %v", body["parent_id"])
	}
}
