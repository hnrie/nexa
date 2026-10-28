package api

import (
	"strings"
	"testing"
)

func TestNSFWCommunityAndMixedServer(t *testing.T) {
	c := newCommunity(t)
	tokC, _ := register(t, c.ts, "carol")
	patch := func(body map[string]any) map[string]any {
		t.Helper()
		res, out := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server, c.tokA, body)
		if res.StatusCode != 200 {
			t.Fatalf("patch: %d %v", res.StatusCode, out)
		}
		return out
	}
	patch(map[string]any{"discoverable": true, "description": "Public-safe description", "discovery_tags": []string{"unique-tag"}})
	tag := map[string]any{"text": "TOWN", "badge": "icon:fish"}
	if res, body := setTag(t, c.ts, c.tokA, c.server, tag); res.StatusCode != 200 {
		t.Fatalf("tag: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, c.ts, "PUT", "/api/v1/users/@me/server-tag", c.tokB, map[string]any{"server_id": c.server}); res.StatusCode != 200 {
		t.Fatalf("wear: %d %v", res.StatusCode, body)
	}
	code := inviteFor(t, c.ts, c.tokA, c.general)
	list := func(q string, want int) map[string]any {
		t.Helper()
		res, body := do(t, c.ts, "GET", "/api/v1/discovery"+q, tokC, nil)
		if res.StatusCode != 200 || len(listOf(body, "servers")) != want {
			t.Fatalf("discovery %s: %d %v", q, res.StatusCode, body)
		}
		if want > 0 {
			return listOf(body, "servers")[0].(map[string]any)
		}
		return nil
	}
	list("", 1)
	// Even a channel hidden from the viewer must classify the server in Discovery.
	if res, body := do(t, c.ts, "PATCH", "/api/v1/channels/"+c.general, c.tokA, map[string]any{"nsfw": true}); res.StatusCode != 200 {
		t.Fatalf("channel: %d %v", res.StatusCode, body)
	}
	list("", 0)
	list("?nsfw_only=1", 0)
	mixed := list("?nsfw=1&nsfw_only=1", 1)
	if mixed["nsfw"] != false || mixed["nsfw_content"] != true || mixed["tag"] == nil {
		t.Fatalf("mixed classification: %v", mixed)
	}
	_, meta := do(t, c.ts, "GET", "/api/v1/discovery/categories", tokC, nil)
	if meta["total"].(float64) != 0 || len(listOf(meta, "tags")) != 0 {
		t.Fatalf("hidden metadata: %v", meta)
	}
	_, meta = do(t, c.ts, "GET", "/api/v1/discovery/categories?nsfw=1", tokC, nil)
	if meta["total"].(float64) != 1 || len(listOf(meta, "tags")) != 1 {
		t.Fatalf("opt-in metadata: %v", meta)
	}
	_, preview := do(t, c.ts, "GET", "/api/v1/invites/"+code, "", nil)
	if preview["server"] == nil || preview["age_gate"] == true {
		t.Fatalf("mixed preview should stay visible: %v", preview)
	}
	if res, body := do(t, c.ts, "GET", "/api/v1/discovery/"+c.server, tokC, nil); res.StatusCode != 200 {
		t.Fatalf("mixed detail: %d %v", res.StatusCode, body)
	}
	if wornTag(t, c.ts, c.tokB, c.idB) == nil {
		t.Fatal("mixed server lost its tag")
	}
	// An explicit whole-community setting removes the tag and hides every invite detail.
	out := patch(map[string]any{"nsfw": true})
	if out["nsfw"] != true || out["tag"] != nil {
		t.Fatalf("whole server: %v", out)
	}
	if wornTag(t, c.ts, c.tokB, c.idB) != nil {
		t.Fatal("tag still worn")
	}
	if res, body := setTag(t, c.ts, c.tokA, c.server, tag); res.StatusCode != 403 || errCode(body) != "nsfw_tag_blocked" {
		t.Fatalf("tag admitted: %d %v", res.StatusCode, body)
	}
	_, preview = do(t, c.ts, "GET", "/api/v1/invites/"+code, "", nil)
	if preview["age_gate"] != true || preview["nsfw"] != true || len(preview) != 3 {
		t.Fatalf("preview leak: %v", preview)
	}
	for _, path := range []string{"/api/v1/discovery/" + c.server, "/api/v1/invites/" + code} {
		method := "GET"
		if strings.Contains(path, "invites/") {
			method = "POST"
		}
		res, body := do(t, c.ts, method, path, tokC, nil)
		if res.StatusCode != 403 || errCode(body) != "nsfw_age_required" {
			t.Fatalf("ungated %s: %d %v", path, res.StatusCode, body)
		}
	}
	if res, body := do(t, c.ts, "POST", "/api/v1/discovery/"+c.server+"/join", tokC, nil); res.StatusCode != 403 || errCode(body) != "nsfw_age_required" {
		t.Fatalf("ungated discovery join: %d %v", res.StatusCode, body)
	}
	for _, version := range []string{"v6", "v10"} {
		res, body := do(t, c.ts, "GET", "/api/"+version+"/invites/"+code, "", nil)
		if res.StatusCode != 403 || body["guild"] != nil || body["inviter"] != nil {
			t.Fatalf("bot preview leaked: %d %v", res.StatusCode, body)
		}
		res, body = do(t, c.ts, "GET", "/api/"+version+"/invites/"+code+"?nsfw=1", "", nil)
		if res.StatusCode != 200 || body["guild"] == nil {
			t.Fatalf("confirmed bot preview: %d %v", res.StatusCode, body)
		}
	}

	_, preview = do(t, c.ts, "GET", "/api/v1/invites/"+code+"?nsfw=1", "", nil)
	if preview["server"] == nil || preview["age_gate"] == true {
		t.Fatalf("confirmed preview: %v", preview)
	}
	if res, body := do(t, c.ts, "POST", "/api/v1/invites/"+code+"?nsfw=1", tokC, nil); res.StatusCode != 201 || body["server"] == nil {
		t.Fatalf("confirmed join: %d %v", res.StatusCode, body)
	}
	// Turning the whole-server flag off preserves individual channel flags.
	patch(map[string]any{"nsfw": false})
	list("", 0)
	_, preview = do(t, c.ts, "GET", "/api/v1/invites/"+code, "", nil)
	if preview["server"] == nil {
		t.Fatalf("mixed preview stayed hidden: %v", preview)
	}
	if res, body := setTag(t, c.ts, c.tokA, c.server, tag); res.StatusCode != 200 {
		t.Fatalf("tag not restored as an option: %d %v", res.StatusCode, body)
	}
	for _, value := range []any{nil, "true", 1} {
		res, body := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server, c.tokA, map[string]any{"nsfw": value})
		if res.StatusCode != 400 {
			t.Fatalf("invalid nsfw %v: %d %v", value, res.StatusCode, body)
		}
	}
	if res, _ := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server, c.tokB, map[string]any{"nsfw": true}); res.StatusCode != 403 {
		t.Fatalf("member changed classification: %d", res.StatusCode)
	}
}

