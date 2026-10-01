package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
	"github.com/coder/websocket"
)

// What a device would send: the server only ever sees these as sealed text.
const (
	sealedHead = "v1.aGVhZA.c2VhbGVkLWhlYWQ"
	sealedBody = "v1.Ym9keQ.c2VhbGVkLWJvZHk"
	sealedKey  = "a2V5LXNlYWxlZC10by1vbmUtcGVyc29u"
)

// nextWhere returns the next event of type t that `is` accepts.
func (g *gw) nextWhere(t string, timeout time.Duration, is func(map[string]any) bool) map[string]any {
	deadline := time.Now().Add(timeout)
	for {
		left := time.Until(deadline)
		if left <= 0 {
			return nil
		}
		ev := g.next(t, left)
		if ev == nil || is(ev) {
			return ev
		}
	}
}

func newNote(t *testing.T, ts *httptest.Server, tok string) string {
	t.Helper()
	res, body := do(t, ts, "POST", "/api/v1/notes", tok, map[string]any{"head": sealedHead, "body": sealedBody, "key_sealed": sealedKey})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create note: %d %v", res.StatusCode, body)
	}
	return body["id"].(string)
}

func TestNotesBelongToTheirMembers(t *testing.T) {
	_, ts := newTestServer(t)
	alice, aliceID := register(t, ts, "alice")
	bob, _ := register(t, ts, "bob")
	gwA := connectGW(t, ts, alice)

	res, created := do(t, ts, "POST", "/api/v1/notes", alice, map[string]any{"head": sealedHead, "body": sealedBody, "key_sealed": sealedKey})
	if res.StatusCode != http.StatusCreated || created["owner_id"] != aliceID || created["role"].(float64) != store.NoteOwner || created["version"].(float64) != 1 || created["key_sealed"] != sealedKey {
		t.Fatalf("create: %d %v", res.StatusCode, created)
	}
	id := created["id"].(string)
	// the owner's other devices see it appear
	if ev := gwA.next("note_update", 2*time.Second); ev == nil || ev["id"] != id || ev["head"] != sealedHead {
		t.Errorf("note_update on create: %v", ev)
	}

	// the list has the head, the owner's key and no body; the note itself has the body
	_, list := do(t, ts, "GET", "/api/v1/notes", alice, nil)
	notes := list["notes"].([]any)
	if len(notes) != 1 || notes[0].(map[string]any)["head"] != sealedHead || notes[0].(map[string]any)["body"] != nil || notes[0].(map[string]any)["members"].(float64) != 1 {
		t.Errorf("list: %v", list)
	}
	if _, got := do(t, ts, "GET", "/api/v1/notes/"+id, alice, nil); got["body"] != sealedBody || got["key_sealed"] != sealedKey {
		t.Errorf("get: %v", got)
	}

	// to anyone else the note is not there at all, whatever they try
	if _, l := do(t, ts, "GET", "/api/v1/notes", bob, nil); len(l["notes"].([]any)) != 0 {
		t.Errorf("bob's list: %v", l)
	}
	for _, try := range [][2]string{{"GET", ""}, {"PUT", ""}, {"DELETE", ""}, {"GET", "/sharing"}, {"POST", "/links"}, {"POST", "/invites"}, {"POST", "/rekey"}, {"POST", "/attachments"}, {"DELETE", "/members/@me"}} {
		if res, body := do(t, ts, try[0], "/api/v1/notes/"+id+try[1], bob, map[string]any{}); res.StatusCode != http.StatusNotFound {
			t.Errorf("%s %s by a stranger: %d %v", try[0], try[1], res.StatusCode, body)
		}
	}

	// only what a device could have sealed is taken
	for name, bad := range map[string]map[string]any{
		"empty head":      {"head": "", "body": sealedBody, "key_sealed": sealedKey},
		"readable body":   {"head": sealedHead, "body": "my secret plans <b>", "key_sealed": sealedKey},
		"no key":          {"head": sealedHead, "body": sealedBody},
		"a head too long": {"head": strings.Repeat("A", store.MaxNoteHeadBytes+1), "body": sealedBody, "key_sealed": sealedKey},
	} {
		if res, body := do(t, ts, "POST", "/api/v1/notes", alice, bad); res.StatusCode != http.StatusBadRequest || errCode(body) != "bad_note" {
			t.Errorf("%s: %d %v", name, res.StatusCode, body)
		}
	}
}

// A save names the version it was made from. Two people saving from the same
// version cannot both win: the second is told the note moved on, fetches it,
// puts their changes in, and saves from the new version.
func TestNoteSavesAreOrdered(t *testing.T) {
	_, ts := newTestServer(t)
	alice, aliceID := register(t, ts, "alice")
	id := newNote(t, ts, alice)
	gwA := connectGW(t, ts, alice)

	res, saved := do(t, ts, "PUT", "/api/v1/notes/"+id, alice, map[string]any{"head": "v1.aDI.aDI", "body": "v1.YjI.YjI", "base_version": 1})
	if res.StatusCode != http.StatusOK || saved["version"].(float64) != 2 || saved["updated_at"] == nil {
		t.Fatalf("save: %d %v", res.StatusCode, saved)
	}
	if ev := gwA.next("note_update", 2*time.Second); ev == nil || ev["version"].(float64) != 2 || ev["head"] != "v1.aDI.aDI" || ev["edited_by"] != aliceID {
		t.Errorf("note_update on save: %v", ev)
	}
	// from the old version again: refused, with where the note is now
	res, stale := do(t, ts, "PUT", "/api/v1/notes/"+id, alice, map[string]any{"head": "v1.aDM.aDM", "body": "v1.YjM.YjM", "base_version": 1})
	if res.StatusCode != http.StatusConflict || errCode(stale) != "note_stale" || stale["version"].(float64) != 2 {
		t.Fatalf("stale save: %d %v", res.StatusCode, stale)
	}
	if _, got := do(t, ts, "GET", "/api/v1/notes/"+id, alice, nil); got["body"] != "v1.YjI.YjI" || got["version"].(float64) != 2 {
		t.Errorf("a refused save changed the note: %v", got)
	}
	if res, _ := do(t, ts, "PUT", "/api/v1/notes/"+id, alice, map[string]any{"head": "v1.aDM.aDM", "body": "v1.YjM.YjM", "base_version": 2}); res.StatusCode != http.StatusOK {
		t.Errorf("save from the new version: %d", res.StatusCode)
	}
	if res, body := do(t, ts, "PUT", "/api/v1/notes/"+id, alice, map[string]any{"head": "plain words", "body": sealedBody, "base_version": 3}); res.StatusCode != http.StatusBadRequest {
		t.Errorf("a head that is not sealed: %d %v", res.StatusCode, body)
	}
}

