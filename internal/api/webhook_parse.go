package api

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// Discord's limits for what a webhook sends, which programs written for its
// webhooks are built around.
const (
	whMaxContent       = 2000
	whMaxEmbeds        = 10
	whMaxEmbedTotal    = 6000
	whMaxTitle         = 256
	whMaxDescription   = 4096
	whMaxFields        = 25
	whMaxFieldName     = 256
	whMaxFieldValue    = 1024
	whMaxFooter        = 2048
	whMaxAuthorName    = 256
	whMaxName          = 80
	whMaxURL           = 2048
	whMaxFiles         = 10
	whMaxAltText       = 1024
	whMaxComponents    = 40
	whMaxTopRows       = 5
	whMaxTextDisplay   = 4000
	whMaxButtonLabel   = 80
	whMaxButtonURL     = 512
	whMaxPollQuestion  = 300
	whMaxPollAnswer    = 55
	whMaxPollAnswers   = 10
	whMaxPollHours     = 32 * 24
	whDefaultPollHours = 24
	whMaxMentionIDs    = 100
	whMaxColor         = 0xFFFFFF
)

// whInput is an Execute or Edit Webhook request, read and checked. Present
// says which fields the request had at all, which an edit needs: a field
// left out stays as it was, a field sent as null is cleared.
type whInput struct {
	Present    map[string]bool
	Content    string
	Username   string
	AvatarURL  string
	TTS        bool
	Embeds     []wmEmbed
	Components []wmComponent
	Poll       *wmPoll
	PollHours  int
	Flags      int64
	Mentions   *allowedMentions
	Attach     []whAttachReq
	ThreadName string
}

// whAttachReq is one entry of the request's attachments: metadata for a
// file sent with it (ID is the n of files[n]) or, in an edit, an existing
// attachment to keep (ID is its id).
type whAttachReq struct {
	ID          string
	Filename    string
	Title       string
	Description string
	HasDesc     bool
	Spoiler     *bool
}

type whParseOpts struct {
	edit bool
	// components are only read when the caller asks (with_components=true),
	// or the message is laid out by them, as Discord's own webhooks do
	withComponents bool
}

// messageFlags a webhook may set: suppress embeds, no notifications, and a
// message laid out by components.
const whAllowedFlags = store.MsgFlagSuppressEmbeds | store.MsgFlagSuppressNotifications | store.MsgFlagComponentsV2

// fieldPath builds a path for formErrors from mixed names and indexes.
func fieldPath(parts ...any) []string {
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		switch v := p.(type) {
		case string:
			out = append(out, v)
		case int:
			out = append(out, strconv.Itoa(v))
		case []string:
			out = append(out, v...)
		}
	}
	return out
}

// jsonReader reads loosely typed JSON the way Discord does: a number where a
// string belongs is taken as its digits, "true" as true, and so on; anything
// that cannot be taken as the right type is recorded in errs.
type jsonReader struct{ errs *formErrors }

func (r jsonReader) str(obj map[string]any, key string, path []string) (string, bool) {
	v, ok := obj[key]
	if !ok || v == nil {
		return "", false
	}
	switch x := v.(type) {
	case string:
		return x, true
	case json.Number:
		return x.String(), true
	case bool:
		return strconv.FormatBool(x), true
	case int:
		return strconv.Itoa(x), true
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64), true
	}
	r.errs.add(append(path, key), "STRING_TYPE_CONVERT", "Could not interpret the value as string.")
	return "", false
}

func (r jsonReader) boolean(obj map[string]any, key string, path []string) (bool, bool) {
	v, ok := obj[key]
	if !ok || v == nil {
		return false, false
	}
	switch x := v.(type) {
	case bool:
		return x, true
	case string:
		switch strings.ToLower(strings.TrimSpace(x)) {
		case "true", "1", "yes":
			return true, true
		case "false", "0", "no", "":
			return false, true
		}
	case json.Number:
		if x.String() == "0" || x.String() == "1" {
			return x.String() == "1", true
		}
	}
	r.errs.add(append(path, key), "BASE_TYPE_BOOLEAN", "Must be either true or false.")
	return false, false
}

