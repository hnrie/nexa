package voice

import (
	"testing"

	"evilion.xyz/chat/internal/ids"
)

func TestRegistry(t *testing.T) {
	r := New()
	a, b := ids.ID(1), ids.ID(2)
	ch1, ch2 := ids.ID(10), ids.ID(20)
	if old := r.Join(State{UserID: a, ChannelID: ch1, SessionID: 100}); old != nil {
		t.Fatal("first join returns no previous state")
	}
	r.Join(State{UserID: b, ChannelID: ch1, SessionID: 200, SelfMute: true})
	if r.Count(ch1) != 2 || len(r.Participants(ch1)) != 2 || r.Participants(ch1)[0].UserID != a {
		t.Fatalf("participants: %+v", r.Participants(ch1))
	}
	// moderation flags survive a move
	if _, ok := r.Update(a, func(s *State) { s.ServerMute = true }); !ok {
		t.Fatal("update")
	}
	old := r.Join(State{UserID: a, ChannelID: ch2, SessionID: 100, Video: true})
	if old == nil || old.ChannelID != ch1 {
		t.Fatalf("move returns old state: %+v", old)
	}
	st, _ := r.Get(a)
	if st.ChannelID != ch2 || !st.ServerMute || !st.Video || r.Count(ch1) != 1 || r.Count(ch2) != 1 {
		t.Fatalf("after move: %+v", st)
	}
	if len(r.In([]ids.ID{ch1, ch2})) != 2 {
		t.Error("In lists both channels")
	}
	// session-scoped leave ignores other sessions
	if _, ok := r.LeaveSession(a, 999); ok {
		t.Error("wrong session must not leave")
	}
	if left, ok := r.LeaveSession(a, 100); !ok || left.ChannelID != ch2 {
		t.Errorf("leave session: %v %+v", ok, left)
	}
	if _, ok := r.Get(a); ok {
		t.Error("gone after leave")
	}
	if cleared := r.ClearChannel(ch1); len(cleared) != 1 || cleared[0].UserID != b || r.Count(ch1) != 0 {
		t.Errorf("clear: %+v", cleared)
	}
	if _, ok := r.Leave(b); ok {
		t.Error("b already cleared")
	}
}
