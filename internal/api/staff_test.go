package api

import (
	"net/http/httptest"
	"testing"

	"evilion.xyz/chat/internal/store"
)

// setRank has the owner give id a rank.
func setRank(t *testing.T, ts *httptest.Server, ownerTok, id, rank string) {
	t.Helper()
	if res, body := do(t, ts, "PATCH", "/api/v1/admin/users/"+id, ownerTok, map[string]any{"rank": rank}); res.StatusCode != 200 {
		t.Fatalf("rank %q: %d %v", rank, res.StatusCode, body)
	}
}

func TestStaffRanks(t *testing.T) {
	_, ts := newTestServer(t)
	ownTok, ownID := register(t, ts, "owner")
	devTok, devID := register(t, ts, "dev")
	admTok, admID := register(t, ts, "adm")
	modTok, modID := register(t, ts, "moddy")
	_, memID := register(t, ts, "member")
	_, mem2ID := register(t, ts, "member2")
	setRank(t, ts, ownTok, devID, "developer")
	setRank(t, ts, ownTok, admID, "admin")
	setRank(t, ts, ownTok, modID, "mod")

	// ranks are public, as their badges are
	for id, bit := range map[string]int64{devID: store.FlagAdmin, admID: store.FlagStaffAdmin, modID: store.FlagStaffMod} {
		_, pub := do(t, ts, "GET", "/api/v1/users/"+id, ownTok, nil)
		if f := int64(pub["flags"].(float64)); f&store.StaffFlags != bit {
			t.Errorf("%s public flags %d, want rank bit %d", id, f, bit)
		}
	}

	// only the owner gives or takes ranks, the old admin switch included
	for _, tok := range []string{devTok, admTok, modTok} {
		if res, body := do(t, ts, "PATCH", "/api/v1/admin/users/"+memID, tok, map[string]any{"rank": "mod"}); res.StatusCode != 403 || errCode(body) != "owner_only" {
			t.Errorf("non-owner gives a rank: %d %v", res.StatusCode, body)
		}
		if res, body := do(t, ts, "PATCH", "/api/v1/admin/users/"+memID, tok, map[string]any{"admin": true}); res.StatusCode != 403 || errCode(body) != "owner_only" {
			t.Errorf("non-owner makes an admin: %d %v", res.StatusCode, body)
		}
	}
	if res, body := do(t, ts, "PATCH", "/api/v1/admin/users/"+memID, ownTok, map[string]any{"rank": "owner"}); res.StatusCode != 400 {
		t.Errorf("owner is not grantable: %d %v", res.StatusCode, body)
	}

	// what each rank reaches
	for _, c := range []struct {
		method, path string
		tok          string
		want         int
	}{
		{"GET", "/api/v1/moderation/users", modTok, 200},
		{"GET", "/api/v1/moderation/cases", modTok, 200},
		{"GET", "/api/v1/moderation/log", modTok, 200},
		{"GET", "/api/v1/moderation/servers", modTok, 403},
		{"GET", "/api/v1/moderation/bugs", modTok, 403},
		{"GET", "/api/v1/moderation/announcements", modTok, 403},
		{"GET", "/api/v1/moderation/users/" + memID + "/alts", modTok, 403},
		{"GET", "/api/v1/moderation/servers", admTok, 200},
		{"GET", "/api/v1/moderation/bugs", admTok, 200},
		{"GET", "/api/v1/moderation/users/" + memID + "/alts", admTok, 200},
		{"GET", "/api/v1/admin/stats", admTok, 403},
		{"GET", "/api/v1/moderation/users/" + memID + "/purge-preview", admTok, 403},
		{"GET", "/api/v1/admin/stats", devTok, 200},
		{"GET", "/api/v1/admin/errors", devTok, 200},
		{"GET", "/api/v1/admin/legal-report?user=member", devTok, 403},
	} {
		if res, body := do(t, ts, c.method, c.path, c.tok, nil); res.StatusCode != c.want {
			t.Errorf("%s %s: %d %v, want %d", c.method, c.path, res.StatusCode, body, c.want)
		}
	}

	// a mod mutes and bans for a week at most, and does nothing else
	week := int64(7 * 24 * 3600 * 1000)
	for _, body := range []map[string]any{
		{"action": "mute", "reason": "too long", "duration_ms": week + 1},
		{"action": "ban", "reason": "for ever", "permanent": true},
		{"action": "field_reset", "reason": "a field", "fields": []string{"about_me"}},
		{"action": "delete", "reason": "gone", "confirm": "member"},
	} {
		if res, out := modAct(t, ts, modTok, memID, body); res.StatusCode != 403 {
			t.Errorf("mod %v: %d %v", body["action"], res.StatusCode, out)
		}
	}
	modCase := mustAct(t, ts, modTok, memID, map[string]any{"action": "mute", "reason": "a week", "duration_ms": week})
	// an admin's longer ban stands: a mod cannot shorten it
	admCase := mustAct(t, ts, admTok, mem2ID, map[string]any{"action": "ban", "reason": "for good", "permanent": true})
	if res, out := modAct(t, ts, modTok, mem2ID, map[string]any{"action": "ban", "reason": "shorter", "duration_ms": 3600000}); res.StatusCode != 403 || errCode(out) != "mod_shortens" {
		t.Errorf("mod shortens a ban: %d %v", res.StatusCode, out)
	}
	// a mod lifts what they gave, not what others gave
	lift := map[string]any{"reason": "changed my mind"}
	if res, out := do(t, ts, "POST", "/api/v1/moderation/cases/"+admCase["id"].(string)+"/lift", modTok, lift); res.StatusCode != 403 || errCode(out) != "not_your_case" {
		t.Errorf("mod lifts an admin's ban: %d %v", res.StatusCode, out)
	}
	if res, out := do(t, ts, "POST", "/api/v1/moderation/cases/"+modCase["id"].(string)+"/lift", modTok, lift); res.StatusCode != 200 {
		t.Errorf("mod lifts their own mute: %d %v", res.StatusCode, out)
	}

	// an admin cannot disable sign-in or delete; a developer can, but not for staff
	if res, out := do(t, ts, "PATCH", "/api/v1/admin/users/"+memID, admTok, map[string]any{"disabled": true}); res.StatusCode != 403 {
		t.Errorf("admin disables sign-in: %d %v", res.StatusCode, out)
	}
	if res, out := modAct(t, ts, admTok, memID, map[string]any{"action": "delete", "reason": "gone", "confirm": "member"}); res.StatusCode != 403 {
		t.Errorf("admin deletes: %d %v", res.StatusCode, out)
	}
	if res, out := do(t, ts, "PATCH", "/api/v1/admin/users/"+modID, devTok, map[string]any{"disabled": true}); res.StatusCode != 403 || errCode(out) != "owner_only" {
		t.Errorf("developer disables a mod: %d %v", res.StatusCode, out)
	}
	if res, out := do(t, ts, "PATCH", "/api/v1/admin/users/"+memID, devTok, map[string]any{"disabled": true}); res.StatusCode != 200 {
		t.Errorf("developer disables a member: %d %v", res.StatusCode, out)
	}

	// staff of every rank are out of reach until the owner takes the rank away
	if res, out := modAct(t, ts, devTok, modID, map[string]any{"action": "mute", "reason": "a mute", "duration_ms": 3600000}); errCode(out) != "moderate_staff" {
		t.Errorf("acting on a mod: %d %v", res.StatusCode, out)
	}
	setRank(t, ts, ownTok, modID, "")
	mustAct(t, ts, devTok, modID, map[string]any{"action": "mute", "reason": "a mute", "duration_ms": 3600000})

	// the owner cannot change their own rank
	if res, out := do(t, ts, "PATCH", "/api/v1/admin/users/"+ownID, ownTok, map[string]any{"rank": "mod"}); res.StatusCode != 400 {
		t.Errorf("owner changes own rank: %d %v", res.StatusCode, out)
	}
}
