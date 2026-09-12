package store

import (
	"context"
	"errors"
	"testing"
)

func TestSessions(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	u := mkUser(t, s, "dave")
	a := &Session{UserID: u.ID, TokenHash: "a", UserAgent: "ua", IP: "1.2.3.4"}
	b := &Session{UserID: u.ID, TokenHash: "b"}
	if err := s.CreateSession(ctx, a); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSession(ctx, b); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSession(ctx, &Session{UserID: u.ID, TokenHash: "a"}); err == nil {
		t.Error("duplicate token hash must fail")
	}
	got, err := s.SessionByTokenHash(ctx, "a")
	if err != nil || got.ID != a.ID || got.UserID != u.ID || got.UserAgent != "ua" {
		t.Fatalf("lookup: %v %+v", err, got)
	}
	if err := s.TouchSession(ctx, a.ID, a.CreatedAt+5000); err != nil {
		t.Fatal(err)
	}
	list, _ := s.SessionsByUser(ctx, u.ID)
	if len(list) != 2 || list[0].ID != a.ID {
		t.Errorf("list should be newest-activity first: %+v", list)
	}
	if err := s.DeleteUserSessions(ctx, u.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SessionByTokenHash(ctx, "b"); !errors.Is(err, ErrNotFound) {
		t.Error("b should be deleted")
	}
	if _, err := s.SessionByTokenHash(ctx, "a"); err != nil {
		t.Error("a should survive")
	}
	n, _ := s.DeleteExpiredSessions(ctx, a.CreatedAt+6000)
	if n != 1 {
		t.Errorf("expired = %d", n)
	}
	if err := s.DeleteSession(ctx, a.ID); !errors.Is(err, ErrNotFound) {
		t.Error("already deleted should be ErrNotFound")
	}
}

func TestSettingsVersioning(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	u := mkUser(t, s, "erin")
	st, err := s.GetSettings(ctx, u.ID)
	if err != nil || st != nil {
		t.Fatalf("expected no settings: %v %v", err, st)
	}
	v, err := s.PutSettings(ctx, u.ID, []byte("one"), 0)
	if err != nil || v != 1 {
		t.Fatalf("create: %v %d", err, v)
	}
	if _, err := s.PutSettings(ctx, u.ID, []byte("dup"), 0); !errors.Is(err, ErrConflict) {
		t.Error("second create must conflict")
	}
	v, err = s.PutSettings(ctx, u.ID, []byte("two"), 1)
	if err != nil || v != 2 {
		t.Fatalf("update: %v %d", err, v)
	}
	if _, err := s.PutSettings(ctx, u.ID, []byte("stale"), 1); !errors.Is(err, ErrConflict) {
		t.Error("stale version must conflict")
	}
	st, _ = s.GetSettings(ctx, u.ID)
	if string(st.Blob) != "two" || st.Version != 2 {
		t.Errorf("got %+v", st)
	}
}

func TestBlobs(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	b := &Blob{SHA256: "abc", Size: 10, Mime: "image/png", Kind: "avatar", RefCount: 1, Width: ptr(4), Height: ptr(4), CreatedAt: 1000}
	if err := s.InsertBlob(ctx, b); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertBlob(ctx, &Blob{SHA256: "abc", Size: 10, Mime: "image/png", Kind: "avatar"}); err == nil {
		t.Error("same sha+kind must be unique")
	}
	if err := s.InsertBlob(ctx, &Blob{SHA256: "abc", Size: 10, Mime: "image/png", Kind: "emoji", CreatedAt: 1000}); err != nil {
		t.Error("same sha, different kind is allowed:", err)
	}
	got, err := s.BlobBySHA(ctx, "abc", "avatar")
	if err != nil || got.ID != b.ID || *got.Width != 4 {
		t.Fatalf("by sha: %v %+v", err, got)
	}
	if err := s.AddBlobRef(ctx, b.ID, -5); err != nil {
		t.Fatal(err)
	}
	got, _ = s.BlobByID(ctx, b.ID)
	if got.RefCount != 0 {
		t.Errorf("ref should clamp at 0, got %d", got.RefCount)
	}
	un, _ := s.UnreferencedBlobs(ctx, 2000)
	if len(un) != 2 {
		t.Errorf("unreferenced = %d", len(un))
	}
	un, _ = s.UnreferencedBlobs(ctx, 500)
	if len(un) != 0 {
		t.Error("olderThan filter")
	}
	if err := s.DeleteBlob(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.BlobByID(ctx, b.ID); !errors.Is(err, ErrNotFound) {
		t.Error("deleted")
	}
}
