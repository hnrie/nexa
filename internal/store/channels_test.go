package store

import (
	"context"
	"errors"
	"sync"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

func TestDMAndGroupDM(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b, c := mkUser(t, s, "a"), mkUser(t, s, "b"), mkUser(t, s, "c")
	dm, created, err := s.CreateDM(ctx, a.ID, b.ID)
	if err != nil || !created || dm.Type != "dm" || len(dm.Recipients) != 2 {
		t.Fatalf("create dm: %v %v %+v", err, created, dm)
	}
	again, created, err := s.CreateDM(ctx, b.ID, a.ID)
	if err != nil || created || again.ID != dm.ID {
		t.Errorf("dm dedupe (reverse order): %v %v %v", err, created, again)
	}
	other, created, _ := s.CreateDM(ctx, a.ID, c.ID)
	if !created || other.ID == dm.ID {
		t.Error("different pair must be a new dm")
	}
	g, err := s.CreateGroupDM(ctx, a.ID, []ids.ID{b.ID, c.ID, b.ID}, "gang")
	if err != nil || g.Type != "group_dm" || len(g.Recipients) != 3 || *g.OwnerID != a.ID || g.Name != "gang" {
		t.Fatalf("group: %v %+v", err, g)
	}
	ok, _ := s.IsParticipant(ctx, g.ID, c.ID)
	if !ok {
		t.Error("c should be a participant")
	}
	if _, err := s.AddParticipant(ctx, g.ID, c.ID, a.ID); !errors.Is(err, ErrAlreadyExists) {
		t.Error("re-adding should be ErrAlreadyExists")
	}
	if _, _, err := s.RemoveParticipant(ctx, g.ID, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.RemoveParticipant(ctx, g.ID, c.ID); !errors.Is(err, ErrNotFound) {
		t.Error("removing twice")
	}
	d := mkUser(t, s, "d")
	if _, err := s.AddParticipant(ctx, g.ID, d.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	parts, _ := s.Participants(ctx, g.ID)
	if len(parts) != 3 || parts[2] != d.ID {
		t.Errorf("participants: %v", parts)
	}
	list, err := s.DMChannelsForUser(ctx, a.ID)
	if err != nil || len(list) != 3 {
		t.Fatalf("a's channels: %v %d", err, len(list))
	}
	for _, ch := range list {
		if len(ch.Recipients) < 2 {
			t.Errorf("recipients not loaded: %+v", ch)
		}
	}
	list, _ = s.DMChannelsForUser(ctx, c.ID)
	if len(list) != 1 || list[0].ID != other.ID {
		t.Errorf("c's channels: %v", list)
	}
	icon := &Blob{SHA256: "i", Size: 1, Mime: "image/png", Kind: "icon", RefCount: 1}
	_ = s.InsertBlob(ctx, icon)
	ip := &icon.ID
	if err := s.UpdateChannel(ctx, g.ID, ChannelPatch{Name: ptr("renamed"), IconID: &ip, OwnerID: &b.ID}); err != nil {
		t.Fatal(err)
	}
	g, _ = s.ChannelByID(ctx, g.ID)
	if g.Name != "renamed" || g.IconID == nil || *g.OwnerID != b.ID {
		t.Errorf("patch: %+v", g)
	}
	if err := s.DeleteChannel(ctx, g.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ChannelByID(ctx, g.ID); !errors.Is(err, ErrNotFound) {
		t.Error("deleted")
	}
	if n, _ := s.Participants(ctx, g.ID); len(n) != 0 {
		t.Error("participants should cascade")
	}
}

func TestConcurrentCreateDMMakesOneConversation(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b := mkUser(t, s, "a"), mkUser(t, s, "b")
	const n = 8
	got := make([]ids.ID, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			x, y := a.ID, b.ID
			if i%2 == 1 {
				x, y = y, x
			}
			if ch, _, err := s.CreateDM(ctx, x, y); err == nil {
				got[i] = ch.ID
			}
		}()
	}
	wg.Wait()
	for i := range got {
		if got[i].IsZero() || got[i] != got[0] {
			t.Fatalf("two taps opened different DMs: %v", got)
		}
	}
}

func TestSubchatMembersFollowTheGroup(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b, c := mkUser(t, s, "a"), mkUser(t, s, "b"), mkUser(t, s, "c")
	g, _ := s.CreateGroupDM(ctx, a.ID, []ids.ID{b.ID}, "g")
	sub, err := s.CreateSubchat(ctx, g, a.ID, "plans", nil)
	if err != nil {
		t.Fatal(err)
	}
	joined, err := s.AddParticipant(ctx, g.ID, c.ID, a.ID)
	if err != nil || len(joined) != 1 || joined[0] != sub.ID {
		t.Fatalf("join: %v %v", joined, err)
	}
	if ok, _ := s.IsParticipant(ctx, sub.ID, c.ID); !ok {
		t.Error("a new group member should be in its subchats")
	}
	left, stillThere, err := s.RemoveParticipant(ctx, g.ID, b.ID)
	if err != nil || len(left) != 1 || left[0] != sub.ID {
		t.Fatalf("leave: %v %v", left, err)
	}
	// who is left has to come from the same transaction, so two people leaving
	// at once cannot each be told the other is still there
	if len(stillThere) != 2 || !hasBoth(stillThere, a.ID, c.ID) {
		t.Errorf("remaining after b left = %v, want a and c", stillThere)
	}
	if ok, _ := s.IsParticipant(ctx, sub.ID, b.ID); ok {
		t.Error("someone who left the group should leave its subchats")
	}
	if err := s.DeleteChannel(ctx, g.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ChannelByID(ctx, sub.ID); !errors.Is(err, ErrNotFound) {
		t.Error("deleting a group should delete its subchats")
	}
}

func hasBoth(list []ids.ID, want ...ids.ID) bool {
	for _, w := range want {
		found := false
		for _, got := range list {
			if got == w {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// A DM is its own key conversation. Unset, the field marshalled as "0" and any
// client that read it without a guard against that string encrypted the first
// message of a new conversation for the wrong one.
func TestCreateDMCarriesItsKeyConversation(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b := mkUser(t, s, "kca"), mkUser(t, s, "kcb")
	ch, created, err := s.CreateDM(ctx, a.ID, b.ID)
	if err != nil || !created {
		t.Fatalf("create: %v %v", created, err)
	}
	if ch.KeyConvID != ch.ID {
		t.Errorf("key_conv_id = %v on a freshly created DM, want %v", ch.KeyConvID, ch.ID)
	}
	// and the second call, which re-reads, agrees with it
	again, created, err := s.CreateDM(ctx, b.ID, a.ID)
	if err != nil || created {
		t.Fatalf("second create: %v %v", created, err)
	}
	if again.KeyConvID != ch.ID {
		t.Errorf("key_conv_id = %v on re-read, want %v", again.KeyConvID, ch.ID)
	}
}
