package api

import (
	"net/url"
	"testing"

	"evilion.xyz/chat/internal/botproto"
	"evilion.xyz/chat/internal/perms"
)

func TestBotVoiceChannelChat(t *testing.T) {
	_, ts := newTestServer(t)
	tok, _ := register(t, ts, "alice")
	view := createServer(t, ts, tok, "Voice Chat")
	sid := view["id"].(string)
	app, token := makeApp(t, ts, tok, "Voice Bot")
	// No administrator role: channel overwrites must actually apply.
	query := url.Values{"client_id": {app["id"].(string)}, "scope": {"bot"}, "permissions": {"0"}}
	if res, body := do(t, ts, "POST", "/api/v1/oauth2/authorize", tok, map[string]any{"query": query.Encode(), "guild_id": sid}); res.StatusCode != 200 {
		t.Fatalf("install: %d %v", res.StatusCode, body)
	}
	res, voice := do(t, ts, "POST", "/api/v1/servers/"+sid+"/channels", tok, map[string]any{"name": "Lounge", "type": "voice"})
	if res.StatusCode != 201 {
		t.Fatalf("voice: %d %v", res.StatusCode, voice)
	}
	cid := voice["id"].(string)
	path := "/api/v10/channels/" + botproto.OutString(snowID(t, cid))
	res, sent := botDo(t, ts, "POST", path+"/messages", token, map[string]any{"content": "hello in voice"})
	if res.StatusCode != 200 || sent["content"] != "hello in voice" {
		t.Fatalf("send: %d %v", res.StatusCode, sent)
	}
	mid := sent["id"].(string)
	for _, suffix := range []string{"/messages", "/messages/" + mid} {
		if res, body := botDo(t, ts, "GET", path+suffix, token, nil); res.StatusCode != 200 {
			t.Fatalf("read %s: %d %v", suffix, res.StatusCode, body)
		}
	}
	overwrite := func(deny perms.Perm) {
		t.Helper()
		res, body := do(t, ts, "PUT", "/api/v1/channels/"+cid+"/permissions/"+app["id"].(string), tok, map[string]any{"type": "member", "deny": permStr(deny)})
		if res.StatusCode != 200 {
			t.Fatalf("overwrite: %d %v", res.StatusCode, body)
		}
	}
	overwrite(perms.Connect)
	for _, suffix := range []string{"/messages", "/messages/" + mid} {
		if res, body := botDo(t, ts, "GET", path+suffix, token, nil); res.StatusCode != 403 || body["code"] != float64(50013) {
			t.Fatalf("history without Connect %s: %d %v", suffix, res.StatusCode, body)
		}
	}
	overwrite(perms.SendMessages)
	if res, body := botDo(t, ts, "POST", path+"/messages", token, map[string]any{"content": "denied"}); res.StatusCode != 403 || body["code"] != float64(50013) {
		t.Fatalf("send denied: %d %v", res.StatusCode, body)
	}
	overwrite(perms.ViewChannel)
	if res, body := botDo(t, ts, "POST", path+"/messages", token, map[string]any{"content": "hidden"}); res.StatusCode != 403 || body["code"] != float64(50001) {
		t.Fatalf("hidden: %d %v", res.StatusCode, body)
	}
	// Categories remain non-messageable.
	res, category := do(t, ts, "POST", "/api/v1/servers/"+sid+"/channels", tok, map[string]any{"name": "Rooms", "type": "category"})
	if res.StatusCode != 201 {
		t.Fatalf("category: %d %v", res.StatusCode, category)
	}
	catPath := "/api/v10/channels/" + botproto.OutString(snowID(t, category["id"].(string))) + "/messages"
	if res, body := botDo(t, ts, "POST", catPath, token, map[string]any{"content": "no"}); res.StatusCode != 400 || body["code"] != float64(50008) {
		t.Fatalf("category send: %d %v", res.StatusCode, body)
	}
}
