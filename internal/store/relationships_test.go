package store

import (
	"context"
	"testing"
)

func TestRelationships(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b, c := mkUser(t, s, "a"), mkUser(t, s, "b"), mkUser(t, s, "c")
	if err := s.SetRelationshipPair(ctx, a.ID, b.ID, "outgoing", "incoming"); err != nil {
		t.Fatal(err)
	}
	r, _ := s.Relationship(ctx, b.ID, a.ID)
	if r.Type != "incoming" {
		t.Errorf("incoming: %+v", r)
	}
	_ = s.SetRelationshipPair(ctx, a.ID, b.ID, "friend", "friend")
	ok, _ := s.AreFriends(ctx, b.ID, a.ID)
	if !ok {
		t.Error("friends")
	}
	_ = s.SetRelationshipPair(ctx, a.ID, c.ID, "friend", "friend")
	_ = s.SetRelationshipPair(ctx, b.ID, c.ID, "friend", "friend")
	mutual, _ := s.MutualFriends(ctx, a.ID, b.ID)
	if len(mutual) != 1 || mutual[0] != c.ID {
		t.Errorf("mutual: %v", mutual)
	}
	friends, _ := s.Friends(ctx, a.ID)
	if len(friends) != 2 {
		t.Errorf("friends of a: %v", friends)
	}
	list, _ := s.Relationships(ctx, a.ID)
	if len(list) != 2 {
		t.Errorf("list: %d", len(list))
	}
	_ = s.SetRelationship(ctx, a.ID, b.ID, "blocked")
	_ = s.DeleteRelationship(ctx, b.ID, a.ID)
	ab, ba, _ := s.Blocked(ctx, a.ID, b.ID)
	if !ab || ba {
		t.Errorf("blocked: %v %v", ab, ba)
	}
	ab, ba, _ = s.Blocked(ctx, b.ID, a.ID)
	if ab || !ba {
		t.Errorf("blocked reversed: %v %v", ab, ba)
	}
	ok, _ = s.AreFriends(ctx, a.ID, b.ID)
	if ok {
		t.Error("blocking replaced friendship")
	}
	_ = s.DeleteRelationshipPair(ctx, a.ID, c.ID)
	if _, err := s.Relationship(ctx, c.ID, a.ID); err == nil {
		t.Error("pair delete")
	}
}
