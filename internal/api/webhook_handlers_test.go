package api

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/ratelimit"
	"evilion.xyz/chat/internal/store"
	"golang.org/x/time/rate"
)

// hookFixture is a server with its owner, a member, the #general channel and
// one webhook in it.
type hookFixture struct {
	srv                 *Server
	ts                  *httptest.Server
	owner, member       string
	ownerID, memberID   string
	serverID, channelID string
	hookID, hookToken   string
	hookURL             string
	memberGW            *gw
}

func newHookFixture(t *testing.T) *hookFixture {
	t.Helper()
	srv, ts := newTestServer(t)
	// the tests post in bursts; TestWebhookRateLimit puts the real limit back
	srv.limHook = ratelimit.New(rate.Inf, 1000, time.Hour)
	srv.limHookCh = ratelimit.New(rate.Inf, 1000, time.Hour)
	f := &hookFixture{srv: srv, ts: ts}
	f.owner, f.ownerID = register(t, ts, "owner")
	f.member, f.memberID = register(t, ts, "member")
	view := createServer(t, ts, f.owner, "Hooks")
	f.serverID = view["id"].(string)
	f.channelID = channelNamed(view, "general")["id"].(string)
	join(t, ts, f.member, inviteFor(t, ts, f.owner, f.channelID))
	res, body := do(t, ts, "POST", "/api/v1/channels/"+f.channelID+"/webhooks", f.owner, map[string]any{"name": "Deploys"})
	if res.StatusCode != 200 {
		t.Fatalf("create webhook: %d %v", res.StatusCode, body)
	}
	f.hookID, f.hookToken = body["id"].(string), body["token"].(string)
	f.hookURL = "/api/webhooks/" + f.hookID + "/" + f.hookToken
	return f
}

// post sends raw bytes with a content type to a path, returning the answer.
func post(t *testing.T, ts *httptest.Server, method, path, ctype string, body []byte, headers ...string) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest(method, ts.URL+path, bytes.NewReader(body))
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res, raw
}

func decode(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	out := map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("not JSON: %s", raw)
	}
	return out
}

// formErr digs the first error code out of a 50035 at path.
func formErr(body map[string]any, path ...string) string {
	cur, _ := body["errors"].(map[string]any)
	for _, p := range path {
		cur, _ = cur[p].(map[string]any)
	}
	list, _ := cur["_errors"].([]any)
	if len(list) == 0 {
		return ""
	}
	e, _ := list[0].(map[string]any)
	code, _ := e["code"].(string)
	return code
}

func tinyPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 3, 2))
	img.Set(0, 0, color.RGBA{255, 0, 0, 255})
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestWebhookManagement(t *testing.T) {
	f := newHookFixture(t)
	ts := f.ts
	// only people with Manage Webhooks
	if res, body := do(t, ts, "POST", "/api/v1/channels/"+f.channelID+"/webhooks", f.member, map[string]any{"name": "Nope"}); res.StatusCode != 403 {
		t.Fatalf("member made a webhook: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/channels/"+f.channelID+"/webhooks", f.member, nil); res.StatusCode != 403 {
		t.Fatalf("member listed webhooks: %d", res.StatusCode)
	}
	role := createRole(t, ts, f.owner, f.serverID, "hooks", perms.ManageWebhooks)
	if res, body := do(t, ts, "PUT", "/api/v1/servers/"+f.serverID+"/members/"+f.memberID+"/roles/"+role, f.owner, nil); res.StatusCode >= 300 {
		t.Fatalf("give role: %d %v", res.StatusCode, body)
	}
	res, body := do(t, ts, "GET", "/api/v1/servers/"+f.serverID+"/webhooks", f.member, nil)
	if res.StatusCode != 200 || len(body["_list"].([]any)) != 1 {
		t.Fatalf("server webhooks: %d %v", res.StatusCode, body)
	}
	hook := body["_list"].([]any)[0].(map[string]any)
	if hook["name"] != "Deploys" || hook["token"] != f.hookToken || !strings.HasSuffix(hook["url"].(string), f.hookURL) || hook["user"].(map[string]any)["id"] != f.ownerID {
		t.Fatalf("webhook view: %v", hook)
	}
	// names are 1-80 characters, and not the instance's own
	for _, name := range []string{"", strings.Repeat("x", 81), "Nexa"} {
		if res, _ := do(t, ts, "POST", "/api/v1/channels/"+f.channelID+"/webhooks", f.owner, map[string]any{"name": name}); res.StatusCode != 400 {
			t.Fatalf("name %q: %d", name, res.StatusCode)
		}
	}
	// a picture as image data
	avatar := "data:image/png;base64," + b64(tinyPNG(t))
	res, body = do(t, ts, "PATCH", "/api/v1/webhooks/"+f.hookID, f.owner, map[string]any{"name": "Builds", "avatar": avatar})
	if res.StatusCode != 200 || body["name"] != "Builds" || body["avatar"] == nil {
		t.Fatalf("patch: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "GET", "/media/avatar/"+body["avatar"].(string), "", nil); res.StatusCode != 200 {
		t.Fatalf("avatar not served: %d", res.StatusCode)
	}
	res, body = do(t, ts, "GET", "/api/v1/servers/"+f.serverID+"/audit-log", f.owner, nil)
	if res.StatusCode != 200 || !strings.Contains(stringify(body), "webhook_create") || !strings.Contains(stringify(body), "webhook_update") {
		t.Fatalf("audit log: %v", body)
	}
	// with the token alone
	resp, raw := post(t, ts, "GET", f.hookURL, "", nil)
	got := decode(t, raw)
	if resp.StatusCode != 200 || got["name"] != "Builds" || got["user"] != nil || got["token"] != f.hookToken {
		t.Fatalf("get with token: %d %s", resp.StatusCode, raw)
	}
	resp, raw = post(t, ts, "GET", "/api/webhooks/"+f.hookID+"/wrong", "", nil)
	if resp.StatusCode != 401 || decode(t, raw)["code"].(float64) != 50027 {
		t.Fatalf("wrong token: %d %s", resp.StatusCode, raw)
	}
	resp, raw = post(t, ts, "GET", "/api/webhooks/123/"+f.hookToken, "", nil)
	if resp.StatusCode != 404 || decode(t, raw)["code"].(float64) != 10015 {
		t.Fatalf("unknown webhook: %d %s", resp.StatusCode, raw)
	}
	// the versioned paths Discord's libraries build
	if resp, raw := post(t, ts, "GET", "/api/v10/webhooks/"+f.hookID+"/"+f.hookToken, "", nil); resp.StatusCode != 200 {
		t.Fatalf("v10 path: %d %s", resp.StatusCode, raw)
	}
	resp, raw = post(t, ts, "PATCH", f.hookURL, "application/json", []byte(`{"name":"Renamed","channel_id":"1"}`))
	if resp.StatusCode != 200 || decode(t, raw)["name"] != "Renamed" || decode(t, raw)["channel_id"] != f.channelID {
		t.Fatalf("patch with token: %d %s", resp.StatusCode, raw)
	}
	resp, _ = post(t, ts, "DELETE", f.hookURL, "", nil)
	if resp.StatusCode != 204 {
		t.Fatalf("delete with token: %d", resp.StatusCode)
	}
	if resp, _ := post(t, ts, "GET", f.hookURL, "", nil); resp.StatusCode != 404 {
		t.Fatalf("deleted webhook still answers: %d", resp.StatusCode)
	}
}

func stringify(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func TestWebhookExecute(t *testing.T) {
	f := newHookFixture(t)
	ts := f.ts
	g := connectGW(t, ts, f.member)
	payload := map[string]any{
		"content":  "Deployed <@" + f.memberID + "> @everyone",
		"username": "CI Bot",
		"embeds": []any{map[string]any{
			"title": "Build #42", "url": "https://example.com/42", "description": "All **green**", "color": 0x2ECC71,
			"timestamp": "2026-09-26T12:00:00Z",
			"author":    map[string]any{"name": "ci", "icon_url": "https://example.com/ci.png"},
			"footer":    map[string]any{"text": "main"},
			"fields":    []any{map[string]any{"name": "Time", "value": "3m", "inline": true}},
			"thumbnail": map[string]any{"url": "https://example.com/t.png"},
		}},
	}
	b, _ := json.Marshal(payload)
	resp, raw := post(t, ts, "POST", f.hookURL+"?wait=true", "application/json", b)
	if resp.StatusCode != 200 {
		t.Fatalf("execute: %d %s", resp.StatusCode, raw)
	}
	msg := decode(t, raw)
	author := msg["author"].(map[string]any)
	if author["username"] != "CI Bot" || author["bot"] != true || author["id"] != f.hookID || msg["webhook_id"] != f.hookID {
		t.Fatalf("author: %v", msg)
	}
	embed := msg["embeds"].([]any)[0].(map[string]any)
	if embed["title"] != "Build #42" || embed["color"].(float64) != 0x2ECC71 || embed["type"] != "rich" || embed["timestamp"] != "2026-09-26T12:00:00.000Z" {
		t.Fatalf("embed: %v", embed)
	}
	if thumb := embed["thumbnail"].(map[string]any); !strings.Contains(thumb["proxy_url"].(string), "/media/proxy/") {
		t.Fatalf("thumbnail not proxied: %v", thumb)
	}
	// webhooks ping users by default, and nobody else unless asked
	if len(msg["mentions"].([]any)) != 1 || msg["mention_everyone"] != false {
		t.Fatalf("mentions: %v %v", msg["mentions"], msg["mention_everyone"])
	}
	ev := g.next("message_create", 3*time.Second)
	if ev == nil || ev["webhook_id"] != f.hookID || ev["ciphertext"] != nil {
		t.Fatalf("message_create: %v", ev)
	}
	plain := ev["webhook"].(map[string]any)
	if plain["name"] != "CI Bot" || !strings.HasPrefix(plain["content"].(string), "Deployed") {
		t.Fatalf("event content: %v", plain)
	}
	if ev["author_id"] == f.ownerID || ev["author_id"] == f.memberID {
		t.Fatalf("filed under a person: %v", ev["author_id"])
	}
	// @everyone only when asked for
	resp, raw = post(t, ts, "POST", f.hookURL+"?wait=1", "application/json", []byte(`{"content":"@everyone up","allowed_mentions":{"parse":["everyone"]}}`))
	if resp.StatusCode != 200 || decode(t, raw)["mention_everyone"] != true {
		t.Fatalf("everyone: %d %s", resp.StatusCode, raw)
	}
	// no wait: nothing back
	if resp, raw := post(t, ts, "POST", f.hookURL, "application/json", []byte(`{"content":"quiet"}`)); resp.StatusCode != 204 || len(raw) != 0 {
		t.Fatalf("no wait: %d %s", resp.StatusCode, raw)
	}
	cases := []struct {
		name, body string
		status     int
		code       float64
		path       []string
	}{
		{"empty", `{}`, 400, 50006, nil},
		{"blank content", `{"content":"   "}`, 400, 50006, nil},
		{"bad json", `{"content":`, 400, 50109, nil},
		{"long content", `{"content":"` + strings.Repeat("a", 2001) + `"}`, 400, 50035, []string{"content"}},
		{"too many embeds", `{"embeds":[` + strings.TrimSuffix(strings.Repeat(`{"title":"x"},`, 11), ",") + `]}`, 400, 50035, []string{"embeds"}},
		{"long title", `{"embeds":[{"title":"` + strings.Repeat("t", 257) + `"}]}`, 400, 50035, []string{"embeds", "0", "title"}},
		{"empty embed", `{"embeds":[{}]}`, 400, 50035, []string{"embeds", "0", "description"}},
		{"field without value", `{"embeds":[{"fields":[{"name":"a"}]}]}`, 400, 50035, []string{"embeds", "0", "fields", "0", "value"}},
		{"bad color", `{"embeds":[{"title":"x","color":16777216}]}`, 400, 50035, []string{"embeds", "0", "color"}},
		{"bad timestamp", `{"embeds":[{"title":"x","timestamp":"yesterday"}]}`, 400, 50035, []string{"embeds", "0", "timestamp"}},
		{"bad url", `{"embeds":[{"title":"x","url":"ftp://x"}]}`, 400, 50035, []string{"embeds", "0", "url"}},
		{"bad avatar", `{"content":"x","avatar_url":"javascript:alert(1)"}`, 400, 50035, []string{"avatar_url"}},
		{"parse and users", `{"content":"x","allowed_mentions":{"parse":["users"],"users":["1"]}}`, 400, 50035, []string{"allowed_mentions"}},
		{"total", `{"embeds":[{"description":"` + strings.Repeat("d", 4000) + `"},{"description":"` + strings.Repeat("d", 2001) + `"}]}`, 400, 50035, []string{"embeds"}},
		{"thread name", `{"content":"x","thread_name":"t"}`, 400, 220003, nil},
		{"interactive button", `{"components":[{"type":1,"components":[{"type":2,"style":1,"label":"Go","custom_id":"go"}]}]}`, 400, 50035, []string{"components", "0", "components", "0", "style"}},
		{"v2 with content", `{"flags":32768,"content":"x","components":[{"type":10,"content":"y"}]}`, 400, 50035, []string{"content"}},
	}
	for _, c := range cases {
		path := f.hookURL + "?wait=true"
		if c.name == "interactive button" {
			path += "&with_components=true"
		}
		resp, raw := post(t, ts, "POST", path, "application/json", []byte(c.body))
		got := decode(t, raw)
		if resp.StatusCode != c.status || got["code"].(float64) != c.code {
			t.Errorf("%s: %d %s", c.name, resp.StatusCode, raw)
			continue
		}
		if c.path != nil && formErr(got, c.path...) == "" {
			t.Errorf("%s: no error at %v: %s", c.name, c.path, raw)
		}
	}
	if resp, raw := post(t, ts, "POST", f.hookURL+"?thread_id=123", "application/json", []byte(`{"content":"x"}`)); resp.StatusCode != 404 || decode(t, raw)["code"].(float64) != 10003 {
		t.Fatalf("thread_id: %d %s", resp.StatusCode, raw)
	}
	// components count only when asked for, as Discord's do
	resp, raw = post(t, ts, "POST", f.hookURL+"?wait=true", "application/json", []byte(`{"content":"x","components":[{"type":1,"components":[{"type":2,"style":5,"label":"Open","url":"https://example.com"}]}]}`))
	if resp.StatusCode != 200 || len(decode(t, raw)["components"].([]any)) != 0 {
		t.Fatalf("components without with_components: %s", raw)
	}
	resp, raw = post(t, ts, "POST", f.hookURL+"?wait=true&with_components=true", "application/json", []byte(`{"content":"x","components":[{"type":1,"components":[{"type":2,"style":5,"label":"Open","url":"https://example.com","emoji":{"name":"🚀"}}]}]}`))
	if resp.StatusCode != 200 || len(decode(t, raw)["components"].([]any)) != 1 {
		t.Fatalf("link button: %d %s", resp.StatusCode, raw)
	}
	// a message laid out by components
	v2 := `{"flags":32768,"components":[{"type":17,"accent_color":16711680,"components":[{"type":10,"content":"# Release"},{"type":14,"divider":true,"spacing":2},{"type":9,"components":[{"type":10,"content":"Notes"}],"accessory":{"type":11,"media":{"url":"https://example.com/i.png"}}},{"type":12,"items":[{"media":{"url":"https://example.com/a.png"}},{"media":{"url":"https://example.com/b.png"},"spoiler":true}]}]}]}`
	resp, raw = post(t, ts, "POST", f.hookURL+"?wait=true", "application/json", []byte(v2))
	if resp.StatusCode != 200 {
		t.Fatalf("components v2: %d %s", resp.StatusCode, raw)
	}
	got := decode(t, raw)
	if got["flags"].(float64) != 32768 || got["components"].([]any)[0].(map[string]any)["type"].(float64) != 17 {
		t.Fatalf("components v2 back: %s", raw)
	}
	// flags: only the three a webhook may set are kept
	resp, raw = post(t, ts, "POST", f.hookURL+"?wait=true", "application/json", []byte(`{"content":"shh","flags":4098}`))
	if resp.StatusCode != 200 || decode(t, raw)["flags"].(float64) != 4096 {
		t.Fatalf("flags: %d %s", resp.StatusCode, raw)
	}
	// a plain form, as curl -F sends without files
	resp, raw = post(t, ts, "POST", f.hookURL+"?wait=true", "application/x-www-form-urlencoded", []byte("content=from+a+form&username=Former"))
	if resp.StatusCode != 200 || decode(t, raw)["content"] != "from a form" || decode(t, raw)["author"].(map[string]any)["username"] != "Former" {
		t.Fatalf("form: %d %s", resp.StatusCode, raw)
	}
	// JSON sent as a form, as curl -d sends it
	resp, raw = post(t, ts, "POST", f.hookURL+"?wait=true", "application/x-www-form-urlencoded", []byte(`{"content":"json as form"}`))
	if resp.StatusCode != 200 || decode(t, raw)["content"] != "json as form" {
		t.Fatalf("json as form: %d %s", resp.StatusCode, raw)
	}
	// the channel's history shows them to members, readable
	res, body := do(t, ts, "GET", "/api/v1/channels/"+f.channelID+"/messages?limit=100", f.member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("history: %d %v", res.StatusCode, body)
	}
	n := 0
	for _, m := range body["_list"].([]any) {
		if m.(map[string]any)["webhook_id"] == f.hookID {
			n++
		}
	}
	if n < 7 {
		t.Fatalf("history has %d webhook messages", n)
	}
}

func TestWebhookFiles(t *testing.T) {
	f := newHookFixture(t)
	ts := f.ts
	pic := tinyPNG(t)
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("payload_json", `{"content":"files","embeds":[{"title":"shot","image":{"url":"attachment://shot.png"}}],"attachments":[{"id":0,"description":"a screenshot"},{"id":1,"filename":"SPOILER_notes.txt"}]}`)
	part, _ := mw.CreateFormFile("files[0]", "shot.png")
	_, _ = part.Write(pic)
	part, _ = mw.CreateFormFile("files[1]", "notes.txt")
	_, _ = part.Write([]byte("hello notes"))
	_ = mw.Close()
	resp, raw := post(t, ts, "POST", f.hookURL+"?wait=true", mw.FormDataContentType(), body.Bytes())
	if resp.StatusCode != 200 {
		t.Fatalf("multipart: %d %s", resp.StatusCode, raw)
	}
	msg := decode(t, raw)
	// the picture the embed shows is part of the embed, and only the other is listed
	atts := msg["attachments"].([]any)
	if len(atts) != 1 {
		t.Fatalf("attachments: %v", atts)
	}
	notes := atts[0].(map[string]any)
	if notes["filename"] != "SPOILER_notes.txt" || notes["flags"].(float64) != 8 {
		t.Fatalf("spoiler file: %v", notes)
	}
	image := msg["embeds"].([]any)[0].(map[string]any)["image"].(map[string]any)
	if !strings.Contains(image["url"].(string), "/media/attachments/") || image["width"].(float64) != 3 || image["content_type"] != "image/png" {
		t.Fatalf("embed picture: %v", image)
	}
	// the embed shows the picture, which is then not listed again
	m, err := f.srv.Store.MessageByID(context.Background(), parseHookID(msg["id"].(string)), 0)
	if err != nil {
		t.Fatal(err)
	}
	var p wmPlain
	if err := json.Unmarshal(m.Webhook, &p); err != nil {
		t.Fatal(err)
	}
	if p.Embeds[0].Image == nil || p.Embeds[0].Image.BlobID == nil || !p.Attachments[0].Inline || p.Attachments[1].Inline || p.Attachments[0].Description != "a screenshot" || *p.Attachments[0].Height != 2 {
		t.Fatalf("embed picture: %+v %+v", p.Embeds[0].Image, p.Attachments)
	}
	// members download the bytes; others cannot
	blob := p.Attachments[1].BlobID.String()
	req, _ := http.NewRequest("GET", ts.URL+"/media/attachments/"+blob, nil)
	req.Header.Set("Authorization", "Bearer "+f.member)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || string(got) != "hello notes" {
		t.Fatalf("download: %d %q", res.StatusCode, got)
	}
	stranger, _ := register(t, ts, "stranger")
	req, _ = http.NewRequest("GET", ts.URL+"/media/attachments/"+blob, nil)
	req.Header.Set("Authorization", "Bearer "+stranger)
	if res, err := http.DefaultClient.Do(req); err != nil || res.StatusCode != 404 {
		t.Fatalf("stranger downloaded a webhook file: %v", res.StatusCode)
	}
	// too many files
	body.Reset()
	mw = multipart.NewWriter(&body)
	for i := 0; i < 11; i++ {
		part, _ := mw.CreateFormFile("files["+itoa(i)+"]", "f.txt")
		_, _ = part.Write([]byte("x"))
	}
	_ = mw.Close()
	if resp, raw := post(t, ts, "POST", f.hookURL, mw.FormDataContentType(), body.Bytes()); resp.StatusCode != 400 || formErr(decode(t, raw), "files") == "" {
		t.Fatalf("11 files: %d %s", resp.StatusCode, raw)
	}
	// the message goes, and its files with it
	resp, _ = post(t, ts, "DELETE", f.hookURL+"/messages/"+msg["id"].(string), "", nil)
	if resp.StatusCode != 204 {
		t.Fatalf("delete: %d", resp.StatusCode)
	}
	b, err := f.srv.Store.BlobByID(context.Background(), p.Attachments[1].BlobID)
	if err != nil || b.RefCount != 0 {
		t.Fatalf("file still referenced: %+v %v", b, err)
	}
}

func TestWebhookMessageEdit(t *testing.T) {
	f := newHookFixture(t)
	ts := f.ts
	g := connectGW(t, ts, f.member)
	resp, raw := post(t, ts, "POST", f.hookURL+"?wait=true", "application/json", []byte(`{"content":"first <@`+f.memberID+`>","embeds":[{"title":"one"}]}`))
	if resp.StatusCode != 200 {
		t.Fatalf("execute: %d %s", resp.StatusCode, raw)
	}
	id := decode(t, raw)["id"].(string)
	g.next("message_create", 3*time.Second)
	resp, raw = post(t, ts, "GET", f.hookURL+"/messages/"+id, "", nil)
	if resp.StatusCode != 200 || decode(t, raw)["content"] != "first <@"+f.memberID+">" {
		t.Fatalf("get: %d %s", resp.StatusCode, raw)
	}
	resp, raw = post(t, ts, "PATCH", f.hookURL+"/messages/"+id, "application/json", []byte(`{"content":"second","embeds":null}`))
	got := decode(t, raw)
	if resp.StatusCode != 200 || got["content"] != "second" || len(got["embeds"].([]any)) != 0 || got["edited_timestamp"] == nil || len(got["mentions"].([]any)) != 0 {
		t.Fatalf("edit: %d %s", resp.StatusCode, raw)
	}
	ev := g.next("message_update", 3*time.Second)
	if ev == nil || ev["webhook"].(map[string]any)["content"] != "second" || len(ev["was"].(map[string]any)["mentions"].([]any)) != 1 {
		t.Fatalf("message_update: %v", ev)
	}
	// nothing left to show is refused
	if resp, raw := post(t, ts, "PATCH", f.hookURL+"/messages/"+id, "application/json", []byte(`{"content":""}`)); resp.StatusCode != 400 || decode(t, raw)["code"].(float64) != 50006 {
		t.Fatalf("empty edit: %d %s", resp.StatusCode, raw)
	}
	// another webhook cannot touch it
	res, body := do(t, ts, "POST", "/api/v1/channels/"+f.channelID+"/webhooks", f.owner, map[string]any{"name": "Other"})
	if res.StatusCode != 200 {
		t.Fatalf("second webhook: %v", body)
	}
	other := "/api/webhooks/" + body["id"].(string) + "/" + body["token"].(string)
	if resp, raw := post(t, ts, "PATCH", other+"/messages/"+id, "application/json", []byte(`{"content":"mine now"}`)); resp.StatusCode != 404 || decode(t, raw)["code"].(float64) != 10008 {
		t.Fatalf("other webhook edited: %d %s", resp.StatusCode, raw)
	}
	// people cannot edit it, but moderators can hide its previews and delete it
	if res, _ := do(t, ts, "PATCH", "/api/v1/channels/"+f.channelID+"/messages/"+id, f.member, map[string]any{"flags": 4}); res.StatusCode != 403 {
		t.Fatalf("member suppressed embeds: %d", res.StatusCode)
	}
	if res, body := do(t, ts, "PATCH", "/api/v1/channels/"+f.channelID+"/messages/"+id, f.owner, map[string]any{"flags": 4}); res.StatusCode != 200 || body["flags"].(float64) != 4 {
		t.Fatalf("owner suppressed embeds: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "DELETE", "/api/v1/channels/"+f.channelID+"/messages/"+id, f.owner, nil); res.StatusCode != 204 {
		t.Fatalf("owner delete: %d", res.StatusCode)
	}
	if resp, _ := post(t, ts, "GET", f.hookURL+"/messages/"+id, "", nil); resp.StatusCode != 404 {
		t.Fatalf("deleted message: %d", resp.StatusCode)
	}
}

func TestWebhookSlackAndGitHub(t *testing.T) {
	f := newHookFixture(t)
	ts := f.ts
	slack := `{"text":"*Build* passed on <https://ci.example.com/1|run 1> _today_","username":"Slacky","attachments":[{"color":"good","pretext":"Heads up","title":"Details","title_link":"https://ci.example.com","text":"All ~bad~ good","fields":[{"title":"Branch","value":"main","short":true}],"footer":"CI","ts":1790000000}]}`
	resp, raw := post(t, ts, "POST", f.hookURL+"/slack", "application/json", []byte(slack))
	if resp.StatusCode != 200 || string(raw) != "ok" {
		t.Fatalf("slack: %d %s", resp.StatusCode, raw)
	}
	res, body := do(t, ts, "GET", "/api/v1/channels/"+f.channelID+"/messages?limit=5", f.member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("history: %v", body)
	}
	list := body["_list"].([]any)
	var p wmPlain
	_ = json.Unmarshal([]byte(stringify(list[len(list)-1].(map[string]any)["webhook"])), &p)
	if p.Name != "Slacky" || p.Content != "**Build** passed on [run 1](https://ci.example.com/1) *today*" || p.Source != "slack" {
		t.Fatalf("slack content: %+v", p)
	}
	if e := p.Embeds[0]; e.Color == nil || *e.Color != 0x2EB886 || e.Title != "Details" || e.Description != "Heads up\nAll ~~bad~~ good" || !e.Fields[0].Inline || e.Timestamp == "" {
		t.Fatalf("slack embed: %+v", e)
	}
	push := `{"ref":"refs/heads/main","compare":"https://github.com/o/r/compare/a...b","forced":false,"repository":{"name":"r","full_name":"o/r","html_url":"https://github.com/o/r"},"sender":{"login":"octo","html_url":"https://github.com/octo","avatar_url":"https://avatars.githubusercontent.com/u/1"},"commits":[{"id":"abcdef1234","url":"https://github.com/o/r/commit/abcdef1234","message":"Fix the thing\n\nlong body","author":{"username":"octo"}},{"id":"123456789a","url":"https://github.com/o/r/commit/123456789a","message":"Second","author":{"name":"Octo Cat"}}]}`
	resp, raw = post(t, ts, "POST", f.hookURL+"/github?wait=true", "application/json", []byte(push), "X-GitHub-Event", "push")
	if resp.StatusCode != 200 {
		t.Fatalf("github push: %d %s", resp.StatusCode, raw)
	}
	pushed := decode(t, raw)
	embed := pushed["embeds"].([]any)[0].(map[string]any)
	if embed["title"] != "[r:main] 2 new commits" || embed["color"].(float64) != 7506394 || embed["url"] != "https://github.com/o/r/compare/a...b" || !strings.Contains(embed["description"].(string), "[`abcdef1`](https://github.com/o/r/commit/abcdef1234) Fix the thing - octo") {
		t.Fatalf("push embed: %v", embed)
	}
	// every GitHub message goes out as GitHub, whatever the webhook is called
	if pushed["author"].(map[string]any)["username"] != "GitHub" || embed["author"].(map[string]any)["name"] != "octo" {
		t.Fatalf("push author: %v", pushed["author"])
	}
	// ping and unshown actions are accepted and dropped
	for _, ev := range [][2]string{{"ping", `{"zen":"hi"}`}, {"issues", `{"action":"labeled","issue":{"number":1}}`}, {"push", `{"ref":"refs/tags/v1","commits":[]}`}} {
		resp, raw := post(t, ts, "POST", f.hookURL+"/github", "application/json", []byte(ev[1]), "X-GitHub-Event", ev[0])
		if resp.StatusCode != 204 || len(raw) != 0 {
			t.Fatalf("%s: %d %s", ev[0], resp.StatusCode, raw)
		}
	}
	issue := `{"action":"opened","issue":{"number":7,"title":"Broken","html_url":"https://github.com/o/r/issues/7","body":"It broke"},"repository":{"name":"r","full_name":"o/r"},"sender":{"login":"octo"}}`
	resp, raw = post(t, ts, "POST", f.hookURL+"/github?wait=true", "application/json", []byte(issue), "X-GitHub-Event", "issues")
	embed = decode(t, raw)["embeds"].([]any)[0].(map[string]any)
	if resp.StatusCode != 200 || embed["title"] != "[o/r] Issue opened: #7 Broken" || embed["color"].(float64) != 15426592 || embed["description"] != "It broke" || embed["url"] != "https://github.com/o/r/issues/7" {
		t.Fatalf("issue: %d %s", resp.StatusCode, raw)
	}
	// what someone typed in a title does not turn into formatting
	issue = `{"action":"closed","issue":{"number":8,"title":"fix *all* the_things","html_url":"https://github.com/o/r/issues/8"},"repository":{"name":"r","full_name":"o/r"},"sender":{"login":"octo"}}`
	resp, raw = post(t, ts, "POST", f.hookURL+"/github?wait=true", "application/json", []byte(issue), "X-GitHub-Event", "issues")
	embed = decode(t, raw)["embeds"].([]any)[0].(map[string]any)
	if resp.StatusCode != 200 || embed["title"] != `[o/r] Issue closed: #8 fix \*all\* the\_things` || embed["color"] != nil {
		t.Fatalf("closed issue: %d %s", resp.StatusCode, raw)
	}
}

func TestWebhookPoll(t *testing.T) {
	f := newHookFixture(t)
	ts := f.ts
	poll := `{"poll":{"question":{"text":"Lunch?"},"answers":[{"poll_media":{"text":"Pizza","emoji":{"name":"🍕"}}},{"poll_media":{"text":"Soup"}}],"duration":1}}`
	resp, raw := post(t, ts, "POST", f.hookURL+"?wait=true", "application/json", []byte(poll))
	if resp.StatusCode != 200 {
		t.Fatalf("poll: %d %s", resp.StatusCode, raw)
	}
	msg := decode(t, raw)
	id := msg["id"].(string)
	answers := msg["poll"].(map[string]any)["answers"].([]any)
	if len(answers) != 2 || answers[1].(map[string]any)["answer_id"].(float64) != 2 {
		t.Fatalf("poll answers: %v", answers)
	}
	g := connectGW(t, ts, f.owner)
	vote := "/api/v1/channels/" + f.channelID + "/polls/" + id + "/answers/@me"
	res, body := do(t, ts, "PUT", vote, f.member, map[string]any{"answer_ids": []int{1}})
	if res.StatusCode != 200 || body["answer_counts"].([]any)[0].(map[string]any)["count"].(float64) != 1 || body["answer_counts"].([]any)[0].(map[string]any)["me_voted"] != true {
		t.Fatalf("vote: %d %v", res.StatusCode, body)
	}
	if ev := g.next("poll_vote_add", 3*time.Second); ev == nil || ev["answer_id"].(float64) != 1 || ev["user_id"] != f.memberID || ev["total_voters"].(float64) != 1 {
		t.Fatalf("poll_vote_add: %v", ev)
	}
	if res, _ := do(t, ts, "PUT", vote, f.member, map[string]any{"answer_ids": []int{1, 2}}); res.StatusCode != 400 {
		t.Fatalf("two answers on a single-choice poll: %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "PUT", vote, f.member, map[string]any{"answer_ids": []int{3}}); res.StatusCode != 400 {
		t.Fatalf("an answer it does not have: %d", res.StatusCode)
	}
	res, body = do(t, ts, "GET", "/api/v1/channels/"+f.channelID+"/polls/"+id+"/answers/1", f.owner, nil)
	if res.StatusCode != 200 || len(body["users"].([]any)) != 1 || body["users"].([]any)[0] != f.memberID {
		t.Fatalf("voters: %d %v", res.StatusCode, body)
	}
	// the owner's view of the message counts the vote without calling it theirs
	res, body = do(t, ts, "GET", "/api/v1/channels/"+f.channelID+"/messages/"+id, f.owner, nil)
	tally := body["poll_results"].(map[string]any)
	if res.StatusCode != 200 || tally["answer_counts"].([]any)[0].(map[string]any)["me_voted"] != false || tally["total_voters"].(float64) != 1 {
		t.Fatalf("tally: %v", body)
	}
	// time runs out: the poll closes, says how it went, and takes no more votes
	ctx := context.Background()
	if _, err := f.srv.Store.DB().W.ExecContext(ctx, `UPDATE polls SET expires_at = ? WHERE message_id = ?`, time.Now().Add(-time.Minute).UnixMilli(), int64(parseHookID(id))); err != nil {
		t.Fatal(err)
	}
	f.srv.closePolls(ctx)
	line := g.next("message_create", 3*time.Second)
	if line == nil || line["type"] != "system_poll_result" || line["reply_to_id"] != id {
		t.Fatalf("result line: %v", line)
	}
	fields := line["webhook"].(map[string]any)["embeds"].([]any)[0].(map[string]any)["fields"].([]any)
	if !strings.Contains(stringify(fields), `"victor_answer_text","value":"Pizza"`) {
		t.Fatalf("result fields: %v", fields)
	}
	if res, body := do(t, ts, "PUT", vote, f.owner, map[string]any{"answer_ids": []int{2}}); res.StatusCode != 400 || errCode(body) != "poll_closed" {
		t.Fatalf("vote after close: %d %v", res.StatusCode, body)
	}
	// a poll that is not valid
	if resp, raw := post(t, ts, "POST", f.hookURL, "application/json", []byte(`{"poll":{"question":{"text":""},"answers":[]}}`)); resp.StatusCode != 400 || formErr(decode(t, raw), "poll", "answers") == "" {
		t.Fatalf("bad poll: %d %s", resp.StatusCode, raw)
	}
}

func TestWebhookRateLimit(t *testing.T) {
	f := newHookFixture(t)
	ts := f.ts
	f.srv.limHook = ratelimit.New(ratelimit.Every(5, 2*time.Second), 5, time.Hour)
	var last *http.Response
	var raw []byte
	for i := 0; i < 6; i++ {
		last, raw = post(t, ts, "POST", f.hookURL, "application/json", []byte(`{"content":"spam"}`))
	}
	if last.StatusCode != 429 {
		t.Fatalf("sixth request in a burst: %d %s", last.StatusCode, raw)
	}
	body := decode(t, raw)
	if body["retry_after"].(float64) <= 0 || body["global"] != false || last.Header.Get("X-RateLimit-Remaining") != "0" || last.Header.Get("Retry-After") == "" || last.Header.Get("Via") == "" {
		t.Fatalf("429: %v %v", body, last.Header)
	}
}

func TestWebhookAccountIsNobody(t *testing.T) {
	f := newHookFixture(t)
	ctx := context.Background()
	author, err := f.srv.Store.WebhookUser(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n, _ := f.srv.Store.CountUsers(ctx); n != 2 {
		t.Fatalf("people counted: %d", n)
	}
	if res, _ := do(t, f.ts, "POST", "/api/v1/users/@me/channels", f.member, map[string]any{"recipient_ids": []string{author.ID.String()}}); res.StatusCode != 404 {
		t.Fatalf("DM to the webhook account: %d", res.StatusCode)
	}
	if res, _ := do(t, f.ts, "POST", "/api/v1/users/@me/relationships", f.member, map[string]any{"username": store.WebhookUsername}); res.StatusCode != 404 {
		t.Fatalf("friend request to the webhook account: %d", res.StatusCode)
	}
	if res, _ := do(t, f.ts, "PUT", "/api/v1/users/@me/blocks/"+author.ID.String(), f.member, nil); res.StatusCode != 404 {
		t.Fatalf("block of the webhook account: %d", res.StatusCode)
	}
	if res, _ := do(t, f.ts, "POST", "/api/v1/auth/login", "", map[string]any{"username": store.WebhookUsername, "auth_key": b64(key32)}); res.StatusCode == 200 {
		t.Fatal("signed in as the webhook account")
	}
	res, body := do(t, f.ts, "GET", "/api/v1/users/search?q=webhook", f.member, nil)
	if res.StatusCode == 200 && strings.Contains(stringify(body), store.WebhookUsername) {
		t.Fatalf("search found the webhook account: %v", body)
	}
}

func parseHookID(s string) ids.ID {
	id, err := ids.Parse(s)
	if err != nil {
		panic(err)
	}
	return id
}
