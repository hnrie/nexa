// Package gateway is the realtime WebSocket side of chatd: connections,
// presence, typing, voice signalling and event fan-out.
package gateway

import (
	"encoding/json"
	"sync"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// ClientFrame is what clients send.
type ClientFrame struct {
	Op string          `json:"op"`
	D  json.RawMessage `json:"d"`
}

// ServerFrame is what the server sends.
type ServerFrame struct {
	T string `json:"t"`
	S uint64 `json:"s,omitempty"`
	D any    `json:"d,omitempty"`
	// shared, when set, is the frame's encoding, made by whichever of its
	// connections writes it first and reused by all the others: an event for
	// two thousand people is encoded once, not two thousand times.
	shared *frameBytes
}

type frameBytes struct {
	once sync.Once
	b    []byte
	err  error
}

// fanOut marks a frame as going to many connections, so its encoding is shared.
func (f ServerFrame) fanOut() ServerFrame {
	f.shared = &frameBytes{}
	return f
}

// encode is the frame as JSON, made once when the frame is shared.
func (f *ServerFrame) encode() ([]byte, error) {
	if f.shared == nil {
		return json.Marshal(f)
	}
	f.shared.once.Do(func() { f.shared.b, f.shared.err = json.Marshal(f) })
	return f.shared.b, f.shared.err
}

// Client ops.
const (
	OpIdentify    = "identify"
	OpHeartbeat   = "heartbeat"
	OpPresence    = "presence"
	OpTyping      = "typing"
	OpVoiceState  = "voice_state"
	OpVoiceSignal = "voice_signal"
	OpSubscribe   = "subscribe_members"
	// OpActivities replaces this connection's activities (from the desktop app's Rich Presence server).
	OpActivities = "activities"
	// OpAway says whether the person has left this connection alone for a
	// while. An account showing as online shows as idle while every one of its
	// connections says so; nothing about it is stored.
	OpAway = "away"
)

// Server events.
const (
	EvReady              = "ready"
	EvHeartbeatAck       = "heartbeat_ack"
	EvMessageCreate      = "message_create"
	EvMessageUpdate      = "message_update"
	EvMessageDelete      = "message_delete"
	EvMessageDeleteBulk  = "message_delete_bulk"
	EvReactionAdd        = "reaction_add"
	EvReactionRemove     = "reaction_remove"
	EvTyping             = "typing"
	EvChannelCreate      = "channel_create"
	EvChannelUpdate      = "channel_update"
	EvChannelDelete      = "channel_delete"
	EvChannelPositions   = "channel_positions"
	EvServerCreate       = "server_create"
	EvServerUpdate       = "server_update"
	EvServerDelete       = "server_delete"
	EvMemberAdd          = "member_add"
	EvMemberUpdate       = "member_update"
	EvMemberRemove       = "member_remove"
	EvRoleCreate         = "role_create"
	EvRoleUpdate         = "role_update"
	EvRoleDelete         = "role_delete"
	EvPresence           = "presence"
	EvUserUpdate         = "user_update"
	EvRelationshipAdd    = "relationship_add"
	EvRelationshipRemove = "relationship_remove"
	EvReadState          = "read_state"
	EvVoiceState         = "voice_state"
	EvVoiceSignal        = "voice_signal"
	EvCallRing           = "call_ring"
	EvCallEnd            = "call_end"
	EvKeyGrant           = "key_grant"
	EvKeysNeeded         = "keys_needed"
	EvEmojiUpdate        = "emoji_update"
	EvStickerUpdate      = "sticker_update"
	EvPinUpdate          = "pin_update"
	EvBanAdd             = "ban_add"
	EvBanRemove          = "ban_remove"
	EvInviteCreate       = "invite_create"
	EvInviteDelete       = "invite_delete"
	EvSettingsUpdate     = "settings_update"
	EvSessionExpired     = "session_expired"
	// EvGuestEnded tells a guest why their time in the call is over, just before the socket closes.
	EvGuestEnded = "guest_ended"
	// EvVoiceResumed answers a device resuming its call after a reconnect: kept, or start over.
	EvVoiceResumed = "voice_resumed"
	// EvVoiceError says why a voice op this device sent was refused.
	EvVoiceError = "voice_error"
	// EvKeyRotationNeeded asks holders of a conversation's key to replace it:
	// someone lost access.
	EvKeyRotationNeeded = "key_rotation_needed"
	// EvStickerRecent carries the account's recently used stickers to its other devices.
	EvStickerRecent = "sticker_recent"
	// Moderation, delivered through Nexa: the account's own state, a notice to
	// show, one of its cases, announcements, and for staff the queue and the log.
	EvNexaState              = "nexa_state"
	EvNexaNotice             = "nexa_notice"
	EvNexaCase               = "nexa_case"
	EvNexaAnnouncement       = "nexa_announcement"
	EvNexaAnnouncementDelete = "nexa_announcement_delete"
	EvModCase                = "mod_case"
	EvModLog                 = "mod_log"
	// Bug reports, the same two ways: to the reporter through Nexa, and to staff.
	EvNexaBug = "nexa_bug"
	EvModBug  = "mod_bug"
)

// Presence is a user's visible status.
type Presence struct {
	UserID          ids.ID `json:"user_id"`
	Status          string `json:"status"` // online | idle | dnd | offline
	StatusText      string `json:"status_text"`
	StatusEmoji     string `json:"status_emoji"`
	StatusExpiresAt *int64 `json:"status_expires_at"`
	// Activities are what the user is doing right now (games, music, video), newest connection's first.
	Activities []Activity `json:"activities,omitempty"`
}

// ReadyPayload is sent once after a successful identify.
type ReadyPayload struct {
	SessionID     ids.ID                   `json:"session_id"`
	User          any                      `json:"user"`
	Users         []store.PublicUser       `json:"users"`
	Channels      []*store.Channel         `json:"channels"`
	Relationships []store.RelationshipView `json:"relationships"`
	ReadStates    []*store.ReadState       `json:"read_states"`
	Presences     []Presence               `json:"presences"`
	KeyGrants     []*store.KeyGrant        `json:"key_grants"`
	Settings      *store.Settings          `json:"settings"`
	Servers       []any                    `json:"servers"`
	Emojis        []*store.Emoji           `json:"emojis"`
	StickerPacks  []*store.StickerPack     `json:"sticker_packs"`
	VoiceStates   []any                    `json:"voice_states"`
	// Guest says which call a guest is in; only a guest's ready has it.
	Guest any `json:"guest,omitempty"`
	// Nexa is the account's moderation state: restrictions in force, notices
	// not yet dismissed, what is unread from Nexa, and for staff the queue.
	Nexa  any            `json:"nexa,omitempty"`
	Extra map[string]any `json:"-"`
}

// identifyData is the payload of the identify op.
type identifyData struct {
	Token string `json:"token"`
}

// presenceData is the payload of the presence op.
type presenceData struct {
	Status          *string `json:"status"`
	StatusText      *string `json:"status_text"`
	StatusEmoji     *string `json:"status_emoji"`
	StatusExpiresAt *int64  `json:"status_expires_at"`
	ClearStatus     bool    `json:"clear_status"`
}

// awayData is the payload of the away op.
type awayData struct {
	Away bool `json:"away"`
}

// activitiesData is the payload of the activities op; an empty list clears them.
type activitiesData struct {
	Activities []json.RawMessage `json:"activities"`
}

type typingData struct {
	ChannelID ids.ID `json:"channel_id"`
	// Stop ends the indicator at once instead of waiting for it to expire.
	Stop bool `json:"stop"`
}
