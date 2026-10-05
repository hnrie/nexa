package api

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"evilion.xyz/chat/internal/perms"
)

func rule(t *testing.T, c *community, body map[string]any) (int, map[string]any) {
	t.Helper()
	res, out := do(t, c.ts, "POST", "/api/v1/servers/"+c.server+"/automod/rules", c.tokA, body)
	return res.StatusCode, out
}

// AutoMod's rules are checked as they are written, the server applies the
// ones it can see for itself, and members' apps get the ones that read messages.
func TestAutomodRules(t *testing.T) {
	c := newCommunity(t)
	if code, body := rule(t, c, map[string]any{"name": "Patterns", "kind": "words", "config": map[string]any{"regex": []string{"(a+)+b"}}, "actions": []map[string]any{{"type": "block"}}}); code != 400 || errCode(body) != "invalid_pattern" {
		t.Errorf("a pattern that repeats a repeat: %d %v", code, body)
	}
	if code, body := rule(t, c, map[string]any{"name": "Nothing", "kind": "words", "config": map[string]any{"words": []string{"x"}}, "actions": []map[string]any{}}); code != 400 {
		t.Errorf("a rule that does nothing: %d %v", code, body)
	}
	code, words := rule(t, c, map[string]any{"name": "No Spoilers", "kind": "words", "config": map[string]any{"words": []string{"spoiler*", "the butler"}}, "actions": []map[string]any{{"type": "block", "message": "No spoilers here."}, {"type": "timeout", "seconds": 60, "after": 2}}})
	if code != 201 {
		t.Fatalf("words rule: %d %v", code, words)
	}
	if code, body := rule(t, c, map[string]any{"name": "Lists", "kind": "flagged_words", "config": map[string]any{"lists": []string{"profanity", "slurs"}, "allow": []string{"Bitch"}}, "actions": []map[string]any{{"type": "block"}}}); code != 201 {
		t.Fatalf("flagged words: %d %v", code, body)
	}
	if code, body := rule(t, c, map[string]any{"name": "Pings", "kind": "mentions", "config": map[string]any{"max": 2, "raid": true}, "actions": []map[string]any{{"type": "block"}, {"type": "alert", "channel_id": c.general}}}); code != 201 {
		t.Fatalf("mentions: %d %v", code, body)
	}
	// members' apps get the rules that read messages, and not the server's own
	_, mine := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/automod", c.tokB, nil)
	kinds := []string{}
	for _, r := range listOf(mine, "_list") {
		kinds = append(kinds, r.(map[string]any)["kind"].(string))
	}
	if strings.Join(kinds, ",") != "words,flagged_words" {
		t.Errorf("members' rules: %v", kinds)
	}
	if res, _ := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/automod/rules", c.tokB, nil); res.StatusCode != 403 {
		t.Errorf("a member read the rules' settings: %d", res.StatusCode)
	}
	// three mentions over a limit of two: refused, logged, alerted
	tokC, idC := register(t, c.ts, "carol")
	join(t, c.ts, tokC, inviteFor(t, c.ts, c.tokA, c.general))
	ga := connectGW(t, c.ts, c.tokA)
	res, body := sendMsg(t, c.ts, c.tokB, c.general, c.server, 0, "hey all", "", map[string]any{"mentions": []string{c.idA, idC, c.idB}})
	if res.StatusCode != 403 || errCode(body) != "automod_blocked" {
		t.Fatalf("mention spam: %d %v", res.StatusCode, body)
	}
	if ev := ga.next("message_create", 2*time.Second); ev == nil || ev["type"] != "system_automod" {
		t.Errorf("no alert in the alert channel: %v", ev)
	}
	// the owner is never held by AutoMod
	if res, _ := sendMsg(t, c.ts, c.tokA, c.general, c.server, 0, "everyone", "", map[string]any{"mentions": []string{c.idB, idC, c.idA}}); res.StatusCode != 201 {
		t.Errorf("the owner was held: %d", res.StatusCode)
	}
	// a member's app reports what it stopped; the second catch in a day times them out
	report := map[string]any{"rule_id": words["id"], "channel_id": c.general, "content": envelopeFor(c.server, 0, "the butler did it")}
	if res, body := do(t, c.ts, "POST", "/api/v1/servers/"+c.server+"/automod/report", c.tokB, report); res.StatusCode != 200 || len(body["actions"].([]any)) != 1 {
		t.Fatalf("first catch: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, c.ts, "POST", "/api/v1/servers/"+c.server+"/automod/report", c.tokB, report); res.StatusCode != 200 || len(body["actions"].([]any)) != 2 {
		t.Fatalf("second catch: %d %v", res.StatusCode, body)
	}
	if _, m := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/members/"+c.idB, c.tokA, nil); m["timeout_until"] == nil {
		t.Errorf("not timed out after the second catch: %v", m)
	}
	// what was caught has to be sealed for the server, not readable
	bad := map[string]any{"rule_id": words["id"], "channel_id": c.general, "content": map[string]any{"text": "plain"}}
	if res, _ := do(t, c.ts, "POST", "/api/v1/servers/"+c.server+"/automod/report", tokC, bad); res.StatusCode != 400 {
		t.Errorf("an unsealed report: %d", res.StatusCode)
	}
	// thread titles are read by the server itself
	if code, body := c.thread(t, tokC, c.general, map[string]any{"name": "Spoilers ahead"}); code != 403 || errCode(body) != "automod_blocked" || !strings.Contains(body["error"].(map[string]any)["message"].(string), "No spoilers") {
		t.Errorf("a blocked title: %d %v", code, body)
	}
	// the log, and the week's counts
	_, log := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/automod/events", c.tokA, nil)
	if len(listOf(log, "events")) < 4 {
		t.Errorf("AutoMod log: %v", log)
	}
	_, stats := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/automod/stats", c.tokA, nil)
	if len(listOf(stats, "rules")) == 0 {
		t.Errorf("counts: %v", stats)
	}
	_, presets := do(t, c.ts, "GET", "/api/v1/automod/presets", tokC, nil)
	if lists, _ := presets["lists"].(map[string]any); len(lists) != 3 {
		t.Errorf("presets: %v", presets)
	}
}

