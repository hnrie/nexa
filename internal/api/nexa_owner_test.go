package api

import (
	"testing"
	"time"
)

// Every account learns who owns Nexa, not only the staff: the app
// crowns the owner in anyone's list of conversations.
func TestNexaStateNamesTheOwnerToEveryone(t *testing.T) {
	_, ts := newTestServer(t)
	ownTok, ownID := register(t, ts, "owner")
	tok, _ := register(t, ts, "member")
	member := meNexa(t, ts, tok)
	if member["owner_id"] != ownID {
		t.Errorf("member's owner_id: %v, want %s", member["owner_id"], ownID)
	}
	if member["staff"] != nil {
		t.Errorf("a member sees the staff's queue: %v", member["staff"])
	}
	owner := meNexa(t, ts, ownTok)
	if owner["owner_id"] != ownID || owner["staff"].(map[string]any)["owner_id"] != ownID {
		t.Errorf("owner's own state: %v", owner)
	}
	// and it comes with ready too
	gw := connectGWReady(t, ts, tok)
	if gw.ready == nil {
		t.Fatal("no ready")
	}
	if nexa, _ := gw.ready["nexa"].(map[string]any); nexa == nil || nexa["owner_id"] != ownID {
		t.Errorf("ready's nexa: %v", gw.ready["nexa"])
	}
}

// A staff reply is something new from Nexa: it moves the member's Nexa
// conversation up their list and brings it back if they had closed it.
func TestStaffReplyIsNexaActivity(t *testing.T) {
	_, ts := newTestServer(t)
	modTok, _ := register(t, ts, "owner")
	tok, id := register(t, ts, "member")
	c := mustAct(t, ts, modTok, id, map[string]any{"action": "mute", "reason": "please be kind", "duration_ms": 3600000})
	before := meNexa(t, ts, tok)["latest"].(float64)
	if before == 0 {
		t.Fatal("a mute is not Nexa activity")
	}
	time.Sleep(5 * time.Millisecond)
	if res, body := do(t, ts, "POST", "/api/v1/moderation/cases/"+c["id"].(string)+"/messages", modTok, map[string]any{"body": "Just checking in."}); res.StatusCode != 201 {
		t.Fatalf("staff reply: %d %v", res.StatusCode, body)
	}
	if after := meNexa(t, ts, tok)["latest"].(float64); after <= before {
		t.Errorf("latest after a staff reply: %v, before it: %v", after, before)
	}
}

// Reading the Nexa conversation reads everything it counts as waiting: its
// notices, and what the team wrote in the member's case threads and bug
// reports. A thread only opening it could read kept the conversation's count
// up however often the conversation itself was read.
func TestNexaSeenReadsThreads(t *testing.T) {
	_, ts := newTestServer(t)
	modTok, _ := register(t, ts, "owner")
	tok, id := register(t, ts, "member")
	c := mustAct(t, ts, modTok, id, map[string]any{"action": "mute", "reason": "please be kind", "duration_ms": 3600000})
	if res, body := do(t, ts, "POST", "/api/v1/moderation/cases/"+c["id"].(string)+"/messages", modTok, map[string]any{"body": "Just checking in."}); res.StatusCode != 201 {
		t.Fatalf("staff reply in the case: %d %v", res.StatusCode, body)
	}
	report := mustBug(t, ts, tok, bugBody("The button"))
	if res, body := do(t, ts, "POST", "/api/v1/moderation/bugs/"+report["id"].(string)+"/messages", modTok, map[string]any{"body": "Thanks, looking into it."}); res.StatusCode != 201 {
		t.Fatalf("staff reply in the report: %d %v", res.StatusCode, body)
	}
	// the notice, the reply in its thread and the reply to the report
	if st := meNexa(t, ts, tok); st["unread"].(float64) != 3 {
		t.Fatalf("unread before reading: %v", st["unread"])
	}
	if res, _ := do(t, ts, "POST", "/api/v1/nexa/seen", tok, nil); res.StatusCode != 204 {
		t.Fatal("seen")
	}
	if st := meNexa(t, ts, tok); st["unread"].(float64) != 0 {
		t.Errorf("unread after reading the conversation: %v", st["unread"])
	}
	if _, body := do(t, ts, "GET", "/api/v1/nexa/cases/"+c["id"].(string), tok, nil); body["case"].(map[string]any)["unread"].(float64) != 0 {
		t.Errorf("case thread still unread: %v", body["case"])
	}
	if _, body := do(t, ts, "GET", "/api/v1/bugs/"+report["id"].(string), tok, nil); body["report"].(map[string]any)["unread"].(float64) != 0 {
		t.Errorf("bug report still unread: %v", body["report"])
	}
	// something the team writes afterwards is news again
	if res, body := do(t, ts, "POST", "/api/v1/moderation/bugs/"+report["id"].(string)+"/messages", modTok, map[string]any{"body": "Fixed in the next version."}); res.StatusCode != 201 {
		t.Fatalf("second staff reply: %d %v", res.StatusCode, body)
	}
	if st := meNexa(t, ts, tok); st["unread"].(float64) != 1 {
		t.Errorf("unread after a new reply: %v", st["unread"])
	}
	// and reading up to a moment before it leaves it waiting
	if res, _ := do(t, ts, "POST", "/api/v1/nexa/seen", tok, map[string]any{"at": 1}); res.StatusCode != 204 {
		t.Fatal("seen at a moment")
	}
	if st := meNexa(t, ts, tok); st["unread"].(float64) != 1 {
		t.Errorf("reading up to an earlier moment read a later reply: %v", st["unread"])
	}
}