func TestNoteInvitations(t *testing.T) {
	_, ts := newTestServer(t)
	alice, aliceID := register(t, ts, "alice")
	bob, bobID := register(t, ts, "bob")
	carol, carolID := register(t, ts, "carol")
	id := newNote(t, ts, alice)
	gwA := connectGW(t, ts, alice)
	gwB := connectGW(t, ts, bob)

	const bobKey = "c2VhbGVkLXRvLWJvYg"
	res, inv := do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": bobID, "role": store.NoteEditor, "key_sealed": bobKey})
	if res.StatusCode != http.StatusCreated || inv["user"].(map[string]any)["id"] != bobID {
		t.Fatalf("invite: %d %v", res.StatusCode, inv)
	}
	invID := inv["id"].(string)
	// the person invited is told, with the note's sealed head and their copy
	// of its key: enough to read what they are being invited to
	ev := gwB.next("note_invite", 2*time.Second)
	if ev == nil || ev["id"] != invID || ev["head"] != sealedHead || ev["key_sealed"] != bobKey || ev["from"].(map[string]any)["id"] != aliceID {
		t.Fatalf("note_invite: %v", ev)
	}
	_, list := do(t, ts, "GET", "/api/v1/notes", bob, nil)
	if invites := list["invites"].([]any); len(invites) != 1 || invites[0].(map[string]any)["id"] != invID || len(list["notes"].([]any)) != 0 {
		t.Errorf("bob's list before answering: %v", list)
	}
	// invited is not in: the note stays shut until they accept
	if res, _ := do(t, ts, "GET", "/api/v1/notes/"+id, bob, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("an invited person read the note: %d", res.StatusCode)
	}
	// the owner sees who is waiting; nobody else sees invitations
	_, sharing := do(t, ts, "GET", "/api/v1/notes/"+id+"/sharing", alice, nil)
	if w := sharing["invites"].([]any); len(w) != 1 || w[0].(map[string]any)["user"].(map[string]any)["id"] != bobID {
		t.Errorf("sharing: %v", sharing)
	}

	// nobody can answer an invitation that is not theirs
	if res, _ := do(t, ts, "POST", "/api/v1/note-invites/"+invID+"/accept", carol, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("carol accepted bob's invitation: %d", res.StatusCode)
	}
	res, note := do(t, ts, "POST", "/api/v1/note-invites/"+invID+"/accept", bob, nil)
	if res.StatusCode != http.StatusOK || note["id"] != id || note["role"].(float64) != store.NoteEditor || note["key_sealed"] != bobKey || note["body"] != sealedBody || note["members"].(float64) != 2 {
		t.Fatalf("accept: %d %v", res.StatusCode, note)
	}
	if ev := gwA.nextWhere("note_update", 2*time.Second, func(d map[string]any) bool { return d["members"] == true && d["version"] != nil }); ev == nil {
		t.Error("the owner is told someone joined")
	}
	if ev := gwB.next("note_invite_delete", 2*time.Second); ev == nil || ev["id"] != invID {
		t.Errorf("note_invite_delete: %v", ev)
	}
	// an editor edits, and does not share: that is the owner's
	if res, _ := do(t, ts, "PUT", "/api/v1/notes/"+id, bob, map[string]any{"head": sealedHead, "body": "v1.Ym9i.Ym9i", "base_version": 1}); res.StatusCode != http.StatusOK {
		t.Errorf("an editor's save: %d", res.StatusCode)
	}
	for _, try := range [][2]string{{"POST", "/invites"}, {"POST", "/links"}, {"DELETE", ""}, {"POST", "/rekey"}, {"PATCH", "/members/" + aliceID}} {
		if res, body := do(t, ts, try[0], "/api/v1/notes/"+id+try[1], bob, map[string]any{"user_id": carolID, "role": 1, "key_sealed": sealedKey}); res.StatusCode != http.StatusForbidden || errCode(body) != "note_role" {
			t.Errorf("%s %s by an editor: %d %v", try[0], try[1], res.StatusCode, body)
		}
	}

	// someone in the note already, yourself, nobody, and a role that is not one
	if res, body := do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": bobID, "role": 1, "key_sealed": sealedKey}); res.StatusCode != http.StatusConflict || errCode(body) != "already_member" {
		t.Errorf("inviting a member: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": aliceID, "role": 1, "key_sealed": sealedKey}); res.StatusCode != http.StatusBadRequest || errCode(body) != "self" {
		t.Errorf("inviting yourself: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": "999", "role": 1, "key_sealed": sealedKey}); res.StatusCode != http.StatusNotFound {
		t.Errorf("inviting nobody: %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": carolID, "role": store.NoteOwner, "key_sealed": sealedKey}); res.StatusCode != http.StatusBadRequest {
		t.Errorf("inviting someone to own the note: %d", res.StatusCode)
	}

	// declined, and withdrawn
	_, inv = do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": carolID, "role": store.NoteViewer, "key_sealed": sealedKey})
	if res, _ := do(t, ts, "DELETE", "/api/v1/note-invites/"+inv["id"].(string), carol, nil); res.StatusCode != http.StatusNoContent {
		t.Errorf("decline: %d", res.StatusCode)
	}
	if _, l := do(t, ts, "GET", "/api/v1/notes", carol, nil); len(l["invites"].([]any)) != 0 {
		t.Errorf("a declined invitation is still there: %v", l)
	}
	_, inv = do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": carolID, "role": store.NoteViewer, "key_sealed": sealedKey})
	if res, _ := do(t, ts, "DELETE", "/api/v1/notes/"+id+"/invites/"+inv["id"].(string), alice, nil); res.StatusCode != http.StatusNoContent {
		t.Errorf("withdraw: %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "POST", "/api/v1/note-invites/"+inv["id"].(string)+"/accept", carol, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("accepting a withdrawn invitation: %d", res.StatusCode)
	}

	// someone who blocked you is not asked things by you
	if res, _ := do(t, ts, "PUT", "/api/v1/users/@me/blocks/"+aliceID, carol, nil); res.StatusCode >= 300 {
		t.Fatalf("block: %d", res.StatusCode)
	}
	if res, body := do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": carolID, "role": 1, "key_sealed": sealedKey}); res.StatusCode != http.StatusForbidden || errCode(body) != "blocked" {
		t.Errorf("inviting someone who blocked you: %d %v", res.StatusCode, body)
	}
}