// A message already sent is acted on once per rule, however many apps report
// it: a rule that only alerts leaves it be, one that blocks clears it away,
// and only moderators' apps report other people's messages.
func TestAutomodSentMessages(t *testing.T) {
	c := newCommunity(t)
	code, alerts := rule(t, c, map[string]any{"name": "Watch", "kind": "words", "config": map[string]any{"words": []string{"butterfly"}}, "actions": []map[string]any{{"type": "alert", "channel_id": c.general}}})
	if code != 201 {
		t.Fatalf("alert rule: %d %v", code, alerts)
	}
	code, blocks := rule(t, c, map[string]any{"name": "Stop", "kind": "words", "config": map[string]any{"words": []string{"badger"}}, "actions": []map[string]any{{"type": "block"}}})
	if code != 201 {
		t.Fatalf("block rule: %d %v", code, blocks)
	}
	report := func(token, ruleID, msg string) (int, map[string]any) {
		res, body := do(t, c.ts, "POST", "/api/v1/servers/"+c.server+"/automod/report", token, map[string]any{"rule_id": ruleID, "channel_id": c.general, "message_id": msg, "content": envelopeFor(c.server, 0, "caught")})
		return res.StatusCode, body
	}
	gone := func(msg string) bool {
		_, body := do(t, c.ts, "GET", "/api/v1/channels/"+c.general+"/messages?ids="+msg, c.tokA, nil)
		return len(listOf(body, "_list")) == 0
	}
	_, sent := sendMsg(t, c.ts, c.tokB, c.general, c.server, 0, "a butterfly", "", nil)
	msg := sent["id"].(string)
	// the sender's own app reports what a rule let through: alerted, kept
	if code, body := report(c.tokB, alerts["id"].(string), msg); code != 200 || len(body["actions"].([]any)) != 1 {
		t.Fatalf("own report: %d %v", code, body)
	}
	if gone(msg) {
		t.Errorf("an alert-only rule deleted the message")
	}
	// the same rule and message again, from anyone: nothing more happens
	if code, _ := report(c.tokB, alerts["id"].(string), msg); code != 204 {
		t.Errorf("a second report of the same message: %d", code)
	}
	if code, _ := report(c.tokA, alerts["id"].(string), msg); code != 204 {
		t.Errorf("a moderator's report after the sender's: %d", code)
	}
	// someone who cannot manage messages cannot report other people's
	tokC, _ := register(t, c.ts, "carol")
	join(t, c.ts, tokC, inviteFor(t, c.ts, c.tokA, c.general))
	if code, _ := report(tokC, blocks["id"].(string), msg); code != 403 {
		t.Errorf("a member reported someone else's message: %d", code)
	}
	// a moderator's app clears away what a blocking rule catches, once
	_, sent = sendMsg(t, c.ts, c.tokB, c.general, c.server, 0, "a badger", "", nil)
	msg = sent["id"].(string)
	if code, body := report(c.tokA, blocks["id"].(string), msg); code != 200 || len(body["actions"].([]any)) != 1 {
		t.Fatalf("moderator's report: %d %v", code, body)
	}
	if !gone(msg) {
		t.Errorf("the caught message is still there")
	}
	if code, _ := report(c.tokA, blocks["id"].(string), msg); code != 404 {
		t.Errorf("a report of a message already cleared away: %d", code)
	}
	_, log := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/automod/events", c.tokA, nil)
	if events := listOf(log, "events"); len(events) != 2 || events[0].(map[string]any)["message_id"] != msg {
		t.Errorf("AutoMod log: %v", log)
	}
}

