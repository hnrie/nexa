package api

import (
	"encoding/base64"
	"testing"
	"time"
)

func TestQRSignInHandsTheSealedKeyToTheWaitingDevice(t *testing.T) {
	_, ts := newTestServer(t)
	token, id := register(t, ts, "rosa")
	pub := make([]byte, 32)
	res, req := do(t, ts, "POST", "/api/v1/auth/qr", "", map[string]any{"public_key": b64(pub)})
	if res.StatusCode != 200 {
		t.Fatalf("create: %d %v", res.StatusCode, req)
	}
	qid, poll := req["id"].(string), req["poll"].(string)
	path := "/api/v1/auth/qr/" + qid + "?poll=" + poll

	if _, b := do(t, ts, "GET", "/api/v1/auth/qr/"+qid+"?poll=wrong&seen=pending", "", nil); b["state"] != "expired" {
		t.Fatalf("a wrong poll secret saw it: %v", b)
	}
	if res, _ := do(t, ts, "POST", "/api/v1/auth/qr/"+qid+"/approve", token, map[string]any{"sealed_identity": b64([]byte("box"))}); res.StatusCode != 409 {
		t.Fatalf("approved before scanning: %d", res.StatusCode)
	}

	// the poll wakes when the phone scans
	got := make(chan map[string]any, 1)
	go func() {
		_, b := do(t, ts, "GET", path+"&seen=pending", "", nil)
		got <- b
	}()
	time.Sleep(100 * time.Millisecond)
	if res, b := do(t, ts, "POST", "/api/v1/auth/qr/"+qid+"/scan", token, nil); res.StatusCode != 200 || b["user_agent"] == nil {
		t.Fatalf("scan: %d %v", res.StatusCode, b)
	}
	select {
	case b := <-got:
		if b["state"] != "scanned" || b["user"].(map[string]any)["id"] != id {
			t.Fatalf("after the scan: %v", b)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the poll did not wake on the scan")
	}

	other, _ := register(t, ts, "sven")
	if res, _ := do(t, ts, "POST", "/api/v1/auth/qr/"+qid+"/approve", other, map[string]any{"sealed_identity": b64([]byte("box"))}); res.StatusCode != 409 {
		t.Fatalf("someone else approved it: %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "POST", "/api/v1/auth/qr/"+qid+"/approve", token, map[string]any{"sealed_identity": b64([]byte("box"))}); res.StatusCode != 204 {
		t.Fatalf("approve: %d", res.StatusCode)
	}
	_, b := do(t, ts, "GET", path+"&seen=scanned", "", nil)
	if b["state"] != "approved" || b["user"].(map[string]any)["id"] != id {
		t.Fatalf("approved: %v", b)
	}
	if box, _ := base64.StdEncoding.DecodeString(b["sealed_identity"].(string)); string(box) != "box" {
		t.Fatalf("box: %q", box)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/users/@me", b["token"].(string), nil); res.StatusCode != 200 {
		t.Fatalf("the new session does not work: %d", res.StatusCode)
	}
	// handed over once
	if _, b := do(t, ts, "GET", path+"&seen=scanned", "", nil); b["state"] != "expired" || b["token"] != nil {
		t.Fatalf("handed over twice: %v", b)
	}
}

func TestQRSignInCanBeDenied(t *testing.T) {
	_, ts := newTestServer(t)
	token, _ := register(t, ts, "tove")
	_, req := do(t, ts, "POST", "/api/v1/auth/qr", "", map[string]any{"public_key": b64(make([]byte, 32))})
	qid, poll := req["id"].(string), req["poll"].(string)
	do(t, ts, "POST", "/api/v1/auth/qr/"+qid+"/scan", token, nil)
	if res, _ := do(t, ts, "POST", "/api/v1/auth/qr/"+qid+"/deny", token, nil); res.StatusCode != 204 {
		t.Fatalf("deny: %d", res.StatusCode)
	}
	if _, b := do(t, ts, "GET", "/api/v1/auth/qr/"+qid+"?poll="+poll+"&seen=scanned", "", nil); b["state"] != "denied" || b["token"] != nil {
		t.Fatalf("denied: %v", b)
	}
	if res, _ := do(t, ts, "POST", "/api/v1/auth/qr/"+qid+"/approve", token, map[string]any{"sealed_identity": b64([]byte("box"))}); res.StatusCode != 404 {
		t.Fatalf("approved after a deny: %d", res.StatusCode)
	}
}