func TestNoteMembersAndRoles(t *testing.T) {
	_, ts := newTestServer(t)
	alice, aliceID := register(t, ts, "alice")
	bob, bobID := register(t, ts, "bob")
	id := newNote(t, ts, alice)
	_, inv := do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": bobID, "role": store.NoteViewer, "key_sealed": sealedKey})
	do(t, ts, "POST", "/api/v1/note-invites/"+inv["id"].(string)+"/accept", bob, nil)
	gwB := connectGW(t, ts, bob)

	// a viewer reads and cannot write
	if res, body := do(t, ts, "PUT", "/api/v1/notes/"+id, bob, map[string]any{"head": sealedHead, "body": sealedBody, "base_version": 1}); res.StatusCode != http.StatusForbidden || errCode(body) != "note_role" {
		t.Errorf("a viewer's save: %d %v", res.StatusCode, body)
	}
	_, sharing := do(t, ts, "GET", "/api/v1/notes/"+id+"/sharing", bob, nil)
	if m := sharing["members"].([]any); len(m) != 2 || m[0].(map[string]any)["user"].(map[string]any)["id"] != aliceID || m[0].(map[string]any)["role"].(float64) != store.NoteOwner {
		t.Errorf("members as a viewer sees them: %v", sharing)
	}
	// made an editor, they can
	if res, _ := do(t, ts, "PATCH", "/api/v1/notes/"+id+"/members/"+bobID, alice, map[string]any{"role": store.NoteEditor}); res.StatusCode != http.StatusNoContent {
		t.Fatalf("make editor: %d", res.StatusCode)
	}
	if ev := gwB.next("note_update", 2*time.Second); ev == nil || ev["members"] != true {
		t.Errorf("note_update on a role change: %v", ev)
	}
	if res, _ := do(t, ts, "PUT", "/api/v1/notes/"+id, bob, map[string]any{"head": sealedHead, "body": sealedBody, "base_version": 1}); res.StatusCode != http.StatusOK {
		t.Errorf("an editor's save: %d", res.StatusCode)
	}
	// the owner's role is not one to give, take or leave
	if res, _ := do(t, ts, "PATCH", "/api/v1/notes/"+id+"/members/"+aliceID, alice, map[string]any{"role": store.NoteViewer}); res.StatusCode != http.StatusNotFound {
		t.Errorf("demoting the owner: %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "PATCH", "/api/v1/notes/"+id+"/members/"+bobID, alice, map[string]any{"role": store.NoteOwner}); res.StatusCode != http.StatusBadRequest {
		t.Errorf("a second owner: %d", res.StatusCode)
	}
	if res, body := do(t, ts, "DELETE", "/api/v1/notes/"+id+"/members/@me", alice, nil); res.StatusCode != http.StatusBadRequest || errCode(body) != "note_owner" {
		t.Errorf("the owner leaving: %d %v", res.StatusCode, body)
	}
	// a member cannot remove another, only leave
	if res, _ := do(t, ts, "DELETE", "/api/v1/notes/"+id+"/members/"+aliceID, bob, nil); res.StatusCode != http.StatusForbidden {
		t.Errorf("a member removing the owner: %d", res.StatusCode)
	}
	// removed: the note is gone for them, at once
	if res, _ := do(t, ts, "DELETE", "/api/v1/notes/"+id+"/members/"+bobID, alice, nil); res.StatusCode != http.StatusNoContent {
		t.Fatalf("remove: %d", res.StatusCode)
	}
	if ev := gwB.next("note_delete", 2*time.Second); ev == nil || ev["id"] != id {
		t.Errorf("note_delete to the one removed: %v", ev)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/notes/"+id, bob, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("a removed member read the note: %d", res.StatusCode)
	}

	// the owner deletes it, and it is gone for everyone
	_, inv = do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": bobID, "role": store.NoteViewer, "key_sealed": sealedKey})
	do(t, ts, "POST", "/api/v1/note-invites/"+inv["id"].(string)+"/accept", bob, nil)
	if res, _ := do(t, ts, "DELETE", "/api/v1/notes/"+id, alice, nil); res.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: %d", res.StatusCode)
	}
	if ev := gwB.next("note_delete", 2*time.Second); ev == nil || ev["id"] != id {
		t.Errorf("note_delete on delete: %v", ev)
	}
	if _, l := do(t, ts, "GET", "/api/v1/notes", bob, nil); len(l["notes"].([]any)) != 0 {
		t.Errorf("a deleted note is still listed: %v", l)
	}
}

func TestNoteShareLinks(t *testing.T) {
	_, ts := newTestServer(t)
	alice, aliceID := register(t, ts, "alice")
	bob, _ := register(t, ts, "bob")
	carol, _ := register(t, ts, "carol")
	id := newNote(t, ts, alice)

	const token = "dG9rZW4tZm9yLWEtbm90ZS1saW5r"
	link := map[string]any{"token_hash": noteTokenHash(token), "role": store.NoteViewer, "key_wrapped": "d3JhcHBlZC1rZXk", "link_sealed": "c2VhbGVkLWxpbms"}
	res, made := do(t, ts, "POST", "/api/v1/notes/"+id+"/links", alice, link)
	if res.StatusCode != http.StatusCreated || made["link_sealed"] != "c2VhbGVkLWxpbms" || made["token_hash"] != nil {
		t.Fatalf("create link: %d %v", res.StatusCode, made)
	}
	// the same token twice, and a hash that is not one
	if res, _ := do(t, ts, "POST", "/api/v1/notes/"+id+"/links", alice, link); res.StatusCode != http.StatusConflict {
		t.Errorf("a token used twice: %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "POST", "/api/v1/notes/"+id+"/links", alice, map[string]any{"token_hash": "not-a-hash", "role": 1, "key_wrapped": "a2V5", "link_sealed": "bGluaw"}); res.StatusCode != http.StatusBadRequest {
		t.Errorf("a bad hash: %d", res.StatusCode)
	}

	// whoever holds the link sees what it leads to: the sealed head and the
	// key the link's own key opens, which is all the server has
	res, seen := do(t, ts, "GET", "/api/v1/note-links/"+token, bob, nil)
	if res.StatusCode != http.StatusOK || seen["note_id"] != id || seen["head"] != sealedHead || seen["key_wrapped"] != "d3JhcHBlZC1rZXk" || seen["role"].(float64) != store.NoteViewer || seen["member_role"].(float64) != 0 || seen["owner"].(map[string]any)["id"] != aliceID || seen["body"] != nil {
		t.Fatalf("link as a stranger sees it: %d %v", res.StatusCode, seen)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/note-links/"+token+"x", bob, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("a wrong token: %d", res.StatusCode)
	}
	// seeing is not joining
	if res, _ := do(t, ts, "GET", "/api/v1/notes/"+id, bob, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("read through a link without joining: %d", res.StatusCode)
	}
	res, joined := do(t, ts, "POST", "/api/v1/note-links/"+token+"/join", bob, map[string]any{"key_sealed": "Ym9icy1jb3B5"})
	if res.StatusCode != http.StatusOK || joined["role"].(float64) != store.NoteViewer || joined["key_sealed"] != "Ym9icy1jb3B5" || joined["body"] != sealedBody {
		t.Fatalf("join: %d %v", res.StatusCode, joined)
	}
	// joining twice changes nothing, least of all the key they hold
	_, again := do(t, ts, "POST", "/api/v1/note-links/"+token+"/join", bob, map[string]any{"key_sealed": "YW5vdGhlci1jb3B5"})
	if again["key_sealed"] != "Ym9icy1jb3B5" || again["members"].(float64) != 2 {
		t.Errorf("join again: %v", again)
	}
	_, sharing := do(t, ts, "GET", "/api/v1/notes/"+id+"/sharing", alice, nil)
	if l := sharing["links"].([]any); len(l) != 1 || l[0].(map[string]any)["uses"].(float64) != 1 {
		t.Errorf("the link counts who came in by it, once each: %v", sharing)
	}
	// a link to edit raises someone who could only read; one to read lowers nobody
	const editToken = "dG9rZW4tdG8tZWRpdC10aGUtbm90ZQ"
	do(t, ts, "POST", "/api/v1/notes/"+id+"/links", alice, map[string]any{"token_hash": noteTokenHash(editToken), "role": store.NoteEditor, "key_wrapped": "d3JhcHBlZA", "link_sealed": "c2VhbGVk"})
	if _, up := do(t, ts, "POST", "/api/v1/note-links/"+editToken+"/join", bob, map[string]any{"key_sealed": "eA"}); up["role"].(float64) != store.NoteEditor {
		t.Errorf("an edit link for a viewer: %v", up)
	}
	if _, down := do(t, ts, "POST", "/api/v1/note-links/"+token+"/join", bob, map[string]any{"key_sealed": "eA"}); down["role"].(float64) != store.NoteEditor {
		t.Errorf("a view link lowered an editor: %v", down)
	}
	if _, own := do(t, ts, "POST", "/api/v1/note-links/"+token+"/join", alice, map[string]any{"key_sealed": "eA"}); own["role"].(float64) != store.NoteOwner || own["key_sealed"] != sealedKey {
		t.Errorf("the owner through their own link: %v", own)
	}

	// revoked: the link leads nowhere, and those already in stay in
	linkID := made["id"].(string)
	if res, _ := do(t, ts, "DELETE", "/api/v1/notes/"+id+"/links/"+linkID, alice, nil); res.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke: %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/note-links/"+token, carol, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("a revoked link: %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "POST", "/api/v1/note-links/"+token+"/join", carol, map[string]any{"key_sealed": "eA"}); res.StatusCode != http.StatusNotFound {
		t.Errorf("joining by a revoked link: %d", res.StatusCode)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/notes/"+id, bob, nil); res.StatusCode != http.StatusOK {
		t.Errorf("a member after their link was revoked: %d", res.StatusCode)
	}
}

