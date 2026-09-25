package store

import (
	"context"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

// Listing packs reads every pack's stickers at once, and each pack still gets
// exactly its own, in their order.
func TestPackListsCarryTheirOwnStickersInOrder(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a := mkUser(t, s, "a")
	blob := &Blob{SHA256: "s", Size: 1, Mime: "image/png", Kind: "sticker", RefCount: 1}
	if err := s.InsertBlob(ctx, blob); err != nil {
		t.Fatal(err)
	}
	var packs []*StickerPack
	for _, name := range []string{"one", "two", "empty"} {
		p := &StickerPack{Name: name, Kind: "sticker", OwnerUserID: &a.ID, Public: true}
		if err := s.CreatePack(ctx, p); err != nil {
			t.Fatal(err)
		}
		packs = append(packs, p)
	}
	add := func(p *StickerPack, name string) *Sticker {
		st := &Sticker{PackID: p.ID, Name: name, BlobID: blob.ID, Format: "png", CreatorID: a.ID}
		if err := s.AddSticker(ctx, st); err != nil {
			t.Fatal(err)
		}
		return st
	}
	// added b then a, then moved a in front
	b := add(packs[0], "b")
	first := add(packs[0], "a")
	add(packs[1], "c")
	if err := s.SetStickerPositions(ctx, packs[0].ID, map[ids.ID]int{first.ID: 0, b.ID: 1}); err != nil {
		t.Fatal(err)
	}
	mine, err := s.PacksForUser(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	public, err := s.PublicPacks(ctx, a.ID, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, list := range [][]*StickerPack{mine, public} {
		got := map[string][]string{}
		for _, p := range list {
			if p.Stickers == nil {
				t.Errorf("%s has a nil sticker list", p.Name)
			}
			for _, st := range p.Stickers {
				got[p.Name] = append(got[p.Name], st.Name)
			}
		}
		if len(got["one"]) != 2 || got["one"][0] != "a" || got["one"][1] != "b" || len(got["two"]) != 1 || got["two"][0] != "c" || len(got["empty"]) != 0 {
			t.Errorf("stickers by pack: %v", got)
		}
	}
}
