// Package voice keeps the in-memory registry of who is in which voice channel.
// Media never touches the server: peers connect directly, so the registry only
// exists to tell clients who to call and to carry moderation flags.
package voice

import (
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
}

// Registry is safe for concurrent use.
type Registry struct {
	mu        sync.RWMutex
	byUser    map[ids.ID]*State
	byChannel map[ids.ID]map[ids.ID]*State
}

// New creates an empty registry.
func New() *Registry {
	return &Registry{byUser: map[ids.ID]*State{}, byChannel: map[ids.ID]map[ids.ID]*State{}}
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

// Join puts a user in a channel (moving them if they were elsewhere) and
// returns the state they left, if any. Moderation flags survive a move within
// the same registry; self flags come from the new state.
func (r *Registry) Join(st State) *State {
	r.mu.Lock()
	defer r.mu.Unlock()
	var old *State
	if prev, ok := r.byUser[st.UserID]; ok {
		cp := *prev
		old = &cp
		delete(r.byChannel[prev.ChannelID], st.UserID)
		if len(r.byChannel[prev.ChannelID]) == 0 {
			delete(r.byChannel, prev.ChannelID)
		}
		st.ServerMute, st.ServerDeaf = prev.ServerMute, prev.ServerDeaf
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

// LeaveSession removes a user only when the given session holds their state.
func (r *Registry) LeaveSession(uid, session ids.ID) (State, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	st, ok := r.byUser[uid]
	if !ok || st.SessionID != session {
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
	delete(r.byChannel[st.ChannelID], uid)
	if len(r.byChannel[st.ChannelID]) == 0 {
		delete(r.byChannel, st.ChannelID)
	}
	return *st, true
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
	return out
}
