package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"evilion.xyz/chat/internal/botproto"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
	"evilion.xyz/chat/internal/unfurl"
)

// A message as the protocol shows it. What a message says depends on who
// asks: a person's message is sealed, and a bot reads it only from a copy
// addressed to it or with keys it was given (bot_crypto.go); what a bot or a
// webhook said is in the clear. On top of that a bot without the Message
// Content intent is shown the words only of messages meant for it, as the
// protocol has it: its own, direct messages, and messages that mention it.

// nullJSON writes a JSON null where a field must be present but empty
// (referenced_message for a reply whose original is gone).
type nullJSON struct{}

func (nullJSON) MarshalJSON() ([]byte, error) { return []byte("null"), nil }

type dAttachment struct {
	ID           snow     `json:"id"`
	Filename     string   `json:"filename"`
	Title        string   `json:"title,omitempty"`
	Description  string   `json:"description,omitempty"`
	ContentType  string   `json:"content_type,omitempty"`
	Size         int64    `json:"size"`
	URL          string   `json:"url"`
	ProxyURL     string   `json:"proxy_url"`
	Height       *int     `json:"height,omitempty"`
	Width        *int     `json:"width,omitempty"`
	Ephemeral    bool     `json:"ephemeral,omitempty"`
	DurationSecs *float64 `json:"duration_secs,omitempty"`
	Flags        int      `json:"flags,omitempty"`
}

type dEmbedMedia struct {
	URL         string `json:"url"`
	ProxyURL    string `json:"proxy_url,omitempty"`
	Height      *int   `json:"height,omitempty"`
	Width       *int   `json:"width,omitempty"`
	ContentType string `json:"content_type,omitempty"`
	Description string `json:"description,omitempty"`
}

type dEmbedFooter struct {
	Text         string `json:"text"`
	IconURL      string `json:"icon_url,omitempty"`
	ProxyIconURL string `json:"proxy_icon_url,omitempty"`
}

type dEmbedAuthor struct {
	Name         string `json:"name"`
	URL          string `json:"url,omitempty"`
	IconURL      string `json:"icon_url,omitempty"`
	ProxyIconURL string `json:"proxy_icon_url,omitempty"`
}

type dEmbedProvider struct {
	Name string `json:"name,omitempty"`
	URL  string `json:"url,omitempty"`
}

type dEmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline"`
}

type dEmbed struct {
	Title       string          `json:"title,omitempty"`
	Type        string          `json:"type"`
	Description string          `json:"description,omitempty"`
	URL         string          `json:"url,omitempty"`
	Timestamp   string          `json:"timestamp,omitempty"`
	Color       *int            `json:"color,omitempty"`
	Footer      *dEmbedFooter   `json:"footer,omitempty"`
	Image       *dEmbedMedia    `json:"image,omitempty"`
	Thumbnail   *dEmbedMedia    `json:"thumbnail,omitempty"`
	Video       *dEmbedMedia    `json:"video,omitempty"`
	Provider    *dEmbedProvider `json:"provider,omitempty"`
	Author      *dEmbedAuthor   `json:"author,omitempty"`
	Fields      []dEmbedField   `json:"fields,omitempty"`
}

type dReactionCount struct {
	Burst  int `json:"burst"`
	Normal int `json:"normal"`
}

type dReaction struct {
	Count        int            `json:"count"`
	CountDetails dReactionCount `json:"count_details"`
	Me           bool           `json:"me"`
	MeBurst      bool           `json:"me_burst"`
	Emoji        dPartialEmoji  `json:"emoji"`
	BurstColors  []string       `json:"burst_colors"`
}

type dPollMedia struct {
	Text  *string        `json:"text,omitempty"`
	Emoji *dPartialEmoji `json:"emoji,omitempty"`
}

type dPollAnswer struct {
	AnswerID  int        `json:"answer_id"`
	PollMedia dPollMedia `json:"poll_media"`
}

type dPollCount struct {
	ID      int  `json:"id"`
	Count   int  `json:"count"`
	MeVoted bool `json:"me_voted"`
}

type dPollResults struct {
	IsFinalized  bool         `json:"is_finalized"`
	AnswerCounts []dPollCount `json:"answer_counts"`
}

type dPoll struct {
	Question         dPollMedia    `json:"question"`
	Answers          []dPollAnswer `json:"answers"`
	Expiry           *string       `json:"expiry"`
	AllowMultiselect bool          `json:"allow_multiselect"`
	LayoutType       int           `json:"layout_type"`
	Results          *dPollResults `json:"results,omitempty"`
}

