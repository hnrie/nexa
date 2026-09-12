package store

import (
	"encoding/json"

	"evilion.xyz/chat/internal/ids"
)

// User flag bits.
const (
	FlagAdmin    int64 = 1
	FlagDisabled int64 = 2
	FlagDeleted  int64 = 4
)

// User is a full account row. Fields tagged "-" never leave the server.
type User struct {
	ID              ids.ID  `json:"id"`
	Username        string  `json:"username"`
	DisplayName     string  `json:"display_name"`
	AvatarID        *ids.ID `json:"avatar_id"`
	BannerID        *ids.ID `json:"banner_id"`
	AboutMe         string  `json:"about_me"`
	Pronouns        string  `json:"pronouns"`
	AccentColor     *int    `json:"accent_color"`
	StatusText      string  `json:"status_text"`
	StatusEmoji     string  `json:"status_emoji"`
	StatusExpiresAt *int64  `json:"status_expires_at"`
	PresencePref    string  `json:"presence_pref"`
	DMPrivacy       string  `json:"dm_privacy"`
	Flags           int64   `json:"flags"`
	PublicKey       []byte  `json:"public_key"`
	CreatedAt       int64   `json:"created_at"`
	UpdatedAt       int64   `json:"-"`

	AuthHash              string `json:"-"`
	KDFSalt               []byte `json:"-"`
	KDFParams             string `json:"-"`
	EncPrivateKey         []byte `json:"-"`
	EncPrivateKeyRecovery []byte `json:"-"`
	RecoveryAuthHash      string `json:"-"`
}

// PublicUser is what other users may see.
type PublicUser struct {
	ID              ids.ID  `json:"id"`
	Username        string  `json:"username"`
	DisplayName     string  `json:"display_name"`
	AvatarID        *ids.ID `json:"avatar_id"`
	BannerID        *ids.ID `json:"banner_id"`
	AboutMe         string  `json:"about_me"`
	Pronouns        string  `json:"pronouns"`
	AccentColor     *int    `json:"accent_color"`
	StatusText      string  `json:"status_text"`
	StatusEmoji     string  `json:"status_emoji"`
	StatusExpiresAt *int64  `json:"status_expires_at"`
	PublicKey       []byte  `json:"public_key"`
	Flags           int64   `json:"flags"`
	CreatedAt       int64   `json:"created_at"`
}

// Public returns the shareable view of u.
func (u *User) Public() PublicUser {
	return PublicUser{ID: u.ID, Username: u.Username, DisplayName: u.DisplayName, AvatarID: u.AvatarID, BannerID: u.BannerID,
		AboutMe: u.AboutMe, Pronouns: u.Pronouns, AccentColor: u.AccentColor, StatusText: u.StatusText, StatusEmoji: u.StatusEmoji,
		StatusExpiresAt: u.StatusExpiresAt, PublicKey: u.PublicKey, Flags: u.Flags & FlagAdmin, CreatedAt: u.CreatedAt}
}

// ProfilePatch describes optional profile changes. A nil pointer means "leave
// unchanged"; for the double pointers, a pointer to nil means "clear".
type ProfilePatch struct {
	Username        *string
	DisplayName     *string
	AboutMe         *string
	Pronouns        *string
	AccentColor     **int
	AvatarID        **ids.ID
	BannerID        **ids.ID
	StatusText      *string
	StatusEmoji     *string
	StatusExpiresAt **int64
	PresencePref    *string
	DMPrivacy       *string
}

// Session is a login on one device.
type Session struct {
	ID         ids.ID `json:"id"`
	UserID     ids.ID `json:"-"`
	TokenHash  string `json:"-"`
	UserAgent  string `json:"user_agent"`
	IP         string `json:"ip"`
	CreatedAt  int64  `json:"created_at"`
	LastSeenAt int64  `json:"last_seen_at"`
}

// Settings is the client-encrypted settings blob with its optimistic version.
type Settings struct {
	Blob      []byte `json:"blob"`
	Version   int64  `json:"version"`
	UpdatedAt int64  `json:"updated_at"`
}

// Blob is a stored file.
type Blob struct {
	ID        ids.ID  `json:"id"`
	SHA256    string  `json:"-"`
	Size      int64   `json:"size"`
	Mime      string  `json:"mime"`
	Kind      string  `json:"kind"`
	Encrypted bool    `json:"encrypted"`
	RefCount  int     `json:"-"`
	OwnerID   *ids.ID `json:"-"`
	Width     *int    `json:"width,omitempty"`
	Height    *int    `json:"height,omitempty"`
	Animated  bool    `json:"animated"`
	CreatedAt int64   `json:"created_at"`
}