func TestModerationDiscoveryFilters(t *testing.T) {
	c := newCommunity(t)
	if res, _ := do(t, c.ts, "GET", "/api/v1/moderation/servers?discovery=all", c.tokB, nil); res.StatusCode != 403 {
		t.Fatalf("member reads moderation: %d", res.StatusCode)
	}
	view := createServer(t, c.ts, c.tokB, "Listed Community")
	sid := view["id"].(string)
	set := func(body map[string]any) {
		t.Helper()
		res, out := do(t, c.ts, "PATCH", "/api/v1/servers/"+sid, c.tokB, body)
		if res.StatusCode != 200 {
			t.Fatalf("patch: %d %v", res.StatusCode, out)
		}
	}
	check := func(filter string, want int) {
		t.Helper()
		res, out := do(t, c.ts, "GET", "/api/v1/moderation/servers?discovery="+filter, c.tokA, nil)
		if res.StatusCode != 200 || len(listOf(out, "servers")) != want || out["total"].(float64) != float64(want) {
			t.Fatalf("%s: %d %v", filter, res.StatusCode, out)
		}
	}
	check("all", 0)
	set(map[string]any{"discoverable": true, "nsfw": true})
	check("all", 1)
	check("listed", 1)
	check("held", 0)
	check("all&q=absent", 0)
	if res, _ := do(t, c.ts, "GET", "/api/v1/moderation/servers?discovery=bad", c.tokA, nil); res.StatusCode != 400 {
		t.Fatalf("invalid filter: %d", res.StatusCode)
	}
	if res, out := do(t, c.ts, "POST", "/api/v1/moderation/servers/"+sid+"/actions", c.tokA, map[string]any{"fields": []string{"discovery"}, "reason": "Public details break the community rules."}); res.StatusCode != 201 {
		t.Fatalf("hold: %d %v", res.StatusCode, out)
	}
	check("all", 1)
	check("listed", 0)
	check("held", 1)
	set(map[string]any{"discoverable": false})
	check("all", 1)
	check("held", 1)
	if res, out := do(t, c.ts, "DELETE", "/api/v1/moderation/servers/"+sid+"/discovery-hold", c.tokA, nil); res.StatusCode != 204 {
		t.Fatalf("restore: %d %v", res.StatusCode, out)
	}
	check("all", 0)
	check("held", 0)
}