type dMessageRef struct {
	Type            int   `json:"type"`
	MessageID       *snow `json:"message_id,omitempty"`
	ChannelID       snow  `json:"channel_id"`
	GuildID         *snow `json:"guild_id,omitempty"`
	FailIfNotExists *bool `json:"fail_if_not_exists,omitempty"`
}

type dInteractionMetadata struct {
	ID                            snow            `json:"id"`
	Type                          int             `json:"type"`
	Name                          string          `json:"name,omitempty"`
	CommandType                   *int            `json:"command_type,omitempty"`
	User                          dUser           `json:"user"`
	AuthorizingIntegrationOwners  map[string]snow `json:"authorizing_integration_owners"`
	OriginalResponseMessageID     *snow           `json:"original_response_message_id,omitempty"`
	InteractedMessageID           *snow           `json:"interacted_message_id,omitempty"`
	TargetUser                    *dUser          `json:"target_user,omitempty"`
	TargetMessageID               *snow           `json:"target_message_id,omitempty"`
	TriggeringInteractionMetadata any             `json:"triggering_interaction_metadata,omitempty"`
}

// dMessageInteraction is the older, simpler form of interaction_metadata,
// which some libraries still read.
type dMessageInteraction struct {
	ID     snow     `json:"id"`
	Type   int      `json:"type"`
	Name   string   `json:"name"`
	User   dUser    `json:"user"`
	Member *dMember `json:"member,omitempty"`
}

type dCall struct {
	Participants   []snow  `json:"participants"`
	EndedTimestamp *string `json:"ended_timestamp"`
}

// dMentionUser is a mentioned user, with their membership in a server message.
type dMentionUser struct {
	dUser
	Member *dMember `json:"member,omitempty"`
}

type dMessage struct {
	ID                  snow                  `json:"id"`
	ChannelID           snow                  `json:"channel_id"`
	GuildID             *snow                 `json:"guild_id,omitempty"`
	Author              dUser                 `json:"author"`
	Member              *dMember              `json:"member,omitempty"`
	Content             string                `json:"content"`
	Timestamp           string                `json:"timestamp"`
	EditedTimestamp     *string               `json:"edited_timestamp"`
	TTS                 bool                  `json:"tts"`
	MentionEveryone     bool                  `json:"mention_everyone"`
	Mentions            []dMentionUser        `json:"mentions"`
	MentionRoles        []snow                `json:"mention_roles"`
	Attachments         []dAttachment         `json:"attachments"`
	Embeds              []dEmbed              `json:"embeds"`
	Reactions           []dReaction           `json:"reactions,omitempty"`
	Nonce               any                   `json:"nonce,omitempty"`
	Pinned              bool                  `json:"pinned"`
	WebhookID           *snow                 `json:"webhook_id,omitempty"`
	Type                int                   `json:"type"`
	ApplicationID       *snow                 `json:"application_id,omitempty"`
	MessageReference    *dMessageRef          `json:"message_reference,omitempty"`
	Flags               int64                 `json:"flags"`
	ReferencedMessage   any                   `json:"referenced_message,omitempty"`
	InteractionMetadata *dInteractionMetadata `json:"interaction_metadata,omitempty"`
	Interaction         *dMessageInteraction  `json:"interaction,omitempty"`
	Thread              *dChannel             `json:"thread,omitempty"`
	Components          []any                 `json:"components"`
	StickerItems        []dStickerItem        `json:"sticker_items,omitempty"`
	Position            *int                  `json:"position,omitempty"`
	Poll                *dPoll                `json:"poll,omitempty"`
	Call                *dCall                `json:"call,omitempty"`
}

// Message flags as the protocol numbers them.
const (
	dMsgCrossposted          = 1 << 0
	dMsgIsCrosspost          = 1 << 1
	dMsgSuppressEmbeds       = 1 << 2
	dMsgSourceDeleted        = 1 << 3
	dMsgHasThread            = 1 << 5
	dMsgEphemeral            = 1 << 6
	dMsgLoading              = 1 << 7
	dMsgSuppressNotification = 1 << 12
	dMsgComponentsV2         = 1 << 15
)

// msgOpts says how a message is to be built.
type msgOpts struct {
	// member adds the author's membership, as MESSAGE_CREATE does
	member bool
	// content says whether a bot reading this has the Message Content
	// intent: on the gateway, the intent it connected with; over REST, its
	// application's
	content bool
	// copy is the sealed copy for the viewer, when it was looked up already
	copy []byte
	// noReference leaves out the message a reply quotes (inside a quote)
	noReference bool
}

