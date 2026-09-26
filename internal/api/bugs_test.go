package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/time/rate"

	"evilion.xyz/chat/internal/ratelimit"
)

// fakeMP4 is the start of an MP4 file: enough for the server to know it as one.
var fakeMP4 = append([]byte{0, 0, 0, 0x18, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 2, 0, 'i', 's', 'o', 'm', 'i', 's', 'o', '2'}, bytes.Repeat([]byte{7}, 4000)...)

// bugUpload sends one file for a report and returns what the server said.
func bugUpload(t *testing.T, ts *httptest.Server, tok, name, ctype string, body []byte) (int, map[string]any) {
	t.Helper()
	res, raw := rawPost(t, ts.URL+"/api/v1/bugs/attachments?name="+name, tok, ctype, body)
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

func mustBugUpload(t *testing.T, ts *httptest.Server, tok, name, ctype string, body []byte) string {
	t.Helper()
	code, out := bugUpload(t, ts, tok, name, ctype, body)
	if code != 201 {
		t.Fatalf("upload %s: %d %v", name, code, out)
	}
	return out["id"].(string)
}

func bugBody(subject string, files ...string) map[string]any {
	list := []map[string]any{}
	for _, f := range files {
		list = append(list, map[string]any{"id": f, "name": "file"})
	}
	return map[string]any{"subject": subject, "description": "It stopped working when I pressed the button.", "attachments": list}
}

func mustBug(t *testing.T, ts *httptest.Server, tok string, body map[string]any) map[string]any {
	t.Helper()
	res, out := do(t, ts, "POST", "/api/v1/bugs", tok, body)
	if res.StatusCode != 201 {
		t.Fatalf("create: %d %v", res.StatusCode, out)
	}
	return out["report"].(map[string]any)
}

// fetch GETs a path with a token and returns the status, content type and body.
func fetch(t *testing.T, ts *httptest.Server, path, tok string) (int, string, []byte) {
	t.Helper()
	req, _ := http.NewRequest("GET", ts.URL+path, nil)
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, res.Header.Get("Content-Type"), b
}

func TestBugReportsFromFormToThread(t *testing.T) {
	_, ts := newTestServer(t)
	aliceTok, _ := register(t, ts, "alice") // the first account is the instance's admin
	bobTok, bobID := register(t, ts, "bob")
	carolTok, _ := register(t, ts, "carol")
	ga := connectGW(t, ts, aliceTok)
	gb := connectGW(t, ts, bobTok)

	shot := mustBugUpload(t, ts, bobTok, "shot.png", "image/png", pngBytes(64, 48))
	clip := mustBugUpload(t, ts, bobTok, "clip.mp4", "video/mp4", fakeMP4)
	unsent := mustBugUpload(t, ts, bobTok, "later.png", "image/png", pngBytes(20, 20))
	if code, out := bugUpload(t, ts, bobTok, "notes.txt", "text/plain", []byte("hello there, this is text")); code != 400 || errCode(out) != "unsupported_type" {
		t.Errorf("a text file: %d %v", code, out)
	}
	big := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{1}, 11<<20)...)
	if code, out := bugUpload(t, ts, bobTok, "big.png", "image/png", big); code != 413 || errCode(out) != "image_too_large" {
		t.Errorf("an 11 MB picture: %d %v", code, out)
	}

	body := bugBody("Calls drop after a minute", shot, clip)
	body["context"] = map[string]any{"app": "web", "build": "abc123", "language": "en", "secret": "not kept"}
	report := mustBug(t, ts, bobTok, body)
	id := report["id"].(string)
	if report["number"].(float64) != 1 || report["status"] != "open" || report["awaiting"] != "staff" {
		t.Fatalf("new report %v", report)
	}
	files := report["attachments"].([]any)
	if len(files) != 2 || files[0].(map[string]any)["mime"] != "image/png" || files[1].(map[string]any)["mime"] != "video/mp4" {
		t.Fatalf("attachments %v", files)
	}
	context := report["context"].(map[string]any)
	if context["app"] != "web" || context["build"] != "abc123" || context["secret"] != nil || context["server"] == nil {
		t.Errorf("context kept %v", context)
	}

	// the staff hear of it, and the reporter's other devices
	if ev := ga.next("mod_bug", 3*time.Second); ev == nil || ev["counts"].(map[string]any)["waiting"].(float64) != 1 || ev["report"].(map[string]any)["reporter_username"] != "bob" {
		t.Errorf("staff event: %v", ev)
	}
	if ev := gb.next("nexa_bug", 3*time.Second); ev == nil || ev["report"].(map[string]any)["id"] != id || ev["state"].(map[string]any)["latest"].(float64) == 0 {
		t.Errorf("reporter event: %v", ev)
	}

	// nobody else can read it, write in it or see its files
	for _, p := range []string{"/api/v1/bugs/" + id, "/media/bugs/" + shot, "/media/bugs/" + clip, "/media/bugs/" + unsent} {
		if code, _, _ := fetch(t, ts, p, carolTok); code != 404 {
			t.Errorf("carol GET %s: %d", p, code)
		}
	}
	if res, out := do(t, ts, "POST", "/api/v1/bugs/"+id+"/messages", carolTok, map[string]any{"body": "me too"}); res.StatusCode != 404 {
		t.Errorf("carol writing in bob's report: %d %v", res.StatusCode, out)
	}
	if res, out := do(t, ts, "POST", "/api/v1/bugs/"+id+"/read", carolTok, map[string]any{"message_id": "1"}); res.StatusCode != 404 {
		t.Errorf("carol reading bob's report: %d %v", res.StatusCode, out)
	}
	for _, p := range []string{"/api/v1/moderation/bugs", "/api/v1/moderation/bugs/" + id} {
		if res, out := do(t, ts, "GET", p, carolTok, nil); res.StatusCode != 403 || errCode(out) != "admin_only" {
			t.Errorf("carol GET %s: %d %v", p, res.StatusCode, out)
		}
	}
	if code, _, _ := fetch(t, ts, "/media/bugs/"+shot, ""); code != 401 {
		t.Errorf("signed out: %d", code)
	}
	if res, out := do(t, ts, "GET", "/api/v1/bugs", carolTok, nil); res.StatusCode != 200 || len(out["reports"].([]any)) != 0 {
		t.Errorf("carol's own list: %d %v", res.StatusCode, out)
	}
	// the reporter sees their files, and the one not sent yet; the staff see the sent ones
	for _, c := range []struct {
		path, tok, ctype string
		code             int
	}{
		{"/media/bugs/" + shot, bobTok, "image/png", 200},
		{"/media/bugs/" + unsent, bobTok, "image/png", 200},
		{"/media/bugs/" + shot, aliceTok, "image/png", 200},
		{"/media/bugs/" + clip, aliceTok, "video/mp4", 200},
		{"/media/bugs/" + unsent, aliceTok, "", 404},
	} {
		code, ctype, _ := fetch(t, ts, c.path, c.tok)
		if code != c.code || (c.ctype != "" && ctype != c.ctype) {
			t.Errorf("GET %s: %d %s, want %d %s", c.path, code, ctype, c.code, c.ctype)
		}
	}
	if code, _, thumb := fetch(t, ts, "/media/bugs/"+shot+"?size=16", aliceTok); code != 200 || len(thumb) == 0 {
		t.Errorf("thumbnail: %d", code)
	}

	// the staff list, filtered
	res, list := do(t, ts, "GET", "/api/v1/moderation/bugs?waiting=1&files=1&q=calls", aliceTok, nil)
	if res.StatusCode != 200 || len(list["reports"].([]any)) != 1 || list["people"].(map[string]any)[bobID] == nil {
		t.Fatalf("staff list: %d %v", res.StatusCode, list)
	}
	if _, none := do(t, ts, "GET", "/api/v1/moderation/bugs?status=resolved", aliceTok, nil); len(none["reports"].([]any)) != 0 {
		t.Errorf("resolved view: %v", none)
	}

	// a staff reply reaches the reporter as news from Nexa
	res, out := do(t, ts, "POST", "/api/v1/moderation/bugs/"+id+"/messages", aliceTok, map[string]any{"body": "Which browser are you using?"})
	if res.StatusCode != 201 || out["report"].(map[string]any)["awaiting"] != "member" {
		t.Fatalf("staff reply: %d %v", res.StatusCode, out)
	}
	ev := gb.next("nexa_bug", 3*time.Second)
	if ev == nil || len(ev["messages"].([]any)) != 1 || ev["messages"].([]any)[0].(map[string]any)["kind"] != "staff" || ev["state"].(map[string]any)["unread"].(float64) != 1 {
		t.Fatalf("reporter event for a reply: %v", ev)
	}
	if st := meNexa(t, ts, bobTok); st["unread"].(float64) != 1 {
		t.Errorf("unread from Nexa: %v", st)
	}
	_, feed := do(t, ts, "GET", "/api/v1/nexa/feed", bobTok, nil)
	kinds := map[string]int{}
	for _, it := range feed["items"].([]any) {
		kinds[it.(map[string]any)["kind"].(string)]++
	}
	if kinds["bug"] != 1 || kinds["bug_reply"] != 1 {
		t.Errorf("feed kinds %v", kinds)
	}

	// a change of status answers it, and the reporter sees that too
	if res, out := do(t, ts, "POST", "/api/v1/moderation/bugs/"+id+"/status", aliceTok, map[string]any{"status": "fixed"}); res.StatusCode != 400 || errCode(out) != "bad_status" {
		t.Errorf("unknown status: %d %v", res.StatusCode, out)
	}
	res, out = do(t, ts, "POST", "/api/v1/moderation/bugs/"+id+"/status", aliceTok, map[string]any{"status": "resolved"})
	if res.StatusCode != 200 || out["report"].(map[string]any)["status"] != "resolved" || len(out["messages"].([]any)) != 1 {
		t.Fatalf("status: %d %v", res.StatusCode, out)
	}
	if ev := gb.next("nexa_bug", 3*time.Second); ev == nil || ev["report"].(map[string]any)["status"] != "resolved" || ev["state"].(map[string]any)["unread"].(float64) != 2 {
		t.Errorf("reporter event for a status: %v", ev)
	}

	// the reporter answers: it keeps its status and waits on staff again
	res, out = do(t, ts, "POST", "/api/v1/bugs/"+id+"/messages", bobTok, map[string]any{"body": "Firefox, and it still happens"})
	if res.StatusCode != 201 || out["report"].(map[string]any)["status"] != "resolved" || out["report"].(map[string]any)["awaiting"] != "staff" {
		t.Fatalf("reporter reply: %d %v", res.StatusCode, out)
	}
	if ev := ga.next("mod_bug", 3*time.Second); ev == nil {
		t.Error("the staff did not hear the reply")
	}
	res, thread := do(t, ts, "GET", "/api/v1/bugs/"+id, bobTok, nil)
	msgs := thread["messages"].([]any)
	if res.StatusCode != 200 || len(msgs) != 3 || thread["people"].(map[string]any)[bobID] == nil {
		t.Fatalf("thread: %d %v", res.StatusCode, thread)
	}
	last := msgs[len(msgs)-1].(map[string]any)["id"].(string)
	if res, _ := do(t, ts, "POST", "/api/v1/bugs/"+id+"/read", bobTok, map[string]any{"message_id": last}); res.StatusCode != 204 {
		t.Errorf("read: %d", res.StatusCode)
	}
	if st := meNexa(t, ts, bobTok); st["unread"].(float64) != 0 {
		t.Errorf("unread after reading: %v", st)
	}
	if st := meNexa(t, ts, aliceTok); st["staff"].(map[string]any)["bugs"].(map[string]any)["waiting"].(float64) != 1 {
		t.Errorf("staff counts on arrival: %v", st["staff"])
	}
	// a file sent once cannot be sent again
	if res, out := do(t, ts, "POST", "/api/v1/bugs", bobTok, bugBody("Again", shot)); res.StatusCode != 400 || errCode(out) != "attachment_gone" {
		t.Errorf("a file sent twice: %d %v", res.StatusCode, out)
	}
}

