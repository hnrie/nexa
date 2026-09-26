package api

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"evilion.xyz/chat/internal/perms"
)

func TestIsEmoji(t *testing.T) {
	good := []string{
		"🎉", "❤️", "☀", "⭐", "👍🏽", "1️⃣", "#️⃣", "🇯🇵", "🏳️‍🌈", "👩🏽‍💻",
		"👨‍👩‍👧‍👦", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "©️", "‼️", "🫶",
	}
	for _, s := range good {
		if !isEmoji(s) {
			t.Errorf("%q (%U) should be an emoji", s, []rune(s))
		}
	}
	bad := []string{
		"", "a", "ab", "general", "🎉🎉", "🎉 ", " 🎉", "🎉a", "1", "#", "‍🎉", "🎉‍", "🎉‍‍🎈",
		"‮🎉", "🎉‏", "️", "🏽", "🇯🇵🇺🇸", "\x00", "\n", "٣", "漢", strings.Repeat("👍🏽", 10),
	}
	for _, s := range bad {
		if isEmoji(s) {
			t.Errorf("%q (%U) should not be an emoji", s, []rune(s))
		}
	}
}

func TestChannelGlyphPatch(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, bobID := register(t, ts, "bob")
	view := createServer(t, ts, tokA, "Glyphs")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	join(t, ts, tokB, inviteFor(t, ts, tokA, general))
	gb := connectGW(t, ts, tokB)
	path := "/api/v1/channels/" + general

	// Everyone in the server sees the change as it happens.
	res, body := do(t, ts, "PATCH", path, tokA, map[string]any{"glyph": "icon:megaphone"})
	if res.StatusCode != 200 || body["glyph"] != "icon:megaphone" {
		t.Fatalf("set icon: %d %v", res.StatusCode, body)
	}
	if ev := gb.next("channel_update", 3*time.Second); ev == nil || ev["glyph"] != "icon:megaphone" {
		t.Fatalf("channel_update: %v", ev)
	}
	// And whoever loads the server afterwards gets it too.
	if res, body := do(t, ts, "GET", "/api/v1/servers/"+sid+"/channels", tokB, nil); res.StatusCode != 200 || !strings.Contains(asJSON(t, body["_list"]), `"glyph":"icon:megaphone"`) {
		t.Fatalf("channels: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PATCH", path, tokA, map[string]any{"glyph": "emoji:🎉"}); res.StatusCode != 200 || body["glyph"] != "emoji:🎉" {
		t.Fatalf("set emoji: %d %v", res.StatusCode, body)
	}

	// Only the forms the app draws, and only a single emoji.
	for _, g := range []string{"megaphone", "icon:", "icon:Mega", "icon:mega phone", "icon:-x", "icon:" + strings.Repeat("a", 33), "emoji:abc", "emoji:🎉🎉", "emoji:", "custom:nope", "custom:123", "url:https://example.com/x.png", strings.Repeat("x", 70)} {
		if res, body := do(t, ts, "PATCH", path, tokA, map[string]any{"glyph": g}); res.StatusCode != 400 || errCode(body) != "invalid_glyph" {
			t.Errorf("%q: %d %v", g, res.StatusCode, body)
		}
	}

	// One of this server's custom emoji is fine; another server's is not.
	res2, raw := rawPost(t, ts.URL+"/api/v1/servers/"+sid+"/emojis?name=party", tokA, "image/png", pngBytes(32, 32))
	if res2.StatusCode != 201 {
		t.Fatalf("emoji upload: %d %s", res2.StatusCode, raw)
	}
	var own map[string]any
	_ = json.Unmarshal(raw, &own)
	other := createServer(t, ts, tokA, "Other")
	res3, raw3 := rawPost(t, ts.URL+"/api/v1/servers/"+other["id"].(string)+"/emojis?name=elsewhere", tokA, "image/png", pngBytes(32, 32))
	if res3.StatusCode != 201 {
		t.Fatalf("other emoji upload: %d %s", res3.StatusCode, raw3)
	}
	var foreign map[string]any
	_ = json.Unmarshal(raw3, &foreign)
	if res, body := do(t, ts, "PATCH", path, tokA, map[string]any{"glyph": "custom:" + own["id"].(string)}); res.StatusCode != 200 || body["glyph"] != "custom:"+own["id"].(string) {
		t.Fatalf("own custom emoji: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PATCH", path, tokA, map[string]any{"glyph": "custom:" + foreign["id"].(string)}); res.StatusCode != 400 {
		t.Fatalf("another server's emoji: %d %v", res.StatusCode, body)
	}

	// Setting it takes Manage Channels.
	if res, _ := do(t, ts, "PATCH", path, tokB, map[string]any{"glyph": "icon:star"}); res.StatusCode != 403 {
		t.Errorf("member without Manage Channels: %d", res.StatusCode)
	}
	role := createRole(t, ts, tokA, sid, "Channel Keeper", perms.ManageChannels)
	if res, body := do(t, ts, "PUT", "/api/v1/servers/"+sid+"/members/"+bobID+"/roles/"+role, tokA, nil); res.StatusCode != 200 {
		t.Fatalf("give role: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PATCH", path, tokB, map[string]any{"glyph": "icon:star"}); res.StatusCode != 200 || body["glyph"] != "icon:star" {
		t.Errorf("with Manage Channels: %d %v", res.StatusCode, body)
	}

	// An empty one puts the default back, and the field is left out.
	res, body = do(t, ts, "PATCH", path, tokA, map[string]any{"glyph": ""})
	if res.StatusCode != 200 {
		t.Fatalf("clear: %d %v", res.StatusCode, body)
	}
	if _, has := body["glyph"]; has {
		t.Errorf("cleared icon still in the channel: %v", body["glyph"])
	}
}

func asJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