// botReadsContent reports whether the viewing bot's application holds the
// Message Content intent, which REST answers go by.
func (b *dBuilder) botReadsContent() bool {
	if b.app == nil {
		return true
	}
	return botproto.ReadsMessages(b.app.Flags)
}

// messageType is a Nexa message's type in the protocol's numbers.
func messageType(m *store.Message, plain *wmPlain) int {
	switch m.Type {
	case "reply":
		return 19
	case "system_member_add", "system_thread_add":
		return 1
	case "system_member_remove", "system_thread_remove":
		return 2
	case "system_call":
		return 3
	case "system_pin":
		return 6
	case "system_join":
		return 7
	case "system_thread":
		return 18
	case "system_automod":
		return 24
	case "system_poll_result":
		return 46
	}
	if plain != nil && plain.Interaction != nil && plain.Interaction.OriginalResponseMessageID == nil {
		switch {
		case plain.Interaction.Type == 2 && plain.Interaction.CommandType <= 1:
			return 20
		case plain.Interaction.Type == 2:
			return 23
		}
	}
	return 0
}

// fileURL is the address a viewer downloads one of a message's files from:
// signed and bound to who may fetch it, for a day, as the protocol's are.
// The bot API's CDN route (bot_cdn.go) checks it and, for a sealed file,
// opens it for that viewer.
func (s *Server) fileURL(channel, attachment, viewer ids.ID, filename string) string {
	issued := time.Now().Unix()
	expires := issued + 24*3600
	sig := s.fileSig(attachment, viewer, expires)
	q := url.Values{}
	q.Set("ex", strconv.FormatInt(expires, 16))
	q.Set("is", strconv.FormatInt(issued, 16))
	q.Set("hm", sig)
	if !viewer.IsZero() {
		q.Set("u", botproto.OutString(viewer))
	}
	return s.absoluteURL("/cdn/attachments/" + botproto.OutString(channel) + "/" + botproto.OutString(attachment) + "/" + url.PathEscape(path.Base(filename)) + "?" + q.Encode())
}

func (s *Server) fileSig(attachment, viewer ids.ID, expires int64) string {
	mac := hmac.New(sha256.New, s.derivedKey("bot-file-v1"))
	mac.Write([]byte(attachment.String() + "|" + viewer.String() + "|" + strconv.FormatInt(expires, 10)))
	return hex.EncodeToString(mac.Sum(nil))
}

// mediaURL is where a picture an embed or a component shows is fetched.
func (b *dBuilder) mediaObj(m *wmMedia, atts []wmAttachment, channel ids.ID) *dEmbedMedia {
	if m == nil {
		return nil
	}
	out := &dEmbedMedia{URL: m.URL, Width: m.Width, Height: m.Height, ContentType: m.ContentType, Description: m.Description}
	if m.AttachmentID != nil {
		name := "file"
		for _, a := range atts {
			if a.ID == *m.AttachmentID {
				name = a.Filename
			}
		}
		out.URL = b.s.fileURL(channel, *m.AttachmentID, b.viewerID(), name)
		out.ProxyURL = out.URL
	} else if m.ProxyURL != "" {
		out.ProxyURL = b.s.absoluteURL(m.ProxyURL)
	}
	return out
}

func (b *dBuilder) viewerID() ids.ID {
	if b.viewer == nil {
		return 0
	}
	return b.viewer.ID
}

// plainEmbeds are the embeds a bot or a webhook sent, then the link
// previews made for its links.
func (b *dBuilder) plainEmbeds(p *wmPlain, channel ids.ID) []dEmbed {
	out := []dEmbed{}
	for _, e := range p.Embeds {
		de := dEmbed{Type: e.Type, Title: botproto.OutText(e.Title), Description: botproto.OutText(e.Description), URL: e.URL, Timestamp: e.Timestamp, Color: e.Color,
			Image: b.mediaObj(e.Image, p.Attachments, channel), Thumbnail: b.mediaObj(e.Thumbnail, p.Attachments, channel)}
		if de.Type == "" {
			de.Type = "rich"
		}
		if e.Footer != nil {
			de.Footer = &dEmbedFooter{Text: botproto.OutText(e.Footer.Text), IconURL: e.Footer.IconURL}
			if e.Footer.ProxyIconURL != "" {
				de.Footer.ProxyIconURL = b.s.absoluteURL(e.Footer.ProxyIconURL)
			}
		}
		if e.Author != nil {
			de.Author = &dEmbedAuthor{Name: e.Author.Name, URL: e.Author.URL, IconURL: e.Author.IconURL}
			if e.Author.ProxyIconURL != "" {
				de.Author.ProxyIconURL = b.s.absoluteURL(e.Author.ProxyIconURL)
			}
		}
		if e.Provider != nil {
			de.Provider = &dEmbedProvider{Name: e.Provider.Name, URL: e.Provider.URL}
		}
		for _, f := range e.Fields {
			de.Fields = append(de.Fields, dEmbedField{Name: botproto.OutText(f.Name), Value: botproto.OutText(f.Value), Inline: f.Inline})
		}
		out = append(out, de)
	}
	for _, l := range p.LinkEmbeds {
		out = append(out, b.linkEmbed(l))
	}
	return out
}

