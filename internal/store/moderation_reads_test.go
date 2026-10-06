package store

import (
	"context"
	"errors"
	"slices"
	"testing"

	"evilion.xyz/chat/internal/ids"
)

func TestBugThreadsCarryFiles(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	bob := mkUser(t, s, "bob")
	alice := mkUser(t, s, "alice")
	r := newBug(t, s, bob, "Calls drop")

	mine := bugFile(t, s, bob.ID)
	theirs := bugFile(t, s, alice.ID)
	msg, _, err := s.AddBugMessage(ctx, r.ID, bob.ID, ModMsgMember, "", []BugAttachment{{BlobID: mine, Name: "screen.png"}})
	if err != nil || len(msg.Files) != 1 || msg.Files[0].Mime != "image/png" || msg.Files[0].Name != "screen.png" {
		t.Fatalf("member line with a file: %+v %v", msg, err)
	}
	if _, _, err := s.AddBugMessage(ctx, r.ID, alice.ID, ModMsgStaff, "Like this?", []BugAttachment{{BlobID: theirs}}); err != nil {
		t.Fatal(err)
	}
	// a file goes with one line only, and only its uploader can send it
	if _, _, err := s.AddBugMessage(ctx, r.ID, bob.ID, ModMsgMember, "again", []BugAttachment{{BlobID: mine}}); !errors.Is(err, ErrCaseFile) {
		t.Errorf("a sent file went again: %v", err)
	}
	stranger := bugFile(t, s, alice.ID)
	if _, _, err := s.AddBugMessage(ctx, r.ID, bob.ID, ModMsgMember, "not mine", []BugAttachment{{BlobID: stranger}}); !errors.Is(err, ErrCaseFile) {
		t.Errorf("someone else's file went: %v", err)
	}
	// both files belong to the report: its reporter and the staff may fetch them
	for _, f := range []ids.ID{mine, theirs} {
		owner, sent, err := s.BugFileOwner(ctx, f)
		if err != nil || owner != bob.ID || !sent {
			t.Errorf("file %s: owner %s sent %v %v", f, owner, sent, err)
		}
	}
	if owner, sent, err := s.BugFileOwner(ctx, stranger); err != nil || owner != alice.ID || sent {
		t.Errorf("unsent file: owner %s sent %v %v", owner, sent, err)
	}
	msgs, err := s.BugMessages(ctx, r.ID, 0, 0)
	if err != nil || len(msgs) != 2 || len(msgs[0].Files) != 1 || len(msgs[1].Files) != 1 || msgs[1].Files[0].BlobID != theirs {
		t.Fatalf("thread files: %+v %v", msgs, err)
	}
	last, _ := s.LastBugMessages(ctx, []ids.ID{r.ID})
	if l := last[r.ID]; l == nil || len(l.Files) != 1 {
		t.Errorf("preview of a picture line: %+v", l)
	}
	// the account goes, and its report's files are let go with it
	if err := s.PurgeUserLeftovers(ctx, bob.ID); err != nil {
		t.Fatal(err)
	}
	for _, f := range []ids.ID{mine, theirs} {
		b, err := s.BlobByID(ctx, f)
		if err != nil || b.RefCount != 0 {
			t.Errorf("file %s still held: %+v %v", f, b, err)
		}
	}
}

func TestStaffReadWhatWaitsOnThem(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	alice := mkUser(t, s, "alice")
	carol := mkUser(t, s, "carol")
	bob := mkUser(t, s, "bob")
	unread := func(uid ids.ID) ModUnread {
		t.Helper()
		u, err := s.ModUnreadFor(ctx, uid)
		if err != nil {
			t.Fatal(err)
		}
		return u
	}

	// a new report is new to every member of staff
	r := newBug(t, s, bob, "Emoji picker closes")
	for _, uid := range []ids.ID{alice.ID, carol.ID} {
		if u := unread(uid); !slices.Equal(u.Bugs, []ids.ID{r.ID}) || len(u.Cases) != 0 {
			t.Fatalf("new report for %s: %+v", uid, u)
		}
	}
	// opening it reads it for that person alone
	if err := s.MarkModRead(ctx, alice.ID, ModReadBug, r.ID, 0); err != nil {
		t.Fatal(err)
	}
	if u := unread(alice.ID); len(u.Bugs) != 0 {
		t.Errorf("read report still new to alice: %+v", u)
	}
	if u := unread(carol.ID); len(u.Bugs) != 1 {
		t.Errorf("alice's reading read it for carol: %+v", u)
	}
	// the reporter writes again: new to alice again
	if _, _, err := s.AddBugMessage(ctx, r.ID, bob.ID, ModMsgMember, "Still happens", nil); err != nil {
		t.Fatal(err)
	}
	if u := unread(alice.ID); len(u.Bugs) != 1 {
		t.Errorf("a new line from the reporter: %+v", u)
	}
	// someone answers: it waits on nobody on the staff any more
	if _, _, err := s.AddBugMessage(ctx, r.ID, carol.ID, ModMsgStaff, "Which phone?", nil); err != nil {
		t.Fatal(err)
	}
	if u := unread(alice.ID); len(u.Bugs) != 0 {
		t.Errorf("answered report still counted: %+v", u)
	}

	// a case counts once its member writes in it
	c := &ModCase{UserID: bob.ID, ModeratorID: alice.ID, Action: ActionFieldReset, Reason: "Name"}
	if err := s.OpenModCase(ctx, c, &ModLogEntry{Action: ActionFieldReset, ModeratorID: alice.ID}); err != nil {
		t.Fatal(err)
	}
	if u := unread(alice.ID); len(u.Cases) != 0 {
		t.Errorf("a case nobody wrote in: %+v", u)
	}
	line, _, _, err := s.AddModMessage(ctx, c.ID, bob.ID, ModMsgMember, "Why?", nil)
	if err != nil {
		t.Fatal(err)
	}
	if u := unread(carol.ID); !slices.Equal(u.Cases, []ids.ID{c.ID}) {
		t.Fatalf("member wrote in a case: %+v", u)
	}
	if err := s.MarkModRead(ctx, carol.ID, ModReadCase, c.ID, line.ID); err != nil {
		t.Fatal(err)
	}
	if u := unread(carol.ID); len(u.Cases) != 0 {
		t.Errorf("case read up to its last line: %+v", u)
	}
	// Mark as Read takes everything at once, and what comes after counts again
	if _, _, err := s.AddBugMessage(ctx, r.ID, bob.ID, ModMsgMember, "A Pixel 7", nil); err != nil {
		t.Fatal(err)
	}
	if u := unread(alice.ID); len(u.Cases) != 1 || len(u.Bugs) != 1 {
		t.Fatalf("before reading everything: %+v", u)
	}
	if err := s.MarkModReadAll(ctx, alice.ID, ids.New()); err != nil {
		t.Fatal(err)
	}
	if u := unread(alice.ID); len(u.Cases) != 0 || len(u.Bugs) != 0 {
		t.Errorf("after reading everything: %+v", u)
	}
	if _, _, _, err := s.AddModMessage(ctx, c.ID, bob.ID, ModMsgMember, "Hello?", nil); err != nil {
		t.Fatal(err)
	}
	if u := unread(alice.ID); len(u.Cases) != 1 {
		t.Errorf("a line after reading everything: %+v", u)
	}
	if err := s.MarkModRead(ctx, alice.ID, "nope", c.ID, 0); err == nil {
		t.Error("an unknown kind of thread was read")
	}
}
