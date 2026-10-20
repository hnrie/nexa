package api

import (
	"context"
	"regexp"
	"strings"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
	"evilion.xyz/chat/internal/unfurl"
)

// A webhook's message is not end-to-end encrypted: whoever holds the URL
// sends it here readable, so there is nothing to seal it for. It is stored as
// JSON in messages.plain, in the shape below, and reaches clients as the
// message's "webhook" field. The shape follows Discord's message, embed,
// component and poll objects field for field, so what a program meant for
// Discord sends is kept as it meant it; the additions are what this server
// adds to make it showable: signed proxy links for remote pictures and the
// blob ids of files that came with the message.

// wmPlain is a webhook message's content.
type wmPlain struct {
	// Name is who the message says it is from: the name it was sent with, or
	// the webhook's own at the time. The avatar is one of three: a picture
	// sent with the message (AvatarURL, loaded through AvatarProxy), the
	// webhook's own picture then (AvatarID), or neither.
	Name        string  `json:"name"`
	AvatarID    *ids.ID `json:"avatar_id,omitempty"`
	AvatarURL   string  `json:"avatar_url,omitempty"`
	AvatarProxy string  `json:"avatar_proxy_url,omitempty"`

	Content     string          `json:"content,omitempty"`
	TTS         bool            `json:"tts,omitempty"`
	Embeds      []wmEmbed       `json:"embeds,omitempty"`
	Components  []wmComponent   `json:"components,omitempty"`
	Poll        *wmPoll         `json:"poll,omitempty"`
	Attachments []wmAttachment  `json:"attachments,omitempty"`
	LinkEmbeds  []unfurl.Result `json:"link_embeds,omitempty"`
	// Source is "slack" or "github" for a message converted from one of
	// those formats, empty for one sent as it is.
	Source string `json:"source,omitempty"`

	// What a bot's messages carry besides (bot_messages.go): the
	// application that wrote it, the interaction it answers, and the
	// stickers it sent. Name and AvatarID are then the bot's own, which older
	// apps show it under.
	ApplicationID *ids.ID         `json:"application_id,omitempty"`
	Interaction   *wmInteraction  `json:"interaction,omitempty"`
	Stickers      []wmStickerItem `json:"stickers,omitempty"`
}

// wmInteraction is the interaction a bot's message answers: who used what.
type wmInteraction struct {
	ID          ids.ID `json:"id"`
	Type        int    `json:"type"`
	UserID      ids.ID `json:"user_id"`
	Name        string `json:"name,omitempty"`
	CommandType int    `json:"command_type,omitempty"`
	// the options someone filled in for a slash command; kept for the line
	// above its answer, not included in the bot protocol's interaction metadata
	Options []dOptionValue `json:"options,omitempty"`
	// the message a component sat on, and the one an answer to a form's
	// component went on from
	InteractedMessageID *ids.ID `json:"interacted_message_id,omitempty"`
	// what a user or message command was used on
	TargetUserID    *ids.ID `json:"target_user_id,omitempty"`
	TargetMessageID *ids.ID `json:"target_message_id,omitempty"`
	// for a followup, the message the first answer made
	OriginalResponseMessageID *ids.ID `json:"original_response_message_id,omitempty"`
	// where the application was installed for it: "0" a server, "1" an account
	Owners map[string]ids.ID `json:"authorizing_integration_owners,omitempty"`
	// Trigger is, for a form's submission, the interaction that opened it
	Trigger *wmInteraction `json:"trigger,omitempty"`
}

// wmStickerItem is a sticker a bot sent.
type wmStickerItem struct {
	ID         ids.ID `json:"id"`
	Name       string `json:"name"`
	FormatType int    `json:"format_type"`
	BlobID     ids.ID `json:"blob_id"`
	// Format is the sticker's file as Nexa keeps it (png, apng, gif, webp,
	// tgs, webm), for the apps that draw it
	Format string `json:"format,omitempty"`
}