func TestNoteFiles(t *testing.T) {
	srv, ts := newTestServer(t)
	alice, _ := register(t, ts, "alice")
	bob, bobID := register(t, ts, "bob")
	carol, carolID := register(t, ts, "carol")
	id := newNote(t, ts, alice)
	share := func(tok, uid string, role int) {
		t.Helper()
		_, inv := do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": uid, "role": role, "key_sealed": sealedKey})
		if res, _ := do(t, ts, "POST", "/api/v1/note-invites/"+inv["id"].(string)+"/accept", tok, nil); res.StatusCode != http.StatusOK {
			t.Fatalf("share: %d", res.StatusCode)
		}
	}
	share(bob, bobID, store.NoteEditor)
	share(carol, carolID, store.NoteViewer)
	dave, _ := register(t, ts, "dave")

	upload := func(tok string, data []byte) (int, string) {
		t.Helper()
		req, _ := http.NewRequest("POST", ts.URL+"/api/v1/notes/"+id+"/attachments", bytes.NewReader(data))
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Content-Type", "application/octet-stream")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		blob, _ := out["blob_id"].(string)
		return res.StatusCode, blob
	}
	get := func(tok, blob string) (int, []byte) {
		t.Helper()
		req, _ := http.NewRequest("GET", ts.URL+"/media/attachments/"+blob, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		data, _ := io.ReadAll(res.Body)
		return res.StatusCode, data
	}
	refs := func(blob string) int {
		t.Helper()
		bid, _ := ids.Parse(blob)
		b, err := srv.Store.BlobByID(context.Background(), bid)
		if err != nil {
			t.Fatal(err)
		}
		return b.RefCount
	}

	picture := bytes.Repeat([]byte{0x42}, 3000)
	code, blob := upload(alice, picture)
	if code != http.StatusCreated || blob == "" {
		t.Fatalf("upload: %d", code)
	}
	// someone who only reads cannot add files, and a stranger cannot at all
	if code, _ := upload(carol, picture); code != http.StatusForbidden {
		t.Errorf("a viewer's upload: %d", code)
	}
	if code, _ := upload(dave, picture); code != http.StatusNotFound {
		t.Errorf("a stranger's upload: %d", code)
	}
	// until a save names it, the file is its uploader's alone
	if code, _ := get(bob, blob); code != http.StatusNotFound {
		t.Errorf("a file no save has named, read by another member: %d", code)
	}
	if res, body := do(t, ts, "PUT", "/api/v1/notes/"+id, alice, map[string]any{"head": sealedHead, "body": sealedBody, "base_version": 1, "files": []string{blob}}); res.StatusCode != http.StatusOK {
		t.Fatalf("save with a file: %d %v", res.StatusCode, body)
	}
	if refs(blob) != 1 {
		t.Errorf("the note holds the file once, held %d times", refs(blob))
	}
	// now it is the note's: every member can read it, viewers too, and nobody else
	for name, tok := range map[string]string{"owner": alice, "editor": bob, "viewer": carol} {
		if code, data := get(tok, blob); code != http.StatusOK || !bytes.Equal(data, picture) {
			t.Errorf("the %s reading the note's file: %d", name, code)
		}
	}
	if code, _ := get(dave, blob); code != http.StatusNotFound {
		t.Errorf("a stranger reading the note's file: %d", code)
	}
	// saved again with the same file, the note still holds it once
	do(t, ts, "PUT", "/api/v1/notes/"+id, bob, map[string]any{"head": sealedHead, "body": sealedBody, "base_version": 2, "files": []string{blob}})
	if refs(blob) != 1 {
		t.Errorf("held %d times after a second save", refs(blob))
	}

	// A note cannot be made to hold a file its saver did not upload: bob
	// names a file of alice's that the note does not have.
	_, loose := upload(alice, []byte("alice's other file"))
	if res, body := do(t, ts, "PUT", "/api/v1/notes/"+id, bob, map[string]any{"head": sealedHead, "body": sealedBody, "base_version": 3, "files": []string{blob, loose}}); res.StatusCode != http.StatusBadRequest || errCode(body) != "note_file" {
		t.Errorf("claiming someone else's upload: %d %v", res.StatusCode, body)
	} else if named, _ := body["files"].([]any); len(named) != 1 || named[0] != loose {
		// the app is told which, so it can take that file out and save the rest
		t.Errorf("the refusal names %v, wanted only %s", body["files"], loose)
	}
	if res, body := do(t, ts, "PUT", "/api/v1/notes/"+id, bob, map[string]any{"head": sealedHead, "body": sealedBody, "base_version": 3, "files": []string{blob, "424242"}}); res.StatusCode != http.StatusBadRequest || errCode(body) != "note_file" {
		t.Errorf("naming a file that is not there: %d %v", res.StatusCode, body)
	}
	// ...and the refused saves changed nothing
	if _, got := do(t, ts, "GET", "/api/v1/notes/"+id, alice, nil); got["version"].(float64) != 3 {
		t.Errorf("version after refused saves: %v", got["version"])
	}

	// let go of: the reference is given back, and it is its uploader's alone again
	if res, _ := do(t, ts, "PUT", "/api/v1/notes/"+id, bob, map[string]any{"head": sealedHead, "body": sealedBody, "base_version": 3, "files": []string{}}); res.StatusCode != http.StatusOK {
		t.Fatalf("save without the file: %d", res.StatusCode)
	}
	if refs(blob) != 0 {
		t.Errorf("held %d times after the note let it go", refs(blob))
	}
	if code, _ := get(carol, blob); code != http.StatusNotFound {
		t.Errorf("a file the note let go, read by a member: %d", code)
	}

	// deleting the note gives back whatever it still held
	do(t, ts, "PUT", "/api/v1/notes/"+id, alice, map[string]any{"head": sealedHead, "body": sealedBody, "base_version": 4, "files": []string{blob, loose}})
	if refs(blob) != 1 || refs(loose) != 1 {
		t.Fatalf("held %d and %d times", refs(blob), refs(loose))
	}
	do(t, ts, "DELETE", "/api/v1/notes/"+id, alice, nil)
	if refs(blob) != 0 || refs(loose) != 0 {
		t.Errorf("held %d and %d times after the note was deleted", refs(blob), refs(loose))
	}
}

// When someone is taken out of a note its owner seals it again under a new
// key, so what is written from then on is closed to the one who left.
func TestNoteRekey(t *testing.T) {
	_, ts := newTestServer(t)
	alice, aliceID := register(t, ts, "alice")
	bob, bobID := register(t, ts, "bob")
	carol, carolID := register(t, ts, "carol")
	id := newNote(t, ts, alice)
	_, inv := do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": bobID, "role": store.NoteEditor, "key_sealed": "b2xkLWJvYg"})
	do(t, ts, "POST", "/api/v1/note-invites/"+inv["id"].(string)+"/accept", bob, nil)
	_, waiting := do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": carolID, "role": store.NoteViewer, "key_sealed": "b2xkLWNhcm9s"})
	const keep, drop = "dG9rZW4tb2YtdGhlLWxpbmsta2VwdA", "dG9rZW4tb2YtdGhlLWxpbmstZHJvcHBlZA"
	_, kept := do(t, ts, "POST", "/api/v1/notes/"+id+"/links", alice, map[string]any{"token_hash": noteTokenHash(keep), "role": 1, "key_wrapped": "b2xk", "link_sealed": "b2xk"})
	do(t, ts, "POST", "/api/v1/notes/"+id+"/links", alice, map[string]any{"token_hash": noteTokenHash(drop), "role": 1, "key_wrapped": "b2xk", "link_sealed": "b2xk"})
	gwB := connectGW(t, ts, bob)

	rekey := func(base int, members []map[string]any) (*http.Response, map[string]any) {
		return do(t, ts, "POST", "/api/v1/notes/"+id+"/rekey", alice, map[string]any{
			"head": "v1.bmV3.aGVhZA", "body": "v1.bmV3.Ym9keQ", "base_version": base, "members": members, "prev_key": "b2xkLWtleS11bmRlci1uZXc",
			"invites": []map[string]any{{"id": waiting["id"], "key_sealed": "bmV3LWNhcm9s"}},
			"links":   []map[string]any{{"id": kept["id"], "key_wrapped": "bmV3LXdyYXA", "link_sealed": "bmV3LWxpbms"}},
		})
	}
	everyone := []map[string]any{{"user_id": aliceID, "key_sealed": "bmV3LWFsaWNl"}, {"user_id": bobID, "key_sealed": "bmV3LWJvYg"}}
	// leaving a member without the new key would lock them out of a note they are in
	if res, body := rekey(1, everyone[:1]); res.StatusCode != http.StatusConflict || errCode(body) != "note_members_changed" {
		t.Fatalf("a rekey that forgets a member: %d %v", res.StatusCode, body)
	}
	if res, body := rekey(7, everyone); res.StatusCode != http.StatusConflict || errCode(body) != "note_stale" {
		t.Fatalf("a rekey from the wrong version: %d %v", res.StatusCode, body)
	}
	res, done := rekey(1, everyone)
	if res.StatusCode != http.StatusOK || done["version"].(float64) != 2 {
		t.Fatalf("rekey: %d %v", res.StatusCode, done)
	}
	if ev := gwB.next("note_update", 2*time.Second); ev == nil || ev["rekeyed"] != true || ev["version"].(float64) != 2 {
		t.Errorf("note_update on rekey: %v", ev)
	}
	// each member's copy of the key is the new one, and so is the note
	if _, got := do(t, ts, "GET", "/api/v1/notes/"+id, bob, nil); got["key_sealed"] != "bmV3LWJvYg" || got["body"] != "v1.bmV3.Ym9keQ" || got["head"] != "v1.bmV3.aGVhZA" || got["key_epoch"].(float64) != 1 {
		t.Errorf("bob after the rekey: %v", got)
	}
	// the key it replaced is kept, sealed with the new one, for the note's
	// earlier states
	_, history := do(t, ts, "GET", "/api/v1/notes/"+id+"/versions", bob, nil)
	if keys := history["keys"].([]any); len(keys) != 1 || keys[0].(map[string]any)["epoch"].(float64) != 0 || keys[0].(map[string]any)["wrapped"] != "b2xkLWtleS11bmRlci1uZXc" {
		t.Errorf("key history: %v", history)
	}
	// a rekey that does not hand the old key on is refused
	if res, body := do(t, ts, "POST", "/api/v1/notes/"+id+"/rekey", alice, map[string]any{"head": "v1.eA.eA", "body": "v1.eA.eA", "base_version": 2, "members": everyone}); res.StatusCode != http.StatusBadRequest {
		t.Errorf("a rekey without the old key: %d %v", res.StatusCode, body)
	}
	// the invitation waiting carries the new key
	if _, l := do(t, ts, "GET", "/api/v1/notes", carol, nil); l["invites"].([]any)[0].(map[string]any)["key_sealed"] != "bmV3LWNhcm9s" {
		t.Errorf("carol's invitation after the rekey: %v", l)
	}
	// the link that was wrapped again still works; the one left out could
	// not open the note any more, and is gone
	if _, seen := do(t, ts, "GET", "/api/v1/note-links/"+keep, carol, nil); seen["key_wrapped"] != "bmV3LXdyYXA" {
		t.Errorf("the kept link: %v", seen)
	}
	if res, _ := do(t, ts, "GET", "/api/v1/note-links/"+drop, carol, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("the link left out of the rekey: %d", res.StatusCode)
	}
}

// Someone who held a note's key and is no longer in it leaves the note
// marked, and the mark stays until the owner's app has given the note a new
// key: the owner may not be there when it happens.
func TestNotesAreMarkedForANewKey(t *testing.T) {
	srv, ts := newTestServer(t)
	alice, aliceID := register(t, ts, "alice")
	bob, bobID := register(t, ts, "bob")
	carol, carolID := register(t, ts, "carol")
	id := newNote(t, ts, alice)
	marked := func() bool {
		t.Helper()
		_, got := do(t, ts, "GET", "/api/v1/notes/"+id, alice, nil)
		v, _ := got["needs_rekey"].(bool)
		// the list says the same, which is where an app that was away sees it
		_, list := do(t, ts, "GET", "/api/v1/notes", alice, nil)
		listed, _ := list["notes"].([]any)[0].(map[string]any)["needs_rekey"].(bool)
		if listed != v {
			t.Fatalf("the list says %v and the note says %v", listed, v)
		}
		return v
	}
	rekey := func(members ...string) {
		t.Helper()
		_, cur := do(t, ts, "GET", "/api/v1/notes/"+id, alice, nil)
		list := []map[string]any{}
		for _, m := range members {
			list = append(list, map[string]any{"user_id": m, "key_sealed": sealedKey})
		}
		res, body := do(t, ts, "POST", "/api/v1/notes/"+id+"/rekey", alice, map[string]any{"head": sealedHead, "body": sealedBody, "base_version": cur["version"], "prev_key": sealedKey, "members": list})
		if res.StatusCode != http.StatusOK {
			t.Fatalf("rekey: %d %v", res.StatusCode, body)
		}
		if marked() {
			t.Fatal("still marked after a new key")
		}
	}
	invite := func(uid string) string {
		t.Helper()
		res, inv := do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": uid, "role": store.NoteEditor, "key_sealed": sealedKey})
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("invite: %d %v", res.StatusCode, inv)
		}
		return inv["id"].(string)
	}
	join := func(tok, uid string) {
		t.Helper()
		if res, _ := do(t, ts, "POST", "/api/v1/note-invites/"+invite(uid)+"/accept", tok, nil); res.StatusCode != http.StatusOK {
			t.Fatalf("accept: %d", res.StatusCode)
		}
	}

	if marked() {
		t.Fatal("a new note is marked")
	}
	// sharing a note marks nothing: nobody who holds the key has left
	inv := invite(bobID)
	if marked() {
		t.Fatal("marked by an invitation")
	}
	// an invitation carried the key to the person invited: taken back, the
	// note wants a new one, and the owner's app is told so
	gwA := connectGW(t, ts, alice)
	if res, _ := do(t, ts, "DELETE", "/api/v1/notes/"+id+"/invites/"+inv, alice, nil); res.StatusCode != http.StatusNoContent {
		t.Fatalf("cancel: %d", res.StatusCode)
	}
	if ev := gwA.nextWhere("note_update", 2*time.Second, func(d map[string]any) bool { return d["removed"] == true }); ev == nil {
		t.Error("the owner was not told the note wants a new key")
	}
	if !marked() {
		t.Error("not marked after an invitation was taken back")
	}
	rekey(aliceID)
	// ...and the same when the person invited says no
	if res, _ := do(t, ts, "DELETE", "/api/v1/note-invites/"+invite(carolID), carol, nil); res.StatusCode != http.StatusNoContent {
		t.Fatalf("decline: %d", res.StatusCode)
	}
	if !marked() {
		t.Error("not marked after an invitation was declined")
	}
	rekey(aliceID)
	// a member leaving, and a member taken out
	join(bob, bobID)
	if marked() {
		t.Error("marked by someone joining")
	}
	do(t, ts, "DELETE", "/api/v1/notes/"+id+"/members/@me", bob, nil)
	if !marked() {
		t.Error("not marked after a member left")
	}
	rekey(aliceID)
	join(bob, bobID)
	do(t, ts, "DELETE", "/api/v1/notes/"+id+"/members/"+bobID, alice, nil)
	if !marked() {
		t.Error("not marked after a member was taken out")
	}
	rekey(aliceID)
	// a link is a way to the key for whoever holds it
	_, link := do(t, ts, "POST", "/api/v1/notes/"+id+"/links", alice, map[string]any{"token_hash": noteTokenHash("dG9rZW4tb2YtYS1saW5rLXRvLXJlbW92ZQ"), "role": 1, "key_wrapped": "b2xk", "link_sealed": "b2xk"})
	if marked() {
		t.Error("marked by a new link")
	}
	do(t, ts, "DELETE", "/api/v1/notes/"+id+"/links/"+link["id"].(string), alice, nil)
	if !marked() {
		t.Error("not marked after a link was removed")
	}
	rekey(aliceID)
	// and an account that is deleted held the keys of the notes it was in
	join(carol, carolID)
	cid, _ := ids.Parse(carolID)
	if err := srv.Store.PurgeUserLeftovers(context.Background(), cid); err != nil {
		t.Fatal(err)
	}
	if !marked() {
		t.Error("not marked after a member's account was deleted")
	}
	rekey(aliceID)
}