// linkEmbed is a link preview as the protocol's embed of a link.
func (b *dBuilder) linkEmbed(l unfurl.Result) dEmbed {
	e := dEmbed{Type: "link", URL: l.URL, Title: l.Title, Description: l.Description}
	switch l.Type {
	case "image":
		e.Type = "image"
	case "gif":
		e.Type = "gifv"
	case "video", "youtube":
		e.Type = "video"
	}
	if l.SiteName != "" {
		e.Provider = &dEmbedProvider{Name: l.SiteName}
	}
	if l.Author != "" {
		e.Author = &dEmbedAuthor{Name: l.Author, URL: l.AuthorURL}
	}
	if c := strings.TrimPrefix(l.Color, "#"); c != "" {
		if n, err := strconv.ParseInt(c, 16, 32); err == nil {
			v := int(n)
			e.Color = &v
		}
	}
	if l.Image != "" {
		// a link straight to a picture is the picture's own address; a page's
		// picture is known only through the media proxy
		u := b.s.absoluteURL(l.Image)
		img := &dEmbedMedia{URL: u, ProxyURL: u}
		if e.Type == "image" || e.Type == "gifv" {
			img.URL = l.URL
		}
		if l.ImageW > 0 && l.ImageH > 0 {
			img.Width, img.Height = intp(l.ImageW), intp(l.ImageH)
		}
		e.Thumbnail = img
	}
	if l.Media != "" && l.MediaKind == "video" {
		e.Video = &dEmbedMedia{URL: l.Media, ProxyURL: b.s.absoluteURL(b.s.ProxyURL(l.Media))}
	}
	return e
}

// sealedEmbed is a link preview a person's app sealed into its message.
func (b *dBuilder) sealedEmbed(raw map[string]any) dEmbed {
	str := func(k string) string { v, _ := raw[k].(string); return v }
	num := func(k string) int {
		switch v := raw[k].(type) {
		case float64:
			return int(v)
		case json.Number:
			n, _ := v.Int64()
			return int(n)
		}
		return 0
	}
	return b.linkEmbed(unfurl.Result{URL: str("url"), Type: str("type"), Title: str("title"), Description: str("description"), SiteName: str("site_name"),
		Image: str("image"), ImageW: num("image_w"), ImageH: num("image_h"), Color: str("color"), Author: str("author"), AuthorURL: str("author_url"),
		Media: str("media"), MediaKind: str("media_kind")})
}

// componentsOut writes a bot's or a webhook's components as the protocol
// does, ids in its form.
func (b *dBuilder) componentsOut(list []wmComponent, atts []wmAttachment, channel ids.ID) []any {
	out := make([]any, 0, len(list))
	for i := range list {
		out = append(out, b.componentOut(&list[i], atts, channel))
	}
	return out
}