// wmEmbed is a rich embed.
type wmEmbed struct {
	Type        string     `json:"type"`
	Title       string     `json:"title,omitempty"`
	Description string     `json:"description,omitempty"`
	URL         string     `json:"url,omitempty"`
	Timestamp   string     `json:"timestamp,omitempty"`
	Color       *int       `json:"color,omitempty"`
	Footer      *wmFooter  `json:"footer,omitempty"`
	Image       *wmMedia   `json:"image,omitempty"`
	Thumbnail   *wmMedia   `json:"thumbnail,omitempty"`
	Author      *wmAuthor  `json:"author,omitempty"`
	Fields      []wmField  `json:"fields,omitempty"`
	Provider    *wmProvide `json:"provider,omitempty"`
}

// wmMedia is a picture: a remote one (URL, shown through ProxyURL) or one of
// the message's own files (BlobID, and URL as "attachment://name").
type wmMedia struct {
	URL          string  `json:"url"`
	ProxyURL     string  `json:"proxy_url,omitempty"`
	AttachmentID *ids.ID `json:"attachment_id,omitempty"`
	BlobID       *ids.ID `json:"blob_id,omitempty"`
	Width        *int    `json:"width,omitempty"`
	Height       *int    `json:"height,omitempty"`
	ContentType  string  `json:"content_type,omitempty"`
	Description  string  `json:"description,omitempty"`
}

type wmFooter struct {
	Text         string  `json:"text"`
	IconURL      string  `json:"icon_url,omitempty"`
	ProxyIconURL string  `json:"proxy_icon_url,omitempty"`
	IconBlobID   *ids.ID `json:"icon_blob_id,omitempty"`
}

type wmAuthor struct {
	Name         string  `json:"name"`
	URL          string  `json:"url,omitempty"`
	IconURL      string  `json:"icon_url,omitempty"`
	ProxyIconURL string  `json:"proxy_icon_url,omitempty"`
	IconBlobID   *ids.ID `json:"icon_blob_id,omitempty"`
}

type wmField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

type wmProvide struct {
	Name string `json:"name,omitempty"`
	URL  string `json:"url,omitempty"`
}

// Component types, at Discord's numbers.
const (
	compActionRow   = 1
	compButton      = 2
	compStringSel   = 3
	compUserSel     = 5
	compRoleSel     = 6
	compMentionSel  = 7
	compChannelSel  = 8
	compSection     = 9
	compTextDisplay = 10
	compThumbnail   = 11
	compGallery     = 12
	compFile        = 13
	compSeparator   = 14
	compContainer   = 17
)

// Button styles; only links do anything without an app behind them.
const (
	btnPrimary   = 1
	btnSecondary = 2
	btnSuccess   = 3
	btnDanger    = 4
	btnLink      = 5
	btnPremium   = 6
)

// wmComponent is one component of any type; which fields mean anything
// depends on Type, as in Discord's component objects.
type wmComponent struct {
	Type int `json:"type"`
	ID   int `json:"id,omitempty"`
	// action row, section, container
	Components []wmComponent `json:"components,omitempty"`
	// section
	Accessory *wmComponent `json:"accessory,omitempty"`
	// button
	Style    int      `json:"style,omitempty"`
	Label    string   `json:"label,omitempty"`
	Emoji    *wmEmoji `json:"emoji,omitempty"`
	URL      string   `json:"url,omitempty"`
	CustomID string   `json:"custom_id,omitempty"`
	Disabled bool     `json:"disabled,omitempty"`
	// text display
	Content string `json:"content,omitempty"`
	// thumbnail, file
	Media       *wmMedia `json:"media,omitempty"`
	File        *wmMedia `json:"file,omitempty"`
	Description string   `json:"description,omitempty"`
	Spoiler     bool     `json:"spoiler,omitempty"`
	// file: filled in from the attachment
	Name string `json:"name,omitempty"`
	Size int64  `json:"size,omitempty"`
	// media gallery
	Items []wmGalleryItem `json:"items,omitempty"`
	// separator: Divider is a pointer because it defaults to true
	Divider *bool `json:"divider,omitempty"`
	Spacing int   `json:"spacing,omitempty"`
	// container
	AccentColor *int `json:"accent_color,omitempty"`
	// select menus: usable on a bot's message, which an application answers;
	// on a webhook's only shown
	Placeholder   string           `json:"placeholder,omitempty"`
	Options       []wmSelectOption `json:"options,omitempty"`
	MinValues     *int             `json:"min_values,omitempty"`
	MaxValues     *int             `json:"max_values,omitempty"`
	DefaultValues []wmDefaultValue `json:"default_values,omitempty"`
	ChannelTypes  []int            `json:"channel_types,omitempty"`
	Required      *bool            `json:"required,omitempty"`
	// a premium button's SKU; nothing is for sale here, so it shows disabled
	SKUID *ids.ID `json:"sku_id,omitempty"`
}

