package api

import (
	"testing"
	"time"

	"evilion.xyz/chat/internal/perms"
)

// TestEmbedLinksHeldByTheServer checks that a member without Embed Links
// sends messages the server flags to hide their previews, and that neither
// an edit nor asking to show them takes the flag off.
func TestEmbedLinksHeldByTheServer(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, _ := register(t, ts, "bob")
	view := createServer(t, ts, tokA, "Embeds")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	join(t, ts, tokB, inviteFor(t, ts, tokA, general))
	createEpoch(t, ts, tokA, sid)

	_, body := sendMsg(t, ts, tokB, general, sid, 0, "https://example.com", "", nil)
	if int64(body["flags"].(float64))&4 != 0 {
		t.Errorf("allowed by default: %v", body)
	}
	if res, body := do(t, ts, "PUT", "/api/v1/channels/"+general+"/permissions/"+sid, tokA, map[string]any{"type": "role", "deny": permStr(perms.EmbedLinks)}); res.StatusCode != 200 {
		t.Fatalf("deny: %d %v", res.StatusCode, body)
	}
	_, body = sendMsg(t, ts, tokB, general, sid, 0, "https://example.com", "", nil)
	mid := body["id"].(string)
	if int64(body["flags"].(float64))&4 == 0 {
		t.Errorf("flagged without Embed Links: %v", body)
	}
	res, body := do(t, ts, "PATCH", "/api/v1/channels/"+general+"/messages/"+mid, tokB, map[string]any{"flags": 0})
	if res.StatusCode != 200 || int64(body["flags"].(float64))&4 == 0 {
		t.Errorf("the flag stays: %d %v", res.StatusCode, body)
	}
	// an older message edited without the permission is flagged too
	if res, _ := do(t, ts, "DELETE", "/api/v1/channels/"+general+"/permissions/"+sid, tokA, nil); res.StatusCode != 204 {
		t.Fatal("lift")
	}
	_, body = sendMsg(t, ts, tokB, general, sid, 0, "plain", "", nil)
	plain := body["id"].(string)
	do(t, ts, "PUT", "/api/v1/channels/"+general+"/permissions/"+sid, tokA, map[string]any{"type": "role", "deny": permStr(perms.EmbedLinks)})
	res, body = do(t, ts, "PATCH", "/api/v1/channels/"+general+"/messages/"+plain, tokB, map[string]any{"ciphertext": envelopeFor(sid, 0, "https://example.com"), "key_conv_id": sid, "key_epoch": 0})
	if res.StatusCode != 200 || int64(body["flags"].(float64))&4 == 0 {
		t.Errorf("edit flagged: %d %v", res.StatusCode, body)
	}
}

// TestReactionsAndHistoryAsDiscord checks that without Add Reactions one can
// still join a reaction that is there, and that without Read Message History
// a channel's history answers as empty rather than an error.
func TestReactionsAndHistoryAsDiscord(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, _ := register(t, ts, "bob")
	view := createServer(t, ts, tokA, "React")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	join(t, ts, tokB, inviteFor(t, ts, tokA, general))
	createEpoch(t, ts, tokA, sid)
	_, body := sendMsg(t, ts, tokA, general, sid, 0, "hi", "", nil)
	mid := body["id"].(string)
	react := func(tok, emoji string) int {
		res, _ := do(t, ts, "PUT", "/api/v1/channels/"+general+"/messages/"+mid+"/reactions/"+emoji+"/@me", tok, nil)
		return res.StatusCode
	}
	if c := react(tokA, "%F0%9F%91%8D"); c != 204 {
		t.Fatalf("alice reacts: %d", c)
	}
	do(t, ts, "PUT", "/api/v1/channels/"+general+"/permissions/"+sid, tokA, map[string]any{"type": "role", "deny": permStr(perms.AddReactions)})
	if c := react(tokB, "%F0%9F%91%8D"); c != 204 {
		t.Errorf("joining a reaction needs no Add Reactions: %d", c)
	}
	if c := react(tokB, "%F0%9F%8E%89"); c != 403 {
		t.Errorf("a new one does: %d", c)
	}
	do(t, ts, "PUT", "/api/v1/channels/"+general+"/permissions/"+sid, tokA, map[string]any{"type": "role", "deny": permStr(perms.ReadMessageHistory)})
	res, list := do(t, ts, "GET", "/api/v1/channels/"+general+"/messages", tokB, nil)
	if res.StatusCode != 200 || len(list["_list"].([]any)) != 0 {
		t.Errorf("no history, no error: %d %v", res.StatusCode, list)
	}
}