func (b *dBuilder) componentOut(c *wmComponent, atts []wmAttachment, channel ids.ID) map[string]any {
	o := map[string]any{"type": c.Type}
	if c.ID != 0 {
		o["id"] = c.ID
	}
	emoji := func(e *wmEmoji) map[string]any {
		if e == nil {
			return nil
		}
		m := map[string]any{"name": e.Name}
		if e.ID != nil {
			m["id"] = snow(*e.ID)
		}
		if e.Animated {
			m["animated"] = true
		}
		return m
	}
	media := func(m *wmMedia) map[string]any {
		if m == nil {
			return nil
		}
		dm := b.mediaObj(m, atts, channel)
		mo := map[string]any{"url": dm.URL}
		if dm.ProxyURL != "" {
			mo["proxy_url"] = dm.ProxyURL
		}
		if m.Width != nil {
			mo["width"] = *m.Width
		}
		if m.Height != nil {
			mo["height"] = *m.Height
		}
		if m.ContentType != "" {
			mo["content_type"] = m.ContentType
		}
		if m.AttachmentID != nil {
			mo["attachment_id"] = snow(*m.AttachmentID)
		}
		return mo
	}
	switch c.Type {
	case compActionRow, compContainer:
		o["components"] = b.componentsOut(c.Components, atts, channel)
		if c.Type == compContainer {
			if c.AccentColor != nil {
				o["accent_color"] = *c.AccentColor
			}
			o["spoiler"] = c.Spoiler
		}
	case compButton:
		o["style"] = c.Style
		if c.Label != "" {
			o["label"] = botproto.OutText(c.Label)
		}
		if e := emoji(c.Emoji); e != nil {
			o["emoji"] = e
		}
		if c.URL != "" {
			o["url"] = c.URL
		}
		if c.CustomID != "" {
			o["custom_id"] = c.CustomID
		}
		if c.SKUID != nil {
			o["sku_id"] = snow(*c.SKUID)
		}
		o["disabled"] = c.Disabled
	case compStringSel, compUserSel, compRoleSel, compMentionSel, compChannelSel:
		o["custom_id"] = c.CustomID
		if c.Placeholder != "" {
			o["placeholder"] = c.Placeholder
		}
		if c.MinValues != nil {
			o["min_values"] = *c.MinValues
		}
		if c.MaxValues != nil {
			o["max_values"] = *c.MaxValues
		}
		o["disabled"] = c.Disabled
		if c.Required != nil {
			o["required"] = *c.Required
		}
		if c.Type == compStringSel {
			opts := make([]map[string]any, 0, len(c.Options))
			for _, op := range c.Options {
				m := map[string]any{"label": op.Label, "value": op.Value, "default": op.Default}
				if op.Description != "" {
					m["description"] = op.Description
				}
				if e := emoji(op.Emoji); e != nil {
					m["emoji"] = e
				}
				opts = append(opts, m)
			}
			o["options"] = opts
		}
		if len(c.DefaultValues) > 0 {
			dv := make([]map[string]any, 0, len(c.DefaultValues))
			for _, v := range c.DefaultValues {
				dv = append(dv, map[string]any{"id": snow(v.ID), "type": v.Type})
			}
			o["default_values"] = dv
		}
		if len(c.ChannelTypes) > 0 {
			o["channel_types"] = c.ChannelTypes
		}
	case compSection:
		o["components"] = b.componentsOut(c.Components, atts, channel)
		if c.Accessory != nil {
			o["accessory"] = b.componentOut(c.Accessory, atts, channel)
		}
	case compTextDisplay:
		o["content"] = botproto.OutText(c.Content)
	case compThumbnail:
		o["media"] = media(c.Media)
		if c.Description != "" {
			o["description"] = c.Description
		}
		o["spoiler"] = c.Spoiler
	case compGallery:
		items := make([]map[string]any, 0, len(c.Items))
		for _, it := range c.Items {
			m := map[string]any{"media": media(&it.Media), "spoiler": it.Spoiler}
			if it.Description != "" {
				m["description"] = it.Description
			}
			items = append(items, m)
		}
		o["items"] = items
	case compFile:
		o["file"] = media(c.File)
		o["spoiler"] = c.Spoiler
		if c.Name != "" {
			o["name"] = c.Name
		}
		if c.Size > 0 {
			o["size"] = c.Size
		}
	case compSeparator:
		divider := true
		if c.Divider != nil {
			divider = *c.Divider
		}
		o["divider"] = divider
		spacing := c.Spacing
		if spacing == 0 {
			spacing = 1
		}
		o["spacing"] = spacing
	}
	return o
}

// plainAttachments are a bot's or a webhook's files, as listed under it.
func (b *dBuilder) plainAttachments(p *wmPlain, channel ids.ID) []dAttachment {
	out := []dAttachment{}
	for _, a := range p.Attachments {
		if a.Inline {
			continue
		}
		u := b.s.fileURL(channel, a.ID, b.viewerID(), a.Filename)
		da := dAttachment{ID: snow(a.ID), Filename: a.Filename, Title: a.Title, Description: a.Description, ContentType: a.ContentType, Size: a.Size,
			URL: u, ProxyURL: u, Width: a.Width, Height: a.Height}
		if a.Duration > 0 {
			d := a.Duration
			da.DurationSecs = &d
		}
		if a.Spoiler {
			da.Flags |= 8
		}
		out = append(out, da)
	}
	return out
}

