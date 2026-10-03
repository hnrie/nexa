package api

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"
)

// A typing style is how "is typing…" looks for someone to everyone else: up
// to three emoji that move together, how they move, and the words after the
// name, one of a few the app offers in every language or the person's own.
// It is public, like the rest of a profile, and only shows while someone is
// the one person typing.
type typingStyle struct {
	Emoji  []string `json:"emoji"`
	Motion string   `json:"motion"`
	Preset string   `json:"preset,omitempty"`
	Words  string   `json:"words,omitempty"`
}

const (
	maxTypingEmoji = 3
	// own words follow the name on one short line, under the message box
	maxTypingWords = 32
)

// The words the app offers, by the key each language has them under
// (typing.presets.<key> in web/src/i18n/locales).
var typingPresets = map[string]bool{
	"yapping": true, "cooking": true, "plotting": true, "rambling": true, "overthinking": true,
	"daydreaming": true, "meowing": true, "essay": true, "tea": true, "thinking": true,
}

var typingMotions = map[string]bool{"wave": true, "pulse": true, "wiggle": true, "still": true}

// a server or pack emoji, as messages write it: its name and its picture's id
var customEmojiToken = regexp.MustCompile(`^<a?:[A-Za-z0-9_]{1,32}:[0-9]{1,20}>$`)

// cleanTypingStyle checks a style its owner sent and writes it the one way it
// is stored, or "" for one that changes nothing. A JSON null is the plain style.
// The second result is the reason a style was refused.
func cleanTypingStyle(raw json.RawMessage) (string, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", ""
	}
	var in typingStyle
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", "typing_style must be an object or null."
	}
	out := typingStyle{Emoji: []string{}, Motion: "wave"}
	if len(in.Emoji) > maxTypingEmoji {
		return "", "A typing style has at most three emoji."
	}
	for _, e := range in.Emoji {
		e = strings.TrimSpace(e)
		if !utf8.ValidString(e) || !(isEmoji(e) || customEmojiToken.MatchString(e)) {
			return "", "Each emoji in a typing style must be one emoji."
		}
		out.Emoji = append(out.Emoji, e)
	}
	if in.Motion != "" {
		if !typingMotions[in.Motion] {
			return "", "motion must be wave, pulse, wiggle or still."
		}
		out.Motion = in.Motion
	}
	if words, ok := CleanText(strings.NewReplacer("\n", " ", "\t", " ").Replace(in.Words), maxTypingWords); !ok {
		return "", "Your own typing words are at most 32 characters."
	} else if words != "" {
		out.Words = words
	} else if in.Preset != "" {
		if !typingPresets[in.Preset] {
			return "", "That isn't one of the typing words on offer."
		}
		out.Preset = in.Preset
	}
	// nothing chosen is the plain "is typing…", however it moves
	if len(out.Emoji) == 0 && out.Preset == "" && out.Words == "" {
		return "", ""
	}
	// written as typed: a custom emoji's < and > stay themselves
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		return "", "typing_style could not be read."
	}
	return strings.TrimSuffix(b.String(), "\n"), ""
}

// typingStyleText is a typing style as words a moderation case can keep: its
// emoji, then its own words or the name of its preset.
func typingStyleText(raw string) string {
	var st typingStyle
	if raw == "" || json.Unmarshal([]byte(raw), &st) != nil {
		return clipRunes(raw, maxKeptOldValue)
	}
	parts := append([]string{}, st.Emoji...)
	if st.Words != "" {
		parts = append(parts, st.Words)
	} else if st.Preset != "" {
		parts = append(parts, "("+st.Preset+")")
	}
	return strings.Join(parts, " ")
}