// A name rule quarantines whoever it catches until a moderator lets them out.
func TestAutomodQuarantine(t *testing.T) {
	c := newCommunity(t)
	if code, body := rule(t, c, map[string]any{"name": "Names", "kind": "profile", "config": map[string]any{"words": []string{"scam*"}, "names": true}, "actions": []map[string]any{{"type": "quarantine"}}}); code != 201 {
		t.Fatalf("profile rule: %d %v", code, body)
	}
	tokS, idS := register(t, c.ts, "scammer")
	join(t, c.ts, tokS, inviteFor(t, c.ts, c.tokA, c.general))
	_, m := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/members/"+idS, c.tokA, nil)
	if int(m["flags"].(float64))&1 == 0 {
		t.Fatalf("not quarantined: %v", m)
	}
	if res, _ := sendMsg(t, c.ts, tokS, c.general, c.server, 0, "hi", "", nil); res.StatusCode != 403 {
		t.Errorf("a quarantined member could talk: %d", res.StatusCode)
	}
	if res, _ := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server+"/members/"+idS, c.tokB, map[string]any{"quarantined": false}); res.StatusCode != 403 {
		t.Errorf("a member let someone out: %d", res.StatusCode)
	}
	if res, body := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server+"/members/"+idS, c.tokA, map[string]any{"quarantined": false}); res.StatusCode != 200 {
		t.Fatalf("let out: %d %v", res.StatusCode, body)
	}
	if res, _ := sendMsg(t, c.ts, tokS, c.general, c.server, 0, "hi", "", nil); res.StatusCode != 201 {
		t.Errorf("still held after being let out: %d", res.StatusCode)
	}
	// the Members page shows who is held
	_, page := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/member-search?signals=quarantined", c.tokA, nil)
	if len(listOf(page, "members")) != 0 {
		t.Errorf("signals after release: %v", page)
	}
}

