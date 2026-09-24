// Package textutil cleans user-supplied text. The REST API and the gateway
// both use it, so a status set either way passes the same checks.
package textutil

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// CleanText trims, strips control characters (keeping \n and \t) and
// enforces a maximum rune count. ok is false when the result is too long.
//
// The characters that change which way text runs — embeddings, overrides,
// isolates and the direction marks — go too: in a name or a status they only
// serve to make text read differently from how it was written. Line and
// paragraph separators become plain line breaks.
func CleanText(s string, max int) (out string, ok bool) {
	if !utf8.ValidString(s) {
		return "", false
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r == '\n' || r == '\t':
			b.WriteRune(r)
		case r == '\u2028' || r == '\u2029':
			b.WriteRune('\n')
		case unicode.IsControl(r) || isBidiControl(r):
		default:
			b.WriteRune(r)
		}
	}
	out = strings.TrimSpace(b.String())
	return out, utf8.RuneCountInString(out) <= max
}

func isBidiControl(r rune) bool {
	return r == '\u200E' || r == '\u200F' || r == '\u061C' || ('\u202A' <= r && r <= '\u202E') || ('\u2066' <= r && r <= '\u2069')
}

// CleanName is CleanText for a one-line name: tabs and line breaks become
// spaces, and characters that show nothing — zero-width spaces, word joiners,
// byte-order marks, the Hangul fillers that render blank — are dropped, so a
// name cannot be empty or padded with space nobody can see. The joiners that
// build emoji and shape some scripts stay.
func CleanName(s string, max int) (string, bool) {
	out, ok := CleanText(s, max)
	if !ok {
		return "", false
	}
	var b strings.Builder
	b.Grow(len(out))
	for _, r := range out {
		switch {
		case r == '\n' || r == '\t':
			b.WriteRune(' ')
		case isInvisible(r):
		default:
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String()), true
}

func isInvisible(r rune) bool {
	switch r {
	case '\u200B', '\u2060', '\uFEFF', '\u180E', '\u115F', '\u1160', '\u3164', '\uFFA0', '\u034F', '\u17B4', '\u17B5':
		return true
	}
	return '\u2061' <= r && r <= '\u2064'
}

// Skeleton reduces a name to what it looks like: compatibility forms folded
// (full-width letters, ligatures, circled letters), accents, invisible
// characters, spaces, punctuation and symbols dropped, and the Greek, Cyrillic
// and Armenian letters that pass for Latin ones read as those. Two names with
// one skeleton look alike on screen, which is what matters to someone deciding
// whether a message came from the real thing.
func Skeleton(name string) string {
	var b strings.Builder
	for _, r := range norm.NFKD.String(name) {
		switch {
		case unicode.In(r, unicode.Mn, unicode.Me, unicode.Cf), unicode.IsSpace(r), unicode.IsPunct(r), unicode.IsSymbol(r), unicode.IsControl(r), isInvisible(r):
			continue
		}
		if l, ok := lookalike[r]; ok {
			r = l
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return b.String()
}

// lookalike maps letters of other scripts to the Latin letter they are
// usually mistaken for (after Unicode's confusables list, trimmed to the
// letters that matter in practice).
var lookalike = map[rune]rune{
	// Greek
	'Α': 'a', 'Β': 'b', 'Ε': 'e', 'Ζ': 'z', 'Η': 'h', 'Ι': 'i', 'Κ': 'k', 'Μ': 'm', 'Ν': 'n', 'Ο': 'o', 'Ρ': 'p', 'Τ': 't', 'Υ': 'y', 'Χ': 'x',
	'α': 'a', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
	// Cyrillic
	'А': 'a', 'В': 'b', 'Е': 'e', 'К': 'k', 'М': 'm', 'Н': 'h', 'О': 'o', 'Р': 'p', 'С': 'c', 'Т': 't', 'Х': 'x', 'У': 'y', 'Ѕ': 's', 'І': 'i', 'Ј': 'j',
	'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'һ': 'h', 'п': 'n', 'ո': 'n', 'ռ': 'n',
	// Latin letters that look like other Latin letters
	'ɑ': 'a', 'ɡ': 'g', 'ı': 'i', 'ȷ': 'j', 'ʏ': 'y', 'ɴ': 'n', 'ᴇ': 'e', 'ᴀ': 'a',
}
