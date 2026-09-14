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