func (r jsonReader) integer(obj map[string]any, key string, path []string) (int64, bool) {
	v, ok := obj[key]
	if !ok || v == nil {
		return 0, false
	}
	var s string
	switch x := v.(type) {
	case json.Number:
		s = x.String()
	case int:
		return int64(x), true
	case int64:
		return x, true
	case float64:
		s = strconv.FormatFloat(x, 'f', -1, 64)
	case string:
		s = strings.TrimSpace(x)
	case bool:
		r.errs.add(append(path, key), "NUMBER_TYPE_COERCE", fmt.Sprintf("Value \"%v\" is not int.", x))
		return 0, false
	default:
		r.errs.add(append(path, key), "NUMBER_TYPE_COERCE", "Value is not int.")
		return 0, false
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		// 12.0 is an int written as a float; 12.5 is not
		if f, ferr := strconv.ParseFloat(s, 64); ferr == nil && f == math.Trunc(f) && math.Abs(f) < 1<<53 {
			return int64(f), true
		}
		r.errs.add(append(path, key), "NUMBER_TYPE_COERCE", fmt.Sprintf("Value \"%s\" is not int.", truncate(s, 40)))
		return 0, false
	}
	return n, true
}

func (r jsonReader) object(obj map[string]any, key string, path []string) (map[string]any, bool) {
	v, ok := obj[key]
	if !ok || v == nil {
		return nil, false
	}
	m, ok := v.(map[string]any)
	if !ok {
		r.errs.add(append(path, key), "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
		return nil, false
	}
	return m, true
}

func (r jsonReader) list(obj map[string]any, key string, path []string) ([]any, bool) {
	v, ok := obj[key]
	if !ok || v == nil {
		return nil, false
	}
	l, ok := v.([]any)
	if !ok {
		r.errs.add(append(path, key), "LIST_TYPE_CONVERT", "Only iterables may be used in a ListType")
		return nil, false
	}
	return l, true
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n]) + "…"
}

// clean strips what does not belong in text (control characters other than
// newlines and tabs) and the whitespace around it, as Discord trims embeds.
func clean(s string) string {
	out, _ := CleanText(s, 1<<20)
	return out
}

