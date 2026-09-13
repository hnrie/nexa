package voice

import (
	"testing"

	"evilion.xyz/chat/internal/ids"
)

func TestRegistry(t *testing.T) {
	r := New()
	a, b := ids.ID(1), ids.ID(2)
	ch1, ch2 := ids.ID(10), ids.ID(20)
	if old := r.Join(State{UserID: a, ChannelID: ch1, SessionID: 100, ConnID: 1000}, false); old != nil {
		t.Fatal("first join returns no previous state")
	}
	r.Join(State{UserID: b, ChannelID: ch1, SessionID: 200, ConnID: 2000, SelfMute: true}, false)
	if r.Count(ch1) != 2 || len(r.Participants(ch1)) != 2 || r.Participants(ch1)[0].UserID != a {
		t.Fatalf("participants: %+v", r.Participants(ch1))
	}
	// moderation flags survive a move the caller marks as within one server
	if _, ok := r.Update(a, func(s *State) { s.ServerMute = true }); !ok {
		t.Fatal("update")
	}
	old := r.Join(State{UserID: a, ChannelID: ch2, SessionID: 100, ConnID: 1000, Video: true}, true)
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
	// connection-scoped leave ignores other connections, even of the same session
	if _, ok := r.LeaveConn(a, 999); ok {
		t.Error("wrong connection must not leave")
	}
	if left, ok := r.LeaveConn(a, 1000); !ok || left.ChannelID != ch2 {
		t.Errorf("leave conn: %v %+v", ok, left)
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

// TestJoinDropsModerationElsewhere checks that a server mute does not follow
// someone into a channel where nobody could lift it.
func TestJoinDropsModerationElsewhere(t *testing.T) {
	r := New()
	a := ids.ID(1)
	r.Join(State{UserID: a, ChannelID: 10, ConnID: 1}, false)
	r.Update(a, func(s *State) { s.ServerMute, s.ServerDeaf = true, true })
	r.Join(State{UserID: a, ChannelID: 20, ConnID: 1}, false)
	if st, _ := r.Get(a); st.ServerMute || st.ServerDeaf {
		t.Errorf("moderation must not carry over: %+v", st)
	}
}

// TestLeaveConnAfterRejoin checks that a stale socket closing does not end
// the call a newer socket of the same session rejoined.
func TestLeaveConnAfterRejoin(t *testing.T) {
	r := New()
	a := ids.ID(1)
	r.Join(State{UserID: a, ChannelID: 10, SessionID: 5, ConnID: 1}, false)
	r.Join(State{UserID: a, ChannelID: 10, SessionID: 5, ConnID: 2}, true)
	if _, ok := r.LeaveConn(a, 1); ok {
		t.Fatal("the old socket no longer owns the state")
	}
	if st, ok := r.Get(a); !ok || st.ConnID != 2 {
		t.Errorf("state kept for the new socket: %v %+v", ok, st)
	}
}

func TestRecentlyActive(t *testing.T) {
	r := New()
	a := ids.ID(1)
	if r.RecentlyActive(10) {
		t.Fatal("a channel nobody used is not active")
	}
	r.Join(State{UserID: a, ChannelID: 10, ConnID: 1}, false)
	if !r.RecentlyActive(10) {
		t.Fatal("a channel with people in it is active")
	}
	r.Leave(a)
	if !r.RecentlyActive(10) {
		t.Error("a channel that just emptied is still recent")
	}
	r.mu.Lock()
	r.emptiedAt[10] -= RecentWindow.Milliseconds()
	r.mu.Unlock()
	if r.RecentlyActive(10) {
		t.Error("a channel empty for longer than the window is not recent")
	}
}

func TestSFUSessionFollowsTheCall(t *testing.T) {
	r := New()
	u, ch, other := ids.ID(1), ids.ID(10), ids.ID(20)
	r.Join(State{UserID: u, ChannelID: ch, SessionID: 100, ConnID: 1000}, false)
	if _, ok := r.SetSFU(u, other, 1000, "s1"); ok {
		t.Fatal("a session is only given to the call as it is")
	}
	if old, ok := r.SetSFU(u, ch, 1000, "s1"); !ok || old != "" {
		t.Fatalf("set session: %q %v", old, ok)
	}
	if _, ok := r.SetTrack(u, "stale", "audio", "a1", 0); ok {
		t.Error("a track from another session is ignored")
	}
	st, ok := r.SetTrack(u, "s1", "screen", "sc1", 8_000_000)
	if !ok || st.Tracks.Screen != "sc1" || st.ScreenBps != 8_000_000 {
		t.Fatalf("track: %+v", st)
	}
	r.SetTrack(u, "s1", "audio", "a1", 0)
	if got, _ := r.Get(u); len(got.Tracks.Kinds()) != 2 || got.Tracks.Kinds()[0] != "audio" || got.Tracks.Kinds()[1] != "screen" {
		t.Errorf("kinds: %v", got.Tracks.Kinds())
	}
	// a mute toggle rejoins the same channel on the same connection: the session stays
	r.Join(State{UserID: u, ChannelID: ch, SessionID: 100, ConnID: 1000, SelfMute: true}, false)
	if got, _ := r.Get(u); got.SFUSession != "s1" || got.Tracks.Audio != "a1" || !got.SelfMute {
		t.Errorf("a toggle keeps the session: %+v", got)
	}
	// another device picking up the call starts without it
	old := r.Join(State{UserID: u, ChannelID: ch, SessionID: 100, ConnID: 2000}, false)
	if got, _ := r.Get(u); got.SFUSession != "" || old == nil || old.SFUSession != "s1" {
		t.Errorf("another device: %+v, old %+v", got, old)
	}
	// and so does a move
	r.SetSFU(u, ch, 2000, "s2")
	old = r.Join(State{UserID: u, ChannelID: other, SessionID: 100, ConnID: 2000}, true)
	if got, _ := r.Get(u); got.SFUSession != "" || old.SFUSession != "s2" {
		t.Errorf("a move: %+v, old %+v", got, old)
	}
	if old, ok := r.SetSFU(u, other, 2000, "s3"); !ok || old != "" {
		t.Errorf("replacing: %q %v", old, ok)
	}
	if old, ok := r.SetSFU(u, other, 2000, "s4"); !ok || old != "s3" {
		t.Errorf("a new session hands back the one it replaces: %q %v", old, ok)
	}
}
