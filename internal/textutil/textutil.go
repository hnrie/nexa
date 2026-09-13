// Package textutil cleans user-supplied text. The REST API and the gateway
// both use it, so a status set either way passes the same checks.
package textutil

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// CleanText trims, strips control characters (keeping \n and \t) and
// enforces a maximum rune count. ok is false when the result is too long.
func CleanText(s string, max int) (out string, ok bool) {
	if !utf8.ValidString(s) {
		return "", false
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == '\n' || r == '\t' {
			b.WriteRune(r)
			continue
		}
		if unicode.IsControl(r) || r == '‎' || r == '‏' || r == '‮' {
			continue
		}
		b.WriteRune(r)
	}
	out = strings.TrimSpace(b.String())
	return out, utf8.RuneCountInString(out) <= max
}