func (r jsonReader) maxLen(s string, max int, path []string) {
	if utf8.RuneCountInString(s) > max {
		r.errs.add(path, "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("Must be %d or fewer in length.", max))
	}
}

// webURL checks a link a reader may follow: http or https, well formed.
func (r jsonReader) webURL(raw string, path []string, attachments bool) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if len(raw) > whMaxURL {
		r.errs.add(path, "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("Must be %d or fewer in length.", whMaxURL))
		return ""
	}
	if attachments && strings.HasPrefix(strings.ToLower(raw), "attachment://") {
		if len(raw) == len("attachment://") {
			r.errs.add(path, "URL_TYPE_INVALID_URL", "Not a well formed URL.")
			return ""
		}
		return "attachment://" + raw[len("attachment://"):]
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || strings.ContainsAny(raw, " \t\r\n") {
		r.errs.add(path, "URL_TYPE_INVALID_URL", "Not a well formed URL.")
		return ""
	}
	if s := strings.ToLower(u.Scheme); s != "http" && s != "https" {
		r.errs.add(path, "URL_TYPE_INVALID_SCHEME", fmt.Sprintf("Scheme \"%s\" is not supported. Scheme must be one of ('http', 'https').", truncate(u.Scheme, 20)))
		return ""
	}
	return raw
}

// parseWebhookBody reads an Execute Webhook (or, with opts.edit, an Edit
// Webhook Message) body.
func parseWebhookBody(raw map[string]any, opts whParseOpts) (*whInput, *formErrors) {
	errs := &formErrors{}
	r := jsonReader{errs}
	in := &whInput{Present: map[string]bool{}}
	for k := range raw {
		in.Present[k] = true
	}
	if s, ok := r.str(raw, "content", nil); ok {
		in.Content = clean(s)
		r.maxLen(in.Content, whMaxContent, fieldPath("content"))
	}
	if !opts.edit {
		if s, ok := r.str(raw, "username", nil); ok {
			name := strings.TrimSpace(clean(s))
			if name != "" {
				if n := utf8.RuneCountInString(name); n > whMaxName {
					errs.add(fieldPath("username"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", whMaxName))
				} else if reservedDisplayName(name) {
					errs.add(fieldPath("username"), "USERNAME_INVALID_CONTAINS", "That name belongs to the instance's own account.")
				}
				in.Username = strings.Join(strings.Fields(name), " ")
			}
		}
		if s, ok := r.str(raw, "avatar_url", nil); ok {
			in.AvatarURL = r.webURL(s, fieldPath("avatar_url"), false)
		}
		if b, ok := r.boolean(raw, "tts", nil); ok {
			in.TTS = b
		}
		if s, ok := r.str(raw, "thread_name", nil); ok && strings.TrimSpace(s) != "" {
			in.ThreadName = s
		}
	}
	if f, ok := r.integer(raw, "flags", nil); ok {
		in.Flags = f & whAllowedFlags
	}
	v2 := in.Flags&store.MsgFlagComponentsV2 != 0
	if list, ok := r.list(raw, "embeds", nil); ok {
		in.Embeds = parseEmbeds(r, list)
	}
	if am, ok := r.object(raw, "allowed_mentions", nil); ok {
		in.Mentions = parseAllowedMentions(r, am)
	}
	if list, ok := r.list(raw, "components", nil); ok && (opts.withComponents || v2) {
		in.Components = parseComponents(r, list, v2)
	}
	if list, ok := r.list(raw, "attachments", nil); ok {
		in.Attach = parseAttachReqs(r, list)
	}
	if !opts.edit {
		if p, ok := r.object(raw, "poll", nil); ok {
			in.Poll, in.PollHours = parsePoll(r, p)
		}
	}
	if v2 {
		for _, k := range []string{"content", "embeds", "poll", "sticker_ids"} {
			if in.Present[k] && !isEmptyValue(raw[k]) {
				errs.add(fieldPath(k), "MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2", "The IS_COMPONENTS_V2 flag cannot be used with content, embeds, polls or stickers.")
			}
		}
	}
	return in, errs
}

func isEmptyValue(v any) bool {
	switch x := v.(type) {
	case nil:
		return true
	case string:
		return x == ""
	case []any:
		return len(x) == 0
	}
	return false
}

func parseAllowedMentions(r jsonReader, am map[string]any) *allowedMentions {
	out := &allowedMentions{set: true, Parse: []string{}, Users: []ids.ID{}, Roles: []ids.ID{}}
	path := fieldPath("allowed_mentions")
	if list, ok := r.list(am, "parse", path); ok {
		for i, v := range list {
			s, _ := v.(string)
			switch s {
			case "users", "roles", "everyone":
				out.Parse = append(out.Parse, s)
			default:
				r.errs.add(fieldPath(path, "parse", i), "BASE_TYPE_CHOICES", "Value must be one of {'users', 'roles', 'everyone'}.")
			}
		}
	}
	readIDs := func(key string) []ids.ID {
		list, ok := r.list(am, key, path)
		if !ok {
			return []ids.ID{}
		}
		if len(list) > whMaxMentionIDs {
			r.errs.add(fieldPath(path, key), "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("Must be %d or fewer in length.", whMaxMentionIDs))
			return []ids.ID{}
		}
		out := []ids.ID{}
		for i, v := range list {
			var s string
			switch x := v.(type) {
			case string:
				s = x
			case json.Number:
				s = x.String()
			}
			id, err := ids.Parse(s)
			if err != nil || id.IsZero() {
				r.errs.add(fieldPath(path, key, i), "NUMBER_TYPE_COERCE", fmt.Sprintf("Value \"%s\" is not snowflake.", truncate(s, 30)))
				continue
			}
			out = append(out, id)
		}
		return dedupeIDs(out, whMaxMentionIDs)
	}
	out.Users, out.Roles = readIDs("users"), readIDs("roles")
	if out.parses("users") && len(out.Users) > 0 {
		r.errs.add(path, "MESSAGE_ALLOWED_MENTIONS_PARSE_EXCLUSIVE", "parse:[\"users\"] and users: [ids...] are mutually exclusive.")
	}
	if out.parses("roles") && len(out.Roles) > 0 {
		r.errs.add(path, "MESSAGE_ALLOWED_MENTIONS_PARSE_EXCLUSIVE", "parse:[\"roles\"] and roles: [ids...] are mutually exclusive.")
	}
	return out
}

// parseTimestamp reads an ISO 8601 time, in any of the ways programs write
// one, and writes it back in one form.
func parseTimestamp(s string) (string, bool) {
	s = strings.TrimSpace(s)
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.999999999", "2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02 15:04:05Z07:00", "2006-01-02 15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC().Format("2006-01-02T15:04:05.000Z"), true
		}
	}
	return "", false
}

func parseEmbeds(r jsonReader, list []any) []wmEmbed {
	if len(list) > whMaxEmbeds {
		r.errs.add(fieldPath("embeds"), "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("Must be %d or fewer in length.", whMaxEmbeds))
		list = list[:whMaxEmbeds]
	}
	out := make([]wmEmbed, 0, len(list))
	total := 0
	for i, v := range list {
		path := fieldPath("embeds", i)
		obj, ok := v.(map[string]any)
		if !ok {
			r.errs.add(path, "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
			continue
		}
		e := wmEmbed{Type: "rich"}
		text := func(key string, max int) string {
			s, ok := r.str(obj, key, path)
			if !ok {
				return ""
			}
			s = clean(s)
			r.maxLen(s, max, fieldPath(path, key))
			total += utf8.RuneCountInString(s)
			return s
		}
		e.Title = text("title", whMaxTitle)
		e.Description = text("description", whMaxDescription)
		if s, ok := r.str(obj, "url", path); ok {
			e.URL = r.webURL(s, fieldPath(path, "url"), false)
		}
		if s, ok := r.str(obj, "timestamp", path); ok && strings.TrimSpace(s) != "" {
			if ts, ok := parseTimestamp(s); ok {
				e.Timestamp = ts
			} else {
				r.errs.add(fieldPath(path, "timestamp"), "DATE_TYPE_PARSE", fmt.Sprintf("Could not parse %s. Should be ISO8601.", truncate(s, 40)))
			}
		}
		if c, ok := r.integer(obj, "color", path); ok {
			switch {
			case c < 0:
				r.errs.add(fieldPath(path, "color"), "NUMBER_TYPE_MIN", "int value should be greater than or equal to 0.")
			case c > whMaxColor:
				r.errs.add(fieldPath(path, "color"), "NUMBER_TYPE_MAX", fmt.Sprintf("int value should be less than or equal to %d.", whMaxColor))
			default:
				n := int(c)
				e.Color = &n
			}
		}
		if f, ok := r.object(obj, "footer", path); ok {
			fp := fieldPath(path, "footer")
			s, _ := r.str(f, "text", fp)
			s = clean(s)
			if s == "" {
				r.errs.add(fieldPath(fp, "text"), "BASE_TYPE_REQUIRED", "This field is required")
			} else {
				r.maxLen(s, whMaxFooter, fieldPath(fp, "text"))
				total += utf8.RuneCountInString(s)
				e.Footer = &wmFooter{Text: s}
				if u, ok := r.str(f, "icon_url", fp); ok {
					e.Footer.IconURL = r.webURL(u, fieldPath(fp, "icon_url"), true)
				}
			}
		}
		if a, ok := r.object(obj, "author", path); ok {
			ap := fieldPath(path, "author")
			s, _ := r.str(a, "name", ap)
			s = clean(s)
			if s == "" {
				r.errs.add(fieldPath(ap, "name"), "BASE_TYPE_REQUIRED", "This field is required")
			} else {
				r.maxLen(s, whMaxAuthorName, fieldPath(ap, "name"))
				total += utf8.RuneCountInString(s)
				e.Author = &wmAuthor{Name: s}
				if u, ok := r.str(a, "url", ap); ok {
					e.Author.URL = r.webURL(u, fieldPath(ap, "url"), false)
				}
				if u, ok := r.str(a, "icon_url", ap); ok {
					e.Author.IconURL = r.webURL(u, fieldPath(ap, "icon_url"), true)
				}
			}
		}
		for _, key := range []string{"image", "thumbnail"} {
			m, ok := r.object(obj, key, path)
			if !ok {
				continue
			}
			mp := fieldPath(path, key)
			u, _ := r.str(m, "url", mp)
			u = r.webURL(u, fieldPath(mp, "url"), true)
			if u == "" {
				continue
			}
			media := &wmMedia{URL: u}
			if d, ok := r.str(m, "description", mp); ok {
				media.Description = clean(d)
				r.maxLen(media.Description, whMaxAltText, fieldPath(mp, "description"))
			}
			if key == "image" {
				e.Image = media
			} else {
				e.Thumbnail = media
			}
		}
		// a provider and a video are for link previews; a webhook's are ignored
		if fl, ok := r.list(obj, "fields", path); ok {
			if len(fl) > whMaxFields {
				r.errs.add(fieldPath(path, "fields"), "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("Must be %d or fewer in length.", whMaxFields))
				fl = fl[:whMaxFields]
			}
			for j, fv := range fl {
				fp := fieldPath(path, "fields", j)
				fo, ok := fv.(map[string]any)
				if !ok {
					r.errs.add(fp, "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
					continue
				}
				name, _ := r.str(fo, "name", fp)
				value, _ := r.str(fo, "value", fp)
				name, value = clean(name), clean(value)
				if name == "" {
					r.errs.add(fieldPath(fp, "name"), "BASE_TYPE_REQUIRED", "This field is required")
				}
				if value == "" {
					r.errs.add(fieldPath(fp, "value"), "BASE_TYPE_REQUIRED", "This field is required")
				}
				r.maxLen(name, whMaxFieldName, fieldPath(fp, "name"))
				r.maxLen(value, whMaxFieldValue, fieldPath(fp, "value"))
				total += utf8.RuneCountInString(name) + utf8.RuneCountInString(value)
				inline, _ := r.boolean(fo, "inline", fp)
				e.Fields = append(e.Fields, wmField{Name: name, Value: value, Inline: inline})
			}
		}
		if e.Title == "" && e.Description == "" && len(e.Fields) == 0 && e.Author == nil && e.Footer == nil && e.Image == nil && e.Thumbnail == nil {
			r.errs.add(fieldPath(path, "description"), "BASE_TYPE_REQUIRED", "This field is required")
			continue
		}
		out = append(out, e)
	}
	if total > whMaxEmbedTotal {
		r.errs.add(fieldPath("embeds"), "MAX_EMBED_SIZE_EXCEEDED", fmt.Sprintf("Embed size exceeds maximum size of %d", whMaxEmbedTotal))
	}
	return out
}

func parseWMEmoji(r jsonReader, obj map[string]any, path []string) *wmEmoji {
	e, ok := r.object(obj, "emoji", path)
	if !ok {
		return nil
	}
	ep := fieldPath(path, "emoji")
	out := &wmEmoji{}
	if s, ok := r.str(e, "id", ep); ok && s != "" {
		id, err := ids.Parse(s)
		if err != nil {
			r.errs.add(fieldPath(ep, "id"), "NUMBER_TYPE_COERCE", fmt.Sprintf("Value \"%s\" is not snowflake.", truncate(s, 30)))
		} else {
			out.ID = &id
		}
	}
	if s, ok := r.str(e, "name", ep); ok {
		out.Name = truncate(clean(s), 32)
	}
	out.Animated, _ = r.boolean(e, "animated", ep)
	if out.ID == nil && out.Name == "" {
		return nil
	}
	return out
}

// parseComponents reads a message's components. A message laid out by them
// (v2) takes every non-interactive kind at the top; one that is not takes
// rows of buttons under its content. Only link buttons can work without an
// app to answer the others, so only they are taken, as Discord takes them
// from webhooks no app owns.
func parseComponents(r jsonReader, list []any, v2 bool) []wmComponent {
	count, textLen, nextID := 0, 0, 1
	var one func(v any, path []string, allowed map[int]bool, depth int) (wmComponent, bool)
	one = func(v any, path []string, allowed map[int]bool, depth int) (wmComponent, bool) {
		obj, ok := v.(map[string]any)
		if !ok {
			r.errs.add(path, "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
			return wmComponent{}, false
		}
		t, ok := r.integer(obj, "type", path)
		if !ok {
			r.errs.add(fieldPath(path, "type"), "BASE_TYPE_REQUIRED", "This field is required")
			return wmComponent{}, false
		}
		c := wmComponent{Type: int(t)}
		if !allowed[c.Type] {
			switch c.Type {
			case compButton, compStringSel, compUserSel, compRoleSel, compMentionSel, compChannelSel, compActionRow, compSection, compTextDisplay, compThumbnail, compGallery, compFile, compSeparator, compContainer:
				r.errs.add(fieldPath(path, "type"), "COMPONENT_LAYOUT_INVALID", fmt.Sprintf("Component type %d is not allowed here.", c.Type))
			default:
				r.errs.add(fieldPath(path, "type"), "BASE_TYPE_CHOICES", fmt.Sprintf("Value must be one of known component types, not %d.", c.Type))
			}
			return wmComponent{}, false
		}
		count++
		if id, ok := r.integer(obj, "id", path); ok && id > 0 && id <= math.MaxInt32 {
			c.ID = int(id)
		} else {
			c.ID = nextID
		}
		if c.ID >= nextID {
			nextID = c.ID + 1
		}
		children := func(key string, childAllowed map[int]bool, min, max int) []wmComponent {
			l, ok := r.list(obj, key, path)
			if !ok || len(l) < min {
				r.errs.add(fieldPath(path, key), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between %d and %d in length.", min, max))
				return nil
			}
			if len(l) > max {
				r.errs.add(fieldPath(path, key), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between %d and %d in length.", min, max))
				l = l[:max]
			}
			out := make([]wmComponent, 0, len(l))
			for i, cv := range l {
				if child, ok := one(cv, fieldPath(path, key, i), childAllowed, depth+1); ok {
					out = append(out, child)
				}
			}
			return out
		}
		media := func(obj map[string]any, key string, path []string, attachmentsOnly bool) *wmMedia {
			m, ok := r.object(obj, key, path)
			if !ok {
				r.errs.add(fieldPath(path, key), "BASE_TYPE_REQUIRED", "This field is required")
				return nil
			}
			u, _ := r.str(m, "url", fieldPath(path, key))
			u = r.webURL(u, fieldPath(path, key, "url"), true)
			if u == "" {
				r.errs.add(fieldPath(path, key, "url"), "BASE_TYPE_REQUIRED", "This field is required")
				return nil
			}
			if attachmentsOnly && !strings.HasPrefix(u, "attachment://") {
				r.errs.add(fieldPath(path, key, "url"), "UNFURLED_MEDIA_ITEM_ATTACHMENT_ONLY", "Only attachment:// references are supported here.")
				return nil
			}
			return &wmMedia{URL: u}
		}
		switch c.Type {
		case compActionRow:
			c.Components = children("components", map[int]bool{compButton: true}, 1, 5)
		case compButton:
			style, _ := r.integer(obj, "style", path)
			c.Style = int(style)
			if c.Style != btnLink {
				r.errs.add(fieldPath(path, "style"), "COMPONENT_INVALID_STYLE", "Only link buttons can be sent by a webhook no app owns.")
				return wmComponent{}, false
			}
			if s, ok := r.str(obj, "label", path); ok {
				c.Label = clean(s)
				r.maxLen(c.Label, whMaxButtonLabel, fieldPath(path, "label"))
			}
			c.Emoji = parseWMEmoji(r, obj, path)
			if c.Label == "" && c.Emoji == nil {
				r.errs.add(fieldPath(path, "label"), "BASE_TYPE_REQUIRED", "A button needs a label or an emoji.")
			}
			u, _ := r.str(obj, "url", path)
			if len(u) > whMaxButtonURL {
				r.errs.add(fieldPath(path, "url"), "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("Must be %d or fewer in length.", whMaxButtonURL))
			}
			c.URL = r.webURL(u, fieldPath(path, "url"), false)
			if c.URL == "" {
				r.errs.add(fieldPath(path, "url"), "BASE_TYPE_REQUIRED", "This field is required")
			}
			c.Disabled, _ = r.boolean(obj, "disabled", path)
		case compSection:
			c.Components = children("components", map[int]bool{compTextDisplay: true}, 1, 3)
			acc, ok := r.object(obj, "accessory", path)
			if !ok {
				r.errs.add(fieldPath(path, "accessory"), "BASE_TYPE_REQUIRED", "This field is required")
				break
			}
			if a, ok := one(acc, fieldPath(path, "accessory"), map[int]bool{compButton: true, compThumbnail: true}, depth+1); ok {
				c.Accessory = &a
			}
		case compTextDisplay:
			s, _ := r.str(obj, "content", path)
			c.Content = clean(s)
			if c.Content == "" {
				r.errs.add(fieldPath(path, "content"), "BASE_TYPE_REQUIRED", "This field is required")
			}
			textLen += utf8.RuneCountInString(c.Content)
		case compThumbnail:
			c.Media = media(obj, "media", path, false)
			if d, ok := r.str(obj, "description", path); ok {
				c.Description = clean(d)
				r.maxLen(c.Description, whMaxAltText, fieldPath(path, "description"))
			}
			c.Spoiler, _ = r.boolean(obj, "spoiler", path)
		case compGallery:
			l, ok := r.list(obj, "items", path)
			if !ok || len(l) < 1 || len(l) > 10 {
				r.errs.add(fieldPath(path, "items"), "BASE_TYPE_BAD_LENGTH", "Must be between 1 and 10 in length.")
				if len(l) > 10 {
					l = l[:10]
				}
			}
			for i, iv := range l {
				ip := fieldPath(path, "items", i)
				io, ok := iv.(map[string]any)
				if !ok {
					r.errs.add(ip, "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
					continue
				}
				m := media(io, "media", ip, false)
				if m == nil {
					continue
				}
				item := wmGalleryItem{Media: *m}
				if d, ok := r.str(io, "description", ip); ok {
					item.Description = clean(d)
					r.maxLen(item.Description, whMaxAltText, fieldPath(ip, "description"))
				}
				item.Spoiler, _ = r.boolean(io, "spoiler", ip)
				c.Items = append(c.Items, item)
			}
		case compFile:
			c.File = media(obj, "file", path, true)
			c.Spoiler, _ = r.boolean(obj, "spoiler", path)
		case compSeparator:
			if d, ok := r.boolean(obj, "divider", path); ok {
				c.Divider = &d
			}
			if sp, ok := r.integer(obj, "spacing", path); ok {
				if sp != 1 && sp != 2 {
					r.errs.add(fieldPath(path, "spacing"), "BASE_TYPE_CHOICES", "Value must be one of {1, 2}.")
				}
				c.Spacing = int(sp)
			}
		case compContainer:
			c.Components = children("components", map[int]bool{compActionRow: true, compTextDisplay: true, compSection: true, compGallery: true, compSeparator: true, compFile: true}, 1, whMaxComponents)
			if ac, ok := r.integer(obj, "accent_color", path); ok {
				if ac < 0 || ac > whMaxColor {
					r.errs.add(fieldPath(path, "accent_color"), "NUMBER_TYPE_MAX", fmt.Sprintf("int value should be less than or equal to %d.", whMaxColor))
				} else {
					n := int(ac)
					c.AccentColor = &n
				}
			}
			c.Spoiler, _ = r.boolean(obj, "spoiler", path)
		}
		return c, true
	}
	top := map[int]bool{compActionRow: true}
	max := whMaxTopRows
	if v2 {
		top = map[int]bool{compActionRow: true, compSection: true, compTextDisplay: true, compGallery: true, compFile: true, compSeparator: true, compContainer: true}
		max = whMaxComponents
	}
	if len(list) > max {
		r.errs.add(fieldPath("components"), "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("Must be %d or fewer in length.", max))
		list = list[:max]
	}
	out := make([]wmComponent, 0, len(list))
	for i, v := range list {
		if c, ok := one(v, fieldPath("components", i), top, 0); ok {
			out = append(out, c)
		}
	}
	if count > whMaxComponents {
		r.errs.add(fieldPath("components"), "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("A message can have at most %d components.", whMaxComponents))
	}
	if textLen > whMaxTextDisplay {
		r.errs.add(fieldPath("components"), "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("The text of a message's components must be %d or fewer in length.", whMaxTextDisplay))
	}
	return out
}

func parsePoll(r jsonReader, p map[string]any) (*wmPoll, int) {
	path := fieldPath("poll")
	out := &wmPoll{LayoutType: 1}
	q, ok := r.object(p, "question", path)
	if ok {
		s, _ := r.str(q, "text", fieldPath(path, "question"))
		out.Question.Text = clean(s)
	}
	if out.Question.Text == "" {
		r.errs.add(fieldPath(path, "question", "text"), "BASE_TYPE_REQUIRED", "This field is required")
	}
	r.maxLen(out.Question.Text, whMaxPollQuestion, fieldPath(path, "question", "text"))
	list, _ := r.list(p, "answers", path)
	if len(list) < 1 || len(list) > whMaxPollAnswers {
		r.errs.add(fieldPath(path, "answers"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", whMaxPollAnswers))
		if len(list) > whMaxPollAnswers {
			list = list[:whMaxPollAnswers]
		}
	}
	for i, v := range list {
		ap := fieldPath(path, "answers", i)
		a, ok := v.(map[string]any)
		if !ok {
			r.errs.add(ap, "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
			continue
		}
		pm, ok := r.object(a, "poll_media", ap)
		if !ok {
			r.errs.add(fieldPath(ap, "poll_media"), "BASE_TYPE_REQUIRED", "This field is required")
			continue
		}
		mp := fieldPath(ap, "poll_media")
		s, _ := r.str(pm, "text", mp)
		answer := wmPollAnswer{AnswerID: len(out.Answers) + 1, PollMedia: wmPollMedia{Text: clean(s), Emoji: parseWMEmoji(r, pm, mp)}}
		if answer.PollMedia.Text == "" {
			r.errs.add(fieldPath(mp, "text"), "BASE_TYPE_REQUIRED", "This field is required")
		}
		r.maxLen(answer.PollMedia.Text, whMaxPollAnswer, fieldPath(mp, "text"))
		out.Answers = append(out.Answers, answer)
	}
	hours := whDefaultPollHours
	if d, ok := r.integer(p, "duration", path); ok {
		if d < 1 || d > whMaxPollHours {
			r.errs.add(fieldPath(path, "duration"), "NUMBER_TYPE_MAX", fmt.Sprintf("int value should be between 1 and %d.", whMaxPollHours))
		} else {
			hours = int(d)
		}
	}
	out.AllowMultiselect, _ = r.boolean(p, "allow_multiselect", path)
	if lt, ok := r.integer(p, "layout_type", path); ok && lt != 1 {
		r.errs.add(fieldPath(path, "layout_type"), "BASE_TYPE_CHOICES", "Value must be one of {1}.")
	}
	return out, hours
}

func parseAttachReqs(r jsonReader, list []any) []whAttachReq {
	out := make([]whAttachReq, 0, len(list))
	for i, v := range list {
		path := fieldPath("attachments", i)
		obj, ok := v.(map[string]any)
		if !ok {
			r.errs.add(path, "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
			continue
		}
		a := whAttachReq{}
		a.ID, _ = r.str(obj, "id", path)
		a.ID = strings.TrimSpace(a.ID)
		if a.ID == "" {
			r.errs.add(fieldPath(path, "id"), "BASE_TYPE_REQUIRED", "This field is required")
			continue
		}
		if s, ok := r.str(obj, "filename", path); ok {
			a.Filename = cleanFilename(s)
		}
		if s, ok := r.str(obj, "title", path); ok {
			a.Title = truncate(clean(s), 256)
		}
		if s, ok := r.str(obj, "description", path); ok {
			a.Description, a.HasDesc = clean(s), true
			r.maxLen(a.Description, whMaxAltText, fieldPath(path, "description"))
		}
		if b, ok := r.boolean(obj, "is_spoiler", path); ok {
			a.Spoiler = &b
		}
		out = append(out, a)
	}
	return out
}

// cleanFilename keeps a file name to its last path part, without anything
// that is not a character, at a length a name can be.
func cleanFilename(s string) string {
	s = strings.ReplaceAll(s, "\\", "/")
	if i := strings.LastIndex(s, "/"); i >= 0 {
		s = s[i+1:]
	}
	s = strings.TrimSpace(clean(s))
	s = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return ' '
		}
		return r
	}, s)
	if s == "" || s == "." || s == ".." {
		s = "file"
	}
	return truncate(s, 200)
}
