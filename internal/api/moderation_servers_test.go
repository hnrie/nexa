package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// authedGet fetches a path with a session's token, for files the API serves.
func authedGet(t *testing.T, ts *httptest.Server, tok, path string) (int, []byte) {
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
	return res.StatusCode, b
}

func caseUpload(t *testing.T, ts *httptest.Server, path, tok, name string, body []byte) (int, map[string]any) {
	t.Helper()
	res, raw := rawPost(t, ts.URL+path+"?name="+name, tok, "image/png", body)
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

// Pictures in a case's thread: both sides can send them, only the two sides
// can see them, and a file is sent once, by whoever uploaded it.
func TestCaseFiles(t *testing.T) {
	_, ts := newTestServer(t)
	modTok, _ := register(t, ts, "owner")
	tok, id := register(t, ts, "alice")
	otherTok, _ := register(t, ts, "mallory")
	c := mustAct(t, ts, modTok, id, map[string]any{"action": "mute", "reason": "spam", "duration_ms": 3600000})
	cid := c["id"].(string)

	// the member, muted, can still add a picture to their appeal
	code, up := caseUpload(t, ts, "/api/v1/nexa/cases/attachments", tok, "shot.png", pngBytes(64, 48))
	if code != 201 || up["mime"] != "image/png" || up["width"].(float64) != 64 {
		t.Fatalf("member upload: %d %v", code, up)
	}
	memberFile := up["id"].(string)
	// before it is sent, only its uploader can see it
	if code, _ := authedGet(t, ts, modTok, "/media/cases/"+memberFile); code != 404 {
		t.Errorf("staff saw an unsent file: %d", code)
	}
	if code, _ := authedGet(t, ts, tok, "/media/cases/"+memberFile); code != 200 {
		t.Errorf("uploader could not see their unsent file: %d", code)
	}
	// someone else's file cannot be sent as yours
	code, other := caseUpload(t, ts, "/api/v1/nexa/cases/attachments", otherTok, "x.png", pngBytes(8, 8))
	if code != 201 {
		t.Fatalf("other upload: %d %v", code, other)
	}
	if res, body := do(t, ts, "POST", "/api/v1/nexa/cases/"+cid+"/messages", tok, map[string]any{"files": []map[string]any{{"id": other["id"], "name": "x.png"}}}); res.StatusCode != 400 || errCode(body) != "bad_file" {
		t.Errorf("sent someone else's file: %d %v", res.StatusCode, body)
	}
	// a picture alone is a line
	res, body := do(t, ts, "POST", "/api/v1/nexa/cases/"+cid+"/messages", tok, map[string]any{"files": []map[string]any{{"id": memberFile, "name": "shot.png"}}})
	if res.StatusCode != 201 {
		t.Fatalf("member line with a picture: %d %v", res.StatusCode, body)
	}
	files := body["message"].(map[string]any)["files"].([]any)
	if len(files) != 1 || files[0].(map[string]any)["id"] != memberFile || files[0].(map[string]any)["name"] != "shot.png" || files[0].(map[string]any)["width"].(float64) != 64 {
		t.Errorf("line's files: %v", files)
	}
	// and once sent, it is not sent again
	if res, body := do(t, ts, "POST", "/api/v1/nexa/cases/"+cid+"/messages", tok, map[string]any{"body": "again", "files": []map[string]any{{"id": memberFile}}}); res.StatusCode != 400 || errCode(body) != "bad_file" {
		t.Errorf("sent a file twice: %d %v", res.StatusCode, body)
	}
	// staff send theirs the same way
	code, up = caseUpload(t, ts, "/api/v1/moderation/cases/attachments", modTok, "evidence.png", pngBytes(32, 32))
	if code != 201 {
		t.Fatalf("staff upload: %d %v", code, up)
	}
	staffFile := up["id"].(string)
	if res, body := do(t, ts, "POST", "/api/v1/moderation/cases/"+cid+"/messages", modTok, map[string]any{"body": "This is what we saw.", "files": []map[string]any{{"id": staffFile, "name": "evidence.png"}}}); res.StatusCode != 201 {
		t.Fatalf("staff line with a picture: %d %v", res.StatusCode, body)
	}
	// the case's two sides can see both; nobody else sees either
	for _, f := range []string{memberFile, staffFile} {
		if code, _ := authedGet(t, ts, tok, "/media/cases/"+f); code != 200 {
			t.Errorf("member could not see %s: %d", f, code)
		}
		if code, _ := authedGet(t, ts, modTok, "/media/cases/"+f); code != 200 {
			t.Errorf("staff could not see %s: %d", f, code)
		}
		if code, _ := authedGet(t, ts, otherTok, "/media/cases/"+f); code != 404 {
			t.Errorf("an outsider saw %s: %d", f, code)
		}
		if code, _ := authedGet(t, ts, "", "/media/cases/"+f); code == 200 {
			t.Errorf("a stranger with no session saw %s", f)
		}
	}
	// the thread carries them, for both sides
	for _, path := range []string{"/api/v1/nexa/cases/" + cid, "/api/v1/moderation/cases/" + cid} {
		who := tok
		if strings.Contains(path, "moderation") {
			who = modTok
		}
		_, thread := do(t, ts, "GET", path, who, nil)
		n := 0
		for _, m := range thread["messages"].([]any) {
			if fs, ok := m.(map[string]any)["files"].([]any); ok {
				n += len(fs)
			}
		}
		if n != 2 {
			t.Errorf("%s: %d files in the thread", path, n)
		}
	}
	// at most four at a time
	many := []map[string]any{}
	for i := 0; i < 5; i++ {
		many = append(many, map[string]any{"id": "1234" + strings.Repeat("5", i)})
	}
	if res, body := do(t, ts, "POST", "/api/v1/nexa/cases/"+cid+"/messages", tok, map[string]any{"files": many}); errCode(body) != "too_many_files" {
		t.Errorf("five files: %d %v", res.StatusCode, body)
	}
}

// What a server shows everyone, moderated: the staff list servers and act on
// one, which opens a case for its owner and changes the server for everyone in it.
func TestServerModeration(t *testing.T) {
	_, ts := newTestServer(t)
	modTok, modID := register(t, ts, "owner")
	tok, ownerID := register(t, ts, "alice")
	memberTok, _ := register(t, ts, "bob")
	view := createServer(t, ts, tok, "Free Nitro Here")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	join(t, ts, memberTok, inviteFor(t, ts, tok, general))
	if res, _ := do(t, ts, "PATCH", "/api/v1/servers/"+sid, tok, map[string]any{"description": "Click https://scam.example for prizes"}); res.StatusCode != 200 {
		t.Fatal("describe")
	}
	if res, raw := rawPut(t, ts.URL+"/api/v1/servers/"+sid+"/icon", tok, "image/png", pngBytes(64, 64)); res.StatusCode != 200 {
		t.Fatalf("icon: %d %s", res.StatusCode, raw)
	}
	// staff only
	if res, _ := do(t, ts, "GET", "/api/v1/moderation/servers", tok, nil); res.StatusCode != 403 && res.StatusCode != 404 {
		t.Errorf("a member listed servers: %d", res.StatusCode)
	}
	// the list: what the server shows, who owns it, how many are in it
	res, body := do(t, ts, "GET", "/api/v1/moderation/servers?q=nitro", modTok, nil)
	list := body["servers"].([]any)
	if res.StatusCode != 200 || len(list) != 1 {
		t.Fatalf("search: %d %v", res.StatusCode, body)
	}
	got := list[0].(map[string]any)
	if got["name"] != "Free Nitro Here" || got["owner_id"] != ownerID || got["member_count"].(float64) != 2 || got["icon_id"] == nil || got["blocked"] != "" {
		t.Errorf("listed server: %v", got)
	}
	if body["people"].(map[string]any)[ownerID] == nil {
		t.Errorf("the owner is not named: %v", body["people"])
	}
	if _, body := do(t, ts, "GET", "/api/v1/moderation/servers?q=alice", modTok, nil); len(body["servers"].([]any)) != 1 {
		t.Errorf("search by owner: %v", body)
	}
	if _, body := do(t, ts, "GET", "/api/v1/moderation/servers?q=nothing-like-it", modTok, nil); len(body["servers"].([]any)) != 0 {
		t.Errorf("search for nothing: %v", body)
	}
	// nothing taken back without a reason, and only what is there
	act := "/api/v1/moderation/servers/" + sid + "/actions"
	if res, body := do(t, ts, "POST", act, modTok, map[string]any{"fields": []string{"name"}, "reason": ""}); errCode(body) != "reason_required" {
		t.Errorf("no reason: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "POST", act, modTok, map[string]any{"fields": []string{"banner"}, "reason": "rules"}); errCode(body) != "no_banner" {
		t.Errorf("no banner: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "POST", act, modTok, map[string]any{"fields": []string{"channels"}, "reason": "rules"}); errCode(body) != "unknown_field" {
		t.Errorf("unknown field: %d %v", res.StatusCode, body)
	}
	ownerGW := connectGW(t, ts, tok)
	memberGW := connectGW(t, ts, memberTok)
	res, body = do(t, ts, "POST", act, modTok, map[string]any{"fields": []string{"icon", "name", "description"}, "reason": "Scam links in the server's profile."})
	if res.StatusCode != 201 {
		t.Fatalf("server reset: %d %v", res.StatusCode, body)
	}
	c := body["case"].(map[string]any)
	if c["action"] != "server_reset" || c["user_id"] != ownerID {
		t.Errorf("case: %v", c)
	}
	d := c["details"].(map[string]any)
	if d["server_id"] != sid || d["server_name"] != "Free Nitro Here" || d["old"].(map[string]any)["description"] != "Click https://scam.example for prizes" {
		t.Errorf("case details: %v", d)
	}
	newName := d["new"].(map[string]any)["name"].(string)
	if !strings.HasPrefix(newName, "MODERATOR_REMOVED_") {
		t.Errorf("new name: %q", newName)
	}
	// everyone in it sees the change at once
	ev := memberGW.next("server_update", 3*time.Second)
	if ev == nil || ev["name"] != newName || ev["description"] != "" || ev["icon_id"] != nil {
		t.Errorf("members' server_update: %v", ev)
	}
	// and the owner is told, with the reason
	if ev := ownerGW.next("nexa_notice", 3*time.Second); ev == nil || ev["case"].(map[string]any)["reason"] != "Scam links in the server's profile." {
		t.Errorf("owner's notice: %v", ev)
	}
	// the server's page in the panel names the case
	_, detail := do(t, ts, "GET", "/api/v1/moderation/servers/"+sid, modTok, nil)
	if detail["server"].(map[string]any)["name"] != newName || len(detail["cases"].([]any)) != 1 {
		t.Errorf("server detail: %v", detail)
	}
	// the log has it
	_, log := do(t, ts, "GET", "/api/v1/moderation/log?action=server_reset", modTok, nil)
	if entries := log["entries"].([]any); len(entries) != 1 || entries[0].(map[string]any)["moderator_id"] != modID {
		t.Errorf("log: %v", log)
	}
	// a server of the owner of Nexa is out of reach, like the owner is
	mine := createServer(t, ts, modTok, "Staff Room")
	if res, body := do(t, ts, "POST", "/api/v1/moderation/servers/"+mine["id"].(string)+"/actions", modTok, map[string]any{"fields": []string{"name"}, "reason": "testing"}); res.StatusCode == 201 {
		t.Errorf("moderated their own server: %v", body)
	}
}

// A person's full profile in the panel shows where else it appears: the
// servers they own and the nicknames they go by, which can be reset.
func TestProfileServersAndNicknames(t *testing.T) {
	_, ts := newTestServer(t)
	modTok, _ := register(t, ts, "owner")
	tok, id := register(t, ts, "alice")
	bobTok, _ := register(t, ts, "bob")
	own := createServer(t, ts, tok, "Alice's Place")
	theirs := createServer(t, ts, bobTok, "Bob's Place")
	quiet := createServer(t, ts, bobTok, "Bob's Quiet Place")
	join(t, ts, tok, inviteFor(t, ts, bobTok, channelNamed(theirs, "general")["id"].(string)))
	join(t, ts, tok, inviteFor(t, ts, bobTok, channelNamed(quiet, "general")["id"].(string)))
	if res, body := do(t, ts, "PATCH", "/api/v1/servers/"+theirs["id"].(string)+"/members/"+id, tok, map[string]any{"nick": "Rude Name"}); res.StatusCode != 200 {
		t.Fatalf("nickname: %d %v", res.StatusCode, body)
	}
	_, user := do(t, ts, "GET", "/api/v1/moderation/users/"+id, modTok, nil)
	servers := user["servers"].([]any)
	// their own server and the one they go by a nickname in; not the one where they are only a member
	if len(servers) != 2 || servers[0].(map[string]any)["server_id"] != own["id"] || servers[0].(map[string]any)["owner"] != true || servers[1].(map[string]any)["nickname"] != "Rude Name" {
		t.Errorf("profile servers: %v", servers)
	}
	c := mustAct(t, ts, modTok, id, map[string]any{"action": "field_reset", "fields": []string{"nicknames"}, "reason": "Rude nickname."})
	if old := c["details"].(map[string]any)["old"].(map[string]any)["nicknames"]; old != "Bob's Place: Rude Name" {
		t.Errorf("what the case kept: %v", old)
	}
	_, user = do(t, ts, "GET", "/api/v1/moderation/users/"+id, modTok, nil)
	if servers := user["servers"].([]any); len(servers) != 1 {
		t.Errorf("a nickname survived the reset: %v", servers)
	}
	// with none left, there is nothing to reset
	if res, body := do(t, ts, "POST", "/api/v1/moderation/users/"+id+"/actions", modTok, map[string]any{"action": "field_reset", "fields": []string{"nicknames"}, "reason": "again"}); errCode(body) != "field_empty" {
		t.Errorf("second reset: %d %v", res.StatusCode, body)
	}
}
