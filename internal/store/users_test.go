package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

func TestUsersCRUD(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	u := mkUser(t, s, "alice")
	if u.ID.IsZero() || u.CreatedAt == 0 {
		t.Fatal("id/created_at not filled")
	}
	if err := s.CreateUser(ctx, &User{Username: "alice", DisplayName: "x", AuthHash: "h", KDFSalt: []byte{1}, KDFParams: "{}", PublicKey: []byte{1}, EncPrivateKey: []byte{1}}); !errors.Is(err, ErrUsernameTaken) {
		t.Errorf("want ErrUsernameTaken, got %v", err)
	}
	got, err := s.UserByUsername(ctx, "alice")
	if err != nil || got.ID != u.ID {
		t.Fatal(err)
	}
	blob := &Blob{SHA256: "sha-av", Size: 1, Mime: "image/png", Kind: "avatar", RefCount: 1}
	if err := s.InsertBlob(ctx, blob); err != nil {
		t.Fatal(err)
	}
	av := blob.ID
	avp := &av
	if err := s.UpdateProfile(ctx, u.ID, ProfilePatch{AvatarID: &avp, AboutMe: ptr("hi"), AccentColor: ptr(ptr(0xff00ff))}); err != nil {
		t.Fatal(err)
	}
	got, _ = s.UserByID(ctx, u.ID)
	if got.AvatarID == nil || *got.AvatarID != av || got.AboutMe != "hi" || got.AccentColor == nil || *got.AccentColor != 0xff00ff {
		t.Errorf("patch not applied: %+v", got)
	}
	var nilID *ids.ID
	var nilInt *int
	if err := s.UpdateProfile(ctx, u.ID, ProfilePatch{AvatarID: &nilID, AccentColor: &nilInt}); err != nil {
		t.Fatal(err)
	}
	got, _ = s.UserByID(ctx, u.ID)
	if got.AvatarID != nil || got.AccentColor != nil {
		t.Error("avatar/accent should be cleared")
	}
	b, _ := json.Marshal(got.Public())
	if strings.Contains(string(b), "auth") || strings.Contains(string(b), "kdf") || strings.Contains(string(b), "enc_private") {
		t.Errorf("public view leaks: %s", b)
	}
	if !strings.Contains(string(b), `"id":"`) {
		t.Errorf("id should be a string: %s", b)
	}
	if _, err := s.UserByID(ctx, ids.ID(1)); !errors.Is(err, ErrNotFound) {
		t.Error("want ErrNotFound")
	}
	if err := s.UpdateProfile(ctx, ids.ID(1), ProfilePatch{AboutMe: ptr("x")}); !errors.Is(err, ErrNotFound) {
		t.Error("patch of unknown user should be ErrNotFound")
	}
	// username change respects uniqueness
	mkUser(t, s, "bob")
	if err := s.UpdateProfile(ctx, u.ID, ProfilePatch{Username: ptr("bob")}); !errors.Is(err, ErrUsernameTaken) {
		t.Errorf("rename to taken name: %v", err)
	}
	if err := s.UpdateProfile(ctx, u.ID, ProfilePatch{Username: ptr("alice2")}); err != nil {
		t.Fatal(err)
	}
	n, _ := s.CountUsers(ctx)
	if n != 2 {
		t.Errorf("count = %d", n)
	}
	m, err := s.UsersByIDs(ctx, []ids.ID{u.ID, ids.ID(77)})
	if err != nil || len(m) != 1 || m[u.ID].Username != "alice2" {
		t.Errorf("UsersByIDs: %v %v", err, m)
	}
	res, _ := s.SearchUsers(ctx, "AL", 10)
	if len(res) != 1 || res[0].ID != u.ID {
		t.Errorf("search: %v", res)
	}
	res, _ = s.SearchUsers(ctx, "%", 10)
	if len(res) != 0 {
		t.Error("LIKE wildcard must be escaped")
	}
}

func TestUpdateAuthAndFlagsAndDelete(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	u := mkUser(t, s, "carol")
	if err := s.UpdateAuth(ctx, u.ID, AuthUpdate{AuthHash: "h2", EncPrivateKey: []byte{2}, EncPrivateKeyRecovery: []byte{3}, RecoveryAuthHash: "rh", KDFSalt: []byte{7}, KDFParams: "{p}"}); err != nil {
		t.Fatal(err)
	}
	got, _ := s.UserByID(ctx, u.ID)
	if got.AuthHash != "h2" || string(got.EncPrivateKey) != "\x02" || string(got.EncPrivateKeyRecovery) != "\x03" || got.RecoveryAuthHash != "rh" || string(got.KDFSalt) != "\x07" || got.KDFParams != "{p}" {
		t.Errorf("auth not updated: %+v", got)
	}
	if err := s.UpdateAuth(ctx, u.ID, AuthUpdate{AuthHash: "h3", EncPrivateKey: []byte{4}}); err != nil {
		t.Fatal(err)
	}
	got, _ = s.UserByID(ctx, u.ID)
	if got.AuthHash != "h3" || got.RecoveryAuthHash != "rh" || string(got.KDFSalt) != "\x07" {
		t.Error("recovery and kdf must be kept when not provided")
	}
	if err := s.UpdateRecovery(ctx, u.ID, "rh2", []byte{8}); err != nil {
		t.Fatal(err)
	}
	got, _ = s.UserByID(ctx, u.ID)
	if got.RecoveryAuthHash != "rh2" || string(got.EncPrivateKeyRecovery) != "\x08" {
		t.Error("UpdateRecovery")
	}
	if err := s.SetUserFlags(ctx, u.ID, FlagAdmin); err != nil {
		t.Fatal(err)
	}
	got, _ = s.UserByID(ctx, u.ID)
	if got.Flags != FlagAdmin || got.Public().Flags != FlagAdmin {
		t.Error("flags")
	}
	se := &Session{UserID: u.ID, TokenHash: "t"}
	if err := s.CreateSession(ctx, se); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteAccount(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = s.UserByID(ctx, u.ID)
	if got.Username != "deleted-"+u.ID.String() || got.Flags&FlagDeleted == 0 || len(got.EncPrivateKey) != 0 {
		t.Errorf("not anonymised: %+v", got)
	}
	if _, err := s.SessionByTokenHash(ctx, "t"); !errors.Is(err, ErrNotFound) {
		t.Error("sessions should be gone")
	}
}
