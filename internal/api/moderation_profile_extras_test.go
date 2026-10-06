package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"golang.org/x/time/rate"

	"evilion.xyz/chat/internal/ratelimit"
)

// The parts of a profile people write that came after the first moderation
// tools: the typing indicator's words, the widgets and the server tag worn.
// Staff clear them like a status, the widgets' pictures are let go, and a
// server's own tag comes down with the server's other parts, off everyone
// wearing it.
func TestStaffClearTypingWidgetsAndTags(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.limTag = ratelimit.New(rate.Inf, 1000, time.Hour)
	modTok, _ := register(t, ts, "owner")
	tok, id := register(t, ts, "loud")
	bob, bobID := register(t, ts, "bob")

	// a typing line, a card with a picture, and a tag to wear
	if res, body := do(t, ts, "PATCH", "/api/v1/users/@me", tok, map[string]any{"typing_style": map[string]any{"emoji": []string{"🔥"}, "motion": "wave", "words": "is up to no good"}}); res.StatusCode != 200 {
		t.Fatalf("typing style: %d %v", res.StatusCode, body)
	}
	still, err := os.ReadFile("../media/testdata/crop/still.png")
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/users/@me/widgets/image?shape=square", bytes.NewReader(still))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "image/png")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	var pic map[string]any
	_ = json.Unmarshal(raw, &pic)
	picID, _ := pic["id"].(string)
	if res, body := do(t, ts, "PUT", "/api/v1/users/@me/widgets", tok, map[string]any{"widgets": []any{
		map[string]any{"type": "custom", "title": "Rude Card", "image": picID, "shape": "square", "text": "something hateful"},
		map[string]any{"type": "played", "games": []any{map[string]any{"name": "A Game"}}},
	}}); res.StatusCode != 200 {
		t.Fatalf("widgets: %d %v", res.StatusCode, body)
	}
	view := createServer(t, ts, tok, "Loud Club")
	sid := view["id"].(string)
	general := channelNamed(view, "general")["id"].(string)
	join(t, ts, bob, inviteFor(t, ts, tok, general))
	if res, body := setTag(t, ts, tok, sid, map[string]any{"text": "LOUD", "badge": "icon:flame"}); res.StatusCode != 200 {
		t.Fatalf("tag: %d %v", res.StatusCode, body)
	}
	for _, who := range []string{tok, bob} {
		if res, body := do(t, ts, "PUT", "/api/v1/users/@me/server-tag", who, map[string]any{"server_id": sid}); res.StatusCode != 200 {
			t.Fatalf("wear: %d %v", res.StatusCode, body)
		}
	}

	// the panel shows the widgets on the account's page, to be judged
	_, detail := do(t, ts, "GET", "/api/v1/moderation/users/"+id, modTok, nil)
	if w, _ := detail["user"].(map[string]any)["widgets"].([]any); len(w) != 2 {
		t.Errorf("the panel's account page has no widgets: %v", detail["user"])
	}

	c := mustAct(t, ts, modTok, id, map[string]any{"action": "field_reset", "reason": "hateful profile", "fields": []string{"typing_style", "widgets", "server_tag"}})
	u, _ := srv.Store.UserByID(context.Background(), modID(id))
	if u.TypingStyle != "" || u.WornTag() != nil {
		t.Errorf("typing style %q and tag %v left", u.TypingStyle, u.WornTag())
	}
	if w, _ := srv.Store.UserWidgets(context.Background(), modID(id)); w != "" {
		t.Errorf("widgets left: %s", w)
	}
	if b, _ := srv.Store.BlobByID(context.Background(), parsedID(t, picID)); b.RefCount != 0 {
		t.Errorf("the card's picture is still held: %d", b.RefCount)
	}
	var details struct {
		Old map[string]string `json:"old"`
	}
	rawCase, _ := json.Marshal(c["details"])
	_ = json.Unmarshal(rawCase, &details)
	if details.Old["typing_style"] != "🔥 is up to no good" || details.Old["server_tag"] != "LOUD" || details.Old["widgets"] != "custom: Rude Card / something hateful\nplayed: A Game" {
		t.Errorf("the case keeps: %q", details.Old)
	}
	// cleared fields cannot be cleared twice
	if res, body := modAct(t, ts, modTok, id, map[string]any{"action": "field_reset", "reason": "again", "fields": []string{"widgets"}}); errCode(body) != "field_empty" {
		t.Errorf("second reset: %d %v", res.StatusCode, body)
	}

	// the server's tag comes down with the server's other parts, off Bob too
	if tag := wornTag(t, ts, bob, bobID); tag == nil || tag["text"] != "LOUD" {
		t.Fatalf("bob's tag before: %v", tag)
	}
	_, list := do(t, ts, "GET", "/api/v1/moderation/servers?q=loud", modTok, nil)
	if s := list["servers"].([]any)[0].(map[string]any); s["tag"] == nil || s["tag"].(map[string]any)["text"] != "LOUD" {
		t.Errorf("the panel's server has no tag: %v", s)
	}
	act := "/api/v1/moderation/servers/" + sid + "/actions"
	if res, body := do(t, ts, "POST", act, modTok, map[string]any{"fields": []string{"tag"}, "reason": "A hateful tag."}); res.StatusCode != 201 {
		t.Fatalf("server tag reset: %d %v", res.StatusCode, body)
	}
	if tag := wornTag(t, ts, bob, bobID); tag != nil {
		t.Errorf("bob still wears it: %v", tag)
	}
	if res, body := do(t, ts, "POST", act, modTok, map[string]any{"fields": []string{"tag"}, "reason": "again"}); errCode(body) != "no_tag" {
		t.Errorf("second tag reset: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PUT", "/api/v1/users/@me/server-tag", bob, map[string]any{"server_id": sid}); res.StatusCode != 400 {
		t.Errorf("wore a tag that is gone: %d %v", res.StatusCode, body)
	}
}

// A profile in one server is as public there as the account's own: staff can
// clear its bio and pronouns, and taking the banner takes the servers' banners.
func TestStaffClearServerProfiles(t *testing.T) {
	srv, ts := newTestServer(t)
	modTok, _ := register(t, ts, "owner")
	tok, id := register(t, ts, "loud")
	view := createServer(t, ts, tok, "Loud Club")
	sid := view["id"].(string)
	if res, body := do(t, ts, "PATCH", "/api/v1/servers/"+sid+"/members/@me", tok, map[string]any{"bio": "something hateful here", "pronouns": "rude/words"}); res.StatusCode != 200 {
		t.Fatalf("server profile: %d %v", res.StatusCode, body)
	}
	png := pngBytes(64, 32)
	res, raw := rawPut(t, ts.URL+"/api/v1/servers/"+sid+"/members/@me/banner", tok, "image/png", png)
	if res.StatusCode >= 300 {
		t.Fatalf("server banner: %d %s", res.StatusCode, raw)
	}

	// the account page names the server and what is set there
	_, detail := do(t, ts, "GET", "/api/v1/moderation/users/"+id, modTok, nil)
	var found map[string]any
	for _, s := range detail["servers"].([]any) {
		if s.(map[string]any)["server_id"] == sid {
			found = s.(map[string]any)
		}
	}
	if found == nil || found["bio"] != "something hateful here" || found["pronouns"] != "rude/words" || found["banner_id"] == nil {
		t.Fatalf("the panel's servers: %v", detail["servers"])
	}

	c := mustAct(t, ts, modTok, id, map[string]any{"action": "field_reset", "reason": "hateful profile", "fields": []string{"server_profiles"}})
	m, err := srv.Store.Member(context.Background(), modID(sid), modID(id))
	if err != nil || m.Bio != "" || m.Pronouns != "" {
		t.Fatalf("server profile left: %+v %v", m, err)
	}
	var details struct {
		Old map[string]string `json:"old"`
	}
	rawCase, _ := json.Marshal(c["details"])
	_ = json.Unmarshal(rawCase, &details)
	if details.Old["server_profiles"] != "Loud Club: rude/words / something hateful here" {
		t.Errorf("the case keeps: %q", details.Old)
	}
	if res, body := modAct(t, ts, modTok, id, map[string]any{"action": "field_reset", "reason": "again", "fields": []string{"server_profiles"}}); errCode(body) != "field_empty" {
		t.Errorf("second reset: %d %v", res.StatusCode, body)
	}
	// their own banner is unset, but the server's is enough to take down
	mustAct(t, ts, modTok, id, map[string]any{"action": "avatar_remove", "reason": "banner", "images": map[string]bool{"banner": true}})
	if m, _ := srv.Store.Member(context.Background(), modID(sid), modID(id)); m.BannerID != nil {
		t.Errorf("the server banner is still there: %v", m.BannerID)
	}
}
