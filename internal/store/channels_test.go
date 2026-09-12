package store

import (
	"context"
	"errors"
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
	if err := s.AddParticipant(ctx, g.ID, c.ID, a.ID); !errors.Is(err, ErrAlreadyExists) {
		t.Error("re-adding should be ErrAlreadyExists")
	}
	if err := s.RemoveParticipant(ctx, g.ID, c.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveParticipant(ctx, g.ID, c.ID); !errors.Is(err, ErrNotFound) {
		t.Error("removing twice")
	}
	d := mkUser(t, s, "d")
	if err := s.AddParticipant(ctx, g.ID, d.ID, a.ID); err != nil {
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
