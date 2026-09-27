package e2ee

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"slices"
	"strings"
)

// Payload is a decrypted message payload, a JSON object. Its members are kept
// as raw JSON in their original order, so members this package does not know
// (the payload gains some over time) survive a decrypt and re-encrypt
// untouched, and a payload a browser wrote marshals back to the same bytes.
//
// The typed getters read a member the way the web client's sanitizer
// (sanitizePayload in web/src/crypto/message.ts) does: a member of the wrong
// type reads as absent, and invalid list entries are skipped. The setters
// write a member as JSON.stringify would. The zero value is an empty payload.
type Payload struct {
	keys []string
	vals map[string]json.RawMessage
}

// NewPayload is an empty payload.
func NewPayload() *Payload { return &Payload{} }

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// ParsePayload reads a payload the way the web client does
// (JSON.parse(new TextDecoder().decode(b))): a JSON object, optionally after a
// byte order mark. A member named twice keeps its first place and its last
// value.
func ParsePayload(b []byte) (*Payload, error) {
	dec := json.NewDecoder(bytes.NewReader(bytes.TrimPrefix(b, utf8BOM)))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil, errors.New("e2ee: a payload is a JSON object")
	}
	p := NewPayload()
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, fmt.Errorf("e2ee: payload: %w", err)
		}
		key, ok := tok.(string)
		if !ok {
			return nil, errors.New("e2ee: payload: a member name is not a string")
		}
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return nil, fmt.Errorf("e2ee: payload: %w", err)
		}
		p.put(key, raw)
	}
	if tok, err := dec.Token(); err != nil || tok != json.Delim('}') {
		return nil, errors.New("e2ee: payload: the object is not closed")
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, errors.New("e2ee: payload: something follows the object")
	}
	return p, nil
}

// MarshalJSON writes the members in order, each value as it was read or set.
func (p *Payload) MarshalJSON() ([]byte, error) {
	if p == nil {
		return []byte("null"), nil
	}
	b := []byte{'{'}
	for i, k := range p.keys {
		if i > 0 {
			b = append(b, ',')
		}
		b = append(appendJSString(b, k), ':')
		b = append(b, p.vals[k]...)
	}
	return append(b, '}'), nil
}

// UnmarshalJSON is ParsePayload.
func (p *Payload) UnmarshalJSON(b []byte) error {
	q, err := ParsePayload(b)
	if err != nil {
		return err
	}
	*p = *q
	return nil
}

func (p *Payload) put(key string, raw []byte) {
	if p.vals == nil {
		p.vals = map[string]json.RawMessage{}
	}
	if _, ok := p.vals[key]; !ok {
		p.keys = append(p.keys, key)
	}
	p.vals[key] = raw
}

// Keys lists the member names in order.
func (p *Payload) Keys() []string { return slices.Clone(p.keys) }

// Raw is a member's JSON as it stands.
func (p *Payload) Raw(key string) (json.RawMessage, bool) {
	v, ok := p.vals[key]
	return slices.Clone(v), ok
}

// SetRaw sets a member to a JSON value, which must be valid.
func (p *Payload) SetRaw(key string, value json.RawMessage) error {
	var buf bytes.Buffer
	if err := json.Compact(&buf, value); err != nil {
		return fmt.Errorf("e2ee: payload member %q: %w", key, err)
	}
	p.put(key, buf.Bytes())
	return nil
}

// Delete removes a member.
func (p *Payload) Delete(key string) {
	if _, ok := p.vals[key]; !ok {
		return
	}
	delete(p.vals, key)
	p.keys = slices.DeleteFunc(p.keys, func(k string) bool { return k == key })
}

// Text is the message text, member "t".
func (p *Payload) Text() (string, bool) { return jsonString(p.vals["t"]) }

// SetText sets the message text.
func (p *Payload) SetText(s string) { p.put("t", appendJSString(nil, s)) }

// Flags is member "flags", any finite number.
func (p *Payload) Flags() (float64, bool) { return jsonNumber(p.vals["flags"]) }

