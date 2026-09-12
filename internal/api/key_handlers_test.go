package api

import (
	"testing"
)

func TestKeyGrantsAndNeeds(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	tokC, idC := register(t, ts, "carol")
	_, idD := register(t, ts, "dave")
	friend(t, ts, tokA, "bob", tokB, idA)
	friend(t, ts, tokA, "carol", tokC, idA)
	_, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idB, idC}})
	g := body["id"].(string)
	// non-member cannot create an epoch
	if res, _ := do(t, ts, "POST", "/api/v1/keys/epochs", tokB, map[string]any{"conv_id": "999"}); res.StatusCode != 404 {
		t.Error("unknown conv")
	}
	res, body := do(t, ts, "POST", "/api/v1/keys/epochs", tokA, map[string]any{"conv_id": g})
	if res.StatusCode != 201 || body["epoch"].(float64) != 0 || len(body["user_ids"].([]any)) != 3 {
		t.Fatalf("epoch: %d %v", res.StatusCode, body)
	}
	// bob holds nothing yet → cannot grant
	if res, body = do(t, ts, "POST", "/api/v1/keys/grants", tokB, []map[string]any{{"conv_id": g, "epoch": 0, "user_id": idC, "wrapped_key": b64([]byte("x"))}}); res.StatusCode != 403 || errCode(body) != "not_holder" {
		t.Errorf("non-holder grant: %d %v", res.StatusCode, body)
	}
	// alice self-grants
	if res, body = do(t, ts, "POST", "/api/v1/keys/grants", tokA, []map[string]any{{"conv_id": g, "epoch": 0, "user_id": idA, "wrapped_key": b64([]byte("a"))}}); res.StatusCode != 200 || body["inserted"].(float64) != 1 {
		t.Fatalf("self grant: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/keys/needs", tokA, nil)
	needs := body["_list"].([]any)
	if res.StatusCode != 200 || len(needs) != 1 || len(needs[0].(map[string]any)["user_ids"].([]any)) != 2 {
		t.Fatalf("needs: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "POST", "/api/v1/keys/grants", tokA, []map[string]any{{"conv_id": g, "epoch": 0, "user_id": idD, "wrapped_key": b64([]byte("d"))}}); res.StatusCode != 403 || errCode(body) != "not_entitled" {
		t.Errorf("grant to outsider: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "POST", "/api/v1/keys/grants", tokA, []map[string]any{{"conv_id": g, "epoch": 0, "user_id": idB, "wrapped_key": b64([]byte("b"))}}); res.StatusCode != 200 || body["inserted"].(float64) != 1 {
		t.Fatalf("grant bob: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/keys/grants", tokB, nil)
	if l := body["_list"].([]any); len(l) != 1 || l[0].(map[string]any)["wrapped_key"] != b64([]byte("b")) || l[0].(map[string]any)["wrapped_by"] != idA {
		t.Errorf("bob's grants: %v", body)
	}
	// bob now holds the latest epoch and can grant carol
	if res, body = do(t, ts, "POST", "/api/v1/keys/grants", tokB, []map[string]any{{"conv_id": g, "epoch": 0, "user_id": idC, "wrapped_key": b64([]byte("c"))}}); res.StatusCode != 200 {
		t.Errorf("bob grants carol: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/keys/needs", tokA, nil)
	if len(body["_list"].([]any)) != 0 {
		t.Errorf("no more needs: %v", body)
	}
	// rotation
	res, body = do(t, ts, "POST", "/api/v1/keys/epochs", tokB, map[string]any{"conv_id": g, "reason": "manual"})
	if res.StatusCode != 201 || body["epoch"].(float64) != 1 {
		t.Fatalf("rotate: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/keys/epochs?conv_id="+g, tokC, nil)
	if res.StatusCode != 200 || len(body["epochs"].([]any)) != 2 || body["flags"].(map[string]any)["needs_rotation"] != false {
		t.Errorf("epochs: %d %v", res.StatusCode, body)
	}
	if res, _ = do(t, ts, "GET", "/api/v1/keys/epochs?conv_id="+g, "", nil); res.StatusCode != 401 {
		t.Error("auth required")
	}
	res, body = do(t, ts, "POST", "/api/v1/keys/grants", tokA, []map[string]any{{"conv_id": g, "epoch": 0, "user_id": idB, "wrapped_key": b64(make([]byte, 600))}})
	if res.StatusCode != 400 {
		t.Errorf("oversized grant: %d %v", res.StatusCode, body)
	}
}
