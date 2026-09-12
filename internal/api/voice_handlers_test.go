package api

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"evilion.xyz/chat/internal/perms"
)

// op sends a gateway op frame from a test client.
func (g *gw) op(t *testing.T, op string, d any) {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"op": op, "d": d})
	if err := g.ws.Write(context.Background(), 1, b); err != nil {
		t.Fatal(err)
	}
}

func TestVoiceChannels(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	tokC, idC := register(t, ts, "carol")
	view := createServer(t, ts, tokA, "Voice")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	voiceCh := channelNamed(view, "General")["id"].(string)
	code := inviteFor(t, ts, tokA, general)
	join(t, ts, tokB, code)
	join(t, ts, tokC, code)
	ga := connectGW(t, ts, tokA)
	gb := connectGW(t, ts, tokB)
	gc := connectGW(t, ts, tokC)

	// ICE config is available to members
	res, body := do(t, ts, "GET", "/api/v1/voice/ice", tokA, nil)
	if res.StatusCode != 200 || len(body["ice_servers"].([]any)) < 1 {
		t.Fatalf("ice: %d %v", res.StatusCode, body)
	}
	// text channels are not joinable
	ga.op(t, "voice_state", map[string]any{"channel_id": general})
	if ev := ga.next("voice_error", 3*time.Second); ev == nil || ev["code"] != "not_voice" {
		t.Errorf("join text channel: %v", ev)
	}
	// alice joins; everyone who sees the channel hears it
	ga.op(t, "voice_state", map[string]any{"channel_id": voiceCh, "self_mute": true})
	for _, g := range []*gw{ga, gb, gc} {
		ev := g.next("voice_state", 3*time.Second)
		if ev == nil || ev["user_id"] != idA || ev["channel_id"] != voiceCh || ev["self_mute"] != true {
			t.Fatalf("join event: %v", ev)
		}
	}
	// bob joins and signals alice; carol cannot signal without being in voice
	gb.op(t, "voice_state", map[string]any{"channel_id": voiceCh})
	if ev := ga.next("voice_state", 3*time.Second); ev == nil || ev["user_id"] != idB {
		t.Fatal("bob join event")
	}
	gb.next("voice_state", 3*time.Second)
	gc.next("voice_state", 3*time.Second)
	gb.op(t, "voice_signal", map[string]any{"to": idA, "payload": map[string]any{"type": "offer", "sdp": "v=0"}})
	ev := ga.next("voice_signal", 3*time.Second)
	if ev == nil || ev["from"] != idB || ev["payload"].(map[string]any)["sdp"] != "v=0" {
		t.Fatalf("signal relay: %v", ev)
	}
	gc.op(t, "voice_signal", map[string]any{"to": idA, "payload": map[string]any{}})
	if ev := gc.next("voice_error", 3*time.Second); ev == nil || ev["code"] != "not_in_voice" {
		t.Errorf("signal outside voice: %v", ev)
	}
	// participants endpoint and a fresh ready payload carry both states
	res, body = do(t, ts, "GET", "/api/v1/channels/"+voiceCh+"/voice", tokC, nil)
	if res.StatusCode != 200 || len(body["_list"].([]any)) != 2 {
		t.Errorf("participants: %d %v", res.StatusCode, body)
	}
	gc2 := connectGWReady(t, ts, tokC)
	if n := len(gc2.ready["voice_states"].([]any)); n != 2 {
		t.Errorf("ready voice states: %d", n)
	}
	// user limit: 2 → carol is refused, but the owner (Move Members) is not
	if res, _ = do(t, ts, "PATCH", "/api/v1/channels/"+voiceCh, tokA, map[string]any{"user_limit": 2}); res.StatusCode != 200 {
		t.Fatal("set limit")
	}
	gc.op(t, "voice_state", map[string]any{"channel_id": voiceCh})
	if ev := gc.next("voice_error", 3*time.Second); ev == nil || ev["code"] != "channel_full" {
		t.Errorf("full channel: %v", ev)
	}
	// moderation: alice server-mutes bob, then moves him to a new channel
	if res, body = do(t, ts, "PATCH", "/api/v1/servers/"+sid+"/members/"+idB+"/voice", tokC, map[string]any{"mute": true}); res.StatusCode != 403 {
		t.Errorf("member mutes: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "PATCH", "/api/v1/servers/"+sid+"/members/"+idB+"/voice", tokA, map[string]any{"mute": true})
	if res.StatusCode != 200 || body["server_mute"] != true {
		t.Fatalf("server mute: %d %v", res.StatusCode, body)
	}
	if ev := gb.next("voice_state", 3*time.Second); ev == nil || ev["server_mute"] != true {
		t.Errorf("mute event: %v", ev)
	}
	res, body = do(t, ts, "POST", "/api/v1/servers/"+sid+"/channels", tokA, map[string]any{"type": "voice", "name": "Lounge"})
	lounge := body["id"].(string)
	for _, g := range []*gw{ga, gb, gc} {
		g.next("channel_create", 3*time.Second)
	}
	res, body = do(t, ts, "PATCH", "/api/v1/servers/"+sid+"/members/"+idB+"/voice", tokA, map[string]any{"channel_id": lounge})
	if res.StatusCode != 200 || body["channel_id"] != lounge || body["server_mute"] != true {
		t.Fatalf("move: %d %v", res.StatusCode, body)
	}
	// the move shows up as a leave from General and a join to Lounge
	saw := map[string]bool{}
	for i := 0; i < 2; i++ {
		ev := gc.next("voice_state", 3*time.Second)
		if ev == nil {
			t.Fatal("move events")
		}
		if ev["channel_id"] == nil {
			saw["leave"] = ev["old_channel_id"] == voiceCh
		} else {
			saw["join"] = ev["channel_id"] == lounge
		}
	}
	if !saw["leave"] || !saw["join"] {
		t.Errorf("move events: %v", saw)
	}
	for i := 0; i < 2; i++ {
		ga.next("voice_state", 3*time.Second) // alice's copies of the move
	}
	// disconnecting bob's gateway clears his state
	gb.close()
	if ev := ga.next("voice_state", 3*time.Second); ev == nil || ev["user_id"] != idB || ev["channel_id"] != nil {
		t.Errorf("leave on disconnect: %v", ev)
	}
	// deleting the channel alice is in kicks her out
	if res, _ = do(t, ts, "DELETE", "/api/v1/channels/"+voiceCh, tokA, nil); res.StatusCode != 204 {
		t.Fatal("delete voice channel")
	}
	if ev := ga.next("voice_state", 3*time.Second); ev == nil || ev["user_id"] != idA || ev["channel_id"] != nil {
		t.Errorf("leave on delete: %v", ev)
	}
	_ = idC
	_ = perms.Connect
}

func TestDMCalls(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	friend(t, ts, tokA, "bob", tokB, idA)
	_, body := do(t, ts, "POST", "/api/v1/users/@me/channels", tokA, map[string]any{"recipient_ids": []string{idB}})
	dm := body["id"].(string)
	ga := connectGW(t, ts, tokA)
	gb := connectGW(t, ts, tokB)
	// alice starts a call by joining the DM's voice: bob rings, a system message lands
	ga.op(t, "voice_state", map[string]any{"channel_id": dm})
	if ev := gb.next("call_ring", 3*time.Second); ev == nil || ev["from"] != idA || ev["channel_id"] != dm {
		t.Fatalf("ring: %v", ev)
	}
	if ev := gb.next("message_create", 3*time.Second); ev == nil || ev["type"] != "system_call" {
		t.Errorf("call system message: %v", ev)
	}
	// bob declines: alice hears it
	if res, _ := do(t, ts, "POST", "/api/v1/channels/"+dm+"/call/decline", tokB, nil); res.StatusCode != 204 {
		t.Fatal("decline")
	}
	if ev := ga.next("call_end", 3*time.Second); ev == nil || ev["reason"] != "declined" || ev["user_id"] != idB {
		t.Errorf("decline event: %v", ev)
	}
	gb.next("call_end", 3*time.Second) // bob hears his own decline too
	// bob joins after all; then everyone leaves and the call ends
	gb.op(t, "voice_state", map[string]any{"channel_id": dm})
	if ev := ga.next("voice_state", 3*time.Second); ev == nil || ev["user_id"] != idB {
		t.Fatal("bob joins call")
	}
	ga.op(t, "voice_state", map[string]any{"channel_id": nil})
	gb.op(t, "voice_state", map[string]any{"channel_id": nil})
	if ev := gb.next("call_end", 5*time.Second); ev == nil || ev["reason"] != "ended" {
		t.Errorf("call end: %v", ev)
	}
	// an outsider cannot join a DM call
	tokC, _ := register(t, ts, "carol")
	gc := connectGW(t, ts, tokC)
	gc.op(t, "voice_state", map[string]any{"channel_id": dm})
	if ev := gc.next("voice_error", 3*time.Second); ev == nil || ev["code"] != "not_found" {
		t.Errorf("outsider join: %v", ev)
	}
}
