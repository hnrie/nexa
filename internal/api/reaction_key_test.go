package api

import "testing"

func TestReactionKeysAreEmoji(t *testing.T) {
	for _, ok := range []string{"👍", "👨‍👩‍👧", "🇺🇸", "1️⃣", "#️⃣", "❤️", "✅", "🏴\U000e0067\U000e0062\U000e0073\U000e0063\U000e0074\U000e007f", "👋🏽", ":blob:123", "a:party_blob:9876543210", "100%"[:0] + "💯"} {
		if _, good := parseEmoji(ok); !good {
			t.Errorf("refused %q", ok)
		}
	}
	for _, bad := range []string{"", "LOL", "100%", "a b", "<b>", "‮abc", "1", "👍 x", "name:", ":name:abc", "x/y"} {
		if _, good := parseEmoji(bad); good {
			t.Errorf("accepted %q", bad)
		}
	}
}
