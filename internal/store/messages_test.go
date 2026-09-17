package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"evilion.xyz/chat/internal/ids"
)

func mkMsg(t *testing.T, s *Store, ch, author ids.ID, text string) *Message {
	t.Helper()
	m := &Message{ChannelID: ch, AuthorID: author, Ciphertext: json.RawMessage(`{"v":1,"ct":"` + text + `"}`)}
	if err := s.InsertMessage(context.Background(), m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestMessagesPaginationAndCRUD(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b := mkUser(t, s, "a"), mkUser(t, s, "b")
	dm, _, _ := s.CreateDM(ctx, a.ID, b.ID)
	var all []*Message
	for i := 0; i < 12; i++ {
		all = append(all, mkMsg(t, s, dm.ID, a.ID, "m"))
	}
	ch, _ := s.ChannelByID(ctx, dm.ID)
	if ch.LastMessageID == nil || *ch.LastMessageID != all[11].ID {
		t.Errorf("last_message_id not bumped: %v", ch.LastMessageID)
	}
	page, err := s.Messages(ctx, dm.ID, MessageQuery{Limit: 5}, b.ID)
	if err != nil || len(page) != 5 || page[0].ID != all[7].ID || page[4].ID != all[11].ID {
		t.Fatalf("latest page ascending: %v %v", err, idsOf(page))
	}
	page, _ = s.Messages(ctx, dm.ID, MessageQuery{Before: all[7].ID, Limit: 5}, b.ID)
	if len(page) != 5 || page[0].ID != all[2].ID || page[4].ID != all[6].ID {
		t.Errorf("before: %v", idsOf(page))
	}
	page, _ = s.Messages(ctx, dm.ID, MessageQuery{After: all[9].ID, Limit: 5}, b.ID)
	if len(page) != 2 || page[0].ID != all[10].ID {
		t.Errorf("after: %v", idsOf(page))
	}
	page, _ = s.Messages(ctx, dm.ID, MessageQuery{Around: all[5].ID, Limit: 4}, b.ID)
	if len(page) != 4 || page[0].ID != all[3].ID || page[2].ID != all[5].ID {
		t.Errorf("around: %v", idsOf(page))
	}
	page, _ = s.Messages(ctx, dm.ID, MessageQuery{Limit: 1000}, b.ID)
	if len(page) != 12 {
		t.Errorf("limit clamps to 100 but returns all 12: %d", len(page))
	}
	// nonce dedupe
	n1 := &Message{ChannelID: dm.ID, AuthorID: a.ID, Ciphertext: json.RawMessage(`{"v":1}`), Nonce: "abc"}
	if err := s.InsertMessage(ctx, n1); err != nil {
		t.Fatal(err)
	}
	n2 := &Message{ChannelID: dm.ID, AuthorID: a.ID, Ciphertext: json.RawMessage(`{"v":1}`), Nonce: "abc"}
	if err := s.InsertMessage(ctx, n2); !errors.Is(err, ErrAlreadyExists) {
		t.Errorf("dup nonce: %v", err)
	}
	got, err := s.MessageByNonce(ctx, dm.ID, a.ID, "abc", a.ID)
	if err != nil || got.ID != n1.ID {
		t.Errorf("by nonce: %v", err)
	}
	n3 := &Message{ChannelID: dm.ID, AuthorID: b.ID, Ciphertext: json.RawMessage(`{"v":1}`), Nonce: "abc"}
	if err := s.InsertMessage(ctx, n3); err != nil {
		t.Error("same nonce by another author is fine:", err)
	}
	// edit
	if err := s.UpdateMessage(ctx, all[0].ID, json.RawMessage(`{"v":1,"ct":"edited"}`), dm.ID, 3, []ids.ID{b.ID}, nil, false, 12345); err != nil {
		t.Fatal(err)
	}
	m, _ := s.MessageByID(ctx, all[0].ID, b.ID)
	if string(m.Ciphertext) != `{"v":1,"ct":"edited"}` || m.EditedAt == nil || *m.EditedAt != 12345 || len(m.Mentions) != 1 || m.Mentions[0] != b.ID || m.KeyConvID == nil || *m.KeyConvID != dm.ID || m.KeyEpoch == nil || *m.KeyEpoch != 3 {
		t.Errorf("edit: %+v", m)
	}
	// attachments + delete releases blob
	blob := &Blob{SHA256: "x", Size: 5, Mime: "application/octet-stream", Kind: "attachment", Encrypted: true}
	_ = s.InsertBlob(ctx, blob)
	withAtt := &Message{ChannelID: dm.ID, AuthorID: a.ID, Ciphertext: json.RawMessage(`{"v":1}`), Attachments: []Attachment{{BlobID: blob.ID, Size: 5}}}
	if err := s.InsertMessage(ctx, withAtt); err != nil {
		t.Fatal(err)
	}
	bl, _ := s.BlobByID(ctx, blob.ID)
	if bl.RefCount != 1 {
		t.Errorf("attachment should reference blob: %d", bl.RefCount)
	}
	m, _ = s.MessageByID(ctx, withAtt.ID, b.ID)
	if len(m.Attachments) != 1 || m.Attachments[0].BlobID != blob.ID {
		t.Errorf("hydrate attachments: %+v", m.Attachments)
	}
	att, err := s.AttachmentByBlob(ctx, blob.ID)
	if err != nil || att.MessageID != withAtt.ID || att.ChannelID != dm.ID {
		t.Errorf("attachment by blob: %v %+v", err, att)
	}
	ch, _ = s.ChannelByID(ctx, dm.ID)
	if *ch.LastMessageID != withAtt.ID {
		t.Error("last message should be the newest")
	}
	if err := s.DeleteMessage(ctx, withAtt.ID); err != nil {
		t.Fatal(err)
	}
	bl, _ = s.BlobByID(ctx, blob.ID)
	if bl.RefCount != 0 {
		t.Errorf("delete should release blob: %d", bl.RefCount)
	}
	ch, _ = s.ChannelByID(ctx, dm.ID)
	if *ch.LastMessageID != n3.ID {
		t.Errorf("last message should fall back to previous: %v vs %v", *ch.LastMessageID, n3.ID)
	}
	if err := s.DeleteMessage(ctx, withAtt.ID); !errors.Is(err, ErrNotFound) {
		t.Error("double delete")
	}
}

func idsOf(list []*Message) []ids.ID {
	out := make([]ids.ID, len(list))
	for i, m := range list {
		out[i] = m.ID
	}
	return out
}

func TestReactionsAndPins(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b := mkUser(t, s, "a"), mkUser(t, s, "b")
	dm, _, _ := s.CreateDM(ctx, a.ID, b.ID)
	m := mkMsg(t, s, dm.ID, a.ID, "hi")
	added, err := s.AddReaction(ctx, m.ID, a.ID, "👍")
	if err != nil || !added {
		t.Fatal("add", err)
	}
	added, _ = s.AddReaction(ctx, m.ID, a.ID, "👍")
	if added {
		t.Error("second add is idempotent")
	}
	s.AddReaction(ctx, m.ID, b.ID, "👍")
	s.AddReaction(ctx, m.ID, b.ID, "smile:123")
	got, _ := s.MessageByID(ctx, m.ID, a.ID)
	if len(got.Reactions) != 2 || got.Reactions[0].Emoji != "👍" || got.Reactions[0].Count != 2 || !got.Reactions[0].Me || got.Reactions[1].Me {
		t.Errorf("summary: %+v", got.Reactions)
	}
	who, _ := s.Reactors(ctx, m.ID, "👍", 10)
	if len(who) != 2 || who[0] != a.ID {
		t.Errorf("reactors: %v", who)
	}
	removed, _ := s.RemoveReaction(ctx, m.ID, a.ID, "👍")
	if !removed {
		t.Error("remove")
	}
	removed, _ = s.RemoveReaction(ctx, m.ID, a.ID, "👍")
	if removed {
		t.Error("remove twice")
	}
	for i := 0; i < MaxReactionEmoji; i++ {
		s.AddReaction(ctx, m.ID, a.ID, string(rune('a'+i)))
	}
	if _, err := s.AddReaction(ctx, m.ID, b.ID, "zzz"); !errors.Is(err, ErrLimit) {
		t.Errorf("cap: %v", err)
	}
	if _, err := s.AddReaction(ctx, m.ID, b.ID, "a"); err != nil {
		t.Error("existing emoji still allowed at cap:", err)
	}
	if err := s.PinMessage(ctx, dm.ID, m.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.PinMessage(ctx, dm.ID, m.ID, a.ID); !errors.Is(err, ErrAlreadyExists) {
		t.Error("double pin")
	}
	got, _ = s.MessageByID(ctx, m.ID, a.ID)
	if got.Flags&MsgFlagPinned == 0 {
		t.Error("pinned flag")
	}
	pins, err := s.Pins(ctx, dm.ID, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(pins) != 1 || pins[0].ID != m.ID || len(pins[0].Reactions) == 0 {
		t.Errorf("pins hydrated: %+v", pins)
	}
	n, _ := s.CountPins(ctx, dm.ID)
	if n != 1 {
		t.Error("count pins")
	}
	if err := s.UnpinMessage(ctx, dm.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = s.MessageByID(ctx, m.ID, a.ID)
	if got.Flags&MsgFlagPinned != 0 {
		t.Error("unpinned flag")
	}
	if err := s.UnpinMessage(ctx, dm.ID, m.ID); !errors.Is(err, ErrNotFound) {
		t.Error("unpin twice")
	}
}

func TestReadStatesAndMentions(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b := mkUser(t, s, "a"), mkUser(t, s, "b")
	dm, _, _ := s.CreateDM(ctx, a.ID, b.ID)
	m1 := mkMsg(t, s, dm.ID, a.ID, "1")
	m2 := &Message{ChannelID: dm.ID, AuthorID: a.ID, Ciphertext: json.RawMessage(`{"v":1}`), Mentions: []ids.ID{b.ID}}
	_ = s.InsertMessage(ctx, m2)
	m3 := &Message{ChannelID: dm.ID, AuthorID: a.ID, Ciphertext: json.RawMessage(`{"v":1}`), MentionEveryone: true}
	_ = s.InsertMessage(ctx, m3)
	m4 := &Message{ChannelID: dm.ID, AuthorID: b.ID, Ciphertext: json.RawMessage(`{"v":1}`), Mentions: []ids.ID{b.ID}}
	_ = s.InsertMessage(ctx, m4) // own mention never counts
	states, err := s.ReadStatesFor(ctx, b.ID, []ids.ID{dm.ID, ids.ID(999)})
	if err != nil || len(states) != 2 || states[0].MentionCount != 2 || states[0].LastReadMessageID != nil || states[1].MentionCount != 0 {
		t.Fatalf("states: %v %+v", err, states)
	}
	// a conversation counts every unread message from the others, mention or not
	if states[0].UnreadCount != 3 || states[1].UnreadCount != 0 {
		t.Errorf("unread counts: %+v", states)
	}
	if err := s.Ack(ctx, b.ID, dm.ID, m2.ID, false); err != nil {
		t.Fatal(err)
	}
	states, _ = s.ReadStatesFor(ctx, b.ID, []ids.ID{dm.ID})
	if *states[0].LastReadMessageID != m2.ID || states[0].MentionCount != 1 || states[0].UnreadCount != 1 {
		t.Errorf("after ack m2: %+v", states[0])
	}
	_ = s.Ack(ctx, b.ID, dm.ID, m1.ID, false) // never moves backwards
	states, _ = s.ReadStatesFor(ctx, b.ID, []ids.ID{dm.ID})
	if *states[0].LastReadMessageID != m2.ID {
		t.Error("ack must not move backwards")
	}
	_ = s.Ack(ctx, b.ID, dm.ID, m1.ID, true) // mark as unread moves it back
	states, _ = s.ReadStatesFor(ctx, b.ID, []ids.ID{dm.ID})
	if *states[0].LastReadMessageID != m1.ID || states[0].MentionCount != 2 {
		t.Errorf("forced ack: %+v", states[0])
	}
	n, _ := s.CountMentionsAfter(ctx, dm.ID, b.ID, m1.ID)
	if n != 2 {
		t.Errorf("count after m1 = %d", n)
	}
}

func TestMentionsBeforeJoiningDoNotCount(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	owner, old, newbie := mkUser(t, s, "owner"), mkUser(t, s, "old"), mkUser(t, s, "newbie")
	srv, err := s.CreateServer(ctx, owner.ID, "S", DefaultNames{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddMember(ctx, srv.ID, old.ID); err != nil {
		t.Fatal(err)
	}
	group, err := s.CreateGroupDM(ctx, owner.ID, []ids.ID{old.ID}, "g")
	if err != nil {
		t.Fatal(err)
	}
	ping := func(ch ids.ID) {
		m := &Message{ChannelID: ch, AuthorID: owner.ID, Ciphertext: json.RawMessage(`{"v":1}`), MentionEveryone: true}
		if err := s.InsertMessage(ctx, m); err != nil {
			t.Fatal(err)
		}
	}
	general := *srv.SystemChannelID
	ping(general)
	ping(general)
	ping(group.ID)
	time.Sleep(5 * time.Millisecond) // the joins land in a later millisecond than the old pings
	if _, err := s.AddMember(ctx, srv.ID, newbie.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddParticipant(ctx, group.ID, newbie.ID, owner.ID); err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond)
	ping(general)
	ping(group.ID)

	for _, tc := range []struct {
		user         *User
		general, grp int
	}{{old, 3, 2}, {newbie, 1, 1}} {
		states, err := s.ReadStatesFor(ctx, tc.user.ID, []ids.ID{general, group.ID})
		if err != nil {
			t.Fatal(err)
		}
		if states[0].MentionCount != tc.general || states[1].MentionCount != tc.grp {
			t.Errorf("%s: general %d group %d, want %d %d", tc.user.Username, states[0].MentionCount, states[1].MentionCount, tc.general, tc.grp)
		}
		// messages from before joining a group are not unread either, and server channels count none
		if states[0].UnreadCount != 0 || states[1].UnreadCount != tc.grp {
			t.Errorf("%s: unread general %d group %d, want 0 %d", tc.user.Username, states[0].UnreadCount, states[1].UnreadCount, tc.grp)
		}
	}
}

func TestUnreadCountStopsAtTheMost(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b := mkUser(t, s, "a"), mkUser(t, s, "b")
	dm, _, _ := s.CreateDM(ctx, a.ID, b.ID)
	for i := 0; i < MaxUnreadCount+5; i++ {
		mkMsg(t, s, dm.ID, a.ID, "x")
	}
	states, err := s.ReadStatesFor(ctx, b.ID, []ids.ID{dm.ID})
	if err != nil || states[0].UnreadCount != MaxUnreadCount {
		t.Fatalf("unread: %v %+v", err, states)
	}
	if states, _ := s.ReadStatesFor(ctx, a.ID, []ids.ID{dm.ID}); states[0].UnreadCount != 0 {
		t.Errorf("your own messages are never unread: %+v", states[0])
	}
}

// A bulk delete runs as one transaction over one channel: it releases blobs,
// moves last_message_id back, and skips ids that are gone or belong elsewhere.
func TestDeleteMessagesInOneChannel(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	a, b, c := mkUser(t, s, "a"), mkUser(t, s, "b"), mkUser(t, s, "c")
	dm, _, _ := s.CreateDM(ctx, a.ID, b.ID)
	other, _, _ := s.CreateDM(ctx, a.ID, c.ID)
	keep := mkMsg(t, s, dm.ID, a.ID, "keep")
	one := mkMsg(t, s, dm.ID, b.ID, "one")
	blob := &Blob{SHA256: "bulk", Size: 5, Mime: "application/octet-stream", Kind: "attachment", Encrypted: true}
	_ = s.InsertBlob(ctx, blob)
	two := &Message{ChannelID: dm.ID, AuthorID: a.ID, Ciphertext: json.RawMessage(`{"v":1}`), Attachments: []Attachment{{BlobID: blob.ID, Size: 5}}}
	if err := s.InsertMessage(ctx, two); err != nil {
		t.Fatal(err)
	}
	elsewhere := mkMsg(t, s, other.ID, a.ID, "elsewhere")

	authors, err := s.MessageAuthors(ctx, dm.ID, []ids.ID{one.ID, two.ID, elsewhere.ID, 424242})
	if err != nil || len(authors) != 2 || authors[one.ID] != b.ID || authors[two.ID] != a.ID {
		t.Fatalf("authors: %v %v", err, authors)
	}
	deleted, err := s.DeleteMessages(ctx, dm.ID, []ids.ID{one.ID, two.ID, elsewhere.ID, 424242})
	if err != nil || len(deleted) != 2 {
		t.Fatalf("delete: %v %v", err, deleted)
	}
	if bl, _ := s.BlobByID(ctx, blob.ID); bl.RefCount != 0 {
		t.Errorf("blob still referenced: %d", bl.RefCount)
	}
	ch, _ := s.ChannelByID(ctx, dm.ID)
	if ch.LastMessageID == nil || *ch.LastMessageID != keep.ID {
		t.Errorf("last message should fall back to the one kept: %v", ch.LastMessageID)
	}
	if _, err := s.MessageByID(ctx, elsewhere.ID, a.ID); err != nil {
		t.Errorf("another channel's message went too: %v", err)
	}
	if deleted, err := s.DeleteMessages(ctx, dm.ID, []ids.ID{one.ID}); err != nil || len(deleted) != 0 {
		t.Errorf("deleting again: %v %v", err, deleted)
	}
}