func TestBugReportRulesAndLimits(t *testing.T) {
	_, ts := newTestServer(t)
	register(t, ts, "alice")
	bobTok, _ := register(t, ts, "bob")
	carolTok, _ := register(t, ts, "carol")
	carolFile := mustBugUpload(t, ts, carolTok, "c.png", "image/png", pngBytes(8, 8))
	bobFile := mustBugUpload(t, ts, bobTok, "b.png", "image/png", pngBytes(8, 8))
	for _, c := range []struct {
		name string
		body map[string]any
		code string
	}{
		{"no subject", map[string]any{"subject": " ", "description": "It stopped working when I pressed it."}, "subject_required"},
		{"long subject", map[string]any{"subject": strings.Repeat("a", 121), "description": "It stopped working when I pressed it."}, "subject_too_long"},
		{"short description", map[string]any{"subject": "Broken", "description": "bad"}, "description_required"},
		{"long description", map[string]any{"subject": "Broken", "description": strings.Repeat("a", 4001)}, "description_too_long"},
		{"someone else's file", bugBody("Broken", carolFile), "attachment_gone"},
		{"too many files", bugBody("Broken", "1", "2", "3", "4", "5", "6"), "too_many_files"},
		{"a file twice", bugBody("Broken", bobFile, bobFile), "bad_attachment"},
	} {
		if res, out := do(t, ts, "POST", "/api/v1/bugs", bobTok, c.body); res.StatusCode != 400 || errCode(out) != c.code {
			t.Errorf("%s: %d %v", c.name, res.StatusCode, out)
		}
	}
	// the mistakes above used none of bob's reports for the hour
	for i := 0; i < 4; i++ {
		mustBug(t, ts, bobTok, bugBody("Broken thing"))
	}
	res, out := do(t, ts, "POST", "/api/v1/bugs", bobTok, bugBody("One too many"))
	if res.StatusCode != 429 || res.Header.Get("Retry-After") == "" {
		t.Errorf("fifth report in an hour: %d %v", res.StatusCode, out)
	}
	// someone else still can
	mustBug(t, ts, carolTok, bugBody("Broken for me too"))
}