// TestCategorySync checks Discord's category sync: a channel made in a
// category takes its overwrites, a synced channel follows the category, one
// changed on its own does not until synced again, and a synced channel moved
// into another category takes that one's.
func TestCategorySync(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	view := createServer(t, ts, tokA, "Sync")
	sid := view["id"].(string)
	mk := func(body map[string]any) string {
		res, b := do(t, ts, "POST", "/api/v1/servers/"+sid+"/channels", tokA, body)
		if res.StatusCode != 201 {
			t.Fatalf("create: %d %v", res.StatusCode, b)
		}
		return b["id"].(string)
	}
	overwrites := func(id string) []any {
		_, list := do(t, ts, "GET", "/api/v1/servers/"+sid+"/channels", tokA, nil)
		for _, c := range list["_list"].([]any) {
			if m := c.(map[string]any); m["id"] == id {
				list, _ := m["overwrites"].([]any)
				return list
			}
		}
		t.Fatalf("no channel %s", id)
		return nil
	}
	staff := mk(map[string]any{"type": "category", "name": "Staff"})
	other := mk(map[string]any{"type": "category", "name": "Other"})
	if res, b := do(t, ts, "PUT", "/api/v1/channels/"+staff+"/permissions/"+sid, tokA, map[string]any{"type": "role", "deny": permStr(perms.ViewChannel)}); res.StatusCode != 200 {
		t.Fatalf("category deny: %d %v", res.StatusCode, b)
	}
	res, b := do(t, ts, "POST", "/api/v1/servers/"+sid+"/channels", tokA, map[string]any{"type": "text", "name": "mods", "parent_id": staff})
	if res.StatusCode != 201 || b["key_actions"] == nil {
		t.Fatalf("made private by its category: %d %v", res.StatusCode, b)
	}
	mods := b["id"].(string)
	if len(overwrites(mods)) != 1 {
		t.Fatalf("starts synced: %v", overwrites(mods))
	}
	// the category changes: the synced channel follows
	do(t, ts, "PUT", "/api/v1/channels/"+staff+"/permissions/"+sid, tokA, map[string]any{"type": "role", "deny": permStr(perms.ViewChannel | perms.SendMessages)})
	if ow := overwrites(mods)[0].(map[string]any); ow["deny"] != permStr(perms.ViewChannel|perms.SendMessages) {
		t.Errorf("follows: %v", ow)
	}
	// changed on its own, it stops following
	do(t, ts, "PUT", "/api/v1/channels/"+mods+"/permissions/"+sid, tokA, map[string]any{"type": "role", "deny": permStr(perms.ViewChannel)})
	do(t, ts, "DELETE", "/api/v1/channels/"+staff+"/permissions/"+sid, tokA, nil)
	if len(overwrites(mods)) != 1 {
		t.Errorf("not synced, kept: %v", overwrites(mods))
	}
	// Sync Now
	if res, b := do(t, ts, "POST", "/api/v1/channels/"+mods+"/permissions/sync", tokA, nil); res.StatusCode != 200 {
		t.Fatalf("sync: %d %v", res.StatusCode, b)
	}
	if len(overwrites(mods)) != 0 {
		t.Errorf("synced: %v", overwrites(mods))
	}
	// a synced channel moved into another category takes its overwrites
	do(t, ts, "PUT", "/api/v1/channels/"+other+"/permissions/"+sid, tokA, map[string]any{"type": "role", "deny": permStr(perms.AddReactions)})
	if res, b := do(t, ts, "PATCH", "/api/v1/servers/"+sid+"/channels", tokA, []map[string]any{{"id": mods, "position": 0, "parent_id": other}}); res.StatusCode != 200 {
		t.Fatalf("move: %d %v", res.StatusCode, b)
	}
	if ow := overwrites(mods); len(ow) != 1 || ow[0].(map[string]any)["deny"] != permStr(perms.AddReactions) {
		t.Errorf("moved and synced: %v", ow)
	}
}

// TestVideoNeedsStream checks that without Video a camera or share is not
// said to be on.
func TestVideoNeedsStream(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, idB := register(t, ts, "bob")
	view := createServer(t, ts, tokA, "Video")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	voiceCh := channelNamed(view, "General")["id"].(string)
	join(t, ts, tokB, inviteFor(t, ts, tokA, general))
	do(t, ts, "PUT", "/api/v1/channels/"+voiceCh+"/permissions/"+sid, tokA, map[string]any{"type": "role", "deny": permStr(perms.Stream)})
	gb := connectGW(t, ts, tokB)
	gb.op(t, "voice_state", map[string]any{"channel_id": voiceCh, "video": true, "streaming": true})
	if ev := gb.nextVoice(idB, voiceCh, 3*time.Second); ev == nil || ev["video"] != false || ev["streaming"] != false {
		t.Errorf("no Video, no camera or share: %v", ev)
	}
}