// wmSelectOption is one choice of a string select menu.
type wmSelectOption struct {
	Label       string   `json:"label"`
	Value       string   `json:"value"`
	Description string   `json:"description,omitempty"`
	Emoji       *wmEmoji `json:"emoji,omitempty"`
	Default     bool     `json:"default,omitempty"`
}

// wmDefaultValue is what a user, role, mentionable or channel select menu
// starts with picked.
type wmDefaultValue struct {
	ID   ids.ID `json:"id"`
	Type string `json:"type"` // user | role | channel
}

type wmGalleryItem struct {
	Media       wmMedia `json:"media"`
	Description string  `json:"description,omitempty"`
	Spoiler     bool    `json:"spoiler,omitempty"`
}

// wmEmoji is a button's or an answer's emoji: a Unicode one by Name, or a
// custom one by ID (Nexa's custom emoji ids).
type wmEmoji struct {
	ID       *ids.ID `json:"id,omitempty"`
	Name     string  `json:"name,omitempty"`
	Animated bool    `json:"animated,omitempty"`
}

// wmPoll is a poll as sent: what it asks, its answers, when it closes.
type wmPoll struct {
	Question         wmPollMedia    `json:"question"`
	Answers          []wmPollAnswer `json:"answers"`
	Expiry           string         `json:"expiry"`
	AllowMultiselect bool           `json:"allow_multiselect"`
	LayoutType       int            `json:"layout_type"`
}

type wmPollAnswer struct {
	AnswerID  int         `json:"answer_id"`
	PollMedia wmPollMedia `json:"poll_media"`
}

type wmPollMedia struct {
	Text  string   `json:"text,omitempty"`
	Emoji *wmEmoji `json:"emoji,omitempty"`
}

// wmAttachment is a file sent with the message, stored as it came.
type wmAttachment struct {
	ID          ids.ID  `json:"id"`
	BlobID      ids.ID  `json:"blob_id"`
	Filename    string  `json:"filename"`
	Title       string  `json:"title,omitempty"`
	Description string  `json:"description,omitempty"`
	ContentType string  `json:"content_type,omitempty"`
	Size        int64   `json:"size"`
	Width       *int    `json:"width,omitempty"`
	Height      *int    `json:"height,omitempty"`
	Spoiler     bool    `json:"spoiler,omitempty"`
	Duration    float64 `json:"duration_secs,omitempty"`
	// Inline marks a file an embed or a component shows, which is then not
	// shown again underneath the message.
	Inline bool `json:"inline,omitempty"`
}

// --- mentions -----------------------------------------------------------------

var (
	reUserMention = regexp.MustCompile(`<@!?(\d{1,20})>`)
	reRoleMention = regexp.MustCompile(`<@&(\d{1,20})>`)
	reEveryone    = regexp.MustCompile(`@(everyone|here)\b`)
	// code does not ping: what is inside backticks is shown, not meant
	reCodeFence = regexp.MustCompile("(?s)```.*?```")
	reCodeSpan  = regexp.MustCompile("`[^`\n]*`")
)

// allowedMentions is Discord's allowed_mentions: which kinds of mention in the
// text may ping, and which particular users and roles.
type allowedMentions struct {
	Parse []string `json:"parse"`
	Users []ids.ID `json:"users"`
	Roles []ids.ID `json:"roles"`
	// RepliedUser says whether a reply pings who it replies to (nil: it does)
	RepliedUser *bool `json:"replied_user,omitempty"`
	// set is false when the request had none, which for a webhook means
	// users are parsed and nothing else is.
	set bool
}

