package store

import (
	"context"
	"slices"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

// A DM someone starts is in their own sidebar at once, and in the other
// person's only once something happens in it.
func TestStartDMWaitsForTheOtherSide(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b := mkUser(t, s, "sda"), mkUser(t, s, "sdb")
	ch, created, err := s.StartDM(ctx, a.ID, b.ID)
	if err != nil || !created {
		t.Fatalf("start: %v %v", created, err)
	}
	if !hasBoth(ch.Recipients, a.ID, b.ID) || ch.KeyConvID != ch.ID {
		t.Fatalf("started DM: recipients %v, key conversation %v", ch.Recipients, ch.KeyConvID)
	}
	listed := func(uid ids.ID) bool {
		list, err := s.DMChannelsForUser(ctx, uid)
		if err != nil {
			t.Fatal(err)
		}
		return slices.ContainsFunc(list, func(c *Channel) bool { return c.ID == ch.ID })
	}
	shown := func() []ids.ID {
		list, err := s.DMShownTo(ctx, ch.ID)
		if err != nil {
			t.Fatal(err)
		}
		return list
	}
	if !listed(a.ID) || listed(b.ID) {
		t.Fatalf("after starting: listed for a %v, for b %v", listed(a.ID), listed(b.ID))
	}
	if got := shown(); !slices.Equal(got, []ids.ID{a.ID}) {
		t.Errorf("shown to %v, want only the one who started it", got)
	}
	// Both are still in it: the other person can be sent to, and holds keys.
	if parts, _ := s.Participants(ctx, ch.ID); !hasBoth(parts, a.ID, b.ID) {
		t.Errorf("participants %v", parts)
	}
	// starting it again finds the same one, still not shown to b
	again, created, err := s.StartDM(ctx, a.ID, b.ID)
	if err != nil || created || again.ID != ch.ID || listed(b.ID) {
		t.Fatalf("second start: %v %v %v, listed for b %v", again, created, err, listed(b.ID))
	}
	// something new in it puts it in front of b
	reopened, err := s.UnhideDM(ctx, ch.ID)
	if err != nil || !slices.Equal(reopened, []ids.ID{b.ID}) {
		t.Fatalf("unhide: %v %v", reopened, err)
	}
	if !listed(b.ID) || len(shown()) != 2 {
		t.Errorf("after something new: listed for b %v, shown to %v", listed(b.ID), shown())
	}

	// CreateDM, which becoming friends uses, shows a new DM to both at once
	c, d := mkUser(t, s, "sdc"), mkUser(t, s, "sdd")
	both, created, err := s.CreateDM(ctx, c.ID, d.ID)
	if err != nil || !created {
		t.Fatalf("create: %v %v", created, err)
	}
	if got, _ := s.DMShownTo(ctx, both.ID); !hasBoth(got, c.ID, d.ID) {
		t.Errorf("CreateDM shown to %v, want both", got)
	}
}

func TestShareServer(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b, c := mkUser(t, s, "ssa"), mkUser(t, s, "ssb"), mkUser(t, s, "ssc")
	srv, err := s.CreateServer(ctx, a.ID, "Den", DefaultNames{})
	if err != nil {
		t.Fatal(err)
	}
	// c has a server of their own, which nobody else is in
	if _, err := s.CreateServer(ctx, c.ID, "Alone", DefaultNames{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddMember(ctx, srv.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		x, y *User
		want bool
	}{{a, b, true}, {b, a, true}, {a, c, false}, {c, b, false}} {
		if got, err := s.ShareServer(ctx, tc.x.ID, tc.y.ID); err != nil || got != tc.want {
			t.Errorf("ShareServer(%s, %s) = %v %v, want %v", tc.x.Username, tc.y.Username, got, err, tc.want)
		}
	}
	if err := s.RemoveMember(ctx, srv.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.ShareServer(ctx, a.ID, b.ID); got {
		t.Error("still sharing a server after leaving it")
	}
}

func TestNewAccountsTakeMessagesFromFriendsAndServerMembers(t *testing.T) {
	s := newStore(t)
	u := mkUser(t, s, "fresh")
	if u.DMPrivacy != DMFriendsServers {
		t.Errorf("new account dm_privacy = %q", u.DMPrivacy)
	}
	back, err := s.UserByID(context.Background(), u.ID)
	if err != nil || back.DMPrivacy != DMFriendsServers {
		t.Errorf("stored dm_privacy = %v %v", back, err)
	}
}
