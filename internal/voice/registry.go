// Package voice keeps the in-memory registry of who is in which voice channel.
// Media never touches the server: peers connect directly, or through
// Cloudflare's SFU, so the registry only tells clients who is in a call, what
// each device publishes there, and carries moderation flags.
package voice

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"sync"
	"time"

	"evilion.xyz/chat/internal/ids"
)

// State is one user's presence in a voice channel.
type State struct {
	UserID     ids.ID `json:"user_id"`
	ChannelID  ids.ID `json:"channel_id"`
	SessionID  ids.ID `json:"session_id"`
	SelfMute   bool   `json:"self_mute"`
	SelfDeaf   bool   `json:"self_deaf"`
	Video      bool   `json:"video"`
	Streaming  bool   `json:"streaming"`
	ServerMute bool   `json:"server_mute"`
	ServerDeaf bool   `json:"server_deaf"`
	JoinedAt   int64  `json:"joined_at"`
	// ConnID is the gateway connection that owns this state. A session is
	// shared by every tab and reconnect of a device, so it cannot say which
	// socket is actually in the call.
	ConnID ids.ID `json:"-"`
	// Suppress is set when the channel denies Speak; it silences the user
	// like a server mute but belongs to the channel, not to a moderator.
	Suppress bool `json:"-"`
	// SFUSession is this device's Cloudflare Realtime session when calls go
	// through the SFU, Tracks what it publishes there, and ScreenBps the
	// bitrate its screen share declared.
	SFUSession string `json:"-"`
	Tracks     Tracks `json:"-"`
	ScreenBps  int64  `json:"-"`
}

// Tracks names what a call device publishes through the SFU, by kind. Only
// the server knows the names; everyone else learns which kinds exist, and a
// tag for each that changes when the track does.
type Tracks struct {
	Audio, Video, Screen, ScreenAudio string
}

// Get returns the name published for a kind, or "".
func (t Tracks) Get(kind string) string {
	switch kind {
	case "audio":
		return t.Audio
	case "video":
		return t.Video
	case "screen":
		return t.Screen
	case "screen_audio":
		return t.ScreenAudio
	}
	return ""
}

// With returns the tracks with a kind named.
func (t Tracks) With(kind, name string) Tracks {
	switch kind {
	case "audio":
		t.Audio = name
	case "video":
		t.Video = name
	case "screen":
		t.Screen = name
	case "screen_audio":
		t.ScreenAudio = name
	}
	return t
}

// Tags maps each published kind to its track's tag, or is nil.
func (t Tracks) Tags() map[string]string {
	var out map[string]string
	for _, k := range []string{"audio", "video", "screen", "screen_audio"} {
		if name := t.Get(k); name != "" {
			if out == nil {
				out = map[string]string{}
			}
			out[k] = TrackTag(name)
		}
	}
	return out
}

// TrackTag names a published track to other devices without giving its name
// away: the same track always has the same tag, and a republished one a new one.
func TrackTag(name string) string {
	sum := sha256.Sum256([]byte("chat-track-tag:" + name))
	return hex.EncodeToString(sum[:6])
}

// RecentWindow is how long a channel counts as still active after its last
// participant left, so a quick rejoin resumes the call instead of starting one.
const RecentWindow = time.Minute

// Registry is safe for concurrent use.
type Registry struct {
	mu        sync.RWMutex
	byUser    map[ids.ID]*State
	byChannel map[ids.ID]map[ids.ID]*State
	// emptiedAt records when a channel lost its last participant (unix ms).
	emptiedAt map[ids.ID]int64
}

// New creates an empty registry.
func New() *Registry {
	return &Registry{byUser: map[ids.ID]*State{}, byChannel: map[ids.ID]map[ids.ID]*State{}, emptiedAt: map[ids.ID]int64{}}
}

// Get returns a user's state.
func (r *Registry) Get(uid ids.ID) (State, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	st, ok := r.byUser[uid]
	if !ok {
		return State{}, false
	}
	return *st, true
}

// Participants lists a channel's states in join order.
func (r *Registry) Participants(ch ids.ID) []State {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]State, 0, len(r.byChannel[ch]))
	for _, st := range r.byChannel[ch] {
		out = append(out, *st)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].JoinedAt != out[j].JoinedAt {
			return out[i].JoinedAt < out[j].JoinedAt
		}
		return out[i].UserID < out[j].UserID
	})
	return out
}

// Count returns how many users are in a channel.
func (r *Registry) Count(ch ids.ID) int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.byChannel[ch])
}

// RecentlyActive reports whether a channel has participants or lost its last
// one within RecentWindow.
func (r *Registry) RecentlyActive(ch ids.ID) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.byChannel[ch]) > 0 {
		return true
	}
	at, ok := r.emptiedAt[ch]
	return ok && time.Now().UnixMilli()-at < RecentWindow.Milliseconds()
}