// plainPoll is a bot's or a webhook's poll with how it stands.
func (b *dBuilder) plainPoll(p *wmPoll, tally *store.PollTally) *dPoll {
	q := botproto.OutText(p.Question.Text)
	out := &dPoll{Question: dPollMedia{Text: &q}, AllowMultiselect: p.AllowMultiselect, LayoutType: 1, Answers: []dPollAnswer{}}
	if p.Expiry != "" {
		e := p.Expiry
		out.Expiry = &e
	}
	for _, a := range p.Answers {
		t := a.PollMedia.Text
		pm := dPollMedia{Text: &t}
		if a.PollMedia.Emoji != nil {
			pe := dPartialEmoji{Animated: a.PollMedia.Emoji.Animated}
			if a.PollMedia.Emoji.ID != nil {
				id := snow(*a.PollMedia.Emoji.ID)
				pe.ID = &id
			}
			if a.PollMedia.Emoji.Name != "" {
				n := a.PollMedia.Emoji.Name
				pe.Name = &n
			}
			pm.Emoji = &pe
		}
		out.Answers = append(out.Answers, dPollAnswer{AnswerID: a.AnswerID, PollMedia: pm})
	}
	out.Results = pollResults(tally)
	return out
}

func pollResults(tally *store.PollTally) *dPollResults {
	if tally == nil {
		return nil
	}
	r := &dPollResults{IsFinalized: tally.Finalized, AnswerCounts: []dPollCount{}}
	for _, c := range tally.Counts {
		if c.Count > 0 {
			r.AnswerCounts = append(r.AnswerCounts, dPollCount{ID: c.ID, Count: c.Count, MeVoted: c.MeVoted})
		}
	}
	return r
}

// sealedPoll is a person's poll, from its sealed words and the tally.
func (b *dBuilder) sealedPoll(p *botPollPayload, tally *store.PollTally) *dPoll {
	q := p.Question
	out := &dPoll{Question: dPollMedia{Text: &q}, AllowMultiselect: p.Multiselect, LayoutType: 1, Answers: []dPollAnswer{}}
	if tally != nil && tally.ExpiresAt != nil {
		out.Expiry = botproto.TimestampP(tally.ExpiresAt)
	}
	for i, a := range p.Answers {
		t := a.Text
		pm := dPollMedia{Text: &t}
		if a.Emoji != nil {
			pe := dPartialEmoji{Animated: a.Emoji.Animated}
			if id, err := ids.Parse(a.Emoji.ID); err == nil && a.Emoji.ID != "" {
				sid := snow(id)
				pe.ID = &sid
			}
			if a.Emoji.Name != "" {
				n := a.Emoji.Name
				pe.Name = &n
			}
			pm.Emoji = &pe
		}
		out.Answers = append(out.Answers, dPollAnswer{AnswerID: i + 1, PollMedia: pm})
	}
	out.Results = pollResults(tally)
	return out
}

// sealedAttachments are a person's files, listed from its sealed words. Each
// is matched to the message's attachment row for its id.
func (b *dBuilder) sealedAttachments(m *store.Message, list []botAttachMeta) []dAttachment {
	out := []dAttachment{}
	rows := map[string]ids.ID{}
	for _, a := range m.Attachments {
		rows[a.BlobID.String()] = a.ID
	}
	for _, a := range list {
		id, ok := rows[a.BlobID]
		if !ok {
			continue
		}
		u := b.s.fileURL(m.ChannelID, id, b.viewerID(), a.Name)
		da := dAttachment{ID: snow(id), Filename: a.Name, ContentType: a.Type, Size: a.Size, URL: u, ProxyURL: u, Description: a.Alt}
		if a.W != nil && a.H != nil {
			da.Width, da.Height = intp(int(*a.W)), intp(int(*a.H))
		}
		if a.Duration != nil {
			d := *a.Duration
			da.DurationSecs = &d
		}
		if a.Spoiler {
			da.Flags |= 8
		}
		out = append(out, da)
	}
	return out
}