// SetFlags sets member "flags".
func (p *Payload) SetFlags(f float64) error {
	b, err := appendJSNumber(nil, f)
	if err != nil {
		return err
	}
	p.put("flags", b)
	return nil
}

// Attachment is an encrypted file in a message (AttachmentMeta in
// message.ts). A payload sealed by a sender only ever holds encrypted files,
// so the "plain" and "alt" members of webhook files are never read from one.
type Attachment struct {
	BlobID   string
	Name     string
	Type     string
	Size     int64 // of the plaintext
	W, H     *float64
	Key      string // base64 of the file key
	Spoiler  *bool
	Duration *float64
}

// FileKey is the decoded file key.
func (a Attachment) FileKey() ([]byte, error) {
	k, err := unb64(a.Key)
	if err != nil || len(k) != KeyLen {
		return nil, decryptError("attachment key is not usable")
	}
	return k, nil
}

// MarshalJSON writes the attachment as the web client lays one out.
func (a Attachment) MarshalJSON() ([]byte, error) {
	if a.Size < 0 || a.Size > maxSafeInteger {
		return nil, errors.New("e2ee: attachment size out of range")
	}
	var o jsObject
	o.str("blob_id", a.BlobID)
	o.str("name", a.Name)
	o.str("type", a.Type)
	o.num("size", float64(a.Size))
	o.optNum("w", a.W)
	o.optNum("h", a.H)
	o.str("key", a.Key)
	o.optBool("spoiler", a.Spoiler)
	o.optNum("duration", a.Duration)
	return o.done()
}

func parseAttachment(raw []byte) (Attachment, bool) {
	m, ok := jsonObject(raw)
	if !ok {
		return Attachment{}, false
	}
	blobID, ok1 := jsonString(m["blob_id"])
	name, ok2 := jsonString(m["name"])
	typ, ok3 := jsonString(m["type"])
	key, ok4 := jsonString(m["key"])
	if !ok1 || !ok2 || !ok3 || !ok4 {
		return Attachment{}, false
	}
	size, ok := jsonNumber(m["size"])
	if !ok || size != math.Trunc(size) || size < 0 || size > maxSafeInteger {
		return Attachment{}, false
	}
	a := Attachment{BlobID: blobID, Name: name, Type: typ, Size: int64(size), Key: key}
	if f, ok := jsonNumber(m["w"]); ok {
		a.W = &f
	}
	if f, ok := jsonNumber(m["h"]); ok {
		a.H = &f
	}
	if f, ok := jsonNumber(m["duration"]); ok {
		a.Duration = &f
	}
	if v, ok := jsonBool(m["spoiler"]); ok {
		a.Spoiler = &v
	}
	return a, true
}

// Attachments are the well-formed entries of member "att".
func (p *Payload) Attachments() []Attachment {
	items, _ := jsonArray(p.vals["att"])
	var out []Attachment
	for _, it := range items {
		if a, ok := parseAttachment(it); ok {
			out = append(out, a)
		}
	}
	return out
}

// SetAttachments sets member "att".
func (p *Payload) SetAttachments(atts []Attachment) error {
	b := []byte{'['}
	for i, a := range atts {
		if i > 0 {
			b = append(b, ',')
		}
		ab, err := a.MarshalJSON()
		if err != nil {
			return err
		}
		b = append(b, ab...)
	}
	p.put("att", append(b, ']'))
	return nil
}

// Sticker is a sticker reference, enough to show it without owning the pack.
type Sticker struct {
	ID       string
	Blob     *string
	Name     *string
	W, H     *float64
	Animated *bool
	Format   *string
}

// MarshalJSON writes the sticker as the web client lays one out.
func (s Sticker) MarshalJSON() ([]byte, error) {
	var o jsObject
	o.str("id", s.ID)
	o.optStr("blob", s.Blob)
	o.optStr("name", s.Name)
	o.optNum("w", s.W)
	o.optNum("h", s.H)
	o.optBool("animated", s.Animated)
	o.optStr("format", s.Format)
	return o.done()
}

