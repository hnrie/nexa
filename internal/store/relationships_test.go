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

// A note lands on the recipient's row of a pending request, only from the
// person who sent it, and a change of type leaves no note behind.
func TestRequestNote(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b, c := mkUser(t, s, "a"), mkUser(t, s, "b"), mkUser(t, s, "c")
	noteOf := func(owner, other *User) string {
		t.Helper()
		r, err := s.Relationship(ctx, owner.ID, other.ID)
		if err != nil {
			t.Fatal(err)
		}
		return r.Note
	}
	if err := s.SetRelationshipPair(ctx, a.ID, b.ID, "outgoing", "incoming"); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.SetRequestNote(ctx, a.ID, b.ID, "sealed"); err != nil || !ok {
		t.Fatalf("sender's note: %v %v", ok, err)
	}
	if noteOf(b, a) != "sealed" || noteOf(a, b) != "" {
		t.Errorf("the note belongs on the recipient's row only: %q %q", noteOf(b, a), noteOf(a, b))
	}
	if ok, _ := s.SetRequestNote(ctx, b.ID, a.ID, "the other way"); ok {
		t.Error("the recipient put a note on a request they did not send")
	}
	// an incoming row whose sender is not waiting on it takes no note
	if err := s.SetRelationship(ctx, c.ID, a.ID, "incoming"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.SetRequestNote(ctx, a.ID, c.ID, "stale"); ok {
		t.Error("a note landed on a request nobody is waiting on")
	}
	if err := s.SetRelationshipPair(ctx, a.ID, b.ID, "friend", "friend"); err != nil {
		t.Fatal(err)
	}
	if noteOf(b, a) != "" {
		t.Error("the note outlived the request")
	}
}