// Pausing invites stops every way in; revoking them all leaves none.
func TestInvitesPauseAndRevokeAll(t *testing.T) {
	c := newCommunity(t)
	code := inviteFor(t, c.ts, c.tokA, c.general)
	until := time.Now().Add(time.Hour).UnixMilli()
	if res, _ := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server, c.tokB, map[string]any{"invites_paused_until": until}); res.StatusCode != 403 {
		t.Errorf("a member paused invites: %d", res.StatusCode)
	}
	if res, body := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server, c.tokA, map[string]any{"invites_paused_until": until}); res.StatusCode != 200 || body["invites_paused_until"] == nil {
		t.Fatalf("pause: %d %v", res.StatusCode, body)
	}
	tokC, _ := register(t, c.ts, "carol")
	if _, preview := do(t, c.ts, "GET", "/api/v1/invites/"+code, tokC, nil); preview["joins_paused"] != true {
		t.Errorf("preview does not say joins are paused: %v", preview)
	}
	if res, body := do(t, c.ts, "POST", "/api/v1/invites/"+code, tokC, nil); res.StatusCode != 403 || errCode(body) != "joins_paused" {
		t.Errorf("joined while paused: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server, c.tokA, map[string]any{"invites_paused_until": nil}); res.StatusCode != 200 {
		t.Fatal("resume")
	}
	join(t, c.ts, tokC, code)
	inviteFor(t, c.ts, c.tokA, c.general)
	if res, body := do(t, c.ts, "DELETE", "/api/v1/servers/"+c.server+"/invites", c.tokA, nil); res.StatusCode != 200 || body["revoked"].(float64) < 2 {
		t.Fatalf("revoke all: %d %v", res.StatusCode, body)
	}
	if _, list := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/invites", c.tokA, nil); len(listOf(list, "_list")) != 0 {
		t.Errorf("invites left: %v", list)
	}
	// the audit log has both, readable by the kind of action
	_, log := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/audit-log?action=invites_pause,invite_delete_all", c.tokA, nil)
	if len(listOf(log, "entries")) != 2 {
		t.Errorf("audit filtered by action: %v", log)
	}
	// a pause sent with other settings is still a line of its own, and the
	// other settings are a server update beside it
	if res, body := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server, c.tokA, map[string]any{"invites_paused_until": until, "description": "Back soon."}); res.StatusCode != 200 {
		t.Fatalf("pause with a description: %d %v", res.StatusCode, body)
	}
	_, log = do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/audit-log?limit=2", c.tokA, nil)
	got := map[string]map[string]any{}
	for _, raw := range listOf(log, "entries") {
		e, _ := raw.(map[string]any)
		action, _ := e["action"].(string)
		got[action], _ = e["changes"].(map[string]any)
	}
	if ch, ok := got["invites_pause"]; !ok || ch["description"] != nil || ch["invites_paused_until"] == nil {
		t.Errorf("pause entry: %v", log)
	}
	if ch, ok := got["server_update"]; !ok || ch["description"] != "Back soon." || ch["invites_paused_until"] != nil {
		t.Errorf("update entry: %v", log)
	}
}

// Anyone can list a server on Discovery; people find it by words, category
// and tags, and join it from there.
func TestDiscovery(t *testing.T) {
	c := newCommunity(t)
	if res, body := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server, c.tokA, map[string]any{"discoverable": true, "discovery_category": "gaming", "discovery_tags": []string{"Speedrun", "speedrun", "co op"}, "discovery_language": "en", "description": "We go **fast**."}); res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, body)
	} else if strings.Join(toStrings(body["discovery_tags"]), ",") != "speedrun,co op" {
		t.Errorf("tags tidied: %v", body["discovery_tags"])
	}
	if res, _ := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server, c.tokA, map[string]any{"discovery_tags": []string{"a", "b", "c", "d", "e", "f"}}); res.StatusCode != 400 {
		t.Errorf("bad tags taken: %d", res.StatusCode)
	}
	tokC, _ := register(t, c.ts, "carol")
	find := func(q string) []any {
		_, body := do(t, c.ts, "GET", "/api/v1/discovery?"+q, tokC, nil)
		return listOf(body, "servers")
	}
	if got := find("q=speed"); len(got) != 1 || got[0].(map[string]any)["member_count"].(float64) != 2 {
		t.Errorf("search by tag word: %v", got)
	}
	if got := find("category=music"); len(got) != 0 {
		t.Errorf("category filter: %v", got)
	}
	if got := find("min_members=3"); len(got) != 0 {
		t.Errorf("member filter: %v", got)
	}
	res, body := do(t, c.ts, "POST", "/api/v1/discovery/"+c.server+"/join", tokC, nil)
	if res.StatusCode != 201 {
		t.Fatalf("join from Discovery: %d %v", res.StatusCode, body)
	}
	_, page := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/member-search?join_method=discovery", c.tokA, nil)
	if rows := listOf(page, "members"); len(rows) != 1 || rows[0].(map[string]any)["join"].(map[string]any)["join_method"] != "discovery" {
		t.Errorf("join method: %v", page)
	}
	if res, _ := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server, c.tokA, map[string]any{"discoverable": false}); res.StatusCode != 200 {
		t.Fatal("unlist")
	}
	if got := find(""); len(got) != 0 {
		t.Errorf("still listed: %v", got)
	}
}

func toStrings(v any) []string {
	out := []string{}
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}

