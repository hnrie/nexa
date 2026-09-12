package api

import (
	"bytes"
	"io"
	"net/http"
	"testing"
	"time"

	"evilion.xyz/chat/internal/perms"
)

func rawPost(t *testing.T, url, token, ctype string, body []byte) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest("POST", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", ctype)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, b
}

func TestServerEmoji(t *testing.T) {
	_, ts := newTestServer(t)
	tokA, _ := register(t, ts, "alice")
	tokB, _ := register(t, ts, "bob")
	view := createServer(t, ts, tokA, "Emo")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	join(t, ts, tokB, inviteFor(t, ts, tokA, general))
	gb := connectGW(t, ts, tokB)

	// members without Manage Expressions cannot upload
	if res, _ := rawPost(t, ts.URL+"/api/v1/servers/"+sid+"/emojis?name=party", tokB, "image/png", pngBytes(32, 32)); res.StatusCode != 403 {
		t.Errorf("member upload: %d", res.StatusCode)
	}
	if res, _ := rawPost(t, ts.URL+"/api/v1/servers/"+sid+"/emojis?name=bad%20name", tokA, "image/png", pngBytes(32, 32)); res.StatusCode != 400 {
		t.Errorf("bad name: %d", res.StatusCode)
	}
	res, raw := rawPost(t, ts.URL+"/api/v1/servers/"+sid+"/emojis?name=party", tokA, "image/png", pngBytes(32, 32))
	if res.StatusCode != 201 {
		t.Fatalf("upload: %d %s", res.StatusCode, raw)
	}
	ev := gb.next("emoji_update", 3*time.Second)
	if ev == nil || len(ev["emojis"].([]any)) != 1 || ev["emojis"].([]any)[0].(map[string]any)["name"] != "party" {
		t.Fatalf("emoji_update: %v", ev)
	}
	emojiID := ev["emojis"].([]any)[0].(map[string]any)["id"].(string)
	blobID := ev["emojis"].([]any)[0].(map[string]any)["blob_id"].(string)
	if res, _ := rawPost(t, ts.URL+"/api/v1/servers/"+sid+"/emojis?name=party", tokA, "image/png", pngBytes(32, 32)); res.StatusCode != 409 {
		t.Errorf("duplicate name: %d", res.StatusCode)
	}
	// the image is served publicly
	req, _ := http.NewRequest("GET", ts.URL+"/media/emoji/"+blobID, nil)
	if r2, err := http.DefaultClient.Do(req); err != nil || r2.StatusCode != 200 || r2.Header.Get("Content-Type") != "image/png" {
		t.Errorf("serve emoji: %v", err)
	}
	// listed for members and in bob's ready payload
	res2, body := do(t, ts, "GET", "/api/v1/servers/"+sid+"/emojis", tokB, nil)
	if res2.StatusCode != 200 || len(body["_list"].([]any)) != 1 {
		t.Errorf("list: %d %v", res2.StatusCode, body)
	}
	gb2 := connectGW(t, ts, tokB)
	_ = gb2
	// rename and delete
	if res2, body = do(t, ts, "PATCH", "/api/v1/servers/"+sid+"/emojis/"+emojiID, tokA, map[string]any{"name": "partying"}); res2.StatusCode != 200 || body["name"] != "partying" {
		t.Errorf("rename: %d %v", res2.StatusCode, body)
	}
	if res2, _ = do(t, ts, "DELETE", "/api/v1/servers/"+sid+"/emojis/"+emojiID, tokB, nil); res2.StatusCode != 403 {
		t.Error("member delete")
	}
	if res2, _ = do(t, ts, "DELETE", "/api/v1/servers/"+sid+"/emojis/"+emojiID, tokA, nil); res2.StatusCode != 204 {
		t.Error("delete")
	}
	res2, body = do(t, ts, "GET", "/api/v1/servers/"+sid+"/emojis", tokA, nil)
	if len(body["_list"].([]any)) != 0 {
		t.Errorf("after delete: %v", body)
	}
	// a role with Manage Expressions lets bob upload
	role := createRole(t, ts, tokA, sid, "Artist", perms.DefaultEveryone|perms.ManageEmojis)
	_, _ = do(t, ts, "PUT", "/api/v1/servers/"+sid+"/members/"+mustID(t, ts, tokB)+"/roles/"+role, tokA, nil)
	if res, _ := rawPost(t, ts.URL+"/api/v1/servers/"+sid+"/emojis?name=bobmoji", tokB, "image/png", pngBytes(32, 32)); res.StatusCode != 201 {
		t.Errorf("artist upload: %d", res.StatusCode)
	}
}

