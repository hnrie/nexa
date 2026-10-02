package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

func TestSoundFilesBelongToTheirAccount(t *testing.T) {
	srv, ts := newTestServer(t)
	alice, aliceID := register(t, ts, "alice")
	bob, bobID := register(t, ts, "bob")

	upload := func(tok string, data []byte) (int, string) {
		t.Helper()
		res, body := rawPost(t, ts.URL+"/api/v1/users/@me/sounds", tok, "application/octet-stream", data)
		var out map[string]any
		_ = json.Unmarshal(body, &out)
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
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, b
	}

	sealed := []byte("ECF1 a sealed recording of a doorbell")
	code, blob := upload(alice, sealed)
	if code != http.StatusCreated || blob == "" {
		t.Fatalf("upload: %d %q", code, blob)
	}
	// held, so the sweep leaves it alone
	bid, _ := ids.Parse(blob)
	if b, err := srv.Store.BlobByID(context.Background(), bid); err != nil || b.RefCount != 1 || !b.Encrypted {
		t.Fatalf("blob after upload: %+v %v", b, err)
	}
	// the account's own devices fetch it back; nobody else can
	if code, got := get(alice, blob); code != http.StatusOK || !bytes.Equal(got, sealed) {
		t.Errorf("owner fetch: %d %q", code, got)
	}
	if code, _ := get(bob, blob); code != http.StatusNotFound {
		t.Errorf("someone else fetched it: %d", code)
	}
	_, list := do(t, ts, "GET", "/api/v1/users/@me/sounds", alice, nil)
	if sounds := list["sounds"].([]any); len(sounds) != 1 || sounds[0].(map[string]any)["blob_id"] != blob {
		t.Errorf("list: %v", list)
	}
	if _, l := do(t, ts, "GET", "/api/v1/users/@me/sounds", bob, nil); len(l["sounds"].([]any)) != 0 {
		t.Errorf("bob's list: %v", l)
	}

	// nobody can take hold of a file that is not theirs, or let go of it
	bid2, _ := ids.Parse(bobID)
	if err := srv.Store.AddUserSound(context.Background(), bid2, bid); err == nil {
		t.Error("bob kept alice's file as his own sound")
	}
	if res, _ := do(t, ts, "DELETE", "/api/v1/users/@me/sounds/"+blob, bob, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("bob removed alice's sound: %d", res.StatusCode)
	}

	// too big is refused before anything is kept
	if code, _ := upload(alice, bytes.Repeat([]byte{1}, store.MaxSoundBytes+10)); code != http.StatusRequestEntityTooLarge && code != http.StatusBadRequest {
		t.Errorf("oversized sound: %d", code)
	}
	// and so is one past the limit
	for i := 1; i < store.MaxUserSounds; i++ {
		if code, _ := upload(alice, []byte(fmt.Sprintf("ECF1 sound %d", i))); code != http.StatusCreated {
			t.Fatalf("upload %d: %d", i, code)
		}
	}
	if res, body := rawPost(t, ts.URL+"/api/v1/users/@me/sounds", alice, "application/octet-stream", []byte("ECF1 one too many")); res.StatusCode != http.StatusBadRequest || !bytes.Contains(body, []byte("too_many_sounds")) {
		t.Errorf("past the limit: %d %s", res.StatusCode, body)
	}

	// removing gives the reference back
	if res, _ := do(t, ts, "DELETE", "/api/v1/users/@me/sounds/"+blob, alice, nil); res.StatusCode != http.StatusNoContent {
		t.Fatalf("remove: %d", res.StatusCode)
	}
	if b, err := srv.Store.BlobByID(context.Background(), bid); err != nil || b.RefCount != 0 {
		t.Errorf("blob after remove: %+v %v", b, err)
	}
	if res, _ := do(t, ts, "DELETE", "/api/v1/users/@me/sounds/"+blob, alice, nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("removed twice: %d", res.StatusCode)
	}

	// a deleted account's sounds go with it
	aid, _ := ids.Parse(aliceID)
	if err := srv.Store.PurgeUserLeftovers(context.Background(), aid); err != nil {
		t.Fatal(err)
	}
	if left, err := srv.Store.UserSounds(context.Background(), aid); err != nil || len(left) != 0 {
		t.Errorf("sounds after purge: %v %v", left, err)
	}
}
