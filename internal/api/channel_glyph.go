package api

import (
	"context"
	"regexp"
	"strings"
	"unicode/utf8"

	"evilion.xyz/chat/internal/ids"
)

// maxGlyph bounds a channel icon as stored: the longest emoji sequences
// (a family, a flag with its tag characters) come to well under this.
const maxGlyph = 64

// glyphIconName is the name of one of the app's line icons. The client keeps
// the list, so a name it does not know yet draws the default icon instead.
var glyphIconName = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// channelGlyph checks a channel icon as a client sends it and returns the form
// to store. "" is the default # or speaker; "icon:<name>" one of the app's
// line icons; "emoji:<emoji>" a single emoji; "custom:<id>" one of this
// server's own custom emoji, and no other server's.
func (s *Server) channelGlyph(ctx context.Context, serverID ids.ID, raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", true
	}
	if len(raw) > maxGlyph {
		return "", false
	}
	kind, value, ok := strings.Cut(raw, ":")
	if !ok {
		return "", false
	}
	switch kind {
	case "icon":
		return raw, len(value) <= 32 && glyphIconName.MatchString(value)
	case "emoji":
		return raw, isEmoji(value)
	case "custom":
		id, err := ids.Parse(value)
		if err != nil {
			return "", false
		}
		e, err := s.Store.EmojiByID(ctx, id)
		if err != nil || e.ServerID != serverID {
			return "", false
		}
		return "custom:" + id.String(), true
	}
	return "", false
}

// isEmoji reports whether s is exactly one emoji: a pictograph with its
// variation selector, skin tone or tag characters, several of them joined
// by zero-width joiners, a keycap, or a flag's pair of regional indicators.
// Letters, spaces, controls and direction marks are refused, so a channel's
// icon can never pass for part of its name.
func isEmoji(s string) bool {
	if s == "" || len(s) > 48 || !utf8.ValidString(s) {
		return false
	}
	clusters, regional := 0, 0
	joined, keycap := false, false
	for _, r := range s {
		switch {
		case r == 0x200d: // a zero-width joiner ties the next pictograph to this one
			if clusters == 0 || joined {
				return false
			}
			joined = true
			continue
		case r == 0xfe0f || r == 0xfe0e || r == 0x20e3 || (r >= 0x1f3fb && r <= 0x1f3ff) || (r >= 0xe0020 && r <= 0xe007f):
			// variation selectors, the keycap mark, skin tones and tag characters belong to what came before
			if clusters == 0 {
				return false
			}
		case r >= 0x1f1e6 && r <= 0x1f1ff: // regional indicators make a flag two at a time
			if regional%2 == 0 && !joined {
				clusters++
			}
			regional++
		case r == '#' || r == '*' || (r >= '0' && r <= '9'):
			if !joined {
				clusters++
			}
			keycap = true
		case pictograph(r):
			if !joined {
				clusters++
			}
		default:
			return false
		}
		joined = false
	}
	if joined || (keycap && !strings.ContainsRune(s, 0x20e3)) {
		return false
	}
	return clusters == 1
}

// pictograph reports whether r is in a block emoji are drawn from.
func pictograph(r rune) bool {
	switch {
	case r == 0xa9 || r == 0xae || r == 0x203c || r == 0x2049:
		return true
	case r >= 0x2100 && r <= 0x2bff: // letterlike symbols through miscellaneous symbols and arrows
		return true
	case r == 0x3030 || r == 0x303d || r == 0x3297 || r == 0x3299:
		return true
	case r >= 0x1f000 && r <= 0x1faff:
		return true
	}
	return false
}
