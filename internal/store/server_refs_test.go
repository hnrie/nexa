package store

import (
	"context"
	"errors"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

func TestJoinByInviteIsAtomic(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	owner, bob, carol, troll := mkUser(t, s, "owner"), mkUser(t, s, "bob"), mkUser(t, s, "carol"), mkUser(t, s, "troll")
	srv, err := s.CreateServer(ctx, owner.ID, "Joins", DefaultNames{})
	if err != nil {
		t.Fatal(err)
	}
	in, err := s.CreateInvite(ctx, &srv.ID, nil, owner.ID, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	uses := func() int {
		var n int
		_ = s.db.R.QueryRowContext(ctx, `SELECT uses FROM invites WHERE code = ?`, in.Code).Scan(&n)
		return n
	}
	// someone already inside spends nothing
	if _, err := s.JoinByInvite(ctx, srv.ID, owner.ID, in.Code); !errors.Is(err, ErrAlreadyExists) || uses() != 0 {
		t.Errorf("member rejoining: %v, uses %d", err, uses())
	}
	// a banned user is refused by the insert itself and spends nothing
	if err := s.Ban(ctx, &Ban{ServerID: srv.ID, UserID: troll.ID, BannedBy: owner.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.JoinByInvite(ctx, srv.ID, troll.ID, in.Code); !errors.Is(err, ErrBanned) || uses() != 0 {
		t.Errorf("banned join: %v, uses %d", err, uses())
	}
	if _, err := s.AddMember(ctx, srv.ID, troll.ID); !errors.Is(err, ErrBanned) {
		t.Errorf("banned AddMember: %v", err)
	}
	if _, err := s.JoinByInvite(ctx, srv.ID, bob.ID, in.Code); err != nil || uses() != 1 {
		t.Fatalf("first join: %v, uses %d", err, uses())
	}
	// the one use is gone: carol's join is rolled back entirely
	if _, err := s.JoinByInvite(ctx, srv.ID, carol.ID, in.Code); !errors.Is(err, ErrNotFound) {
		t.Errorf("exhausted invite: %v", err)
	}
	if ok, _ := s.IsMember(ctx, srv.ID, carol.ID); ok {
		t.Error("a join over the invite's limit left a membership behind")
	}
}

func TestDeletesReleaseImages(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	owner := mkUser(t, s, "owner")
	blob := func(kind string, refs int) ids.ID {
		b := &Blob{SHA256: ids.New().String(), Size: 1, Mime: "image/png", Kind: kind, RefCount: refs}
		if err := s.InsertBlob(ctx, b); err != nil {
			t.Fatal(err)
		}
		return b.ID
	}
	refs := func(id ids.ID) int {
		b, err := s.BlobByID(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		return b.RefCount
	}
	srv, err := s.CreateServer(ctx, owner.ID, "Pictures", DefaultNames{})
	if err != nil {
		t.Fatal(err)
	}
	icon, banner, emoji, sticker := blob("icon", 1), blob("banner", 1), blob("emoji", 2), blob("sticker", 1)
	iconP, bannerP := &icon, &banner
	if err := s.UpdateServer(ctx, srv.ID, ServerPatch{IconID: &iconP, BannerID: &bannerP}); err != nil {
		t.Fatal(err)
	}
	// the same picture used for two emoji holds two references
	for _, name := range []string{"one", "two"} {
		if err := s.CreateEmoji(ctx, &Emoji{ServerID: srv.ID, Name: name, BlobID: emoji, CreatorID: owner.ID}); err != nil {
			t.Fatal(err)
		}
	}
	pack := &StickerPack{ServerID: &srv.ID, Name: "Pack"}
	if err := s.CreatePack(ctx, pack); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSticker(ctx, &Sticker{PackID: pack.ID, Name: "s", BlobID: sticker, Format: "png", CreatorID: owner.ID}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteServer(ctx, srv.ID); err != nil {
		t.Fatal(err)
	}
	for name, id := range map[string]ids.ID{"icon": icon, "banner": banner, "emoji": emoji, "sticker": sticker} {
		if n := refs(id); n != 0 {
			t.Errorf("%s still has %d references after the server was deleted", name, n)
		}
	}

	avatar, profileBanner := blob("avatar", 1), blob("banner", 1)
	a, b := &avatar, &profileBanner
	if err := s.UpdateProfile(ctx, owner.ID, ProfilePatch{AvatarID: &a, BannerID: &b}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteAccount(ctx, owner.ID); err != nil {
		t.Fatal(err)
	}
	if refs(avatar) != 0 || refs(profileBanner) != 0 {
		t.Errorf("profile images after account deletion: %d %d", refs(avatar), refs(profileBanner))
	}
}