func (a *allowedMentions) parses(kind string) bool {
	if a == nil || !a.set {
		return kind == "users"
	}
	for _, p := range a.Parse {
		if p == kind {
			return true
		}
	}
	return false
}

// webhookMentions works out whom a webhook message pings: the mentions in its
// text, as far as allowed_mentions lets them. A webhook may ping any role of
// its server and everyone, as long as the request asks for it.
func (s *Server) webhookMentions(ctx context.Context, ch *store.Channel, texts []string, am *allowedMentions) (users, roles []ids.ID, everyone bool) {
	users, roles = []ids.ID{}, []ids.ID{}
	var b strings.Builder
	for _, t := range texts {
		t = reCodeFence.ReplaceAllString(t, " ")
		t = reCodeSpan.ReplaceAllString(t, " ")
		b.WriteString(t)
		b.WriteByte('\n')
	}
	text := b.String()
	named := func(re *regexp.Regexp) []ids.ID {
		var out []ids.ID
		for _, m := range re.FindAllStringSubmatch(text, -1) {
			if id, err := ids.Parse(m[1]); err == nil {
				out = append(out, id)
			}
		}
		return dedupeIDs(out, 1000)
	}
	only := func(list []ids.ID, allowed []ids.ID) []ids.ID {
		ok := map[ids.ID]bool{}
		for _, id := range allowed {
			ok[id] = true
		}
		out := list[:0:0]
		for _, id := range list {
			if ok[id] {
				out = append(out, id)
			}
		}
		return out
	}
	if found := named(reUserMention); len(found) > 0 {
		switch {
		case am.parses("users"):
			users = found
		case am != nil && am.set:
			users = only(found, am.Users)
		}
	}
	if found := named(reRoleMention); len(found) > 0 && ch.ServerID != nil {
		switch {
		case am.parses("roles"):
			roles = found
		case am != nil && am.set:
			roles = only(found, am.Roles)
		}
		if len(roles) > 0 {
			// only this server's roles, and @everyone has a flag of its own
			if list, err := s.Store.Roles(ctx, *ch.ServerID); err == nil {
				known := map[ids.ID]bool{}
				for _, r := range list {
					if r.ID != *ch.ServerID {
						known[r.ID] = true
					}
				}
				kept := roles[:0:0]
				for _, id := range roles {
					if known[id] {
						kept = append(kept, id)
					}
				}
				roles = kept
			} else {
				roles = []ids.ID{}
			}
		}
	}
	everyone = am.parses("everyone") && reEveryone.MatchString(text)
	return dedupeIDs(users, maxMentions), dedupeIDs(roles, maxMentions), everyone
}

// texts is everything in a message that can mention someone: its content and,
// in a message laid out by components, their text.
func (p *wmPlain) texts() []string {
	out := []string{p.Content}
	var walk func(list []wmComponent)
	walk = func(list []wmComponent) {
		for i := range list {
			c := &list[i]
			if c.Type == compTextDisplay {
				out = append(out, c.Content)
			}
			walk(c.Components)
			if c.Accessory != nil {
				walk([]wmComponent{*c.Accessory})
			}
		}
	}
	walk(p.Components)
	return out
}

// --- Discord's message object ---------------------------------------------------

// webhookMessageObj is a webhook message as the protocol returns one, for the
// programs that read back what they sent (wait=true, and the message
// routes): built as the bot API builds every message, ids in the form the
// libraries expect. ch may be nil, to be looked up.
func (s *Server) webhookMessageObj(ctx context.Context, m *store.Message, ch *store.Channel) dMessage {
	if ch == nil {
		ch, _ = s.Store.ChannelByID(ctx, m.ChannelID)
	}
	return s.builder(ctx, nil, nil).messageObj(m, ch, msgOpts{content: true})
}

func nonNilComponents(list []wmComponent) []wmComponent {
	if list == nil {
		return []wmComponent{}
	}
	return list
}