// Join puts a user in a channel (moving them if they were elsewhere) and
// returns the state they left, if any. Moderation flags survive only when
// keepModeration is set, which the caller does for moves within one server:
// nobody elsewhere could lift them. Self flags come from the new state.
func (r *Registry) Join(st State, keepModeration bool) *State {
	r.mu.Lock()
	defer r.mu.Unlock()
	var old *State
	if prev, ok := r.byUser[st.UserID]; ok {
		cp := *prev
		old = &cp
		r.removeLocked(prev)
		if keepModeration {
			st.ServerMute, st.ServerDeaf = prev.ServerMute, prev.ServerDeaf
		}
		// The same device staying in the same call keeps its SFU session (a
		// mute or camera toggle comes through here too). A move or another
		// device starts afresh, and the caller closes the old session.
		if prev.ChannelID == st.ChannelID && prev.ConnID == st.ConnID {
			st.SFUSession, st.Tracks, st.ScreenBps = prev.SFUSession, prev.Tracks, prev.ScreenBps
		}
	}
	if st.JoinedAt == 0 {
		st.JoinedAt = time.Now().UnixMilli()
	}
	cp := st
	r.byUser[st.UserID] = &cp
	if r.byChannel[st.ChannelID] == nil {
		r.byChannel[st.ChannelID] = map[ids.ID]*State{}
	}
	r.byChannel[st.ChannelID][st.UserID] = &cp
	return old
}

// SetSFU gives a user's call its SFU session, as long as the call is still in
// channelID on connID, and returns the session it replaces. What the old
// session published is forgotten.
func (r *Registry) SetSFU(uid, channelID, connID ids.ID, session string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	st, ok := r.byUser[uid]
	if !ok || st.ChannelID != channelID || st.ConnID != connID {
		return "", false
	}
	old := st.SFUSession
	st.SFUSession, st.Tracks, st.ScreenBps = session, Tracks{}, 0
	return old, true
}

// SetTrack records a track published by the call's SFU session. It does
// nothing once the session was replaced or the user left.
func (r *Registry) SetTrack(uid ids.ID, session, kind, name string, screenBps int64) (State, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	st, ok := r.byUser[uid]
	if !ok || session == "" || st.SFUSession != session {
		return State{}, false
	}
	st.Tracks = st.Tracks.With(kind, name)
	if kind == "screen" {
		st.ScreenBps = screenBps
	}
	return *st, true
}

// Update mutates a user's state in place and returns the result.
func (r *Registry) Update(uid ids.ID, fn func(*State)) (State, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	st, ok := r.byUser[uid]
	if !ok {
		return State{}, false
	}
	fn(st)
	return *st, true
}

// Leave removes a user and returns the state they had.
func (r *Registry) Leave(uid ids.ID) (State, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.leaveLocked(uid)
}

// LeaveConn removes a user only when the given connection holds their state.
func (r *Registry) LeaveConn(uid, connID ids.ID) (State, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	st, ok := r.byUser[uid]
	if !ok || st.ConnID != connID {
		return State{}, false
	}
	return r.leaveLocked(uid)
}

func (r *Registry) leaveLocked(uid ids.ID) (State, bool) {
	st, ok := r.byUser[uid]
	if !ok {
		return State{}, false
	}
	delete(r.byUser, uid)
	r.removeLocked(st)
	return *st, true
}

// removeLocked takes a state out of its channel and notes when the channel
// empties. Entries older than the window are pruned here so the map stays
// as small as the number of calls that ended in the last minute.
func (r *Registry) removeLocked(st *State) {
	delete(r.byChannel[st.ChannelID], st.UserID)
	if len(r.byChannel[st.ChannelID]) > 0 {
		return
	}
	delete(r.byChannel, st.ChannelID)
	now := time.Now().UnixMilli()
	for ch, at := range r.emptiedAt {
		if now-at >= RecentWindow.Milliseconds() {
			delete(r.emptiedAt, ch)
		}
	}
	r.emptiedAt[st.ChannelID] = now
}

// In lists every state in any of the given channels.
func (r *Registry) In(chIDs []ids.ID) []State {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := []State{}
	for _, ch := range chIDs {
		for _, st := range r.byChannel[ch] {
			out = append(out, *st)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ChannelID != out[j].ChannelID {
			return out[i].ChannelID < out[j].ChannelID
		}
		return out[i].JoinedAt < out[j].JoinedAt
	})
	return out
}

// ClearChannel drops everyone from a channel (it was deleted) and returns them.
func (r *Registry) ClearChannel(ch ids.ID) []State {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []State{}
	for uid, st := range r.byChannel[ch] {
		out = append(out, *st)
		delete(r.byUser, uid)
	}
	delete(r.byChannel, ch)
	delete(r.emptiedAt, ch)
	return out
}
