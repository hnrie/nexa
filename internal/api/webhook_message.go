package api

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"

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
	// select menus: shown, never usable (there is no app to answer them)
	Placeholder string `json:"placeholder,omitempty"`
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

// discordMessage is a webhook message as Discord's API returns one, for the
// programs that read back what they sent (wait=true, and the message routes).
func (s *Server) discordMessage(m *store.Message, serverID ids.ID) map[string]any {
	var p wmPlain
	_ = json.Unmarshal(m.Webhook, &p)
	var whID ids.ID
	if m.WebhookID != nil {
		whID = *m.WebhookID
	}
	var avatar any
	if p.AvatarID != nil {
		avatar = p.AvatarID.String()
	}
	author := map[string]any{"id": whID.String(), "username": p.Name, "avatar": avatar, "discriminator": "0000", "public_flags": 0, "flags": 0, "bot": true, "global_name": nil}
	mentions := make([]map[string]any, 0, len(m.Mentions))
	for _, id := range m.Mentions {
		mentions = append(mentions, map[string]any{"id": id.String()})
	}
	if len(m.Mentions) > 0 {
		if list, err := s.Store.UsersByIDs(context.Background(), m.Mentions); err == nil {
			mentions = mentions[:0]
			for _, u := range list {
				mentions = append(mentions, map[string]any{"id": u.ID.String(), "username": u.Username, "global_name": u.DisplayName, "avatar": nil, "discriminator": "0", "public_flags": 0})
			}
		}
	}
	roles := make([]string, 0, len(m.MentionRoles))
	for _, id := range m.MentionRoles {
		roles = append(roles, id.String())
	}
	base := strings.TrimRight(s.Cfg.PublicURL, "/")
	abs := func(u string) string {
		if strings.HasPrefix(u, "/") {
			return base + u
		}
		return u
	}
	attachments := make([]map[string]any, 0, len(p.Attachments))
	for _, a := range p.Attachments {
		// a file an embed or a component shows is part of that, not listed
		if a.Inline {
			continue
		}
		att := map[string]any{"id": a.ID.String(), "filename": a.Filename, "size": a.Size, "url": base + "/media/attachments/" + a.BlobID.String(), "proxy_url": base + "/media/attachments/" + a.BlobID.String()}
		if a.ContentType != "" {
			att["content_type"] = a.ContentType
		}
		if a.Description != "" {
			att["description"] = a.Description
		}
		if a.Title != "" {
			att["title"] = a.Title
		}
		if a.Width != nil && a.Height != nil {
			att["width"], att["height"] = *a.Width, *a.Height
		}
		if a.Spoiler {
			att["flags"] = 8
		}
		attachments = append(attachments, att)
	}
	embeds := make([]any, 0, len(p.Embeds)+len(p.LinkEmbeds))
	for _, e := range p.Embeds {
		e := e
		for _, media := range []**wmMedia{&e.Image, &e.Thumbnail} {
			if *media == nil {
				continue
			}
			m := **media
			if m.BlobID != nil {
				// what attachment://name came to: the file's own address here
				m.URL = base + "/media/attachments/" + m.BlobID.String()
				m.ProxyURL = m.URL
			} else if m.ProxyURL != "" {
				m.ProxyURL = abs(m.ProxyURL)
			}
			*media = &m
		}
		if e.Footer != nil && e.Footer.ProxyIconURL != "" {
			f := *e.Footer
			f.ProxyIconURL = abs(f.ProxyIconURL)
			e.Footer = &f
		}
		if e.Author != nil && e.Author.ProxyIconURL != "" {
			a := *e.Author
			a.ProxyIconURL = abs(a.ProxyIconURL)
			e.Author = &a
		}
		embeds = append(embeds, e)
	}
	for _, l := range p.LinkEmbeds {
		le := map[string]any{"type": map[string]string{"image": "image", "gif": "gifv", "video": "video", "youtube": "video"}[l.Type], "url": l.URL}
		if le["type"] == "" {
			le["type"] = "link"
		}
		if l.Title != "" {
			le["title"] = l.Title
		}
		if l.Description != "" {
			le["description"] = l.Description
		}
		if l.SiteName != "" {
			le["provider"] = map[string]any{"name": l.SiteName}
		}
		if l.Image != "" {
			le["thumbnail"] = map[string]any{"url": l.URL, "proxy_url": abs(l.Image), "width": l.ImageW, "height": l.ImageH}
		}
		embeds = append(embeds, le)
	}
	var edited any
	if m.EditedAt != nil {
		edited = time.UnixMilli(*m.EditedAt).UTC().Format("2006-01-02T15:04:05.000000+00:00")
	}
	out := map[string]any{
		"id": m.ID.String(), "type": 0, "content": p.Content, "channel_id": m.ChannelID.String(), "author": author,
		"attachments": attachments, "embeds": embeds, "mentions": mentions, "mention_roles": roles,
		"pinned": m.Flags&store.MsgFlagPinned != 0, "mention_everyone": m.MentionEveryone, "tts": p.TTS,
		"timestamp": time.UnixMilli(m.CreatedAt).UTC().Format("2006-01-02T15:04:05.000000+00:00"), "edited_timestamp": edited,
		"flags": m.Flags &^ store.MsgFlagPinned, "components": nonNilComponents(p.Components), "webhook_id": whID.String(),
	}
	if p.Poll != nil {
		poll := map[string]any{"question": p.Poll.Question, "answers": p.Poll.Answers, "expiry": p.Poll.Expiry, "allow_multiselect": p.Poll.AllowMultiselect, "layout_type": p.Poll.LayoutType}
		if m.Poll != nil {
			counts := make([]map[string]any, 0, len(m.Poll.Counts))
			for _, c := range m.Poll.Counts {
				if c.Count > 0 {
					counts = append(counts, map[string]any{"id": c.ID, "count": c.Count, "me_voted": false})
				}
			}
			poll["results"] = map[string]any{"is_finalized": m.Poll.Finalized, "answer_counts": counts}
		}
		out["poll"] = poll
	}
	if !serverID.IsZero() {
		out["guild_id"] = serverID.String()
	}
	return out
}

func nonNilComponents(list []wmComponent) []wmComponent {
	if list == nil {
		return []wmComponent{}
	}
	return list
}