// Relationship links two users from user_id's point of view.
type Relationship struct {
	UserID    ids.ID `json:"-"`
	TargetID  ids.ID `json:"user_id"`
	Type      string `json:"type"` // friend | outgoing | incoming | blocked
	Nickname  string `json:"nickname"`
	CreatedAt int64  `json:"created_at"`
}

// Channel is any conversation container: DM, group DM, or server channel.
type Channel struct {
	ID              ids.ID   `json:"id"`
	ServerID        *ids.ID  `json:"server_id"`
	Type            string   `json:"type"`
	Name            string   `json:"name"`
	Topic           string   `json:"topic"`
	Position        int      `json:"position"`
	ParentID        *ids.ID  `json:"parent_id"`
	NSFW            bool     `json:"nsfw"`
	SlowmodeSeconds int      `json:"slowmode_seconds"`
	UserLimit       int      `json:"user_limit"`
	OwnerID         *ids.ID  `json:"owner_id"`
	IconID          *ids.ID  `json:"icon_id"`
	LastMessageID   *ids.ID  `json:"last_message_id"`
	CreatedAt       int64    `json:"created_at"`
	Recipients      []ids.ID `json:"recipient_ids"`
}

// ChannelPatch is an optional set of channel changes.
type ChannelPatch struct {
	Name            *string
	Topic           *string
	IconID          **ids.ID
	OwnerID         *ids.ID
	NSFW            *bool
	SlowmodeSeconds *int
	UserLimit       *int
	ParentID        **ids.ID
	Position        *int
}

// Message flag bits.
const (
	MsgFlagPinned         int64 = 1
	MsgFlagSuppressEmbeds int64 = 4
)

// Message is an encrypted message row plus its attachments and reactions.
type Message struct {
	ID              ids.ID            `json:"id"`
	ChannelID       ids.ID            `json:"channel_id"`
	AuthorID        ids.ID            `json:"author_id"`
	Type            string            `json:"type"`
	Ciphertext      json.RawMessage   `json:"ciphertext"`
	KeyConvID       *ids.ID           `json:"key_conv_id"`
	KeyEpoch        *int              `json:"key_epoch"`
	ReplyToID       *ids.ID           `json:"reply_to_id"`
	Mentions        []ids.ID          `json:"mentions"`
	MentionRoles    []ids.ID          `json:"mention_roles"`
	MentionEveryone bool              `json:"mention_everyone"`
	Attachments     []Attachment      `json:"attachments"`
	Reactions       []ReactionSummary `json:"reactions"`
	Flags           int64             `json:"flags"`
	Nonce           string            `json:"-"`
	EditedAt        *int64            `json:"edited_at"`
	CreatedAt       int64             `json:"created_at"`
}

// Attachment is an encrypted file bound to a message.
type Attachment struct {
	ID         ids.ID `json:"id"`
	MessageID  ids.ID `json:"-"`
	ChannelID  ids.ID `json:"-"`
	UploaderID ids.ID `json:"-"`
	BlobID     ids.ID `json:"blob_id"`
	Size       int64  `json:"size"`
	CreatedAt  int64  `json:"-"`
}

// ReactionSummary aggregates one emoji on a message.
type ReactionSummary struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
	Me    bool   `json:"me"`
}

// ReadState is a user's position in a channel.
type ReadState struct {
	ChannelID         ids.ID  `json:"channel_id"`
	LastReadMessageID *ids.ID `json:"last_read_message_id"`
	LastAckAt         int64   `json:"last_ack_at"`
	MentionCount      int     `json:"mention_count"`
}

// KeyEpoch is one generation of a conversation's root key.
type KeyEpoch struct {
	ConvID    ids.ID `json:"conv_id"`
	Epoch     int    `json:"epoch"`
	CreatedBy ids.ID `json:"created_by"`
	CreatedAt int64  `json:"created_at"`
	Reason    string `json:"reason"`
}

// KeyGrant is a root key sealed for one user.
type KeyGrant struct {
	ConvID     ids.ID `json:"conv_id"`
	Epoch      int    `json:"epoch"`
	UserID     ids.ID `json:"user_id"`
	WrappedKey []byte `json:"wrapped_key"`
	WrappedBy  ids.ID `json:"wrapped_by"`
	CreatedAt  int64  `json:"created_at"`
}

// KeyFlags marks a conversation that needs client-side key work.
type KeyFlags struct {
	ConvID        ids.ID `json:"conv_id"`
	NeedsRotation bool   `json:"needs_rotation"`
	NeedsOwnKey   bool   `json:"needs_own_key"`
}