// The Members page filters and sorts on the server; how people joined is for
// those who see the invites; prunes and bulk bans answer to their permissions.
func TestMembersPage(t *testing.T) {
	c := newCommunity(t)
	mod := createRole(t, c.ts, c.tokA, c.server, "Mods", perms.KickMembers|perms.BanMembers)
	if res, _ := do(t, c.ts, "PUT", "/api/v1/servers/"+c.server+"/members/"+c.idB+"/roles/"+mod, c.tokA, nil); res.StatusCode != 200 {
		t.Fatal("give role")
	}
	_, page := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/member-search?sort=joined_asc", c.tokB, nil)
	rows := listOf(page, "members")
	if len(rows) != 2 || rows[0].(map[string]any)["user_id"] != c.idA || page["total"].(float64) != 2 {
		t.Fatalf("members page: %v", page)
	}
	if rows[1].(map[string]any)["join"] != nil {
		t.Errorf("a moderator without Manage Server sees how people joined: %v", rows[1])
	}
	_, page = do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/member-search?roles="+mod, c.tokA, nil)
	if rows := listOf(page, "members"); len(rows) != 1 || rows[0].(map[string]any)["user_id"] != c.idB || rows[0].(map[string]any)["join"].(map[string]any)["join_method"] != "invite" {
		t.Errorf("role filter: %v", page)
	}
	tokC, idC := register(t, c.ts, "carol")
	join(t, c.ts, tokC, inviteFor(t, c.ts, c.tokA, c.general))
	if res, _ := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/member-search", tokC, nil); res.StatusCode != 403 {
		t.Errorf("a plain member opened the Members page: %d", res.StatusCode)
	}
	_, view := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/members/"+idC+"/mod", c.tokA, nil)
	if d, _ := view["member"].(map[string]any); d == nil || d["account_created_at"] == nil || !containsStr(toStrings(d["signals"]), "new_account") {
		t.Errorf("mod view: %v", view)
	}
	if res, _ := do(t, c.ts, "POST", "/api/v1/servers/"+c.server+"/bulk-ban", c.tokB, map[string]any{"user_ids": []string{idC}}); res.StatusCode != 403 {
		t.Errorf("bulk ban without Manage Server: %d", res.StatusCode)
	}
	if res, body := do(t, c.ts, "POST", "/api/v1/servers/"+c.server+"/bulk-ban", c.tokA, map[string]any{"user_ids": []string{idC, c.idA}, "reason": "raid"}); res.StatusCode != 200 || len(listOf(body, "banned")) != 1 || len(listOf(body, "failed")) != 1 {
		t.Errorf("bulk ban: %d %v", res.StatusCode, body)
	}
	if _, body := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/prune?days=7", c.tokB, nil); body["count"] == nil {
		t.Errorf("prune preview: %v", body)
	}
}

func containsStr(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// The permissions added: pinning on its own, skipping slow mode, emoji from
// elsewhere, and the wait a server can ask of newcomers.
func TestNewPermissions(t *testing.T) {
	c := newCommunity(t)
	// pinning takes Pin Messages, which Manage Messages alone no longer gives
	manager := createRole(t, c.ts, c.tokA, c.server, "Cleaners", perms.ManageMessages)
	do(t, c.ts, "PUT", "/api/v1/servers/"+c.server+"/members/"+c.idB+"/roles/"+manager, c.tokA, nil)
	if res, _ := do(t, c.ts, "PUT", "/api/v1/channels/"+c.general+"/pins/"+c.message, c.tokB, nil); res.StatusCode != 403 {
		t.Errorf("pinned with Manage Messages alone: %d", res.StatusCode)
	}
	pinner := createRole(t, c.ts, c.tokA, c.server, "Pinners", perms.PinMessages)
	do(t, c.ts, "PUT", "/api/v1/servers/"+c.server+"/members/"+c.idB+"/roles/"+pinner, c.tokA, nil)
	if res, _ := do(t, c.ts, "PUT", "/api/v1/channels/"+c.general+"/pins/"+c.message, c.tokB, nil); res.StatusCode != 204 {
		t.Errorf("could not pin with Pin Messages: %d", res.StatusCode)
	}
	// slow mode, and those who may skip it
	if res, _ := do(t, c.ts, "PATCH", "/api/v1/channels/"+c.general, c.tokA, map[string]any{"slowmode_seconds": 600}); res.StatusCode != 200 {
		t.Fatal("slow mode")
	}
	tokC, idC := register(t, c.ts, "carol")
	join(t, c.ts, tokC, inviteFor(t, c.ts, c.tokA, c.general))
	sendMsg(t, c.ts, tokC, c.general, c.server, 0, "one", "", nil)
	if res, _ := sendMsg(t, c.ts, tokC, c.general, c.server, 0, "two", "", nil); res.StatusCode != 429 {
		t.Errorf("slow mode let a second message through: %d", res.StatusCode)
	}
	skip := createRole(t, c.ts, c.tokA, c.server, "Fast", perms.BypassSlowmode)
	do(t, c.ts, "PUT", "/api/v1/servers/"+c.server+"/members/"+idC+"/roles/"+skip, c.tokA, nil)
	if res, _ := sendMsg(t, c.ts, tokC, c.general, c.server, 0, "three", "", nil); res.StatusCode != 201 {
		t.Errorf("Bypass Slow Mode still waited: %d", res.StatusCode)
	}
	// newcomers wait as long as the server asks, unless given a role
	if res, _ := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server, c.tokA, map[string]any{"verify_member_minutes": 10, "slowmode_seconds": 0}); res.StatusCode != 200 {
		t.Fatal("verify")
	}
	do(t, c.ts, "PATCH", "/api/v1/channels/"+c.general, c.tokA, map[string]any{"slowmode_seconds": 0})
	tokD, _ := register(t, c.ts, "dave")
	join(t, c.ts, tokD, inviteFor(t, c.ts, c.tokA, c.general))
	if res, body := sendMsg(t, c.ts, tokD, c.general, c.server, 0, "hi", "", nil); res.StatusCode != 403 || errCode(body) != "verification_wait" || res.Header.Get("Retry-After") == "" {
		t.Errorf("a newcomer talked at once: %d %v", res.StatusCode, body)
	}
}