// Sticker is member "sticker" when it is an object with a string id.
func (p *Payload) Sticker() (Sticker, bool) {
	m, ok := jsonObject(p.vals["sticker"])
	if !ok {
		return Sticker{}, false
	}
	id, ok := jsonString(m["id"])
	if !ok {
		return Sticker{}, false
	}
	s := Sticker{ID: id}
	if v, ok := jsonString(m["blob"]); ok {
		s.Blob = &v
	}
	if v, ok := jsonString(m["name"]); ok {
		s.Name = &v
	}
	if f, ok := jsonNumber(m["w"]); ok {
		s.W = &f
	}
	if f, ok := jsonNumber(m["h"]); ok {
		s.H = &f
	}
	if v, ok := jsonBool(m["animated"]); ok {
		s.Animated = &v
	}
	if v, ok := jsonString(m["format"]); ok {
		s.Format = &v
	}
	return s, true
}

// SetSticker sets member "sticker".
func (p *Payload) SetSticker(s Sticker) error {
	b, err := s.MarshalJSON()
	if err != nil {
		return err
	}
	p.put("sticker", b)
	return nil
}

// Embed is a link preview the sender made. Its string members are url, type,
// title, description, site_name, image, video_id, mime, color and invite_code,
// its number members (float64) image_w, image_h, member_count and
// online_count. Embeds read from a payload hold only those members with the
// right types, and url and image only when WebLink allows them.
type Embed map[string]any

var (
	embedStrings = []string{"url", "type", "title", "description", "site_name", "image", "video_id", "mime", "color", "invite_code"}
	embedNumbers = []string{"image_w", "image_h", "member_count", "online_count"}
)

func embedLink(k string) bool { return k == "url" || k == "image" }

// Str is a string member of the embed.
func (e Embed) Str(k string) (string, bool) {
	v, ok := e[k].(string)
	return v, ok
}

// Num is a number member of the embed.
func (e Embed) Num(k string) (float64, bool) {
	v, ok := e[k].(float64)
	return v, ok
}

// MarshalJSON writes the embed's members in the web client's order. A member
// it does not know or of the wrong type is an error.
func (e Embed) MarshalJSON() ([]byte, error) {
	for k := range e {
		if !slices.Contains(embedStrings, k) && !slices.Contains(embedNumbers, k) {
			return nil, fmt.Errorf("e2ee: an embed has no member %q", k)
		}
	}
	var o jsObject
	for _, k := range embedStrings {
		if v, ok := e[k]; ok {
			s, ok := v.(string)
			if !ok {
				return nil, fmt.Errorf("e2ee: embed member %q is a string", k)
			}
			o.str(k, s)
		}
	}
	for _, k := range embedNumbers {
		if v, ok := e[k]; ok {
			f, ok := v.(float64)
			if !ok {
				return nil, fmt.Errorf("e2ee: embed member %q is a float64", k)
			}
			o.num(k, f)
		}
	}
	return o.done()
}

func sanitizeEmbed(m map[string]json.RawMessage) Embed {
	e := Embed{}
	for _, k := range embedStrings {
		if v, ok := jsonString(m[k]); ok && (!embedLink(k) || WebLink(v)) {
			e[k] = v
		}
	}
	for _, k := range embedNumbers {
		if f, ok := jsonNumber(m[k]); ok {
			e[k] = f
		}
	}
	return e
}

// Embeds are the usable entries of member "embeds": objects whose url is a
// web link, holding only their known members.
func (p *Payload) Embeds() []Embed {
	items, _ := jsonArray(p.vals["embeds"])
	var out []Embed
	for _, it := range items {
		m, ok := jsonObject(it)
		if !ok {
			continue
		}
		if _, ok := jsonString(m["url"]); !ok {
			continue
		}
		if e := sanitizeEmbed(m); e["url"] != nil {
			out = append(out, e)
		}
	}
	return out
}

