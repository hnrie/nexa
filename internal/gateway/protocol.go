// Package gateway is the realtime WebSocket side of chatd: connections,
// presence, typing, voice signalling and event fan-out.
package gateway

import (
	"encoding/json"

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
)

// Presence is a user's visible status.
type Presence struct {
	UserID          ids.ID `json:"user_id"`
	Status          string `json:"status"` // online | idle | dnd | offline
	StatusText      string `json:"status_text"`
	StatusEmoji     string `json:"status_emoji"`
	StatusExpiresAt *int64 `json:"status_expires_at"`
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
	Extra         map[string]any           `json:"-"`
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

type typingData struct {
	ChannelID ids.ID `json:"channel_id"`
	// Stop ends the indicator at once instead of waiting for it to expire.
	Stop bool `json:"stop"`
}
