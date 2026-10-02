package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

// addSticker puts a picture in a pack and returns the sticker's id and its picture's.
func addSticker(t *testing.T, base, tok, pack, name string, img []byte) (string, string) {
	t.Helper()
	res, raw := rawPost(t, base+"/api/v1/stickers/packs/"+pack+"/stickers?name="+name, tok, "image/png", img)
	if res.StatusCode != 201 {
		t.Fatalf("add sticker %s: %d %s", name, res.StatusCode, raw)
	}
	var st map[string]any
	if err := json.Unmarshal(raw, &st); err != nil {
		t.Fatal(err)
	}
	return st["id"].(string), st["blob_id"].(string)
}

func mediaStatus(t *testing.T, base, kind, blob string) int {
	t.Helper()
	res, err := http.Get(base + "/media/" + kind + "/" + blob)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

// The staff see every pack, take down single stickers, a pack's public
// listing or the whole pack, and a picture taken down stays down: it is
// served to nobody and cannot be uploaded again, as anything.
func TestPackModeration(t *testing.T) {
	_, ts := newTestServer(t)
	modTok, _ := register(t, ts, "owner")
	tok, id := register(t, ts, "alice")
	ga := connectGW(t, ts, tok)
	res, body := do(t, ts, "POST", "/api/v1/stickers/packs", tok, map[string]any{"name": "Cats", "description": "meow"})
	if res.StatusCode != 201 {
		t.Fatalf("create pack: %d %v", res.StatusCode, body)
	}
	pack := body["id"].(string)
	grumpy, grumpyBlob := addSticker(t, ts.URL, tok, pack, "Grumpy", pngBytes(64, 48))
	addSticker(t, ts.URL, tok, pack, "Happy", pngBytes(48, 48))
	if res, body := do(t, ts, "PATCH", "/api/v1/stickers/packs/"+pack, tok, map[string]any{"public": true}); res.StatusCode != 200 {
		t.Fatalf("make public: %d %v", res.StatusCode, body)
	}

	// listed for the staff, with its first stickers and whose it is
	res, body = do(t, ts, "GET", "/api/v1/moderation/packs?scope=discover", modTok, nil)
	packs, _ := body["packs"].([]any)
	if res.StatusCode != 200 || len(packs) != 1 {
		t.Fatalf("pack list: %d %v", res.StatusCode, body)
	}
	listed := packs[0].(map[string]any)
	if listed["id"] != pack || listed["owner_id"] != id || listed["sticker_count"].(float64) != 2 || len(listed["stickers"].([]any)) != 2 || listed["blocked"] != "" {
		t.Errorf("listed pack: %v", listed)
	}
	if res, body := do(t, ts, "GET", "/api/v1/moderation/packs?q=alice", modTok, nil); res.StatusCode != 200 || len(body["packs"].([]any)) != 1 {
		t.Errorf("search by owner: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "GET", "/api/v1/moderation/packs?scope=server", modTok, nil); res.StatusCode != 200 || len(body["packs"].([]any)) != 0 {
		t.Errorf("server packs: %d %v", res.StatusCode, body)
	}
	// a member cannot act
	if res, body := do(t, ts, "POST", "/api/v1/moderation/packs/"+pack+"/actions", tok, map[string]any{"stickers": []string{grumpy}, "reason": "nope"}); res.StatusCode != 403 {
		t.Errorf("member takedown: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "POST", "/api/v1/moderation/packs/"+pack+"/actions", modTok, map[string]any{"reason": "nothing chosen"}); res.StatusCode != 400 || errCode(body) != "nothing_selected" {
		t.Errorf("empty takedown: %d %v", res.StatusCode, body)
	}

	// one sticker, blocked
	if mediaStatus(t, ts.URL, "sticker", grumpyBlob) != 200 {
		t.Fatal("the sticker's picture is not served to begin with")
	}
	res, body = do(t, ts, "POST", "/api/v1/moderation/packs/"+pack+"/actions", modTok, map[string]any{"stickers": []string{grumpy}, "block": true, "reason": "Graphic content."})
	if res.StatusCode != 201 {
		t.Fatalf("sticker takedown: %d %v", res.StatusCode, body)
	}
	c := body["case"].(map[string]any)
	if c["action"] != "expression_takedown" || c["user_id"] != id {
		t.Errorf("case: %v", c)
	}
	// the owner hears of it, and their app is told the pack changed
	if ga.next("nexa_notice", 3*time.Second) == nil {
		t.Error("no notice for the pack's owner")
	}
	if mediaStatus(t, ts.URL, "sticker", grumpyBlob) != 404 {
		t.Error("a blocked picture is still served")
	}
	if res, raw := rawPost(t, ts.URL+"/api/v1/stickers/packs/"+pack+"/stickers?name=Again", tok, "image/png", pngBytes(64, 48)); res.StatusCode != 400 || !json.Valid(raw) || errCodeRaw(raw) != "image_blocked" {
		t.Errorf("re-upload as a sticker: %d %s", res.StatusCode, raw)
	}
	if res, raw := rawPut(t, ts.URL+"/api/v1/users/@me/avatar", tok, "image/png", pngBytes(64, 48)); res.StatusCode != 400 || errCodeRaw(raw) != "image_blocked" {
		t.Errorf("re-upload as an avatar: %d %s", res.StatusCode, raw)
	}
	res, body = do(t, ts, "GET", "/api/v1/moderation/packs/"+pack, modTok, nil)
	if res.StatusCode != 200 || len(body["pack"].(map[string]any)["stickers"].([]any)) != 1 || len(body["cases"].([]any)) != 1 {
		t.Errorf("pack after takedown: %d %v", res.StatusCode, body)
	}

	// made private, and kept private until the staff allow it again
	if res, body := do(t, ts, "POST", "/api/v1/moderation/packs/"+pack+"/actions", modTok, map[string]any{"fields": []string{"public", "name"}, "reason": "Spam in Discover."}); res.StatusCode != 201 {
		t.Fatalf("make private: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "GET", "/api/v1/stickers/packs/"+pack, tok, nil)
	if res.StatusCode != 200 || body["public"] != false || body["name"] == "Cats" {
		t.Errorf("pack after reset: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PATCH", "/api/v1/stickers/packs/"+pack, tok, map[string]any{"public": true}); res.StatusCode != 403 || errCode(body) != "discover_blocked" {
		t.Errorf("owner relists: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "POST", "/api/v1/moderation/packs/"+pack+"/relist", modTok, map[string]any{"reason": "Fixed after review."}); res.StatusCode != 204 {
		t.Errorf("relist: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PATCH", "/api/v1/stickers/packs/"+pack, tok, map[string]any{"public": true}); res.StatusCode != 200 {
		t.Errorf("owner relists after: %d %v", res.StatusCode, body)
	}

	// and the whole pack
	if res, body := do(t, ts, "POST", "/api/v1/moderation/packs/"+pack+"/actions", modTok, map[string]any{"delete": true, "reason": "Hateful pack."}); res.StatusCode != 201 {
		t.Fatalf("delete pack: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/stickers/packs/"+pack, tok, nil); res.StatusCode != 404 {
		t.Errorf("deleted pack still there: %d", res.StatusCode)
	}
	// every takedown is on the record
	res, body = do(t, ts, "GET", "/api/v1/moderation/log?action=expression_takedown,expression_relist", modTok, nil)
	if res.StatusCode != 200 || len(body["entries"].([]any)) != 4 {
		t.Errorf("log: %d %v", res.StatusCode, body)
	}
}

// A server's emoji are taken down from its page in the panel; the case is its owner's.
func TestServerEmojiModeration(t *testing.T) {
	_, ts := newTestServer(t)
	modTok, _ := register(t, ts, "owner")
	tok, id := register(t, ts, "alice")
	sid := createServer(t, ts, tok, "Emo")["id"].(string)
	res, raw := rawPost(t, ts.URL+"/api/v1/servers/"+sid+"/emojis?name=party", tok, "image/png", pngBytes(32, 32))
	if res.StatusCode != 201 {
		t.Fatalf("upload: %d %s", res.StatusCode, raw)
	}
	var e map[string]any
	_ = json.Unmarshal(raw, &e)
	res, body := do(t, ts, "GET", "/api/v1/moderation/servers/"+sid, modTok, nil)
	if res.StatusCode != 200 || len(body["emojis"].([]any)) != 1 {
		t.Fatalf("server page: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "POST", "/api/v1/moderation/servers/"+sid+"/emojis/actions", modTok, map[string]any{"emojis": []string{"123"}, "reason": "not here"}); res.StatusCode != 400 || errCode(body) != "not_in_server" {
		t.Errorf("someone else's emoji: %d %v", res.StatusCode, body)
	}
	res, body = do(t, ts, "POST", "/api/v1/moderation/servers/"+sid+"/emojis/actions", modTok, map[string]any{"emojis": []string{e["id"].(string)}, "block": true, "reason": "Slur."})
	if res.StatusCode != 201 || body["case"].(map[string]any)["user_id"] != id {
		t.Fatalf("emoji takedown: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "GET", "/api/v1/servers/"+sid+"/emojis", tok, nil); res.StatusCode != 200 || len(body["_list"].([]any)) != 0 {
		t.Errorf("emoji still there: %d %v", res.StatusCode, body)
	}
	if mediaStatus(t, ts.URL, "emoji", e["blob_id"].(string)) != 404 {
		t.Error("a blocked emoji is still served")
	}
	// and the server's page has the case about it
	if _, body := do(t, ts, "GET", "/api/v1/moderation/servers/"+sid, modTok, nil); len(body["cases"].([]any)) != 1 {
		t.Errorf("server cases: %v", body["cases"])
	}
}

// The newest stickers and emoji, a page at a time, newest first.
func TestRecentUploads(t *testing.T) {
	_, ts := newTestServer(t)
	modTok, _ := register(t, ts, "owner")
	tok, _ := register(t, ts, "alice")
	_, body := do(t, ts, "POST", "/api/v1/stickers/packs", tok, map[string]any{"name": "Cats"})
	pack := body["id"].(string)
	addSticker(t, ts.URL, tok, pack, "One", pngBytes(20, 20))
	addSticker(t, ts.URL, tok, pack, "Two", pngBytes(21, 21))
	sid := createServer(t, ts, tok, "Emo")["id"].(string)
	if res, raw := rawPost(t, ts.URL+"/api/v1/servers/"+sid+"/emojis?name=three", tok, "image/png", pngBytes(22, 22)); res.StatusCode != 201 {
		t.Fatalf("emoji: %d %s", res.StatusCode, raw)
	}
	res, body := do(t, ts, "GET", "/api/v1/moderation/uploads?limit=2", modTok, nil)
	list, _ := body["uploads"].([]any)
	if res.StatusCode != 200 || len(list) != 2 || body["has_more"] != true {
		t.Fatalf("first page: %d %v", res.StatusCode, body)
	}
	first, second := list[0].(map[string]any), list[1].(map[string]any)
	if first["name"] != "three" || first["kind"] != "emoji" || second["name"] != "Two" || second["pack_name"] != "Cats" {
		t.Errorf("newest first: %v", list)
	}
	res, body = do(t, ts, "GET", "/api/v1/moderation/uploads?limit=2&before="+jsonNumber(second["created_at"])+"&before_id="+second["id"].(string), modTok, nil)
	list, _ = body["uploads"].([]any)
	if res.StatusCode != 200 || len(list) != 1 || list[0].(map[string]any)["name"] != "One" || body["has_more"] != false {
		t.Errorf("next page: %d %v", res.StatusCode, body)
	}
}

func errCodeRaw(raw []byte) string {
	var body map[string]any
	if json.Unmarshal(raw, &body) != nil {
		return ""
	}
	return errCode(body)
}

func jsonNumber(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
