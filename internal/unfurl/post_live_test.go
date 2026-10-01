package unfurl

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

// TestLivePosts reads real posts from the real services, to see what each
// source answers today. It needs the network and other people's servers, so
// it only runs when asked for:
//
//	UNFURL_LIVE="https://x.com/jack/status/20 https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l" \
//	  go test ./internal/unfurl -run TestLivePosts -v
//
// UNFURL_SOURCE picks one source of a post's list by its place (0 is the
// first), to check a fallback while the source before it still works.
func TestLivePosts(t *testing.T) {
	links := strings.Fields(os.Getenv("UNFURL_LIVE"))
	if len(links) == 0 {
		t.Skip("set UNFURL_LIVE to a list of links to posts")
	}
	only := os.Getenv("UNFURL_SOURCE")
	f := &Fetcher{Timeout: 12 * time.Second}
	for _, link := range links {
		if only != "" {
			u, ref := mustRef(t, link)
			if ref.short != nil {
				if ref = f.followShort(context.Background(), ref); ref == nil {
					t.Errorf("%s: the short link led nowhere", u)
					continue
				}
			}
			site := postSites[ref.platform]
			i := int(only[0] - '0')
			if i < 0 || i >= len(site.sources) {
				t.Fatalf("%s has %d sources", ref.platform, len(site.sources))
			}
			started := time.Now()
			p, err := site.sources[i](f, context.Background(), ref)
			if err != nil || p == nil {
				t.Errorf("%s source %d: %v (%s)", link, i, err, time.Since(started).Round(time.Millisecond))
				continue
			}
			p.finish(ref, site)
			show(t, link, time.Since(started), p)
			continue
		}
		started := time.Now()
		r, err := f.Fetch(context.Background(), link)
		if err != nil {
			t.Errorf("%s: %v", link, err)
			continue
		}
		if r.Post == nil {
			t.Errorf("%s: no post, only a %s card titled %q (%s)", link, r.Type, r.Title, time.Since(started).Round(time.Millisecond))
			continue
		}
		show(t, link, time.Since(started), r)
	}
}

func show(t *testing.T, link string, took time.Duration, v any) {
	t.Helper()
	out, _ := json.MarshalIndent(v, "", "  ")
	t.Logf("%s (%s)\n%s", link, took.Round(time.Millisecond), out)
}

// mustRef reads a link as a post, or fails the test.
func mustRef(t *testing.T, link string) (*url.URL, *postRef) {
	t.Helper()
	u, err := url.Parse(link)
	if err != nil {
		t.Fatalf("%q: %v", link, err)
	}
	ref := postRefOf(u)
	if ref == nil {
		t.Fatalf("%q is not read as a post", link)
	}
	return u, ref
}
