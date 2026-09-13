package store

import (
	"context"
	"errors"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

func TestKeyEpochsGrantsNeeds(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b, c := mkUser(t, s, "a"), mkUser(t, s, "b"), mkUser(t, s, "c")
	g, _ := s.CreateGroupDM(ctx, a.ID, []ids.ID{b.ID}, "g")
	if err := s.CreateEpoch(ctx, &KeyEpoch{ConvID: g.ID, Epoch: 1, CreatedBy: a.ID}); !errors.Is(err, ErrConflict) {
		t.Errorf("first epoch must be 0: %v", err)
	}
	if err := s.CreateEpoch(ctx, &KeyEpoch{ConvID: g.ID, Epoch: 0, CreatedBy: a.ID}); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateEpoch(ctx, &KeyEpoch{ConvID: g.ID, Epoch: 0, CreatedBy: a.ID}); !errors.Is(err, ErrConflict) {
		t.Error("duplicate epoch")
	}
	latest, ok, _ := s.LatestEpoch(ctx, g.ID)
	if !ok || latest != 0 {
		t.Error("latest")
	}
	if _, err := s.PutGrants(ctx, []KeyGrant{{ConvID: ids.ID(777), Epoch: 0, UserID: a.ID, WrappedKey: []byte{1}, WrappedBy: a.ID}}); !errors.Is(err, ErrNotFound) {
		t.Errorf("grant for unknown epoch: %v", err)
	}
	n, err := s.PutGrants(ctx, []KeyGrant{{ConvID: g.ID, Epoch: 0, UserID: a.ID, WrappedKey: []byte{1}, WrappedBy: a.ID}})
	if err != nil || n != 1 {
		t.Fatalf("self grant: %v %d", err, n)
	}
	n, _ = s.PutGrants(ctx, []KeyGrant{{ConvID: g.ID, Epoch: 0, UserID: a.ID, WrappedKey: []byte{2}, WrappedBy: a.ID}})
	if n != 0 {
		t.Error("duplicate grant ignored")
	}
	gr, _ := s.Grant(ctx, g.ID, 0, a.ID)
	if string(gr.WrappedKey) != "\x01" {
		t.Error("first grant wins")
	}
	needs, err := s.Needs(ctx, a.ID)
	if err != nil || len(needs) != 1 || len(needs[0].UserIDs) != 1 || needs[0].UserIDs[0] != b.ID {
		t.Fatalf("needs: %v %+v", err, needs)
	}
	needs, _ = s.Needs(ctx, b.ID)
	if len(needs) != 0 {
		t.Error("b holds nothing")
	}
	s.PutGrants(ctx, []KeyGrant{{ConvID: g.ID, Epoch: 0, UserID: b.ID, WrappedKey: []byte{3}, WrappedBy: a.ID}})
	needs, _ = s.Needs(ctx, a.ID)
	if len(needs) != 0 {
		t.Errorf("all granted: %+v", needs)
	}
	_, _ = s.AddParticipant(ctx, g.ID, c.ID, a.ID)
	needs, _ = s.Needs(ctx, b.ID)
	if len(needs) != 1 || needs[0].UserIDs[0] != c.ID {
		t.Errorf("new participant needs key from any holder: %+v", needs)
	}
	// rotation: new epoch, old holders lack the new one
	if err := s.CreateEpoch(ctx, &KeyEpoch{ConvID: g.ID, Epoch: 1, CreatedBy: a.ID, Reason: "kick"}); err != nil {
		t.Fatal(err)
	}
	s.PutGrants(ctx, []KeyGrant{{ConvID: g.ID, Epoch: 1, UserID: a.ID, WrappedKey: []byte{4}, WrappedBy: a.ID}})
	needs, _ = s.Needs(ctx, a.ID)
	if len(needs) != 1 || needs[0].Epoch != 1 || len(needs[0].UserIDs) != 2 {
		t.Errorf("after rotation: %+v", needs)
	}
	needs, _ = s.Needs(ctx, b.ID)
	if len(needs) != 0 {
		t.Error("b only holds epoch 0, which is not latest")
	}
	mine, _ := s.GrantsForUser(ctx, a.ID)
	if len(mine) != 2 {
		t.Errorf("a's grants: %d", len(mine))
	}
	eps, _ := s.Epochs(ctx, g.ID)
	if len(eps) != 2 || eps[1].Reason != "kick" {
		t.Errorf("epochs: %+v", eps)
	}
	tr := true
	_ = s.SetKeyFlags(ctx, g.ID, &tr, nil)
	f, _ := s.KeyFlags(ctx, g.ID)
	if !f.NeedsRotation || f.NeedsOwnKey {
		t.Errorf("flags: %+v", f)
	}
	if err := s.CreateEpoch(ctx, &KeyEpoch{ConvID: g.ID, Epoch: 2, CreatedBy: a.ID}); err != nil {
		t.Fatal(err)
	}
	f, _ = s.KeyFlags(ctx, g.ID)
	if f.NeedsRotation {
		t.Error("new epoch clears needs_rotation")
	}
	if _, err := s.Entitled(ctx, ids.ID(4242)); !errors.Is(err, ErrNotFound) {
		t.Error("unknown conv")
	}
	s.EntitledHook = func(ctx context.Context, conv ids.ID) ([]ids.ID, error) { return []ids.ID{a.ID}, nil }
	if e, err := s.Entitled(ctx, ids.ID(4242)); err != nil || len(e) != 1 {
		t.Error("hook")
	}
}
