package api

import (
	"context"
	"strings"
	"testing"

	"evilion.xyz/chat/internal/unfurl"
)

// A GIF picked in the app's search is sealed with one of our own proxy paths;
// bot libraries parse embed addresses as absolute URLs, as Discord's always are.
func TestLinkEmbedVideoIsAbsolute(t *testing.T) {
	s, _ := newTestServer(t)
	s.Cfg.PublicURL = "https://nexa.example"
	b := s.builder(context.Background(), nil, nil)
	e := b.linkEmbed(unfurl.Result{URL: "https://klipy.com/gifs/x", Type: "gifv",
		Media: "/media/proxy/1-sig/aHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL3guZ2lm", MediaKind: "video"})
	for _, u := range []string{e.Video.URL, e.Video.ProxyURL} {
		if !strings.HasPrefix(u, "https://nexa.example/media/proxy/") {
			t.Fatalf("video address %q is not absolute", u)
		}
	}
}