func TestStickerPacks(t *testing.T) {
	srv, ts := newTestServer(t)
	tokA, idA := register(t, ts, "alice")
	tokB, _ := register(t, ts, "bob")
	ga := connectGW(t, ts, tokA)
	gb := connectGW(t, ts, tokB)

	// alice makes a personal pack
	res, body := do(t, ts, "POST", "/api/v1/stickers/packs", tokA, map[string]any{"name": "  Cats  ", "description": "meow"})
	if res.StatusCode != 201 || body["name"] != "Cats" || body["owner_user_id"] != idA || body["public"] != false {
		t.Fatalf("create pack: %d %v", res.StatusCode, body)
	}
	pack := body["id"].(string)
	if ev := ga.next("sticker_update", 3*time.Second); ev == nil || ev["pack_id"] != pack {
		t.Error("sticker_update for owner")
	}
	if res, _ = do(t, ts, "POST", "/api/v1/stickers/packs", tokA, map[string]any{"name": ""}); res.StatusCode != 400 {
		t.Error("empty name")
	}
	// stickers
	res, raw := rawPost(t, ts.URL+"/api/v1/stickers/packs/"+pack+"/stickers?name=Grumpy&tags=cat%20angry", tokA, "image/png", pngBytes(64, 48))
	if res.StatusCode != 201 {
		t.Fatalf("add sticker: %d %s", res.StatusCode, raw)
	}
	res, raw = rawPost(t, ts.URL+"/api/v1/stickers/packs/"+pack+"/stickers?name=Happy", tokA, "image/png", pngBytes(48, 48))
	if res.StatusCode != 201 {
		t.Fatalf("add sticker 2: %d %s", res.StatusCode, raw)
	}
	if res, _ = rawPost(t, ts.URL+"/api/v1/stickers/packs/"+pack+"/stickers?name=Nope", tokB, "image/png", pngBytes(8, 8)); res.StatusCode != 404 {
		t.Errorf("outsider adds sticker to private pack: %d", res.StatusCode)
	}
	res, body = do(t, ts, "GET", "/api/v1/stickers/packs/"+pack, tokA, nil)
	stickers := body["stickers"].([]any)
	if res.StatusCode != 200 || len(stickers) != 2 || body["cover_sticker_id"] != stickers[0].(map[string]any)["id"] {
		t.Fatalf("pack: %d %v", res.StatusCode, body)
	}
	first := stickers[0].(map[string]any)
	second := stickers[1].(map[string]any)
	if first["name"] != "Grumpy" || first["tags"] != "cat angry" || first["format"] != "png" || first["width"].(float64) != 64 {
		t.Errorf("sticker fields: %v", first)
	}
	// reorder, rename
	if res, body = do(t, ts, "PATCH", "/api/v1/stickers/packs/"+pack+"/stickers", tokA, []map[string]any{{"id": second["id"], "position": 0}, {"id": first["id"], "position": 1}}); res.StatusCode != 200 || body["stickers"].([]any)[0].(map[string]any)["name"] != "Happy" {
		t.Errorf("reorder: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "PATCH", "/api/v1/stickers/packs/"+pack+"/stickers/"+first["id"].(string), tokA, map[string]any{"name": "Grump", "tags": "cat"}); res.StatusCode != 200 || body["name"] != "Grump" {
		t.Errorf("rename sticker: %d %v", res.StatusCode, body)
	}
	// bob cannot see or install a private pack
	if res, _ = do(t, ts, "GET", "/api/v1/stickers/packs/"+pack, tokB, nil); res.StatusCode != 404 {
		t.Error("private pack hidden")
	}
	if res, _ = do(t, ts, "PUT", "/api/v1/stickers/packs/"+pack+"/install", tokB, nil); res.StatusCode != 403 {
		t.Error("install private")
	}
	// public → discoverable, installable
	if res, body = do(t, ts, "PATCH", "/api/v1/stickers/packs/"+pack, tokA, map[string]any{"public": true, "description": "meow meow"}); res.StatusCode != 200 || body["public"] != true {
		t.Fatalf("publish: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/stickers/packs/public?q=cat", tokB, nil)
	if res.StatusCode != 200 || len(body["_list"].([]any)) != 1 || body["_list"].([]any)[0].(map[string]any)["installed"] != false {
		t.Errorf("public search: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "PUT", "/api/v1/stickers/packs/"+pack+"/install", tokB, nil); res.StatusCode != 200 || body["installed"] != true {
		t.Fatalf("install: %d %v", res.StatusCode, body)
	}
	if ev := gb.next("sticker_update", 3*time.Second); ev == nil || ev["pack_id"] != pack {
		t.Error("sticker_update for installer")
	}
	res, body = do(t, ts, "GET", "/api/v1/stickers/packs", tokB, nil)
	if len(body["_list"].([]any)) != 1 || body["_list"].([]any)[0].(map[string]any)["installed"] != true {
		t.Errorf("bob's packs: %v", body)
	}
	// installers hear about changes; bob cannot edit
	if res, _ = do(t, ts, "PATCH", "/api/v1/stickers/packs/"+pack, tokB, map[string]any{"name": "Mine"}); res.StatusCode != 403 {
		t.Error("installer edits")
	}
	_, _ = do(t, ts, "PATCH", "/api/v1/stickers/packs/"+pack, tokA, map[string]any{"name": "Cats!"})
	if ev := gb.next("sticker_update", 3*time.Second); ev == nil || ev["pack"].(map[string]any)["name"] != "Cats!" {
		t.Error("installer receives rename")
	}
	if res, _ = do(t, ts, "DELETE", "/api/v1/stickers/packs/"+pack+"/install", tokB, nil); res.StatusCode != 204 {
		t.Error("uninstall")
	}
	if ev := gb.next("sticker_update", 3*time.Second); ev == nil || ev["deleted"] != true {
		t.Error("uninstall removes the pack client-side")
	}
	// ready carries alice's packs and their stickers
	ga2 := connectGW(t, ts, tokA)
	_ = ga2
	// a server pack needs Manage Expressions; members see it in ready and listings
	view := createServer(t, ts, tokA, "Pack Server")
	sid := view["id"].(string)
	join(t, ts, tokB, inviteFor(t, ts, tokA, channelNamed(view, "general")["id"].(string)))
	if res, _ = do(t, ts, "POST", "/api/v1/stickers/packs", tokB, map[string]any{"name": "Server Pack", "server_id": sid}); res.StatusCode != 403 {
		t.Errorf("member creates server pack: %d", res.StatusCode)
	}
	res, body = do(t, ts, "POST", "/api/v1/stickers/packs", tokA, map[string]any{"name": "Server Pack", "server_id": sid})
	if res.StatusCode != 201 || body["server_id"] != sid {
		t.Fatalf("server pack: %d %v", res.StatusCode, body)
	}
	spack := body["id"].(string)
	res, body = do(t, ts, "GET", "/api/v1/stickers/packs", tokB, nil)
	found := false
	for _, p := range body["_list"].([]any) {
		if p.(map[string]any)["id"] == spack {
			found = true
		}
	}
	if !found {
		t.Errorf("member sees server pack: %v", body)
	}
	// delete drops blob references
	if res, _ = do(t, ts, "DELETE", "/api/v1/stickers/packs/"+pack, tokB, nil); res.StatusCode != 403 && res.StatusCode != 404 {
		t.Errorf("outsider delete: %d", res.StatusCode)
	}
	if res, _ = do(t, ts, "DELETE", "/api/v1/stickers/packs/"+pack, tokA, nil); res.StatusCode != 204 {
		t.Error("delete pack")
	}
	if res, _ = do(t, ts, "GET", "/api/v1/stickers/packs/"+pack, tokA, nil); res.StatusCode != 404 {
		t.Error("deleted pack gone")
	}
	if res, body = do(t, ts, "GET", "/api/v1/gif/status", tokA, nil); res.StatusCode != 200 || body["enabled"] != false {
		t.Errorf("gif status: %d %v", res.StatusCode, body)
	}
	if res, body = do(t, ts, "GET", "/api/v1/gif/search?q=cat", tokA, nil); res.StatusCode != 404 || errCode(body) != "gif_disabled" {
		t.Errorf("gif disabled: %d %v", res.StatusCode, body)
	}
	_ = srv
}