// SetEmbeds sets member "embeds". Each needs a url that WebLink allows, or
// the web client would drop it.
func (p *Payload) SetEmbeds(embeds []Embed) error {
	b := []byte{'['}
	for i, e := range embeds {
		if u, ok := e.Str("url"); !ok || !WebLink(u) {
			return errors.New("e2ee: an embed needs a web link as its url")
		}
		if i > 0 {
			b = append(b, ',')
		}
		eb, err := e.MarshalJSON()
		if err != nil {
			return err
		}
		b = append(b, eb...)
	}
	p.put("embeds", append(b, ']'))
	return nil
}

// checkContent fails the way sanitizePayload does: a payload that names
// content (t, att, sticker or embeds) but has none of it in a usable form is
// not a message.
func (p *Payload) checkContent() error {
	named := false
	for _, k := range []string{"t", "att", "sticker", "embeds"} {
		if _, ok := p.vals[k]; ok {
			named = true
		}
	}
	if !named {
		return nil
	}
	if _, ok := p.Text(); ok {
		return nil
	}
	if _, ok := p.Sticker(); ok {
		return nil
	}
	if len(p.Attachments()) > 0 || len(p.Embeds()) > 0 {
		return nil
	}
	return decryptError("malformed message payload")
}

// WebLink reports whether a link in an embed may be followed or loaded, as
// webLink in message.ts decides: an http(s) address or a path on this server,
// with no backslash, whitespace or control character anywhere.
func WebLink(v string) bool {
	for _, r := range v {
		if r == '\\' || r < 0x20 || r == 0x7f || jsSpace(r) {
			return false
		}
	}
	if strings.HasPrefix(v, "/") {
		return !strings.HasPrefix(v, "//")
	}
	return hasPrefixFoldASCII(v, "http://") || hasPrefixFoldASCII(v, "https://")
}

// jsSpace is JavaScript's \s past the control characters: the space
// separators, the line and paragraph separators and the byte order mark.
// (unicode.IsSpace differs: it takes U+0085 and leaves U+FEFF.)
func jsSpace(r rune) bool {
	switch r {
	case ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// hasPrefixFoldASCII matches a prefix ignoring ASCII case only, as a
// JavaScript regular expression with the i flag and without u does.
func hasPrefixFoldASCII(s, prefix string) bool {
	if len(s) < len(prefix) {
		return false
	}
	for i := 0; i < len(prefix); i++ {
		c := s[i]
		if 'A' <= c && c <= 'Z' {
			c += 'a' - 'A'
		}
		if c != prefix[i] {
			return false
		}
	}
	return true
}

// The JSON readers below take a value as JavaScript's typeof sees it.

func trimJSONSpace(raw []byte) []byte { return bytes.TrimLeft(raw, " \t\r\n") }

func jsonObject(raw []byte) (map[string]json.RawMessage, bool) {
	raw = trimJSONSpace(raw)
	if len(raw) == 0 || raw[0] != '{' {
		return nil, false
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return nil, false
	}
	return m, true
}

func jsonArray(raw []byte) ([]json.RawMessage, bool) {
	raw = trimJSONSpace(raw)
	if len(raw) == 0 || raw[0] != '[' {
		return nil, false
	}
	var a []json.RawMessage
	if json.Unmarshal(raw, &a) != nil {
		return nil, false
	}
	return a, true
}

func jsonString(raw []byte) (string, bool) {
	raw = trimJSONSpace(raw)
	if len(raw) == 0 || raw[0] != '"' {
		return "", false
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return "", false
	}
	return s, true
}

// jsonNumber is a finite number; one too large for a float64 would be
// Infinity in JavaScript, which the web client does not take either.
func jsonNumber(raw []byte) (float64, bool) {
	raw = trimJSONSpace(raw)
	if len(raw) == 0 || (raw[0] != '-' && (raw[0] < '0' || raw[0] > '9')) {
		return 0, false
	}
	var f float64
	if json.Unmarshal(raw, &f) != nil {
		return 0, false
	}
	return f, true
}

func jsonBool(raw []byte) (bool, bool) {
	switch string(bytes.TrimSpace(raw)) {
	case "true":
		return true, true
	case "false":
		return false, true
	}
	return false, false
}