// Deleting an account takes its notes with it, files and all, and takes it
// out of the notes it was only shared.
func TestDeletedAccountsNotesGo(t *testing.T) {
	srv, ts := newTestServer(t)
	alice, aliceID := register(t, ts, "alice")
	bob, bobID := register(t, ts, "bob")
	hers := newNote(t, ts, alice)
	his := newNote(t, ts, bob)
	_, inv := do(t, ts, "POST", "/api/v1/notes/"+his+"/invites", bob, map[string]any{"user_id": aliceID, "role": store.NoteEditor, "key_sealed": sealedKey})
	do(t, ts, "POST", "/api/v1/note-invites/"+inv["id"].(string)+"/accept", alice, nil)
	do(t, ts, "POST", "/api/v1/notes/"+hers+"/invites", alice, map[string]any{"user_id": bobID, "role": store.NoteViewer, "key_sealed": sealedKey})
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/notes/"+hers+"/attachments", bytes.NewReader([]byte("a file in her note")))
	req.Header.Set("Authorization", "Bearer "+alice)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var up map[string]any
	_ = json.NewDecoder(res.Body).Decode(&up)
	res.Body.Close()
	blob := up["blob_id"].(string)
	do(t, ts, "PUT", "/api/v1/notes/"+hers, alice, map[string]any{"head": sealedHead, "body": sealedBody, "base_version": 1, "files": []string{blob}})

	uid, _ := ids.Parse(aliceID)
	if err := srv.Store.PurgeUserLeftovers(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	bid, _ := ids.Parse(blob)
	if b, err := srv.Store.BlobByID(context.Background(), bid); err != nil || b.RefCount != 0 {
		t.Errorf("her note's file is still held: %v %v", b, err)
	}
	_, list := do(t, ts, "GET", "/api/v1/notes", bob, nil)
	if notes := list["notes"].([]any); len(notes) != 1 || notes[0].(map[string]any)["id"] != his || notes[0].(map[string]any)["members"].(float64) != 1 {
		t.Errorf("bob's notes after alice's account went: %v", list)
	}
	if len(list["invites"].([]any)) != 0 {
		t.Errorf("an invitation from a deleted account is still waiting: %v", list)
	}
	hid, _ := ids.Parse(hers)
	if _, err := srv.Store.NoteMemberIDs(context.Background(), hid); err != nil {
		t.Fatal(err)
	}
	if members, _ := srv.Store.NoteMemberIDs(context.Background(), hid); len(members) != 0 {
		t.Errorf("her note still has members: %v", members)
	}
}

// Writing together is live: each save is sent on, sealed, to the others in
// the note as it lands, so the note they have open follows.
func TestNoteSavesReachTheOthersLive(t *testing.T) {
	_, ts := newTestServer(t)
	alice, aliceID := register(t, ts, "alice")
	bob, bobID := register(t, ts, "bob")
	carol, _ := register(t, ts, "carol")
	id := newNote(t, ts, alice)
	_, inv := do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": bobID, "role": store.NoteEditor, "key_sealed": sealedKey})
	do(t, ts, "POST", "/api/v1/note-invites/"+inv["id"].(string)+"/accept", bob, nil)
	gwA := connectGW(t, ts, alice)
	gwB := connectGW(t, ts, bob)
	gwC := connectGW(t, ts, carol)

	do(t, ts, "PUT", "/api/v1/notes/"+id, alice, map[string]any{"head": "v1.aDI.aDI", "body": "v1.YjI.YjI", "base_version": 1})
	ev := gwB.nextWhere("note_update", 2*time.Second, func(d map[string]any) bool { return d["version"] != nil })
	if ev == nil || ev["version"].(float64) != 2 || ev["body"] != "v1.YjI.YjI" || ev["head"] != "v1.aDI.aDI" || ev["edited_by"] != aliceID {
		t.Fatalf("the save as bob gets it: %v", ev)
	}
	// a long note goes by its version alone, to be fetched by whoever has it open
	long := "v1." + strings.Repeat("A", noteLiveBytes) + ".AA"
	do(t, ts, "PUT", "/api/v1/notes/"+id, alice, map[string]any{"head": sealedHead, "body": long, "base_version": 2})
	if ev := gwB.nextWhere("note_update", 2*time.Second, func(d map[string]any) bool { return d["version"] != nil }); ev == nil || ev["version"].(float64) != 3 || ev["body"] != nil {
		t.Errorf("a long note's save: %v", ev["version"])
	}
	// nobody outside the note hears any of it
	if ev := gwC.next("note_update", 300*time.Millisecond); ev != nil {
		t.Errorf("a stranger was told of a save: %v", ev)
	}

	// Who has the note open is said by the apps and passed along to the
	// others in it, and to nobody else.
	if res, _ := do(t, ts, "POST", "/api/v1/notes/"+id+"/presence", bob, map[string]any{"here": true, "hello": true}); res.StatusCode != http.StatusNoContent {
		t.Fatalf("presence: %d", res.StatusCode)
	}
	if ev := gwA.next("note_presence", 2*time.Second); ev == nil || ev["id"] != id || ev["user_id"] != bobID || ev["here"] != true || ev["hello"] != true {
		t.Errorf("note_presence as alice gets it: %v", ev)
	}
	if ev := gwB.next("note_presence", 300*time.Millisecond); ev != nil {
		t.Errorf("bob was told of himself: %v", ev)
	}
	do(t, ts, "POST", "/api/v1/notes/"+id+"/presence", bob, map[string]any{"here": false, "hello": true})
	if ev := gwA.next("note_presence", 2*time.Second); ev == nil || ev["here"] != false || ev["hello"] != false {
		t.Errorf("leaving: %v", ev)
	}
	if res, _ := do(t, ts, "POST", "/api/v1/notes/"+id+"/presence", carol, map[string]any{"here": true}); res.StatusCode != http.StatusNotFound {
		t.Errorf("a stranger's presence: %d", res.StatusCode)
	}

	// Where someone's caret is goes over the gateway, sealed, to the others
	// in the note and to nobody else.
	cursor := func(g *gw, note, data string) {
		t.Helper()
		b, _ := json.Marshal(map[string]any{"op": "note_cursor", "d": map[string]any{"id": note, "data": data}})
		if err := g.ws.Write(context.Background(), websocket.MessageText, b); err != nil {
			t.Fatal(err)
		}
	}
	cursor(gwB, id, "v1.Y3Vyc29y.Y3Vyc29y")
	if ev := gwA.next("note_cursor", 2*time.Second); ev == nil || ev["id"] != id || ev["user_id"] != bobID || ev["data"] != "v1.Y3Vyc29y.Y3Vyc29y" {
		t.Errorf("note_cursor as alice gets it: %v", ev)
	}
	if ev := gwB.next("note_cursor", 300*time.Millisecond); ev != nil {
		t.Errorf("bob was sent his own cursor: %v", ev)
	}
	// from someone outside the note, from anything not sealed, and for a note that is not there: nothing
	cursor(gwC, id, "v1.Y3Vyc29y.Y3Vyc29y")
	cursor(gwB, id, "<script>")
	cursor(gwB, id, "v1."+strings.Repeat("A", 4<<10))
	cursor(gwB, "123456789", "v1.Y3Vyc29y.Y3Vyc29y")
	if ev := gwA.next("note_cursor", 400*time.Millisecond); ev != nil {
		t.Errorf("a cursor that should have gone nowhere: %v", ev)
	}
	// a burst past the limit is cut short rather than closing the socket
	for i := 0; i < 40; i++ {
		cursor(gwB, id, "v1.YnVyc3Q.YnVyc3Q")
	}
	got := 0
	for gwA.next("note_cursor", 300*time.Millisecond) != nil {
		got++
	}
	if got == 0 || got >= 40 {
		t.Errorf("%d of a burst of 40 cursors were passed on", got)
	}
	if ev := gwB.next("heartbeat_ack", 100*time.Millisecond); ev == nil {
		b, _ := json.Marshal(map[string]any{"op": "heartbeat"})
		if err := gwB.ws.Write(context.Background(), websocket.MessageText, b); err != nil {
			t.Fatalf("the socket closed after a burst of cursors: %v", err)
		}
		if gwB.next("heartbeat_ack", 2*time.Second) == nil {
			t.Error("no heartbeat answered after a burst of cursors")
		}
	}
}

// Earlier states of a note are set aside as it is written: when writing
// starts again after a pause, and every so often while it goes on.
func TestNoteVersionHistory(t *testing.T) {
	quiet, every := store.NoteQuiet, store.NoteSnapshotEvery
	t.Cleanup(func() { store.NoteQuiet, store.NoteSnapshotEvery = quiet, every })
	srv, ts := newTestServer(t)
	alice, aliceID := register(t, ts, "alice")
	bob, bobID := register(t, ts, "bob")
	carol, carolID := register(t, ts, "carol")
	dave, _ := register(t, ts, "dave")
	id := newNote(t, ts, alice)
	for _, who := range []struct {
		tok, id string
		role    int
	}{{bob, bobID, store.NoteEditor}, {carol, carolID, store.NoteViewer}} {
		_, inv := do(t, ts, "POST", "/api/v1/notes/"+id+"/invites", alice, map[string]any{"user_id": who.id, "role": who.role, "key_sealed": sealedKey})
		do(t, ts, "POST", "/api/v1/note-invites/"+inv["id"].(string)+"/accept", who.tok, nil)
	}
	save := func(tok string, base int, body string, extra map[string]any) {
		t.Helper()
		req := map[string]any{"head": "v1.aA.aA" + body, "body": "v1.Yg.Yg" + body, "base_version": base}
		for k, v := range extra {
			req[k] = v
		}
		if res, out := do(t, ts, "PUT", "/api/v1/notes/"+id, tok, req); res.StatusCode != http.StatusOK {
			t.Fatalf("save from %d: %d %v", base, res.StatusCode, out)
		}
	}
	versions := func(tok string) []any {
		t.Helper()
		res, out := do(t, ts, "GET", "/api/v1/notes/"+id+"/versions", tok, nil)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("versions: %d %v", res.StatusCode, out)
		}
		return out["versions"].([]any)
	}

	// Writing that carries on is one draft: nothing is set aside while saves
	// follow each other within the pause.
	store.NoteQuiet, store.NoteSnapshotEvery = time.Hour, time.Hour
	save(alice, 1, "1", nil)
	save(alice, 2, "2", nil)
	save(bob, 3, "3", nil)
	if got := versions(alice); len(got) != 0 {
		t.Fatalf("versions kept while the writing went on: %v", got)
	}
	// Asked for (an old version is about to be put back), the state being
	// replaced is kept whatever the clock says.
	save(alice, 4, "4", map[string]any{"keep": true})
	got := versions(carol)
	if len(got) != 1 {
		t.Fatalf("versions after a kept save: %v", got)
	}
	v := got[0].(map[string]any)
	// the state it replaced: bob's save, as it was, with who made it and when
	if v["version"].(float64) != 4 || v["head"] != "v1.aA.aA3" || v["edited_by"] != bobID || v["body"] != nil || v["saved_at"].(float64) <= 0 || v["key_epoch"].(float64) != 0 {
		t.Errorf("the version kept: %v", v)
	}
	res, full := do(t, ts, "GET", "/api/v1/notes/"+id+"/versions/"+v["id"].(string), carol, nil)
	if res.StatusCode != http.StatusOK || full["body"] != "v1.Yg.Yg3" || full["head"] != "v1.aA.aA3" {
		t.Errorf("the version in full: %d %v", res.StatusCode, full)
	}
	// history is the note's members', and one note's versions are not another's
	if res, _ := do(t, ts, "GET", "/api/v1/notes/"+id+"/versions", dave, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("a stranger reading history: %d", res.StatusCode)
	}
	other := newNote(t, ts, alice)
	if res, _ := do(t, ts, "GET", "/api/v1/notes/"+other+"/versions/"+v["id"].(string), alice, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("a version read through another note: %d", res.StatusCode)
	}

	// After a pause, the next save sets the draft before it aside; and while
	// the writing never pauses, one is set aside every so often.
	store.NoteQuiet, store.NoteSnapshotEvery = 0, time.Hour
	save(alice, 5, "5", nil)
	if got := versions(alice); len(got) != 2 || got[0].(map[string]any)["head"] != "v1.aA.aA4" || got[0].(map[string]any)["edited_by"] != aliceID {
		t.Errorf("versions after a pause, newest first: %v", got)
	}
	store.NoteQuiet, store.NoteSnapshotEvery = time.Hour, 0
	save(alice, 6, "6", nil)
	if got := versions(alice); len(got) != 3 {
		t.Errorf("versions during long writing: %d", len(got))
	}

	// A file the note let go is still there for the versions that showed it.
	store.NoteQuiet, store.NoteSnapshotEvery = time.Hour, time.Hour
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/notes/"+id+"/attachments", bytes.NewReader([]byte("a picture, sealed")))
	req.Header.Set("Authorization", "Bearer "+alice)
	up, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var uploaded map[string]any
	_ = json.NewDecoder(up.Body).Decode(&uploaded)
	up.Body.Close()
	blob := uploaded["blob_id"].(string)
	refs := func() int {
		t.Helper()
		bid, _ := ids.Parse(blob)
		b, err := srv.Store.BlobByID(context.Background(), bid)
		if err != nil {
			t.Fatal(err)
		}
		return b.RefCount
	}
	read := func(tok string) int {
		t.Helper()
		r, _ := http.NewRequest("GET", ts.URL+"/media/attachments/"+blob, nil)
		r.Header.Set("Authorization", "Bearer "+tok)
		res, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	save(alice, 7, "7", map[string]any{"files": []string{blob}})
	// set aside while it holds the picture, then the picture is taken out
	save(alice, 8, "8", map[string]any{"files": []string{blob}, "keep": true})
	save(alice, 9, "9", map[string]any{"files": []string{}, "keep": true})
	if refs() != 2 {
		t.Errorf("the picture is held by %d, wanted the two versions that show it", refs())
	}
	if read(carol) != http.StatusOK {
		t.Errorf("a member reading a file only a version holds: %d", read(carol))
	}
	if read(dave) != http.StatusNotFound {
		t.Errorf("a stranger reading it: %d", read(dave))
	}
	// Putting an earlier state back brings its files with it, whoever does
	// it: bob did not upload the picture, but the note's own history holds it.
	save(bob, 10, "10", map[string]any{"files": []string{blob}, "keep": true})
	if refs() != 3 {
		t.Errorf("the picture is held by %d after it was put back, wanted the note and two versions", refs())
	}

	// Only so many are kept: past that the oldest go, and give their files back.
	before := len(versions(alice))
	version := 11
	for i := before; i < store.MaxNoteVersions+3; i++ {
		save(alice, version, "n", map[string]any{"keep": true})
		version++
	}
	got = versions(alice)
	if len(got) != store.MaxNoteVersions {
		t.Fatalf("kept %d versions, the most is %d", len(got), store.MaxNoteVersions)
	}
	if oldest := got[len(got)-1].(map[string]any); oldest["head"] == "v1.aA.aA3" {
		t.Error("the oldest version was not let go")
	}
	// deleting the note lets go of everything its versions held
	if res, _ := do(t, ts, "DELETE", "/api/v1/notes/"+id, alice, nil); res.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: %d", res.StatusCode)
	}
	if refs() != 0 {
		t.Errorf("the picture is still held %d times after the note went", refs())
	}
}
