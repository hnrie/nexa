// Package automod is AutoMod's matching: how text is read past the usual
// disguises, how a rule's words and patterns are matched against it, and the
// ready-made word lists. The server uses it on what it can read for itself
// (names, profiles, thread and post titles); members' apps carry the same
// rules for what is end-to-end encrypted, and testdata/vectors.json holds the
// cases every implementation has to agree on.
package automod

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// confusables maps letters that look like Latin ones, from other scripts and
// from symbols, to the Latin letter they pass for.
var confusables = map[rune]rune{
	// Cyrillic
	'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x',
	'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'ү': 'y', 'һ': 'h', 'ɡ': 'g',
	// Greek
	'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ω': 'w',
	// Latin look-alikes and symbols
	'ł': 'l', 'ø': 'o', 'đ': 'd', 'ß': 's', 'æ': 'a', 'œ': 'o', 'ı': 'i', 'ƒ': 'f', '€': 'e', '¢': 'c', '£': 'l', '¥': 'y',
}

// leet maps the digits and symbols people swap for letters.
var leet = map[rune]rune{'0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '|': 'l', '+': 't'}

// invisible are characters that take no space and are slipped inside words.
func invisible(r rune) bool {
	switch r {
	case '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad', '\u180e':
		return true
	}
	return unicode.Is(unicode.Cf, r)
}

// Fold reads text the way a rule should see it: lower case, without accents
// or the marks stacked on letters, with look-alike letters and the usual
// number swaps read as the letters they stand for, and without invisible
// characters. Letters spelled out one at a time with the same thing between
// each (f.u.c.k, f u c k) are put back together.
func Fold(s string) string {
	out, _ := fold(s)
	return out
}

// fold is Fold, also giving the spelled-out runs it put back together, which
// are searched without regard to where words begin: the spacing was what hid
// them.
func fold(s string) (string, []string) {
	var runes []rune
	for _, r := range norm.NFKD.String(s) {
		if unicode.Is(unicode.Mn, r) || invisible(r) {
			continue
		}
		r = unicode.ToLower(r)
		if c, ok := confusables[r]; ok {
			r = c
		}
		if c, ok := leet[r]; ok {
			r = c
		}
		runes = append(runes, r)
	}
	return joinSpelled(runes)
}

// spellSep are what people put between letters they spell out.
func spellSep(r rune) bool { return strings.ContainsRune(" .-_*,~/\\", r) }

func letterOrDigit(r rune) bool { return unicode.IsLetter(r) || unicode.IsNumber(r) }

// single reports whether runes[i] is a letter standing alone.
func single(runes []rune, i int) bool {
	return letterOrDigit(runes[i]) && (i == 0 || !letterOrDigit(runes[i-1])) && (i+1 >= len(runes) || !letterOrDigit(runes[i+1]))
}

// joinSpelled puts back together three or more single letters with the same
// separator between each, and lists the words it made.
func joinSpelled(runes []rune) (string, []string) {
	var out []rune
	var runs []string
	for i := 0; i < len(runes); {
		if single(runes, i) && i+2 < len(runes) && spellSep(runes[i+1]) && single(runes, i+2) {
			sep := runes[i+1]
			letters := []rune{runes[i]}
			j := i
			for j+2 < len(runes) && runes[j+1] == sep && single(runes, j+2) {
				letters = append(letters, runes[j+2])
				j += 2
			}
			if len(letters) >= 3 {
				out = append(out, letters...)
				runs = append(runs, string(letters))
				i = j + 1
				continue
			}
		}
		out = append(out, runes[i])
		i++
	}
	return string(out), runs
}

func isWordRune(r rune) bool {
	return r == '_' || r == '\'' || unicode.IsLetter(r) || unicode.IsNumber(r)
}

// term is one word or phrase of a rule, as matched.
type term struct {
	text           string
	prefix, suffix bool // a * after: starts a word; a * before: ends a word
}

func parseTerm(w string) (term, bool) {
	t := term{prefix: strings.HasSuffix(w, "*"), suffix: strings.HasPrefix(w, "*")}
	t.text = strings.Trim(strings.ToLower(strings.TrimSpace(w)), "*")
	return t, t.text != ""
}

// find reports where t occurs in text, as a whole word or phrase unless a *
// lets it be part of one: the first match's start and end, or -1.
func (t term) find(text string) (int, int) {
	from := 0
	for from <= len(text) {
		i := strings.Index(text[from:], t.text)
		if i < 0 {
			return -1, -1
		}
		start := from + i
		end := start + len(t.text)
		before, _ := utf8.DecodeLastRuneInString(text[:start])
		after, _ := utf8.DecodeRuneInString(text[end:])
		startOK := t.suffix || start == 0 || !isWordRune(before)
		endOK := t.prefix || end == len(text) || !isWordRune(after)
		if startOK && endOK {
			return start, end
		}
		_, size := utf8.DecodeRuneInString(text[start:])
		from = start + size
	}
	return -1, -1
}

// fuzzyPattern is t as a pattern over folded text that lets every letter be
// stretched ("fuuuck"), keeping doubled letters doubled, so "ass" still needs
// two s's and never matches "as". Bare leaves out where words begin and end,
// for searching inside a spelled-out run.
func fuzzyPattern(t term, bare bool) string {
	var b strings.Builder
	if !t.suffix && !bare {
		b.WriteString(`(?:^|[^\p{L}\p{N}_'])`)
	}
	b.WriteString("(")
	for _, r := range t.text {
		switch {
		case unicode.IsSpace(r):
			b.WriteString(`[\s\p{P}]+`)
		case unicode.IsLetter(r):
			b.WriteString(regexp.QuoteMeta(string(r)) + "+")
		default:
			b.WriteString(regexp.QuoteMeta(string(r)))
		}
	}
	b.WriteString(")")
	if !t.prefix && !bare {
		b.WriteString(`(?:$|[^\p{L}\p{N}_'])`)
	}
	return b.String()
}

// Matcher is a rule's words, patterns and allowed words, ready to match.
type Matcher struct {
	terms []term
	allow []term
	// fuzzy is every term as one pattern over folded text (with evasion on),
	// and fuzzyEach the same one at a time, to say which matched
	fuzzy     *regexp.Regexp
	fuzzyEach []*regexp.Regexp
	// bareEach finds each term inside a spelled-out run
	bareEach []*regexp.Regexp
	regexes  []*regexp.Regexp
	evasion  bool
}

// NewMatcher prepares words (with * wildcards), patterns and allowed words.
// With evasion, words are also found past disguises (Fold) and stretched
// letters. Patterns that do not compile are left out.
func NewMatcher(words, patterns, allow []string, evasion bool) *Matcher {
	m := &Matcher{evasion: evasion}
	var alts []string
	for _, w := range words {
		t, ok := parseTerm(w)
		if !ok {
			continue
		}
		m.terms = append(m.terms, t)
		if evasion {
			ft := term{text: Fold(t.text), prefix: t.prefix, suffix: t.suffix}
			p := fuzzyPattern(ft, false)
			if re, err := regexp.Compile(p); err == nil {
				m.fuzzyEach = append(m.fuzzyEach, re)
				alts = append(alts, p)
			} else {
				m.fuzzyEach = append(m.fuzzyEach, nil)
			}
			bare, _ := regexp.Compile(fuzzyPattern(ft, true))
			m.bareEach = append(m.bareEach, bare)
		}
	}
	if len(alts) > 0 {
		m.fuzzy, _ = regexp.Compile(strings.Join(alts, "|"))
	}
	for _, w := range allow {
		if t, ok := parseTerm(w); ok {
			m.allow = append(m.allow, t)
		}
	}
	for _, p := range patterns {
		if re, err := regexp.Compile("(?i)" + p); err == nil {
			m.regexes = append(m.regexes, re)
		}
	}
	return m
}

// withoutAllowed blanks out the allowed words in text, so they never count.
func (m *Matcher) withoutAllowed(text string) string {
	for _, a := range m.allow {
		for {
			start, end := a.find(text)
			if start < 0 {
				break
			}
			text = text[:start] + strings.Repeat(" ", end-start) + text[end:]
		}
	}
	return text
}

// Match is the first of the rule's words or patterns in text, as it was
// written in the rule (or what a pattern matched), and whether there was one.
func (m *Matcher) Match(text string) (string, bool) {
	if strings.TrimSpace(text) == "" {
		return "", false
	}
	low := m.withoutAllowed(strings.ToLower(text))
	for _, t := range m.terms {
		if s, _ := t.find(low); s >= 0 {
			return wildcardForm(t), true
		}
	}
	if m.fuzzy != nil {
		f, runs := fold(text)
		folded := m.withoutAllowed(f)
		if m.fuzzy.MatchString(folded) {
			for i, re := range m.fuzzyEach {
				if re != nil && re.MatchString(folded) {
					return wildcardForm(m.terms[i]), true
				}
			}
		}
		for _, run := range runs {
			if strings.TrimSpace(m.withoutAllowed(run)) == "" {
				continue
			}
			for i, re := range m.bareEach {
				if re != nil && re.MatchString(run) {
					return wildcardForm(m.terms[i]), true
				}
			}
		}
	}
	for _, re := range m.regexes {
		if hit := re.FindString(text); hit != "" {
			return hit, true
		}
	}
	return "", false
}

func wildcardForm(t term) string {
	out := t.text
	if t.suffix {
		out = "*" + out
	}
	if t.prefix {
		out += "*"
	}
	return out
}
