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
