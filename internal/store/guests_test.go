package store

import (
	"context"
	"errors"
	"testing"
)

func TestGuestLinks(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b := mkUser(t, s, "a"), mkUser(t, s, "b")
	dm, _, err := s.CreateDM(ctx, a.ID, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	link, err := s.CreateGuestLink(ctx, dm.ID, a.ID, 3, 60_000)
	if err != nil {
		t.Fatal(err)
	}
	if len(link.Code) != guestCodeLen || link.ExpiresAt != link.CreatedAt+60_000 {
		t.Fatalf("link: %+v", link)
	}
	got, err := s.GuestLinkByCode(ctx, link.Code)
	if err != nil || got.ChannelID != dm.ID || got.CreatorID != a.ID || got.Epoch != 3 {
		t.Fatalf("by code: %+v %v", got, err)
	}

	g := &Guest{LinkCode: link.Code, ChannelID: dm.ID, DisplayName: "Visitor", Epoch: link.Epoch, TokenHash: "hash-1", ExpiresAt: nowMs() + 60_000}
	if err := s.CreateGuest(ctx, g); err != nil {
		t.Fatal(err)
	}
	if g.ID.IsZero() || g.SessionID.IsZero() || g.ID == g.SessionID {
		t.Fatalf("guest ids: %+v", g)
	}
	byToken, err := s.GuestByTokenHash(ctx, "hash-1")
	if err != nil || byToken.ID != g.ID || byToken.DisplayName != "Visitor" || byToken.Epoch != 3 {
		t.Fatalf("by token: %+v %v", byToken, err)
	}
	if u := byToken.User(); u.Flags != FlagGuest || u.ID != g.ID || u.Username != "" {
		t.Fatalf("stand-in user: %+v", u)
	}
	// a guest never becomes an account
	if _, err := s.UserByID(ctx, g.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("guest found among users: %v", err)
	}
	list, _ := s.GuestLinksForChannel(ctx, dm.ID)
	if len(list) != 1 || list[0].Guests != 1 {
		t.Fatalf("listing: %+v", list)
	}

	// an expired link with a guest still in stays; once the guest is gone it goes
	if _, err := s.DeleteSpentGuestLinks(ctx, link.ExpiresAt+1); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GuestLinkByCode(ctx, link.Code); err != nil {
		t.Fatalf("link with a guest in was swept: %v", err)
	}
	if err := s.DeleteGuest(ctx, g.ID); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.DeleteSpentGuestLinks(ctx, link.ExpiresAt+1); n != 1 {
		t.Fatalf("spent link not swept: %d", n)
	}

	// revoking a link takes its guests along
	link2, _ := s.CreateGuestLink(ctx, dm.ID, a.ID, 3, 60_000)
	g2 := &Guest{LinkCode: link2.Code, ChannelID: dm.ID, DisplayName: "Two", TokenHash: "hash-2", ExpiresAt: nowMs() + 60_000}
	if err := s.CreateGuest(ctx, g2); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteGuestLink(ctx, link2.Code); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GuestByID(ctx, g2.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("guest outlived its link: %v", err)
	}
	if err := s.DeleteGuestLink(ctx, link2.Code); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second revoke: %v", err)
	}
}

// Codes use every letter of the alphabet equally often: drawn by a byte
// modulo 56, the first 32 letters came up a quarter more often than the rest.
func TestRandomCodeIsEven(t *testing.T) {
	counts := map[byte]int{}
	const draws = 20000
	for i := 0; i < draws/20; i++ {
		c := randomCode(20)
		if len(c) != 20 {
			t.Fatalf("length %d", len(c))
		}
		for j := 0; j < len(c); j++ {
			counts[c[j]]++
		}
	}
	if len(counts) != len(inviteAlphabet) {
		t.Fatalf("%d distinct letters, want %d", len(counts), len(inviteAlphabet))
	}
	first, rest := 0, 0
	for i := 0; i < len(inviteAlphabet); i++ {
		if i < 32 {
			first += counts[inviteAlphabet[i]]
		} else {
			rest += counts[inviteAlphabet[i]]
		}
	}
	// evenly drawn, the first 32 letters take 32/56 of the draws; biased, 160/256
	got, even := float64(first)/float64(first+rest), 32.0/56.0
	if got > even+0.02 || got < even-0.02 {
		t.Errorf("the first 32 letters took %.3f of the draws, want about %.3f", got, even)
	}
}