func TestBugReportsUnderMuteAndBan(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.limBug = ratelimit.New(rate.Inf, 1000, time.Hour)
	aliceTok, _ := register(t, ts, "alice")
	bobTok, bobID := register(t, ts, "bob")
	carolTok, carolID := register(t, ts, "carol")
	earlier := mustBug(t, ts, carolTok, bugBody("Sent before the ban"))

	mustAct(t, ts, aliceTok, bobID, map[string]any{"action": "mute", "reason": "testing the rules", "duration_ms": 3600000})
	file := mustBugUpload(t, ts, bobTok, "m.png", "image/png", pngBytes(8, 8))
	report := mustBug(t, ts, bobTok, bugBody("Muted, but this is broken", file))
	if res, out := do(t, ts, "POST", "/api/v1/bugs/"+report["id"].(string)+"/messages", bobTok, map[string]any{"body": "more detail"}); res.StatusCode != 201 {
		t.Errorf("muted reply: %d %v", res.StatusCode, out)
	}

	mustAct(t, ts, aliceTok, carolID, map[string]any{"action": "ban", "reason": "testing the rules", "duration_ms": 3600000})
	if code, out := bugUpload(t, ts, carolTok, "b.png", "image/png", pngBytes(8, 8)); code != 403 || errCode(out) != "account_banned" {
		t.Errorf("banned upload: %d %v", code, out)
	}
	if res, out := do(t, ts, "POST", "/api/v1/bugs", carolTok, bugBody("Banned")); res.StatusCode != 403 || errCode(out) != "account_banned" {
		t.Errorf("banned report: %d %v", res.StatusCode, out)
	}
	id := earlier["id"].(string)
	if res, out := do(t, ts, "POST", "/api/v1/bugs/"+id+"/messages", carolTok, map[string]any{"body": "hello"}); res.StatusCode != 403 || errCode(out) != "account_banned" {
		t.Errorf("banned reply: %d %v", res.StatusCode, out)
	}
	for _, p := range []string{"/api/v1/bugs", "/api/v1/bugs/" + id} {
		if res, out := do(t, ts, "GET", p, carolTok, nil); res.StatusCode != 200 {
			t.Errorf("banned GET %s: %d %v", p, res.StatusCode, out)
		}
	}
}
