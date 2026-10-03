package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"golang.org/x/time/rate"

	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/ratelimit"
)

func setTag(t *testing.T, ts *httptest.Server, token, server string, body map[string]any) (*http.Response, map[string]any) {
	t.Helper()
	return do(t, ts, "PUT", "/api/v1/servers/"+server+"/tag", token, body)
}

func wornTag(t *testing.T, ts *httptest.Server, token, uid string) map[string]any {
	t.Helper()
	_, u := do(t, ts, "GET", "/api/v1/users/"+uid, token, nil)
	tag, _ := u["server_tag"].(map[string]any)
	return tag
}

func TestServerTagsAreWornAndKeptInStep(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.limTag = ratelimit.New(rate.Inf, 1000, time.Hour)
	owner, _ := register(t, ts, "owner")
	bob, bobID := register(t, ts, "bob")
	carol, _ := register(t, ts, "carol")
	view := createServer(t, ts, owner, "Fish Club")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	join(t, ts, bob, inviteFor(t, ts, owner, general))

	// nobody can wear what is not there
	if res, body := do(t, ts, "PUT", "/api/v1/users/@me/server-tag", bob, map[string]any{"server_id": sid}); res.StatusCode != 400 || errCode(body) != "no_tag" {
		t.Fatalf("wear before a tag: %d %v", res.StatusCode, body)
	}
	for _, bad := range []map[string]any{
		{"text": "", "badge": "icon:fish"},
		{"text": "MUCHTOOLONG", "badge": "icon:fish"},
		{"text": "Z\u0301\u0302\u0303\u0304", "badge": "icon:fish"},
		{"text": "A B", "badge": "icon:fish"},
		{"text": "FISH", "badge": "icon:kraken"},
		{"text": "FISH", "badge": "image:12345"},
		{"text": "FISH", "badge": "icon:fish", "color": 0x1000000},
	} {
		if res, body := setTag(t, ts, owner, sid, bad); res.StatusCode != 400 {
			t.Errorf("bad tag %v: %d %v", bad, res.StatusCode, body)
		}
	}
	// a member who does not run the server cannot set it
	if res, _ := setTag(t, ts, bob, sid, map[string]any{"text": "FISH", "badge": "icon:fish"}); res.StatusCode != 403 {
		t.Errorf("member sets tag: %d", res.StatusCode)
	}
	res, body := setTag(t, ts, owner, sid, map[string]any{"text": "FISH", "badge": "icon:fish", "color": 0x3d9e60})
	if res.StatusCode != 200 {
		t.Fatalf("set tag: %d %v", res.StatusCode, body)
	}
	if tag, _ := body["tag"].(map[string]any); tag["text"] != "FISH" || tag["join"] != false {
		t.Errorf("server's tag: %v", body["tag"])
	}
	// letters in any script count as letters, and their marks are part of them
	if res, body := setTag(t, ts, owner, sid, map[string]any{"text": "हिंदी", "badge": "icon:fish"}); res.StatusCode != 200 {
		t.Errorf("two letters with their marks: %d %v", res.StatusCode, body)
	}
	if res, body := setTag(t, ts, owner, sid, map[string]any{"text": "ABCDEFGH", "badge": "icon:fish"}); res.StatusCode != 200 {
		t.Errorf("eight letters: %d %v", res.StatusCode, body)
	}
	if res, body := setTag(t, ts, owner, sid, map[string]any{"text": "ABCDEFGHI", "badge": "icon:fish"}); res.StatusCode != 400 {
		t.Errorf("nine letters: %d %v", res.StatusCode, body)
	}
	if res, body := setTag(t, ts, owner, sid, map[string]any{"text": "FISH", "badge": "icon:fish", "color": 0x3d9e60}); res.StatusCode != 200 {
		t.Fatalf("set again: %d %v", res.StatusCode, body)
	}

	// Bob wears it, and anyone looking at him sees it
	if res, body := do(t, ts, "PUT", "/api/v1/users/@me/server-tag", bob, map[string]any{"server_id": sid}); res.StatusCode != 200 {
		t.Fatalf("wear: %d %v", res.StatusCode, body)
	}
	tag := wornTag(t, ts, carol, bobID)
	if tag["text"] != "FISH" || tag["badge"] != "icon:fish" || tag["server_id"] != sid {
		t.Fatalf("worn tag: %v", tag)
	}
	// someone outside the server cannot wear it
	if res, _ := do(t, ts, "PUT", "/api/v1/users/@me/server-tag", carol, map[string]any{"server_id": sid}); res.StatusCode != 403 && res.StatusCode != 400 {
		t.Errorf("outsider wears: %d", res.StatusCode)
	}
	// a new colour reaches him
	if res, body := setTag(t, ts, owner, sid, map[string]any{"text": "FISH", "badge": "icon:fish", "color": 0xda3e44}); res.StatusCode != 200 {
		t.Fatalf("recolour: %d %v", res.StatusCode, body)
	}
	if tag := wornTag(t, ts, carol, bobID); tag["color"].(float64) != 0xda3e44 {
		t.Errorf("after recolour: %v", tag)
	}
	// new letters take it off him
	if res, body := setTag(t, ts, owner, sid, map[string]any{"text": "CARP", "badge": "icon:fish"}); res.StatusCode != 200 {
		t.Fatalf("new letters: %d %v", res.StatusCode, body)
	}
	if tag := wornTag(t, ts, carol, bobID); tag != nil {
		t.Errorf("after new letters: %v", tag)
	}

	// kept to a role: only with it, and losing it takes the tag off
	role := createRole(t, ts, owner, sid, "Crew", 0)
	if res, body := setTag(t, ts, owner, sid, map[string]any{"text": "CARP", "badge": "icon:fish", "limited": true, "roles": []string{role}}); res.StatusCode != 200 {
		t.Fatalf("limit: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PUT", "/api/v1/users/@me/server-tag", bob, map[string]any{"server_id": sid}); res.StatusCode != 403 || errCode(body) != "tag_not_yours" {
		t.Errorf("wear without the role: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PUT", "/api/v1/servers/"+sid+"/members/"+bobID+"/roles/"+role, owner, nil); res.StatusCode >= 300 {
		t.Fatalf("give role: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PUT", "/api/v1/users/@me/server-tag", bob, map[string]any{"server_id": sid}); res.StatusCode != 200 {
		t.Fatalf("wear with the role: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "DELETE", "/api/v1/servers/"+sid+"/members/"+bobID+"/roles/"+role, owner, nil); res.StatusCode >= 300 {
		t.Fatalf("take role: %d %v", res.StatusCode, body)
	}
	if tag := wornTag(t, ts, carol, bobID); tag != nil {
		t.Errorf("after losing the role: %v", tag)
	}

	// open to everyone again; leaving takes it off
	if res, body := setTag(t, ts, owner, sid, map[string]any{"text": "CARP", "badge": "icon:fish"}); res.StatusCode != 200 {
		t.Fatalf("open: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PUT", "/api/v1/users/@me/server-tag", bob, map[string]any{"server_id": sid}); res.StatusCode != 200 {
		t.Fatalf("wear again: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "POST", "/api/v1/servers/"+sid+"/leave", bob, nil); res.StatusCode >= 300 {
		t.Fatalf("leave: %d", res.StatusCode)
	}
	if tag := wornTag(t, ts, carol, bobID); tag != nil {
		t.Errorf("after leaving: %v", tag)
	}
}

func TestServerTagPreviewAndJoining(t *testing.T) {
	_, ts := newTestServer(t)
	owner, _ := register(t, ts, "owner")
	carol, _ := register(t, ts, "carol")
	view := createServer(t, ts, owner, "Fish Club")
	sid := view["id"].(string)
	if res, _ := do(t, ts, "GET", "/api/v1/server-tags/"+sid, carol, nil); res.StatusCode != 404 {
		t.Errorf("preview without a tag: %d", res.StatusCode)
	}
	setTag(t, ts, owner, sid, map[string]any{"text": "FISH", "badge": "icon:fish"})
	res, body := do(t, ts, "GET", "/api/v1/server-tags/"+sid, carol, nil)
	server, _ := body["server"].(map[string]any)
	if res.StatusCode != 200 || server["name"] != "Fish Club" || body["member"] != false || body["invite"] != nil {
		t.Fatalf("preview: %d %v", res.StatusCode, body)
	}
	// joining from the tag keeps an invite for it
	if res, body := setTag(t, ts, owner, sid, map[string]any{"text": "FISH", "badge": "icon:fish", "join": true}); res.StatusCode != 200 {
		t.Fatalf("join on: %d %v", res.StatusCode, body)
	}
	_, body = do(t, ts, "GET", "/api/v1/server-tags/"+sid, carol, nil)
	code, _ := body["invite"].(string)
	if code == "" {
		t.Fatalf("no invite to join through: %v", body)
	}
	joined := join(t, ts, carol, code)
	if joined["id"] != sid {
		t.Errorf("joined %v", joined["id"])
	}
	_, body = do(t, ts, "GET", "/api/v1/server-tags/"+sid, carol, nil)
	if body["member"] != true || body["can_wear"] != true {
		t.Errorf("as a member: %v", body)
	}
	// turned off, the invite goes
	setTag(t, ts, owner, sid, map[string]any{"text": "FISH", "badge": "icon:fish", "join": false})
	if res, _ := do(t, ts, "GET", "/api/v1/invites/"+code, carol, nil); res.StatusCode != 404 {
		t.Errorf("kept invite after turning joining off: %d", res.StatusCode)
	}
	// the server going takes the tag off its wearers
	do(t, ts, "PUT", "/api/v1/users/@me/server-tag", carol, map[string]any{"server_id": sid})
	if res, _ := do(t, ts, "DELETE", "/api/v1/servers/"+sid, owner, nil); res.StatusCode != 204 {
		t.Fatalf("delete server: %d", res.StatusCode)
	}
	_, me := do(t, ts, "GET", "/api/v1/users/@me", carol, nil)
	if me["server_tag"] != nil {
		t.Errorf("tag of a deleted server: %v", me["server_tag"])
	}
}

// A badge picture is cut on the server, kept moving, and held while the tag names it.
func TestServerTagBadgePicture(t *testing.T) {
	_, ts := newTestServer(t)
	owner, _ := register(t, ts, "owner")
	view := createServer(t, ts, owner, "Fish Club")
	sid := view["id"].(string)
	gif, err := os.ReadFile("../media/testdata/crop/anim.gif")
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/servers/"+sid+"/tag/badge?x=10&y=0&w=64&h=64", bytes.NewReader(gif))
	req.Header.Set("Authorization", "Bearer "+owner)
	req.Header.Set("Content-Type", "image/gif")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	var up map[string]any
	_ = json.Unmarshal(raw, &up)
	badge, _ := up["badge"].(string)
	if res.StatusCode != 200 || badge == "" || up["animated"] != true {
		t.Fatalf("upload: %d %s", res.StatusCode, raw)
	}
	if res, body := setTag(t, ts, owner, sid, map[string]any{"text": "FISH", "badge": badge}); res.StatusCode != 200 {
		t.Fatalf("set with picture: %d %v", res.StatusCode, body)
	}
	// the picture is served, still moving, at the badge's size
	pic, err := http.Get(ts.URL + "/media/tag/" + up["id"].(string))
	if err != nil {
		t.Fatal(err)
	}
	head, _ := io.ReadAll(pic.Body)
	pic.Body.Close()
	if pic.StatusCode != 200 || pic.Header.Get("Content-Type") != "image/gif" || !bytes.HasPrefix(head, []byte("GIF89a")) {
		t.Errorf("served badge: %d %s", pic.StatusCode, pic.Header.Get("Content-Type"))
	}
	_ = perms.ManageServer
}