// A member's profile in one server is theirs to write; a moderator can only clear it.
func TestServerProfilesAndRoleStyles(t *testing.T) {
	c := newCommunity(t)
	res, body := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server+"/members/@me", c.tokB, map[string]any{"bio": "Here for the **bread**.", "pronouns": "they/them", "nick": "Bobby"})
	if res.StatusCode != 200 || body["bio"] != "Here for the **bread**." || body["pronouns"] != "they/them" {
		t.Fatalf("own server profile: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server+"/members/"+c.idB, c.tokA, map[string]any{"bio": "rewritten"}); res.StatusCode != 403 {
		t.Errorf("a moderator wrote someone's bio: %d", res.StatusCode)
	}
	if res, body := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server+"/members/"+c.idB, c.tokA, map[string]any{"bio": ""}); res.StatusCode != 200 || body["bio"] != "" {
		t.Errorf("a moderator could not clear a bio: %d %v", res.StatusCode, body)
	}
	res, raw := rawPut(t, c.ts.URL+"/api/v1/servers/"+c.server+"/members/@me/avatar", c.tokB, "image/png", pngBytes(64, 64))
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	if res.StatusCode != 200 || m["avatar_id"] == nil {
		t.Fatalf("server avatar: %d %s", res.StatusCode, raw)
	}
	if res, _ := rawPut(t, c.ts.URL+"/api/v1/servers/"+c.server+"/members/"+c.idA+"/banner", c.tokB, "image/png", pngBytes(64, 32)); res.StatusCode != 403 {
		t.Errorf("set someone else's banner: %d", res.StatusCode)
	}
	// a theme and widgets of its own, shown to the people in that server only
	res, body = do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server+"/members/@me", c.tokB, map[string]any{"accent_color": 0x335577, "accent_color_2": 0xaa2266, "widgets": []any{map[string]any{"id": "abcd1234", "type": "custom", "title": "Bakes", "text": "Sourdough on Sundays."}}})
	if res.StatusCode != 200 || body["accent_color"].(float64) != 0x335577 || body["accent_color_2"].(float64) != 0xaa2266 {
		t.Fatalf("server theme: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server+"/members/"+c.idB, c.tokA, map[string]any{"accent_color": 0x111111}); res.StatusCode != 403 {
		t.Errorf("a moderator chose someone's colours: %d", res.StatusCode)
	}
	_, prof := do(t, c.ts, "GET", "/api/v1/users/"+c.idB+"/profile?server_id="+c.server, c.tokA, nil)
	if list, _ := prof["widgets"].([]any); len(list) != 1 || prof["server_widgets"] != true {
		t.Errorf("server widgets not served there: %v", prof)
	}
	_, prof = do(t, c.ts, "GET", "/api/v1/users/"+c.idB+"/profile", c.tokA, nil)
	if list, _ := prof["widgets"].([]any); len(list) != 0 || prof["server_widgets"] != false {
		t.Errorf("server widgets shown outside it: %v", prof)
	}
	tokOut, _ := register(t, c.ts, "outsider")
	_, prof = do(t, c.ts, "GET", "/api/v1/users/"+c.idB+"/profile?server_id="+c.server, tokOut, nil)
	if prof["server_widgets"] != false {
		t.Errorf("someone outside the server saw its widgets: %v", prof)
	}
	if res, body := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server+"/members/"+c.idB, c.tokA, map[string]any{"accent_color": nil, "accent_color_2": nil, "widgets": nil}); res.StatusCode != 200 || body["accent_color"] != nil {
		t.Errorf("a moderator could not reset a theme: %d %v", res.StatusCode, body)
	}
	_, prof = do(t, c.ts, "GET", "/api/v1/users/"+c.idB+"/profile?server_id="+c.server, c.tokA, nil)
	if prof["server_widgets"] != false {
		t.Errorf("reset widgets still there: %v", prof)
	}
	role := createRole(t, c.ts, c.tokA, c.server, "Sunset", 0)
	res, body = do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server+"/roles/"+role, c.tokA, map[string]any{"color": 0xff8800, "color2": 0x8800ff, "icon_emoji": "🌅"})
	if res.StatusCode != 200 || body["color2"].(float64) != 0x8800ff || body["icon_emoji"] != "🌅" {
		t.Fatalf("role style: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server+"/roles/"+role, c.tokA, map[string]any{"icon_emoji": "not an emoji"}); res.StatusCode != 400 {
		t.Errorf("text taken as an icon: %d", res.StatusCode)
	}
	if res, body := do(t, c.ts, "PATCH", "/api/v1/servers/"+c.server+"/roles/"+role, c.tokA, map[string]any{"color2": nil}); res.StatusCode != 200 || body["color2"] != nil {
		t.Errorf("back to one colour: %d %v", res.StatusCode, body)
	}
	res, raw = rawPut(t, c.ts.URL+"/api/v1/servers/"+c.server+"/roles/"+role+"/icon", c.tokA, "image/png", pngBytes(64, 64))
	_ = json.Unmarshal(raw, &m)
	if res.StatusCode != 200 || m["icon_id"] == nil || m["icon_emoji"] != "" {
		t.Errorf("role picture: %d %s", res.StatusCode, raw)
	}
}