// messageObj is a message for the builder's viewer.
func (b *dBuilder) messageObj(m *store.Message, ch *store.Channel, opts msgOpts) dMessage {
	var plain *wmPlain
	if len(m.Webhook) > 0 {
		var p wmPlain
		if json.Unmarshal(m.Webhook, &p) == nil {
			plain = &p
		}
	}
	out := dMessage{ID: snow(m.ID), ChannelID: snow(m.ChannelID), Timestamp: botproto.Timestamp(m.CreatedAt), EditedTimestamp: botproto.TimestampP(m.EditedAt),
		MentionEveryone: m.MentionEveryone, Mentions: []dMentionUser{}, MentionRoles: botproto.Snows(m.MentionRoles), Attachments: []dAttachment{}, Embeds: []dEmbed{},
		Components: []any{}, Pinned: m.Flags&store.MsgFlagPinned != 0, Type: messageType(m, plain)}
	if m.Nonce != "" {
		out.Nonce = m.Nonce
	}
	out.Flags = m.Flags &^ (store.MsgFlagPinned | store.MsgFlagPublished)
	if m.Flags&store.MsgFlagPublished != 0 {
		out.Flags |= dMsgCrossposted
	}
	if ch != nil && ch.ServerID != nil {
		gid := snow(*ch.ServerID)
		out.GuildID = &gid
	}
	// the author: a webhook speaks under the name and picture it chose
	if m.WebhookID != nil && plain != nil {
		wid := snow(*m.WebhookID)
		out.WebhookID = &wid
		au := dUser{ID: wid, Username: plain.Name, Discriminator: "0000", Bot: true, Avatar: b.hash(plain.AvatarID)}
		out.Author = au
	} else {
		out.Author = b.userByID(m.AuthorID)
	}
	if opts.member && out.GuildID != nil && m.WebhookID == nil {
		if mem, err := b.s.Store.Member(b.ctx, *ch.ServerID, m.AuthorID); err == nil {
			dm := b.memberObj(mem, false)
			out.Member = &dm
		}
	}
	// mentioned users, each with their membership in a server message
	if len(m.Mentions) > 0 {
		b.preloadUsers(m.Mentions)
		for _, id := range m.Mentions {
			mu := dMentionUser{dUser: b.userByID(id)}
			if opts.member && out.GuildID != nil {
				if mem, err := b.s.Store.Member(b.ctx, *ch.ServerID, id); err == nil {
					dm := b.memberObj(mem, false)
					mu.Member = &dm
				}
			}
			out.Mentions = append(out.Mentions, mu)
		}
	}
	// whether the viewer is shown the words at all
	shown := true
	if b.viewer != nil && b.viewer.Flags&store.FlagBot != 0 && !opts.content {
		shown = m.AuthorID == b.viewer.ID || (ch != nil && store.IsDMLike(ch.Type)) || hasID(m.Mentions, b.viewer.ID)
	}
	switch {
	case plain != nil && m.Crosspost == nil && m.Type != "system_automod":
		if plain.ApplicationID != nil {
			aid := snow(*plain.ApplicationID)
			out.ApplicationID = &aid
			if plain.Interaction != nil {
				out.WebhookID = &aid
			}
		}
		if it := plain.Interaction; it != nil {
			meta := b.interactionMetaObj(it)
			out.InteractionMetadata = meta
			out.Interaction = &dMessageInteraction{ID: snow(it.ID), Type: it.Type, Name: it.Name, User: meta.User}
		}
		if !shown {
			break
		}
		out.Content = botproto.OutText(plain.Content)
		out.TTS = plain.TTS
		out.Embeds = b.plainEmbeds(plain, m.ChannelID)
		out.Components = b.componentsOut(plain.Components, plain.Attachments, m.ChannelID)
		out.Attachments = b.plainAttachments(plain, m.ChannelID)
		if plain.Poll != nil {
			out.Poll = b.plainPoll(plain.Poll, m.Poll)
		}
		for _, st := range plain.Stickers {
			out.StickerItems = append(out.StickerItems, dStickerItem{ID: snow(st.ID), Name: st.Name, FormatType: st.FormatType})
		}
	case len(m.Ciphertext) > 0 && string(m.Ciphertext) != "null" && b.viewer != nil && b.viewer.Flags&store.FlagBot != 0:
		if !shown {
			break
		}
		p, err := b.s.decryptForBot(b.ctx, b.viewer, m, opts.copy)
		if err != nil {
			break
		}
		if p.T != nil {
			out.Content = botproto.OutText(*p.T)
		}
		out.Attachments = b.sealedAttachments(m, p.Att)
		for _, e := range p.Embeds {
			out.Embeds = append(out.Embeds, b.sealedEmbed(e))
		}
		if p.Sticker != nil {
			if sid, err := ids.Parse(p.Sticker.ID); err == nil {
				out.StickerItems = append(out.StickerItems, dStickerItem{ID: snow(sid), Name: p.Sticker.Name, FormatType: stickerFormatType(p.Sticker.Format)})
			}
		}
		if p.Poll != nil {
			out.Poll = b.sealedPoll(p.Poll, m.Poll)
		}
	}
	if m.Type == "system_call" {
		out.Call = &dCall{Participants: []snow{snow(m.AuthorID)}}
	}
	if m.Type == "crosspost" && len(m.Crosspost) > 0 {
		out.Flags |= dMsgIsCrosspost
		var src struct {
			ChannelID ids.ID `json:"channel_id"`
			ServerID  ids.ID `json:"server_id"`
			MessageID ids.ID `json:"message_id"`
		}
		if json.Unmarshal(m.Crosspost, &src) == nil && !src.ChannelID.IsZero() {
			mid := snow(src.MessageID)
			gid := snow(src.ServerID)
			out.MessageReference = &dMessageRef{Type: 0, MessageID: &mid, ChannelID: snow(src.ChannelID), GuildID: &gid}
		}
	}
	// a reply, a pin's notice and the like point at another message
	if m.ReplyToID != nil {
		ref := snow(*m.ReplyToID)
		out.MessageReference = &dMessageRef{Type: 0, MessageID: &ref, ChannelID: snow(m.ChannelID), GuildID: out.GuildID}
		if !opts.noReference && (out.Type == 19 || out.Type == 6) {
			out.ReferencedMessage = nullJSON{}
			if refd, err := b.s.Store.MessageByID(b.ctx, *m.ReplyToID, b.viewerID()); err == nil && refd.ChannelID == m.ChannelID {
				q := b.messageObj(refd, ch, msgOpts{content: opts.content, noReference: true})
				out.ReferencedMessage = q
			}
		}
	}
	if m.Thread != nil {
		out.Flags |= dMsgHasThread
		if th, err := b.s.Store.ChannelByID(b.ctx, m.Thread.ID); err == nil {
			if dc, ok := b.channelObj(th); ok {
				out.Thread = &dc
			}
		}
	}
	if len(m.Reactions) > 0 {
		out.Reactions = make([]dReaction, 0, len(m.Reactions))
		for _, r := range m.Reactions {
			out.Reactions = append(out.Reactions, dReaction{Count: r.Count, CountDetails: dReactionCount{Normal: r.Count}, Me: r.Me, Emoji: reactionEmoji(r.Emoji), BurstColors: []string{}})
		}
	}
	return out
}

