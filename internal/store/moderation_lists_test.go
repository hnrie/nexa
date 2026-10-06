package store

import (
	"context"
	"fmt"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

// Each view of the staff's case list holds as many cases as its count says.
func TestModCaseViewsMatchTheirCounts(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	staff := mkUser(t, s, "staff")
	bob := mkUser(t, s, "bob")
	carol := mkUser(t, s, "carol")
	dave := mkUser(t, s, "dave")
	soon := func() *int64 { v := nowMs() + 3_600_000; return &v }
	restrict := func(uid ids.ID, action string) *ModCase {
		t.Helper()
		c := &ModCase{UserID: uid, ModeratorID: staff.ID, Action: action, Reason: "Spam", ExpiresAt: soon()}
		if _, _, err := s.ModRestrict(ctx, c, nil); err != nil {
			t.Fatal(err)
		}
		return c
	}

	// bob is muted twice: the second replaces the first, so one case holds
	restrict(bob.ID, ActionMute)
	restrict(bob.ID, ActionMute)
	// and banned besides: two restrictions of his are in force, in two cases
	restrict(bob.ID, ActionBan)
	// carol's mute was lifted, and her case closed
	lifted := restrict(carol.ID, ActionMute)
	if _, _, err := s.ModLift(ctx, lifted.ID, staff.ID, "", nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SetModCaseClosed(ctx, lifted.ID, staff.ID, true); err != nil {
		t.Fatal(err)
	}
	// dave's name was reset, and he asked why
	reset := &ModCase{UserID: dave.ID, ModeratorID: staff.ID, Action: ActionFieldReset, Reason: "Name"}
	if err := s.OpenModCase(ctx, reset, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := s.AddModMessage(ctx, reset.ID, dave.ID, ModMsgMember, "Why?", nil); err != nil {
		t.Fatal(err)
	}

	now := nowMs()
	counts, err := s.CountModCases(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"needs_reply": counts.NeedsReply, "open": counts.Open, "in_effect": counts.InEffect, "closed": counts.Closed, "all": counts.All}
	for view, n := range want {
		list, err := s.ModCaseList(ctx, ModCaseFilter{View: view, Limit: 100, Now: now})
		if err != nil {
			t.Fatal(err)
		}
		if len(list) != n {
			t.Errorf("%s: the list holds %d cases, its count says %d", view, len(list), n)
		}
	}
	if counts.InEffect != 2 || counts.All != 5 || counts.Closed != 1 || counts.NeedsReply != 1 {
		t.Errorf("counts: %+v", counts)
	}
}

// Most Members puts the biggest servers first, across pages.
func TestModServersByMembers(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	owner := mkUser(t, s, "owner")
	var people []*User
	for i := 0; i < 6; i++ {
		people = append(people, mkUser(t, s, fmt.Sprintf("member%d", i)))
	}
	// made smallest first, so newest first would be the wrong way round
	sizes := map[ids.ID]int{}
	for n := 1; n <= 6; n++ {
		srv, err := s.CreateServer(ctx, owner.ID, fmt.Sprintf("Size %d", n), DefaultNames{})
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range people[:n-1] {
			if _, err := s.AddMember(ctx, srv.ID, p.ID); err != nil {
				t.Fatal(err)
			}
		}
		sizes[srv.ID] = n
	}
	var seen []int
	for offset := 0; offset < 6; offset += 4 {
		page, err := s.ModServers(ctx, ModServerFilter{Sort: "members", Offset: offset, Limit: 4})
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range page {
			if m.MemberCount != sizes[m.ID] {
				t.Errorf("%s: shown with %d members, has %d", m.Name, m.MemberCount, sizes[m.ID])
			}
			seen = append(seen, m.MemberCount)
		}
	}
	if fmt.Sprint(seen) != "[6 5 4 3 2 1]" {
		t.Errorf("most members first, across pages: %v", seen)
	}
}

// Most Installs puts the most installed packs first.
func TestModPacksByInstalls(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	owner := mkUser(t, s, "owner")
	var people []*User
	for i := 0; i < 3; i++ {
		people = append(people, mkUser(t, s, fmt.Sprintf("fan%d", i)))
	}
	for n := 0; n < 3; n++ {
		p := &StickerPack{OwnerUserID: &owner.ID, Name: fmt.Sprintf("Pack %d", n), Public: true}
		if err := s.CreatePack(ctx, p); err != nil {
			t.Fatal(err)
		}
		for _, u := range people[:n] {
			if err := s.InstallPack(ctx, u.ID, p.ID); err != nil {
				t.Fatal(err)
			}
		}
	}
	list, err := s.ModPacks(ctx, ModPackFilter{Scope: "all", Sort: "installs", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	var got []int
	for _, p := range list {
		got = append(got, p.Installs)
	}
	if fmt.Sprint(got) != "[2 1 0]" {
		t.Errorf("most installs first: %v", got)
	}
}