// What moderators do to messages is in the audit log, and the log reads by
// who did it and to whom.
func TestAuditCoverage(t *testing.T) {
	c := newCommunity(t)
	_, own := sendMsg(t, c.ts, c.tokB, c.general, c.server, 0, "bob's", "", nil)
	if res, _ := do(t, c.ts, "DELETE", "/api/v1/channels/"+c.general+"/messages/"+own["id"].(string), c.tokA, nil); res.StatusCode != 204 {
		t.Fatal("delete")
	}
	var ids []string
	for i := 0; i < 3; i++ {
		_, m := sendMsg(t, c.ts, c.tokB, c.general, c.server, 0, "more", "", nil)
		ids = append(ids, m["id"].(string))
	}
	if res, _ := do(t, c.ts, "POST", "/api/v1/channels/"+c.general+"/messages/bulk-delete", c.tokA, map[string]any{"ids": ids}); res.StatusCode != 200 {
		t.Fatal("bulk delete")
	}
	do(t, c.ts, "PUT", "/api/v1/channels/"+c.general+"/pins/"+c.message, c.tokA, nil)
	// deleting your own message is not moderation
	_, mine := sendMsg(t, c.ts, c.tokA, c.general, c.server, 0, "mine", "", nil)
	do(t, c.ts, "DELETE", "/api/v1/channels/"+c.general+"/messages/"+mine["id"].(string), c.tokA, nil)
	_, log := do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/audit-log?target_id="+c.idB, c.tokA, nil)
	actions := []string{}
	for _, e := range listOf(log, "entries") {
		actions = append(actions, e.(map[string]any)["action"].(string))
	}
	if strings.Join(actions, ",") != "message_bulk_delete,message_delete" {
		t.Errorf("about bob: %v", actions)
	}
	_, log = do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/audit-log?action=message_pin", c.tokA, nil)
	if len(listOf(log, "entries")) != 1 {
		t.Errorf("pins: %v", log)
	}
	_, log = do(t, c.ts, "GET", "/api/v1/servers/"+c.server+"/audit-log?actor_id="+c.idB, c.tokA, nil)
	if len(listOf(log, "entries")) != 0 {
		t.Errorf("bob did nothing worth logging: %v", log)
	}
}