// interactionMetaObj is the interaction a message answers, as the
// protocol describes it.
func (b *dBuilder) interactionMetaObj(it *wmInteraction) *dInteractionMetadata {
	meta := &dInteractionMetadata{ID: snow(it.ID), Type: it.Type, Name: it.Name, User: b.userByID(it.UserID), AuthorizingIntegrationOwners: map[string]snow{},
		OriginalResponseMessageID: botproto.SP(it.OriginalResponseMessageID), InteractedMessageID: botproto.SP(it.InteractedMessageID), TargetMessageID: botproto.SP(it.TargetMessageID)}
	if it.Type == 2 {
		ct := it.CommandType
		if ct == 0 {
			ct = 1
		}
		meta.CommandType = &ct
	}
	for k, v := range it.Owners {
		meta.AuthorizingIntegrationOwners[k] = snow(v)
	}
	if it.TargetUserID != nil {
		tu := b.userByID(*it.TargetUserID)
		meta.TargetUser = &tu
	}
	if it.Trigger != nil {
		meta.TriggeringInteractionMetadata = b.interactionMetaObj(it.Trigger)
	}
	return meta
}

// messagesObj builds a page of messages, opening their copies for the viewer
// in one lookup.
func (b *dBuilder) messagesObj(list []*store.Message, ch *store.Channel, opts msgOpts) []dMessage {
	out := make([]dMessage, 0, len(list))
	var copies map[ids.ID][]byte
	if b.viewer != nil && b.viewer.Flags&store.FlagBot != 0 && len(list) > 0 {
		msgIDs := make([]ids.ID, len(list))
		for i, m := range list {
			msgIDs[i] = m.ID
		}
		copies, _ = b.s.Store.BotCopies(b.ctx, b.viewer.ID, msgIDs)
	}
	var authors []ids.ID
	for _, m := range list {
		authors = append(authors, m.AuthorID)
	}
	b.preloadUsers(authors)
	for _, m := range list {
		o := opts
		o.copy = copies[m.ID]
		out = append(out, b.messageObj(m, ch, o))
	}
	return out
}

// botMessageContext is a background context for building a message outside
// a request, bounded like the gateway's own work.
func botMessageContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 10*time.Second)
}
