package store

import (
	"context"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

func TestAltAccountsShareAnAddress(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b, c := mkUser(t, s, "alts_a"), mkUser(t, s, "alts_b"), mkUser(t, s, "alts_c")
	if err := s.CreateSession(ctx, &Session{UserID: a.ID, TokenHash: "ta", IP: "203.0.113.5"}); err != nil {
		t.Fatal(err)
	}
	sb := &Session{UserID: b.ID, TokenHash: "tb", IP: "198.51.100.1"}
	if err := s.CreateSession(ctx, sb); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSession(ctx, &Session{UserID: c.ID, TokenHash: "tc", IP: "192.0.2.9"}); err != nil {
		t.Fatal(err)
	}
	if alts, _ := s.AltAccounts(ctx, a.ID); len(alts) != 0 {
		t.Fatalf("no shared address yet: %+v", alts)
	}
	// b's session moves to a's address: the session and the account keep it
	if err := s.TouchSession(ctx, sb, "203.0.113.5", sb.CreatedAt+1000); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.SessionByID(ctx, sb.ID); got.IP != "203.0.113.5" {
		t.Fatalf("session ip %q", got.IP)
	}
	alts, err := s.AltAccounts(ctx, a.ID)
	if err != nil || len(alts) != 1 || alts[0].UserID != b.ID || alts[0].SharedIPs != 1 {
		t.Fatalf("alts of a: %v %+v", err, alts)
	}
	counts, err := s.AltCounts(ctx, []ids.ID{a.ID, b.ID, c.ID})
	if err != nil || counts[a.ID] != 1 || counts[b.ID] != 1 || counts[c.ID] != 0 {
		t.Fatalf("counts: %v %v", err, counts)
	}
	// a deleted account is nobody's alt, and its addresses go with it
	if err := s.DeleteAccount(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if alts, _ := s.AltAccounts(ctx, a.ID); len(alts) != 0 {
		t.Fatalf("deleted account still an alt: %+v", alts)
	}
}
