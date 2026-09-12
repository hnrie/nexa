package unfurl

import (
	"net/url"
	"testing"
)

func TestYouTubeID(t *testing.T) {
	cases := []struct {
		raw  string
		want string
	}{
		{"https://www.youtube.com/watch?v=abc123DEF_-", "abc123DEF_-"},
		{"https://youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2", "dQw4w9WgXcQ"},
		{"http://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://music.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"},
		{"https://www.youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share", "dQw4w9WgXcQ"},
		{"https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://WWW.YouTube.COM/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"},
		{"https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=1", "dQw4w9WgXcQ"},

		{"https://www.youtube.com/channel/xyz", ""},
		{"https://www.youtube.com/channel/UCabcdefghijk", ""},
		{"https://www.youtube.com/@someuser", ""},
		{"https://www.youtube.com/", ""},
		{"https://www.youtube.com/watch", ""},
		{"https://www.youtube.com/watch?v=", ""},
		{"https://www.youtube.com/watch?v=tooshort", ""},
		{"https://www.youtube.com/watch?v=way_too_long_id", ""},
		{"https://www.youtube.com/watch?v=bad+chars!!", ""},
		{"https://youtu.be/", ""},
		{"https://www.youtube.com/shorts/", ""},
		{"https://notyoutube.com/watch?v=dQw4w9WgXcQ", ""},
		{"https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ", ""},
		{"https://example.com/page", ""},
		{"https://vimeo.com/12345678901", ""},
	}
	for _, tc := range cases {
		u, err := url.Parse(tc.raw)
		if err != nil {
			t.Fatalf("url.Parse(%q): %v", tc.raw, err)
		}
		if got := YouTubeID(u); got != tc.want {
			t.Errorf("YouTubeID(%q) = %q, want %q", tc.raw, got, tc.want)
		}
	}
}

func TestYouTubeIDNil(t *testing.T) {
	if got := YouTubeID(nil); got != "" {
		t.Errorf("YouTubeID(nil) = %q, want empty", got)
	}
}
