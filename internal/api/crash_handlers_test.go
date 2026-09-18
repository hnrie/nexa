package api

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// Postgres refuses a text value that is not valid UTF-8, so a crash report
// clipped mid-rune used to fail to store — from the one endpoint whose whole
// job is to record that something already went wrong.
func TestClipAlwaysLeavesValidUTF8(t *testing.T) {
	for _, s := range []string{
		strings.Repeat("a", 12) + "€xxxx",
		"héllo wörld, ça va — 🎈🎉",
		strings.Repeat("🎈", 8),
		"мир",
		"",
		"plain ascii",
	} {
		for n := 1; n <= len(s)+2; n++ {
			got := clip(s, n)
			if !utf8.ValidString(got) {
				t.Fatalf("clip(%q, %d) = %q, which is not valid UTF-8", s, n, got)
			}
			if len(got) > n {
				t.Fatalf("clip(%q, %d) = %q, longer than asked for", s, n, got)
			}
		}
	}
}

// A User-Agent header is whatever bytes the client sent; nothing decodes it on
// the way in, so it can be invalid on its own without being cut at all.
func TestClipDropsInvalidBytes(t *testing.T) {
	if got := clip("ok\xff\xfe end", 100); !utf8.ValidString(got) || got != "ok end" {
		t.Errorf("clip on invalid bytes = %q", got)
	}
	// a rune that was itself cut short goes rather than becoming U+FFFD
	if got := clip("ab€", 4); got != "ab" {
		t.Errorf("clip cutting into a rune = %q, want %q", got, "ab")
	}
}
