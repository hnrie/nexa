package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
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
	// capitals outside ASCII fold too
	if err := s.UpdateProfile(ctx, u.ID, ProfilePatch{DisplayName: ptr("Łukasz Émile")}); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{"Łukasz", "łuk", "ŁUKASZ"} {
		if res, err := s.SearchUsers(ctx, q, 10); err != nil || len(res) != 1 || res[0].ID != u.ID {
			t.Errorf("search %q: %v %v", q, res, err)
		}
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

// Two overlapping removals of the same avatar release its picture once.
func TestSwapImageReleasesTheOldPictureOnce(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	u := mkUser(t, s, "dana")
	// one reference is dana's, the other belongs to someone with the same picture
	pic := &Blob{SHA256: "pic", Size: 10, Mime: "image/png", Kind: "avatar", RefCount: 2}
	if err := s.InsertBlob(ctx, pic); err != nil {
		t.Fatal(err)
	}
	picID := &pic.ID
	if err := s.UpdateProfile(ctx, u.ID, ProfilePatch{AvatarID: &picID}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := s.SwapImage(ctx, "users", "avatar_id", u.ID, nil); err != nil {
			t.Fatal(err)
		}
	}
	if got, _ := s.BlobByID(ctx, pic.ID); got.RefCount != 1 {
		t.Errorf("ref count = %d, want 1: the other reference must survive", got.RefCount)
	}
	if me, _ := s.UserByID(ctx, u.ID); me.AvatarID != nil {
		t.Errorf("avatar should be cleared: %v", *me.AvatarID)
	}
	// setting the picture it already has keeps one reference for it
	_ = s.AddBlobRef(ctx, pic.ID, 1) // what an upload of the same picture takes
	if err := s.SwapImage(ctx, "users", "avatar_id", u.ID, &pic.ID); err != nil {
		t.Fatal(err)
	}
	_ = s.AddBlobRef(ctx, pic.ID, 1)
	if err := s.SwapImage(ctx, "users", "avatar_id", u.ID, &pic.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.BlobByID(ctx, pic.ID); got.RefCount != 2 {
		t.Errorf("ref count after setting the same picture twice = %d, want 2", got.RefCount)
	}
	if err := s.SwapImage(ctx, "users", "flags", u.ID, nil); err == nil {
		t.Error("only image columns can be swapped")
	}
}

// Two admins acting on the same account at the same moment must not undo each
// other. Each used to read the whole bitfield, compute a new one in Go and
// write it back, so whoever landed second silently dropped the other's change
// — and both were shown the change they had made.
func TestChangeUserFlagsKeepsTheOtherChange(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	u := mkUser(t, s, "contested")

	var wg sync.WaitGroup
	wg.Add(2)
	errs := make([]error, 2)
	go func() { defer wg.Done(); _, errs[0] = s.ChangeUserFlags(ctx, u.ID, FlagDisabled, 0) }()
	go func() { defer wg.Done(); _, errs[1] = s.ChangeUserFlags(ctx, u.ID, FlagAdmin, 0) }()
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("change %d: %v", i, err)
		}
	}
	got, err := s.UserByID(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Flags&FlagDisabled == 0 || got.Flags&FlagAdmin == 0 {
		t.Errorf("flags = %d, want both disabled and admin set", got.Flags)
	}
	// and clearing one bit leaves the other alone
	flags, err := s.ChangeUserFlags(ctx, u.ID, 0, FlagDisabled)
	if err != nil {
		t.Fatal(err)
	}
	if flags&FlagDisabled != 0 || flags&FlagAdmin == 0 {
		t.Errorf("flags = %d after clearing disabled, want admin still set", flags)
	}
	if _, err := s.ChangeUserFlags(ctx, ids.New(), FlagAdmin, 0); !errors.Is(err, ErrNotFound) {
		t.Errorf("changing flags on a missing account = %v, want ErrNotFound", err)
	}
}
