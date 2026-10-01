package unfurl

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// anyResolver gives every name a public address, so the guard lets a test
// reach any host; the transport sends them all to the test server.
type anyResolver struct{}

func (anyResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
}

// fakeNet counts what a test's pretend internet was asked for.
type fakeNet struct {
	mu   sync.Mutex
	hits map[string]int
}

func (n *fakeNet) asked(hostAndPath string) int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.hits[hostAndPath]
}

// network is a pretend internet: each host answers with its own handler, over
// TLS as the real ones do. A host that is not listed answers 404, which is
// how a service that is down looks to a source.
func network(t *testing.T, hosts map[string]http.Handler) (*Fetcher, *fakeNet) {
	t.Helper()
	n := &fakeNet{hits: map[string]int{}}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.mu.Lock()
		n.hits[r.Host+r.URL.Path]++
		n.mu.Unlock()
		if h := hosts[r.Host]; h != nil {
			h.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	tr := &http.Transport{
		DisableKeepAlives: true,
		TLSClientConfig:   &tls.Config{InsecureSkipVerify: true},
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, network, srv.Listener.Addr().String())
		},
	}
	t.Cleanup(tr.CloseIdleConnections)
	return &Fetcher{Timeout: 5 * time.Second, Transport: tr, Resolver: anyResolver{}}, n
}

// paths answers each path with its own handler, and 404 for the rest.
func paths(routes map[string]http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h := routes[r.URL.Path]; h != nil {
			h.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	})
}

func jsonBody(payload string) http.Handler { return body("application/json", payload) }

func down() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusInternalServerError)
	})
}

func mustPost(t *testing.T, f *Fetcher, link string) (*Result, *Post) {
	t.Helper()
	r := mustFetch(t, f, link)
	if r.Post == nil {
		t.Fatalf("%s: no post, only a card titled %q", link, r.Title)
	}
	return r, r.Post
}

func TestPostRefOf(t *testing.T) {
	cases := []struct {
		link               string
		platform, user, id string
	}{
		{"https://x.com/jack/status/20", "twitter", "jack", "20"},
		{"https://twitter.com/jack/status/20?s=20", "twitter", "jack", "20"},
		{"https://mobile.twitter.com/jack/statuses/20/photo/1", "twitter", "jack", "20"},
		{"https://x.com/i/status/1234567890", "twitter", "", "1234567890"},
		{"https://x.com/i/web/status/1234567890", "twitter", "", "1234567890"},
		// the fixer domains people swap in mean the post they point at
		{"https://fxtwitter.com/jack/status/20", "twitter", "jack", "20"},
		{"https://d.fxtwitter.com/jack/status/20", "twitter", "jack", "20"},
		{"https://fixupx.com/jack/status/20", "twitter", "jack", "20"},
		{"https://vxtwitter.com/jack/status/20", "twitter", "jack", "20"},
		{"https://fixvx.com/jack/status/20", "twitter", "jack", "20"},
		{"https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l", "bluesky", "bsky.app", "3l6oveex3ii2l"},
		{"https://fxbsky.app/profile/did:plc:z72i7hdynmk6r22z27h6tvur/post/3l6oveex3ii2l", "bluesky", "did:plc:z72i7hdynmk6r22z27h6tvur", "3l6oveex3ii2l"},
		{"https://www.tiktok.com/@scout2015/video/6718335390845095173?lang=en", "tiktok", "scout2015", "6718335390845095173"},
		{"https://www.tiktok.com/@scout2015/photo/7300000000000000000", "tiktok", "scout2015", "7300000000000000000"},
		{"https://tnktok.com/@scout2015/video/6718335390845095173", "tiktok", "scout2015", "6718335390845095173"},
		{"https://m.tiktok.com/v/6718335390845095173.html", "tiktok", "", "6718335390845095173"},
		{"https://www.instagram.com/p/BsOGulcndj-/", "instagram", "", "BsOGulcndj-"},
		{"https://www.instagram.com/reel/C0abcDEF123/?igsh=x", "instagram", "", "C0abcDEF123"},
		{"https://instagram.com/world_record_egg/p/BsOGulcndj-/", "instagram", "", "BsOGulcndj-"},
		{"https://www.ddinstagram.com/p/BsOGulcndj-/", "instagram", "", "BsOGulcndj-"},
		{"https://www.reddit.com/r/pics/comments/92dd8/test_post_please_ignore/", "reddit", "pics", "92dd8"},
		{"https://old.reddit.com/comments/92dd8", "reddit", "", "92dd8"},
		{"https://redd.it/92dd8", "reddit", "", "92dd8"},
		{"https://www.reddit.com/gallery/1abcde", "reddit", "", "1abcde"},
		{"https://vxreddit.com/r/pics/comments/92dd8/x/", "reddit", "pics", "92dd8"},
		{"https://t.me/durov/43", "telegram", "durov", "43"},
		{"https://t.me/s/durov/43", "telegram", "durov", "43"},
		{"https://fx-t.me/durov/43", "telegram", "durov", "43"},
		{"https://www.threads.com/@zuck/post/DXhZAMkljvS", "threads", "zuck", "DXhZAMkljvS"},
		{"https://www.threads.net/t/DXhZAMkljvS", "threads", "", "DXhZAMkljvS"},
		{"https://mastodon.social/@Mastodon/117156549508722805", "mastodon", "Mastodon", "117156549508722805"},
		{"https://hachyderm.io/@someone@mastodon.social/117156549508722805", "mastodon", "someone@mastodon.social", "117156549508722805"},
		{"https://example.social/users/someone/statuses/117156549508722805", "mastodon", "someone", "117156549508722805"},
	}
	for _, c := range cases {
		u, err := url.Parse(c.link)
		if err != nil {
			t.Fatal(err)
		}
		ref := postRefOf(u)
		if ref == nil {
			t.Errorf("%s: not read as a post", c.link)
			continue
		}
		if ref.platform != c.platform || ref.user != c.user || ref.id != c.id || ref.short != nil {
			t.Errorf("%s: got %s %q %q (short %v), want %s %q %q", c.link, ref.platform, ref.user, ref.id, ref.short, c.platform, c.user, c.id)
		}
	}

	// Addresses that only say where the post is once followed.
	for link, want := range map[string]string{
		"https://vm.tiktok.com/ZMabc123/":                       "https://vm.tiktok.com/ZMabc123/",
		"https://vt.tiktok.com/ZSabc123":                        "https://vt.tiktok.com/ZSabc123",
		"https://www.tiktok.com/t/ZTabc123/":                    "https://www.tiktok.com/t/ZTabc123/",
		"https://vm.tnktok.com/ZMabc123/":                       "https://vm.tiktok.com/ZMabc123/",
		"https://www.reddit.com/r/pics/s/AbCdEf123":             "https://www.reddit.com/r/pics/s/AbCdEf123",
		"https://www.instagram.com/share/p/BAbcdef123/?x=1#top": "https://www.instagram.com/share/p/BAbcdef123/",
	} {
		u, _ := url.Parse(link)
		ref := postRefOf(u)
		if ref == nil || ref.short == nil || ref.short.String() != want {
			t.Errorf("%s: want a short link to %s, got %+v", link, want, ref)
		}
	}

	// And what is not a post, however close it looks.
	for _, link := range []string{
		"https://x.com/jack",
		"https://x.com/home",
		"https://x.com/i/lists/5",
		"https://bsky.app/profile/bsky.app",
		"https://www.tiktok.com/@scout2015",
		"https://www.instagram.com/world_record_egg/",
		"https://www.reddit.com/r/pics/",
		"https://i.redd.it/07g1p2lr6qsh1.jpeg",
		"https://v.redd.it/ruypjcg8syrh1",
		"https://t.me/durov",
		"https://t.me/joinchat/AAAAAEabcdefg",
		"https://t.me/c/1234567890/55",
		"https://t.me/share/url?url=x",
		"https://telegram.org/blog/gifts/1",
		"https://www.threads.com/@zuck",
		"https://medium.com/@writer/a-story-about-things-1234567890ab",
		"https://example.com/@someone/123",
		"ftp://x.com/jack/status/20",
		"https://example.com/jack/status/20",
	} {
		u, _ := url.Parse(link)
		if ref := postRefOf(u); ref != nil {
			t.Errorf("%s: read as a %s post", link, ref.platform)
		}
	}

	if !PostHost("vm.tiktok.com") || !PostHost("fxtwitter.com") || !PostHost("T.ME") {
		t.Error("PostHost should know the services and their stand-ins")
	}
	if PostHost("i.redd.it") || PostHost("example.com") || PostHost("mastodon.social") {
		t.Error("PostHost should not claim a picture host, a stranger, or a server it would have to ask")
	}
}

// The token X's embed script computes, checked against values a browser gave.
func TestSyndicationToken(t *testing.T) {
	for id, want := range map[string]string{
		"20":                  "6dq1a2xwd93",
		"2105315677045203022": "53q1ld7clo5",
		"1585341984679469056": "3uchycv2wqc",
		"1790781346000":       "7ahczrf2xwx",
		"999999999999999999":  "2f9lc2ug9mm",
	} {
		if got := syndicationToken(id); got != want {
			t.Errorf("token for %s: got %s, want %s", id, got, want)
		}
	}
	if got := syndicationToken("not a number"); got == "" {
		t.Error("a bad id still gets some token")
	}
}

const fxStatusJSON = `{"code":200,"message":"OK","status":{
 "type":"status","url":"https://x.com/NASA/status/2105315677045203022","id":"2105315677045203022",
 "text":"New crew soon!\n\nCrew-13 launches tomorrow.",
 "author":{"screen_name":"NASA","url":"https://x.com/NASA","name":"NASA","avatar_url":"https://pbs.twimg.com/profile_images/1/a_200x200.jpg","verification":{"verified":true,"type":"government"}},
 "replies":116,"reposts":337,"likes":"2110","views":625078,"bookmarks":null,"created_timestamp":1790781346,"possibly_sensitive":false,
 "replying_to":{"screen_name":"Space_Station","status":"4"},
 "media":{"all":[{"id":"1","url":"https://video.twimg.com/v/1920x1080/a.mp4","thumbnail_url":"https://pbs.twimg.com/media/t.png","duration":61.494,"width":720,"height":405,"format":"video/mp4","type":"video",
   "formats":[{"url":"https://video.twimg.com/v/pl/a.m3u8","container":"m3u8"},{"url":"https://video.twimg.com/v/480x270/a.mp4","bitrate":288000,"container":"mp4","codec":"h264"},{"url":"https://video.twimg.com/v/1280x720/a.mp4","bitrate":2176000,"container":"mp4","codec":"h264"},{"url":"https://video.twimg.com/v/1920x1080/a.mp4","bitrate":10368000,"container":"mp4","codec":"h264"}]},
   {"type":"gif","url":"https://video.twimg.com/tweet_video/g.mp4","thumbnail_url":"https://pbs.twimg.com/tweet_video_thumb/g.jpg","width":400,"height":300,"duration":0,"format":"video/mp4","formats":[]},
   {"type":"gif","url":"https://media.tenor.com/abc/cat.gif","width":200,"height":100,"format":"image/gif"},
   {"type":"mosaic_photo","url":"https://mosaic.fxtwitter.com/x.jpg","width":1,"height":1}]},
 "quote":{"type":"status","url":"https://x.com/Space_Station/status/5","id":"5","text":"Docking soon","author":{"screen_name":"Space_Station","name":"International Space Station","avatar_url":null,"url":"https://x.com/Space_Station"},"likes":3,
   "media":{"photos":[{"type":"photo","url":"https://pbs.twimg.com/media/q.jpg","width":1200,"height":800,"altText":"The station"}]},
   "quote":{"type":"status","text":"deeper","author":{"screen_name":"x","name":"x"}}},
 "poll":{"choices":[{"label":"Yes","count":30,"percentage":75},{"label":"No","count":10,"percentage":25}],"total_votes":40,"ends_at":"2026-10-02T12:00:00.000Z","time_left_en":"1 day left"},
 "community_note":{"text":"Readers added context."}
}}`

func TestFxTwitterPost(t *testing.T) {
	f, _ := network(t, map[string]http.Handler{
		"api.fxtwitter.com": paths(map[string]http.Handler{"/2/status/2105315677045203022": jsonBody(fxStatusJSON)}),
	})
	// pasted through a fixer domain: the card is the post's all the same
	r, p := mustPost(t, f, "https://fxtwitter.com/NASA/status/2105315677045203022")
	if r.URL != "https://fxtwitter.com/NASA/status/2105315677045203022" {
		t.Errorf("the card keeps the address as it was pasted, got %q", r.URL)
	}
	if p.Platform != "twitter" || p.Site != "X" || p.URL != "https://x.com/NASA/status/2105315677045203022" {
		t.Errorf("platform %q site %q url %q", p.Platform, p.Site, p.URL)
	}
	if p.Name != "NASA" || p.Handle != "NASA" || !p.Verified || p.Avatar == "" || p.AuthorURL != "https://x.com/NASA" {
		t.Errorf("author: %+v", p)
	}
	if p.Text != "New crew soon!\n\nCrew-13 launches tomorrow." || p.Created != 1790781346000 {
		t.Errorf("text %q created %d", p.Text, p.Created)
	}
	// a count written as a string or as null is still a count, or none
	if p.Replies != 116 || p.Reposts != 337 || p.Likes != 2110 || p.Views != 625078 {
		t.Errorf("counts: %d %d %d %d", p.Replies, p.Reposts, p.Likes, p.Views)
	}
	if p.ReplyTo != "Space_Station" || p.Note != "Readers added context." {
		t.Errorf("reply to %q, note %q", p.ReplyTo, p.Note)
	}
	if len(p.Media) != 3 {
		t.Fatalf("media: %+v", p.Media)
	}
	// the 720p copy, not the stream and not the ten megabit original
	if v := p.Media[0]; v.Kind != "video" || v.URL != "https://video.twimg.com/v/1280x720/a.mp4" || v.Thumb != "https://pbs.twimg.com/media/t.png" || v.W != 720 || v.H != 405 || v.Duration != 61.494 {
		t.Errorf("video: %+v", v)
	}
	// X's GIFs are short videos; a GIF that is a picture file stays a picture
	if g := p.Media[1]; g.Kind != "gif" || g.URL != "https://video.twimg.com/tweet_video/g.mp4" {
		t.Errorf("gif: %+v", g)
	}
	if g := p.Media[2]; g.Kind != "photo" || g.URL != "https://media.tenor.com/abc/cat.gif" {
		t.Errorf("gif picture: %+v", g)
	}
	q := p.Quote
	if q == nil || q.Handle != "Space_Station" || q.Text != "Docking soon" || q.Platform != "twitter" || len(q.Media) != 1 || q.Media[0].Alt != "The station" {
		t.Fatalf("quote: %+v", q)
	}
	if q.Quote != nil {
		t.Error("a quote carries no quote of its own")
	}
	if p.Poll == nil || len(p.Poll.Choices) != 2 || p.Poll.Choices[0].Label != "Yes" || p.Poll.Choices[0].Percent != 75 || p.Poll.Votes != 40 || p.Poll.Ends == 0 {
		t.Errorf("poll: %+v", p.Poll)
	}
	// The same post as a plain card, for an app from before posts had their own.
	if r.Type != "link" || r.SiteName != "X" || r.Title != "NASA" || r.Description != p.Text || r.PublishedAt != p.Created {
		t.Errorf("plain card: %+v", r)
	}
	if r.Media != p.Media[0].URL || r.MediaKind != "video" || r.Image != p.Media[0].Thumb || r.Icon == "" || r.Color == "" {
		t.Errorf("plain card media: media %q image %q", r.Media, r.Image)
	}
}

const syndicationJSON = `{"__typename":"Tweet","id_str":"20","text":"Tom &amp; Jerry at https://t.co/abc https://t.co/media1","display_text_range":[0,35],
 "created_at":"2026-09-30T12:00:00.000Z","favorite_count":5,"conversation_count":2,"possibly_sensitive":true,"in_reply_to_screen_name":"biz",
 "user":{"name":"Jack","screen_name":"jack","profile_image_url_https":"https://pbs.twimg.com/profile_images/1/a_normal.jpg","verified":false,"is_blue_verified":true},
 "entities":{"urls":[{"url":"https://t.co/abc","expanded_url":"https://example.com/article","display_url":"example.com/article","indices":[19,35]}]},
 "mediaDetails":[{"type":"animated_gif","media_url_https":"https://pbs.twimg.com/tweet_video_thumb/g.jpg","original_info":{"width":400,"height":300},
   "video_info":{"variants":[{"bitrate":0,"content_type":"video/mp4","url":"https://video.twimg.com/tweet_video/g.mp4"}]}},
  {"type":"video","media_url_https":"https://pbs.twimg.com/media/v.jpg","original_info":{"width":1280,"height":720},
   "video_info":{"duration_millis":12500,"variants":[{"content_type":"application/x-mpegURL","url":"https://video.twimg.com/v/pl.m3u8"},{"bitrate":832000,"content_type":"video/mp4","url":"https://video.twimg.com/v/360.mp4"},{"bitrate":9000000,"content_type":"video/mp4","url":"https://video.twimg.com/v/1080.mp4"}]}}],
 "quoted_tweet":{"id_str":"7","text":"quoted words","user":{"name":"Biz","screen_name":"biz","profile_image_url_https":"https://pbs.twimg.com/profile_images/2/b_normal.jpg"}}}`

const vxTweetJSON = `{"text":"hello from vx","user_name":"Jack","user_screen_name":"jack","user_profile_image_url":"https://pbs.twimg.com/profile_images/1/a_normal.jpg",
 "likes":1,"retweets":2,"replies":3,"date_epoch":1790781346,"tweetURL":"https://twitter.com/jack/status/20","possibly_sensitive":false,"replyingTo":null,
 "media_extended":[{"type":"image","url":"https://pbs.twimg.com/media/p.jpg","size":{"width":10,"height":20},"altText":"a picture"}],"qrt":null}`

const ogOnlyPage = `<html><head><title>x</title><meta property="og:title" content="Jack on X"><meta property="og:description" content="just the tags"></head><body></body></html>`

// Each source that fails hands the post to the next, down to the page's own tags.
func TestTwitterFallsThroughItsSources(t *testing.T) {
	// FxTwitter down: X's own embed endpoint answers.
	f, n := network(t, map[string]http.Handler{
		"api.fxtwitter.com":         down(),
		"cdn.syndication.twimg.com": paths(map[string]http.Handler{"/tweet-result": jsonBody(syndicationJSON)}),
	})
	_, p := mustPost(t, f, "https://x.com/jack/status/20")
	// the readable part of the text, its short link opened up, its escapes undone
	if p.Text != "Tom & Jerry at https://example.com/article" {
		t.Errorf("text: %q", p.Text)
	}
	if p.Name != "Jack" || p.Handle != "jack" || !p.Verified || p.ReplyTo != "biz" || !p.Sensitive || p.Likes != 5 || p.Replies != 2 {
		t.Errorf("post: %+v", p)
	}
	if p.Avatar != "https://pbs.twimg.com/profile_images/1/a_200x200.jpg" || p.URL != "https://x.com/jack/status/20" {
		t.Errorf("avatar %q url %q", p.Avatar, p.URL)
	}
	if len(p.Media) != 2 || p.Media[0].Kind != "gif" || p.Media[0].URL != "https://video.twimg.com/tweet_video/g.mp4" {
		t.Fatalf("media: %+v", p.Media)
	}
	if v := p.Media[1]; v.Kind != "video" || v.URL != "https://video.twimg.com/v/360.mp4" || v.Duration != 12.5 || v.Thumb != "https://pbs.twimg.com/media/v.jpg" {
		t.Errorf("video: %+v", v)
	}
	if p.Quote == nil || p.Quote.Handle != "biz" || p.Quote.Text != "quoted words" || p.Quote.URL != "https://x.com/biz/status/7" {
		t.Errorf("quote: %+v", p.Quote)
	}
	// asked first, and once more after its server error, which is often gone a moment later
	if got := n.asked("api.fxtwitter.com/2/status/20"); got != 2 {
		t.Errorf("FxTwitter was asked %d times", got)
	}

	// Both down: vxTwitter answers.
	f, _ = network(t, map[string]http.Handler{
		"api.vxtwitter.com": paths(map[string]http.Handler{"/Twitter/status/20": jsonBody(vxTweetJSON)}),
	})
	_, p = mustPost(t, f, "https://twitter.com/jack/status/20")
	if p.Text != "hello from vx" || p.Reposts != 2 || len(p.Media) != 1 || p.Media[0].Kind != "photo" || p.Media[0].Alt != "a picture" {
		t.Errorf("vx post: %+v", p)
	}
	if p.URL != "https://x.com/jack/status/20" {
		t.Errorf("one address for a post whichever source wrote it, got %q", p.URL)
	}

	// Every source down: the link still gets the card any link gets.
	f, _ = network(t, map[string]http.Handler{"x.com": body("text/html", ogOnlyPage)})
	r := mustFetch(t, f, "https://x.com/jack/status/20")
	if r.Post != nil || r.Title != "Jack on X" || r.Description != "just the tags" {
		t.Errorf("fallback card: %+v", r)
	}

	// A post that is gone answers with a tombstone, which is no post.
	f, _ = network(t, map[string]http.Handler{
		"cdn.syndication.twimg.com": jsonBody(`{"__typename":"TweetTombstone","tombstone":{"text":{"text":"This Post is unavailable."}}}`),
		"x.com":                     body("text/html", ogOnlyPage),
	})
	if r := mustFetch(t, f, "https://x.com/jack/status/20"); r.Post != nil {
		t.Errorf("a tombstone made a post: %+v", r.Post)
	}
}

// The public fixers answer 500 now and then and are fine a moment later. A
// card lost to that is lost for good, so such a source is asked once more.
func TestServerErrorIsAskedOnceMore(t *testing.T) {
	oldPause := postRetryPause
	postRetryPause = 10 * time.Millisecond
	t.Cleanup(func() { postRetryPause = oldPause })
	asked := 0
	flaky := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked++
		if asked == 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"code":500,"status":null}`))
			return
		}
		jsonBody(`{"code":200,"status":{"url":"https://x.com/gem/status/20","text":"Ten minutes!","author":{"name":"Gem","screen_name":"gem"}}}`).ServeHTTP(w, r)
	})
	f, _ := network(t, map[string]http.Handler{"api.fxtwitter.com": flaky})
	if _, p := mustPost(t, f, "https://x.com/gem/status/20"); p.Text != "Ten minutes!" || asked != 2 {
		t.Errorf("post %+v after %d requests", p, asked)
	}

	// a post that is not there is not asked for again
	missing := 0
	f, _ = network(t, map[string]http.Handler{
		"api.fxtwitter.com": http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			missing++
			http.NotFound(w, r)
		}),
		"x.com": body("text/html", ogOnlyPage),
	})
	if r := mustFetch(t, f, "https://x.com/gem/status/20"); r.Post != nil || missing != 1 {
		t.Errorf("a missing post: %+v after %d requests", r.Post, missing)
	}
}

// A source that hangs is left behind after its share of the time, and the
// next one is asked.
func TestSlowSourceIsLeftBehind(t *testing.T) {
	oldBudget, oldWait := postBudget, postSourceWait
	postBudget, postSourceWait = 2*time.Second, 150*time.Millisecond
	t.Cleanup(func() { postBudget, postSourceWait = oldBudget, oldWait })
	f, _ := network(t, map[string]http.Handler{
		"api.fxtwitter.com": http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			select {
			case <-r.Context().Done():
			case <-time.After(3 * time.Second):
			}
		}),
		"cdn.syndication.twimg.com": jsonBody(syndicationJSON),
	})
	started := time.Now()
	_, p := mustPost(t, f, "https://x.com/jack/status/20")
	if took := time.Since(started); took > 1500*time.Millisecond {
		t.Errorf("waited %s on a source that hung", took)
	}
	if p.Name != "Jack" {
		t.Errorf("post: %+v", p)
	}
}

func TestBlueskyPost(t *testing.T) {
	text := "Read this: example.com/a-long-pa... #sky"
	label, tag := "example.com/a-long-pa...", "#sky"
	at, tagAt := strings.Index(text, label), strings.Index(text, tag)
	thread := fmt.Sprintf(`{"thread":{"$type":"app.bsky.feed.defs#threadViewPost","post":{
 "uri":"at://did:plc:alice/app.bsky.feed.post/3kabc","cid":"c",
 "author":{"did":"did:plc:alice","handle":"alice.test","displayName":"Alice","avatar":"https://cdn.bsky.app/img/avatar/plain/did:plc:alice/a@jpeg","verification":{"verifiedStatus":"valid"}},
 "record":{"$type":"app.bsky.feed.post","text":%q,"createdAt":"2026-09-30T10:00:00.000Z",
   "facets":[{"index":{"byteStart":%d,"byteEnd":%d},"features":[{"$type":"app.bsky.richtext.facet#tag","tag":"sky"}]},
             {"index":{"byteStart":%d,"byteEnd":%d},"features":[{"$type":"app.bsky.richtext.facet#link","uri":"https://example.com/a-long-path/to/the/article"}]}]},
 "embed":{"$type":"app.bsky.embed.recordWithMedia#view",
   "media":{"$type":"app.bsky.embed.images#view","images":[{"thumb":"https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/i1@jpeg","fullsize":"https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/i1@jpeg","alt":"A sky","aspectRatio":{"width":2000,"height":1500}}]},
   "record":{"record":{"$type":"app.bsky.embed.record#viewRecord","uri":"at://did:plc:bob/app.bsky.feed.post/3kq","author":{"did":"did:plc:bob","handle":"bob.test","displayName":"Bob"},
     "value":{"text":"Original","createdAt":"2026-09-29T10:00:00.000Z"},
     "embeds":[{"$type":"app.bsky.embed.video#view","cid":"bafyvideo","playlist":"https://video.bsky.app/watch/x/playlist.m3u8","thumbnail":"https://video.bsky.app/watch/x/thumbnail.jpg","aspectRatio":{"width":1080,"height":1920}}],"likeCount":4}}},
 "replyCount":1,"repostCount":2,"likeCount":3,"labels":[{"val":"porn"}]}}}`, text, tagAt, tagAt+len(tag), at, at+len(label))

	f, n := network(t, map[string]http.Handler{
		"public.api.bsky.app": paths(map[string]http.Handler{"/xrpc/app.bsky.feed.getPostThread": http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := r.URL.Query().Get("uri"); got != "at://alice.test/app.bsky.feed.post/3kabc" {
				http.Error(w, "wrong post "+got, http.StatusBadRequest)
				return
			}
			jsonBody(thread).ServeHTTP(w, r)
		})}),
		"plc.directory": paths(map[string]http.Handler{"/did:plc:bob": jsonBody(`{"service":[{"id":"#atproto_labeler","serviceEndpoint":"https://labels.test"},{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.bob.test"}]}`)}),
	})
	_, p := mustPost(t, f, "https://bsky.app/profile/alice.test/post/3kabc")
	if p.Site != "Bluesky" || p.Name != "Alice" || p.Handle != "alice.test" || !p.Verified || p.AuthorURL != "https://bsky.app/profile/alice.test" {
		t.Errorf("author: %+v", p)
	}
	if p.Text != text || p.Replies != 1 || p.Reposts != 2 || p.Likes != 3 || !p.Sensitive || p.Created == 0 {
		t.Errorf("post: %+v", p)
	}
	// the address behind the shortened link and behind the tag, in the text's order
	if len(p.Links) != 2 || p.Links[0] != (PostLink{Text: label, URL: "https://example.com/a-long-path/to/the/article"}) || p.Links[1] != (PostLink{Text: "#sky", URL: "https://bsky.app/hashtag/sky"}) {
		t.Errorf("links: %+v", p.Links)
	}
	if len(p.Media) != 1 || p.Media[0].Kind != "photo" || !strings.Contains(p.Media[0].URL, "feed_fullsize") || p.Media[0].W != 2000 || p.Media[0].H != 1500 || p.Media[0].Alt != "A sky" {
		t.Errorf("media: %+v", p.Media)
	}
	q := p.Quote
	if q == nil || q.Name != "Bob" || q.Text != "Original" || q.URL != "https://bsky.app/profile/bob.test/post/3kq" || q.Likes != 4 || len(q.Media) != 1 {
		t.Fatalf("quote: %+v", q)
	}
	// the file as it was uploaded, from the server the account keeps its data on
	if v := q.Media[0]; v.Kind != "video" || v.URL != "https://pds.bob.test/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Abob&cid=bafyvideo" || v.Thumb == "" || v.W != 1080 {
		t.Errorf("quoted video: %+v", v)
	}
	if n.asked("plc.directory/did:plc:bob") != 1 {
		t.Error("the account's server is looked up once")
	}

	// Bluesky's own API down: FxBluesky answers in the shared format.
	f, _ = network(t, map[string]http.Handler{
		"api.fxbsky.app": paths(map[string]http.Handler{"/2/status/alice.test/3kabc": jsonBody(`{"code":200,"status":{"url":"https://bsky.app/profile/alice.test/post/3kabc","text":"From the fixer","author":{"name":"Alice","screen_name":"alice.test","avatar_url":"https://cdn.bsky.app/a.jpg"},"likes":9,"created_timestamp":1790781346}}`)}),
	})
	_, p = mustPost(t, f, "https://bsky.app/profile/alice.test/post/3kabc")
	if p.Text != "From the fixer" || p.Likes != 9 || p.Platform != "bluesky" {
		t.Errorf("fxbsky post: %+v", p)
	}
}

// An account whose own server cannot be found still plays, from the copy
// FxBluesky keeps.
func TestBlueskyVideoWithoutItsServer(t *testing.T) {
	thread := `{"thread":{"post":{"uri":"at://did:plc:alice/app.bsky.feed.post/3kabc","author":{"did":"did:plc:alice","handle":"alice.test"},
 "record":{"text":"a clip","createdAt":"2026-09-30T10:00:00.000Z"},
 "embed":{"$type":"app.bsky.embed.video#view","cid":"bafyclip","thumbnail":"https://video.bsky.app/t.jpg","presentation":"gif","aspectRatio":{"width":4,"height":3}}}}}`
	f, _ := network(t, map[string]http.Handler{"public.api.bsky.app": jsonBody(thread)})
	_, p := mustPost(t, f, "https://bsky.app/profile/alice.test/post/3kabc")
	if len(p.Media) != 1 || p.Media[0].Kind != "gif" || p.Media[0].URL != "https://pds-cache.fxbsky.app/did:plc:alice/bafyclip" {
		t.Errorf("media: %+v", p.Media)
	}
}

const tiktokData = `{"__DEFAULT_SCOPE__":{"webapp.app-context":{"language":"en"},"webapp.video-detail":{"itemInfo":{"itemStruct":{
 "id":"6718335390845095173","desc":"Guess my name #pets","createTime":"1564234358",
 "author":{"uniqueId":"scout2015","nickname":"Scout","avatarMedium":"https://p16.tiktokcdn.com/avatar.jpeg?x-expires=1","verified":true},
 "stats":{"diggCount":35200,"shareCount":1496,"commentCount":5844,"playCount":159400},
 "video":{"width":576,"height":1024,"duration":10,"cover":"https://p16.tiktokcdn.com/cover.jpeg?x-expires=1","originCover":"https://p16.tiktokcdn.com/origin.jpeg?x-expires=1",
  "playAddr":"https://v16.tiktok.com/video/needs-cookie",
  "bitrateInfo":[{"CodecType":"h265_hvc1","Bitrate":900000,"PlayAddr":{"UrlList":["https://www.tiktok.com/aweme/v1/play/?file_id=hevc"]}},
                 {"CodecType":"h264","Bitrate":2240963,"PlayAddr":{"UrlList":["https://v16.tiktok.com/video/needs-cookie","https://www.tiktok.com/aweme/v1/play/?file_id=h264"]}}]}}}}}}`

func tiktokPageHTML(data string) string {
	return `<html><head><title>TikTok</title></head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">` + data + `</script></body></html>`
}

// only a browser is given the page's data
func browsersOnly(page string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.UserAgent(), "Chrome/") {
			http.Error(w, "no", http.StatusForbidden)
			return
		}
		body("text/html; charset=utf-8", page).ServeHTTP(w, r)
	})
}

func TestTikTokPost(t *testing.T) {
	const link = "https://www.tiktok.com/@scout2015/video/6718335390845095173"
	f, n := network(t, map[string]http.Handler{
		"www.tiktok.com": paths(map[string]http.Handler{"/@scout2015/video/6718335390845095173": browsersOnly(tiktokPageHTML(tiktokData))}),
	})
	s := &Service{Fetcher: f, Cache: NewCache(10, time.Hour)}
	r, err := s.Lookup(context.Background(), link+"?lang=en")
	if err != nil || r.Post == nil {
		t.Fatalf("lookup: %v %+v", err, r)
	}
	p := r.Post
	if p.Name != "Scout" || p.Handle != "scout2015" || !p.Verified || p.Text != "Guess my name #pets" || p.Created != 1564234358000 {
		t.Errorf("post: %+v", p)
	}
	if p.Likes != 35200 || p.Reposts != 1496 || p.Replies != 5844 || p.Views != 159400 {
		t.Errorf("counts: %+v", p)
	}
	// TikTok signs every address for a few hours, so the card names its
	// files and holds none of them
	if len(p.Media) != 1 || p.Media[0].Kind != "video" || p.Media[0].URL != link+"#nexa-asset=m0" || p.Media[0].Thumb != link+"#nexa-asset=t0" || p.Avatar != link+"#nexa-asset=avatar" {
		t.Fatalf("named files: %+v avatar %q", p.Media, p.Avatar)
	}
	if p.Media[0].W != 576 || p.Media[0].H != 1024 || p.Media[0].Duration != 10 {
		t.Errorf("video shape: %+v", p.Media[0])
	}
	if r.Media != link+"#nexa-asset=m0" || r.Image != link+"#nexa-asset=t0" {
		t.Errorf("plain card files: %q %q", r.Media, r.Image)
	}

	// A name is traded for where the file is today: the copy every browser
	// plays, at the address that needs none of the page's cookies.
	asset := func(name string) *Asset {
		t.Helper()
		u, _ := url.Parse(link + "#nexa-asset=" + name)
		a, named, err := s.Asset(context.Background(), u)
		if !named || err != nil || a == nil {
			t.Fatalf("asset %s: named %v err %v", name, named, err)
		}
		return a
	}
	if a := asset("m0"); a.URL.String() != "https://www.tiktok.com/aweme/v1/play/?file_id=h264" || !strings.Contains(a.Header["User-Agent"], "Chrome/") || a.Header["Referer"] == "" {
		t.Errorf("video asset: %s %v", a.URL, a.Header)
	}
	if a := asset("t0"); a.URL.String() != "https://p16.tiktokcdn.com/origin.jpeg?x-expires=1" {
		t.Errorf("cover asset: %s", a.URL)
	}
	if a := asset("avatar"); a.URL.String() != "https://p16.tiktokcdn.com/avatar.jpeg?x-expires=1" {
		t.Errorf("avatar asset: %s", a.URL)
	}
	// the post read for the card serves its files too: one reading in all
	if got := n.asked("www.tiktok.com/@scout2015/video/6718335390845095173"); got != 1 {
		t.Errorf("the page was read %d times", got)
	}
	// a name the post has no file for, and an ordinary address
	for _, name := range []string{"m5", "x0", "q.m0", ""} {
		u, _ := url.Parse(link + "#nexa-asset=" + name)
		if _, named, err := s.Asset(context.Background(), u); !named || err == nil {
			t.Errorf("asset %q: named %v err %v", name, named, err)
		}
	}
	plainURL, _ := url.Parse("https://example.com/pic.png#top")
	if a, named, err := s.Asset(context.Background(), plainURL); named || err != nil || a != nil {
		t.Errorf("an ordinary address is not a name: %v %v", named, err)
	}

	// A service that never made the card reads the post when first asked,
	// once for everyone asking at that moment.
	s2 := &Service{Fetcher: f}
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			u, _ := url.Parse(link + "#nexa-asset=m0")
			if a, _, err := s2.Asset(context.Background(), u); err != nil || a == nil {
				t.Errorf("concurrent asset: %v", err)
			}
		}()
	}
	wg.Wait()
	if got := n.asked("www.tiktok.com/@scout2015/video/6718335390845095173"); got != 2 {
		t.Errorf("six askers at once should read the page once more, read %d times in all", got)
	}
}

func TestTikTokFallbacks(t *testing.T) {
	// A page whose video only plays with its cookies: the atmosphere API is asked.
	noPlay := strings.ReplaceAll(tiktokData, "/aweme/v1/play/", "/video/tos/")
	atmosphere := `{"code":200,"status":{"url":"https://www.tiktok.com/@scout2015/video/6718335390845095173","text":"Guess my name #pets","author":{"name":"Scout","screen_name":"scout2015","avatar_url":"https://p16.tiktokcdn.com/a.jpeg"},
 "likes":35200,"media":{"all":[{"type":"video","url":"https://api.atmosphere.tools/proxy?url=x","thumbnail_url":"https://p16.tiktokcdn.com/c.jpeg","width":576,"height":1024,"duration":10,"formats":[]}]}}}`
	f, _ := network(t, map[string]http.Handler{
		"www.tiktok.com":       paths(map[string]http.Handler{"/@scout2015/video/6718335390845095173": browsersOnly(tiktokPageHTML(noPlay))}),
		"api.atmosphere.tools": paths(map[string]http.Handler{"/2/tiktok/status/6718335390845095173": jsonBody(atmosphere)}),
	})
	s := &Service{Fetcher: f}
	r, err := s.Lookup(context.Background(), "https://www.tiktok.com/@scout2015/video/6718335390845095173")
	if err != nil || r.Post == nil || len(r.Post.Media) != 1 {
		t.Fatalf("lookup: %v %+v", err, r)
	}
	u, _ := url.Parse(r.Post.Media[0].URL)
	if a, named, err := s.Asset(context.Background(), u); !named || err != nil || a.URL.String() != "https://api.atmosphere.tools/proxy?url=x" {
		t.Errorf("the fallback's file: %v %v", a, err)
	}

	// Both gone: TikTok's oEmbed still has the caption, the author and the
	// cover, which opens the post.
	f, _ = network(t, map[string]http.Handler{
		"www.tiktok.com": paths(map[string]http.Handler{"/oembed": jsonBody(`{"title":"Guess my name #pets","author_name":"Scout","author_unique_id":"scout2015","author_url":"https://www.tiktok.com/@scout2015","thumbnail_url":"https://p16.tiktokcdn.com/c.jpeg","thumbnail_width":576,"thumbnail_height":1024}`)}),
	})
	_, p := mustPost(t, f, "https://www.tiktok.com/@scout2015/video/6718335390845095173")
	if p.Name != "Scout" || p.Handle != "scout2015" || len(p.Media) != 1 || p.Media[0].Kind != "video" || p.Media[0].URL != "" || p.Media[0].Thumb == "" {
		t.Errorf("oembed post: %+v", p)
	}
}

func TestShortLinkIsFollowed(t *testing.T) {
	f, _ := network(t, map[string]http.Handler{
		"vm.tiktok.com": http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1", http.StatusMovedPermanently)
		}),
		"www.tiktok.com": paths(map[string]http.Handler{"/@scout2015/video/6718335390845095173": browsersOnly(tiktokPageHTML(tiktokData))}),
	})
	r, p := mustPost(t, f, "https://vm.tiktok.com/ZMabc123/")
	if p.Handle != "scout2015" || p.URL != "https://www.tiktok.com/@scout2015/video/6718335390845095173" {
		t.Errorf("post: %+v", p)
	}
	if r.URL != "https://vm.tiktok.com/ZMabc123/" {
		t.Errorf("the card keeps the pasted address, got %q", r.URL)
	}

	// a short link that leads somewhere that is not a post is an ordinary link
	f, _ = network(t, map[string]http.Handler{
		"vm.tiktok.com": http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/ZMgone12/" {
				http.Redirect(w, r, "https://www.tiktok.com/", http.StatusFound)
				return
			}
			body("text/html", ogOnlyPage).ServeHTTP(w, r)
		}),
		"www.tiktok.com": body("text/html", ogOnlyPage),
	})
	if r := mustFetch(t, f, "https://vm.tiktok.com/ZMgone12/"); r.Post != nil {
		t.Errorf("a post from a link that led to the front page: %+v", r.Post)
	}
}

const instagramTags = `<html><head>
<meta property="og:title" content="Just An Egg &#x1f95a; on Instagram" />
<meta property="og:image" content="https://scontent.cdninstagram.com/v/egg.jpg?oe=1&amp;stp=s400" />
<meta property="og:url" content="https://www.instagram.com/world_record_egg/p/BsOGulcndj-/" />
<meta property="og:description" content="Let&#x2019;s set a world record together and get the most liked post on Ins..." />
<meta name="twitter:title" content="Just An Egg &#x1f95a; (&#064;world_record_egg) &#x2022; Instagram photo" />
</head><body></body></html>`

// The embed page of a reel or a carousel hands Instagram's own script the
// post as a JSON text inside a string, with the script around it.
func instagramEmbedScript(media string) string {
	context, _ := json.Marshal(`{"context":{"type":"GraphVideo"},"gql_data":{"shortcode_media":` + media + `}}`)
	return `<html><body><div class="Embed" data-media-type="GraphVideo"></div>
<script nonce="x">requireLazy(["TimeSliceImpl","ServerJS"],function(TimeSlice,ServerJS){var s=(new ServerJS());s.handle({"require":[["PolarisEmbedSimple","init",[],[{"isRichEmbed":true,"contextJSON":` + string(context) + `}]]]});});</script></body></html>`
}

// A single picture's embed page is all markup.
const instagramEmbedMarkup = `<html><body><div class="Embed" data-media-type="GraphImage"><div class="Header">
<div class="AvatarContainer"><a class="Avatar" href="https://www.instagram.com/world_record_egg/"><img src="https://scontent.cdninstagram.com/avatar.jpg?oe=1" alt="world_record_egg" /></a></div>
<div class="HeaderText"><a class="Username" href="https://www.instagram.com/world_record_egg/"><span class="UsernameText">world_record_egg</span><i class="Sprite VerifiedSprite"><u>Verified</u></i></a></div></div>
<div class="Content EmbedFrame"><a class="EmbeddedMedia" href="https://www.instagram.com/p/BsOGulcndj-/"><img class="EmbeddedMediaImage" alt="Instagram post" src="https://scontent.cdninstagram.com/egg_640.jpg?oe=1" srcset="https://scontent.cdninstagram.com/egg_640.jpg?oe=1 640w,https://scontent.cdninstagram.com/egg_1080.jpg?oe=1 1080w,https://scontent.cdninstagram.com/egg_750.jpg?oe=1 750w" /></a></div>
<div class="SocialProof"><a href="https://www.instagram.com/p/BsOGulcndj-/">60,292,678 likes</a></div>
<div class="Caption"><a class="CaptionUsername" href="https://www.instagram.com/world_record_egg/">world_record_egg</a><br/><br/>Let’s set a world record together.<br/><br/>#LikeTheEgg<div class="CaptionComments"><a href="https://www.instagram.com/p/BsOGulcndj-/">View all 3,773,089 comments</a></div></div>
</div></body></html>`

func TestInstagramPost(t *testing.T) {
	const link = "https://www.instagram.com/p/BsOGulcndj-/"
	reel := `{"__typename":"GraphVideo","shortcode":"BsOGulcndj-","dimensions":{"height":1280,"width":720},"display_url":"https://scontent.cdninstagram.com/poster.jpg?oe=1","is_video":true,
 "video_url":"https://scontent.cdninstagram.com/reel.mp4?oe=1&x=2","video_duration":4.166,"video_view_count":19183516,
 "edge_media_to_caption":{"edges":[{"node":{"text":"nature’s tiniest water cup 🌷\n#InTheMoment"}}]},"edge_media_to_comment":{"count":9168},"edge_liked_by":{"count":429314},
 "owner":{"username":"instagram","full_name":"Instagram","profile_pic_url":"https://scontent.cdninstagram.com/avatar.jpg?oe=1","is_verified":true}}`
	f, n := network(t, map[string]http.Handler{
		"www.instagram.com": paths(map[string]http.Handler{"/p/BsOGulcndj-/embed/captioned/": body("text/html; charset=utf-8", instagramEmbedScript(reel))}),
	})
	// a reel link, a fixer domain: the same post, from Instagram's own embed page
	_, p := mustPost(t, f, "https://www.ddinstagram.com/reel/BsOGulcndj-/?igsh=abc")
	if p.Name != "Instagram" || p.Handle != "instagram" || !p.Verified || p.Likes != 429314 || p.Replies != 9168 || p.Views != 19183516 || p.URL != link {
		t.Errorf("post: %+v", p)
	}
	if p.Text != "nature’s tiniest water cup 🌷\n#InTheMoment" || p.AuthorURL != "https://www.instagram.com/instagram/" {
		t.Errorf("text %q author %q", p.Text, p.AuthorURL)
	}
	// when it was posted is in the code itself
	if p.Created != 1546621545106 {
		t.Errorf("created: %d", p.Created)
	}
	// Instagram's addresses are signed for a few days: the card names the files
	if len(p.Media) != 1 || p.Media[0].Kind != "video" || p.Media[0].URL != link+"#nexa-asset=m0" || p.Media[0].Thumb != link+"#nexa-asset=t0" || p.Avatar != link+"#nexa-asset=avatar" || p.Media[0].W != 720 || p.Media[0].Duration != 4.166 {
		t.Errorf("named files: %+v", p.Media)
	}
	if n.asked("api.atmosphere.tools/2/instagram/status/BsOGulcndj-") != 0 {
		t.Error("nobody else's service is asked while Instagram's own page answers")
	}

	// A carousel: every picture, in order.
	carousel := `{"__typename":"GraphSidecar","dimensions":{"height":1350,"width":1080},"display_url":"https://scontent.cdninstagram.com/1.jpg","is_video":false,
 "owner":{"username":"natgeo","full_name":"National Geographic"},
 "edge_sidecar_to_children":{"edges":[{"node":{"dimensions":{"height":1350,"width":1080},"display_url":"https://scontent.cdninstagram.com/1.jpg","is_video":false,"accessibility_caption":"A lion"}},
   {"node":{"dimensions":{"height":1350,"width":1080},"display_url":"https://scontent.cdninstagram.com/2.jpg","is_video":true,"video_url":"https://scontent.cdninstagram.com/2.mp4","video_duration":9}}]}}`
	f, _ = network(t, map[string]http.Handler{"www.instagram.com": paths(map[string]http.Handler{"/p/BsOGulcndj-/embed/captioned/": body("text/html", instagramEmbedScript(carousel))})})
	s := &Service{Fetcher: f}
	r, err := s.Lookup(context.Background(), link)
	if err != nil || r.Post == nil || len(r.Post.Media) != 2 {
		t.Fatalf("carousel: %v %+v", err, r)
	}
	if m := r.Post.Media; m[0].Kind != "photo" || m[0].Alt != "A lion" || m[1].Kind != "video" || m[1].Duration != 9 {
		t.Errorf("carousel media: %+v", m)
	}
	u, _ := url.Parse(r.Post.Media[1].URL)
	if a, _, err := s.Asset(context.Background(), u); err != nil || a.URL.String() != "https://scontent.cdninstagram.com/2.mp4" {
		t.Errorf("the carousel's video: %v %v", a, err)
	}

	// A single picture: the embed page is markup, and the account's name is
	// in the title of the post's own page, read beside it.
	f, _ = network(t, map[string]http.Handler{
		"www.instagram.com": paths(map[string]http.Handler{
			"/p/BsOGulcndj-/embed/captioned/": body("text/html; charset=utf-8", instagramEmbedMarkup),
			"/p/BsOGulcndj-/":                 body("text/html; charset=utf-8", instagramTags),
		}),
	})
	s = &Service{Fetcher: f}
	r, err = s.Lookup(context.Background(), link)
	if err != nil || r.Post == nil {
		t.Fatalf("lookup: %v %+v", err, r)
	}
	p = r.Post
	if p.Name != "Just An Egg 🥚" || p.Handle != "world_record_egg" || !p.Verified || p.Likes != 60292678 {
		t.Errorf("post from markup: %+v", p)
	}
	// the caption without the author's name before it or the comments link after
	if p.Text != "Let’s set a world record together.\n\n#LikeTheEgg" {
		t.Errorf("caption: %q", p.Text)
	}
	u, _ = url.Parse(p.Media[0].URL)
	if a, _, err := s.Asset(context.Background(), u); err != nil || a.URL.String() != "https://scontent.cdninstagram.com/egg_1080.jpg?oe=1" {
		t.Errorf("the largest picture the page offers: %v %v", a, err)
	}

	// The embed page gone: the atmosphere API, in the shared format.
	atmosphere := `{"code":200,"status":{"url":"https://www.instagram.com/p/BsOGulcndj-/","text":"Let’s set a world record together","author":{"name":"Just An Egg 🥚","screen_name":"world_record_egg","avatar_url":"https://scontent.cdninstagram.com/avatar.jpg?oe=1","verification":{"verified":true}},
 "likes":60292701,"replies":3773089,"created_timestamp":1546621545,
 "media":{"all":[{"type":"photo","url":"https://scontent.cdninstagram.com/1.jpg?oe=1","width":1080,"height":1080}]}}}`
	f, _ = network(t, map[string]http.Handler{
		"api.atmosphere.tools": paths(map[string]http.Handler{"/2/instagram/status/BsOGulcndj-": jsonBody(atmosphere)}),
	})
	if _, p := mustPost(t, f, link); p.Name != "Just An Egg 🥚" || p.Likes != 60292701 || len(p.Media) != 1 || p.Created != 1546621545000 {
		t.Errorf("post from the fixer: %+v", p)
	}

	// Both gone: Instagram's own tags for a crawler, and its oEmbed for the
	// caption the tags cut short.
	f, _ = network(t, map[string]http.Handler{
		"www.instagram.com": paths(map[string]http.Handler{
			"/p/BsOGulcndj-/": body("text/html; charset=utf-8", instagramTags),
			"/api/v1/oembed/": jsonBody(`{"title":"Let’s set a world record together and get the most liked post on Instagram.","author_name":"world_record_egg","thumbnail_url":"https://x/y.jpg"}`),
		}),
	})
	s = &Service{Fetcher: f}
	r, err = s.Lookup(context.Background(), link)
	if err != nil || r.Post == nil {
		t.Fatalf("lookup: %v %+v", err, r)
	}
	p = r.Post
	if p.Name != "Just An Egg 🥚" || p.Handle != "world_record_egg" || p.Text != "Let’s set a world record together and get the most liked post on Instagram." || p.AuthorURL != "https://www.instagram.com/world_record_egg/" || p.Created != 1546621545106 {
		t.Errorf("post from tags: %+v", p)
	}
	if len(p.Media) != 1 || p.Media[0].Kind != "photo" {
		t.Fatalf("media: %+v", p.Media)
	}
	u, _ = url.Parse(p.Media[0].URL)
	if a, _, err := s.Asset(context.Background(), u); err != nil || a.URL.String() != "https://scontent.cdninstagram.com/v/egg.jpg?oe=1&stp=s400" {
		t.Errorf("the picture's address: %v %v", a, err)
	}

	// what Instagram writes for a visitor who is not a crawler, counts and all
	m := instagramDescRe.FindStringSubmatch(`60M likes, 3.7M comments - world_record_egg on January 4, 2019: "Let’s set a "world" record.".`)
	if m == nil || count(m[1]) != 60_000_000 || count(m[2]) != 3_700_000 || m[3] != "world_record_egg" || m[4] != `Let’s set a "world" record.` {
		t.Errorf("description: %q", m)
	}
}

const redditListing = `[{"kind":"Listing","data":{"children":[{"kind":"t3","data":{
 "id":"abc123","title":"Two cats & a dog","selftext":"","selftext_html":null,"author":"catperson","subreddit_name_prefixed":"r/aww","score":50789,"num_comments":802,
 "created_utc":1790472036.0,"over_18":false,"spoiler":false,"permalink":"/r/aww/comments/abc123/two_cats_a_dog/","url_overridden_by_dest":"https://www.reddit.com/gallery/abc123","is_self":false,
 "gallery_data":{"items":[{"media_id":"m2","id":1,"caption":"the dog"},{"media_id":"m1","id":2},{"media_id":"gone","id":3}]},
 "media_metadata":{"m1":{"status":"valid","e":"Image","m":"image/jpg","s":{"y":800,"x":1200,"u":"https://preview.redd.it/m1.jpg?width=1200&s=aa"}},
                   "m2":{"status":"valid","e":"AnimatedImage","m":"image/gif","s":{"y":300,"x":400,"gif":"https://i.redd.it/m2.gif","mp4":"https://preview.redd.it/m2.mp4"}}}
}}]}},{"kind":"Listing","data":{"children":[]}}]`

const redditFeedXML = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><category term="funny" label="r/funny"/><title>A clip : funny</title>
<entry><author><name>/u/commenter</name></author><content type="html">a comment</content><id>t1_zzz</id><title>/u/commenter on A clip</title></entry>
<entry><author><name>/u/tyrano_dyroc</name><uri>https://www.reddit.com/user/tyrano_dyroc</uri></author><category term="funny" label="r/funny"/>
<content type="html">&lt;table&gt; &lt;tr&gt;&lt;td&gt; &lt;a href=&quot;https://www.reddit.com/r/funny/comments/abc123/a_clip/&quot;&gt; &lt;img src=&quot;https://external-preview.redd.it/thumb.png?width=640&amp;amp;s=bb&quot; alt=&quot;A clip&quot; /&gt; &lt;/a&gt; &lt;/td&gt;&lt;td&gt; &lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Filmed it &lt;a href=&quot;/r/aww&quot;&gt;over here&lt;/a&gt;.&lt;/p&gt; &lt;p&gt;Second paragraph.&lt;/p&gt; &lt;/div&gt;&lt;!-- SC_ON --&gt; &amp;#32; submitted by &amp;#32; &lt;a href=&quot;https://www.reddit.com/user/tyrano_dyroc&quot;&gt; /u/tyrano_dyroc &lt;/a&gt; &lt;br/&gt; &lt;span&gt;&lt;a href=&quot;https://v.redd.it/vid123abc&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt; &amp;#32; &lt;span&gt;&lt;a href=&quot;https://www.reddit.com/r/funny/comments/abc123/a_clip/&quot;&gt;[comments]&lt;/a&gt;&lt;/span&gt; &lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</content>
<id>t3_abc123</id><media:thumbnail url="https://external-preview.redd.it/thumb.png?width=640&amp;s=bb" /><link href="https://www.reddit.com/r/funny/comments/abc123/a_clip/" /><updated>2026-09-27T01:20:36+00:00</updated><published>2026-09-27T01:20:36+00:00</published><title>A clip</title></entry></feed>`

const redditManifest = `<?xml version="1.0" encoding="UTF-8"?>
<MPD mediaPresentationDuration="PT1M3.5S" xmlns="urn:mpeg:dash:schema:mpd:2011"><Period duration="PT63.5S">
<AdaptationSet contentType="audio" segmentAlignment="true"><Representation bandwidth="66000" id="5" mimeType="audio/mp4"><BaseURL>CMAF_AUDIO_64.mp4</BaseURL></Representation>
<Representation bandwidth="132000" id="6" mimeType="audio/mp4"><BaseURL>CMAF_AUDIO_128.mp4</BaseURL></Representation></AdaptationSet>
<AdaptationSet contentType="video" maxHeight="1920"><Representation bandwidth="800000" height="640" id="2" mimeType="video/mp4" width="360"><BaseURL>CMAF_360.mp4</BaseURL></Representation>
<Representation bandwidth="2400000" height="1280" id="4" mimeType="video/mp4" width="720"><BaseURL>CMAF_720.mp4</BaseURL></Representation>
<Representation bandwidth="5200000" height="1920" id="5" mimeType="video/mp4" width="1080"><BaseURL>CMAF_1080.mp4</BaseURL></Representation>
<Representation bandwidth="100" height="1" id="9" mimeType="video/mp4" width="1"><BaseURL>https://elsewhere.test/evil.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`

func TestRedditPost(t *testing.T) {
	// Where Reddit gives its JSON: the whole post, a gallery in its order.
	f, _ := network(t, map[string]http.Handler{
		"www.reddit.com": paths(map[string]http.Handler{"/comments/abc123.json": jsonBody(redditListing)}),
	})
	_, p := mustPost(t, f, "https://redd.it/abc123")
	if p.Site != "Reddit" || p.Title != "Two cats & a dog" || p.Community != "r/aww" || p.CommunityURL != "https://www.reddit.com/r/aww/" || p.Name != "u/catperson" || p.Handle != "" {
		t.Errorf("post: %+v", p)
	}
	if p.Likes != 50789 || p.Replies != 802 || p.Created != 1790472036000 || p.URL != "https://www.reddit.com/r/aww/comments/abc123/two_cats_a_dog/" {
		t.Errorf("counts and address: %+v", p)
	}
	if len(p.Media) != 2 || p.Media[0].URL != "https://i.redd.it/m2.gif" || p.Media[0].Alt != "the dog" || p.Media[1].URL != "https://preview.redd.it/m1.jpg?width=1200&s=aa" || p.Media[1].W != 1200 || p.Media[1].H != 800 {
		t.Errorf("gallery: %+v", p.Media)
	}

	// Where it refuses, which is most servers: the post's feed, and the
	// video's manifest for its picture and its sound.
	f, n := network(t, map[string]http.Handler{
		"www.reddit.com": paths(map[string]http.Handler{
			"/comments/abc123.json": http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "<html>Blocked</html>", http.StatusForbidden)
			}),
			"/comments/abc123/.rss": body("application/atom+xml; charset=UTF-8", redditFeedXML),
		}),
		"v.redd.it": paths(map[string]http.Handler{"/vid123abc/DASHPlaylist.mpd": body("application/dash+xml", redditManifest)}),
	})
	r, p := mustPost(t, f, "https://www.reddit.com/r/funny/comments/abc123/a_clip/")
	if p.Title != "A clip" || p.Community != "r/funny" || p.Name != "u/tyrano_dyroc" || p.AuthorURL != "https://www.reddit.com/user/tyrano_dyroc" || p.Created == 0 {
		t.Errorf("post from the feed: %+v", p)
	}
	// only the post's own words, as paragraphs, with where its link goes
	if p.Text != "Filmed it over here.\n\nSecond paragraph." || len(p.Links) != 1 || p.Links[0] != (PostLink{Text: "over here", URL: "https://www.reddit.com/r/aww"}) {
		t.Errorf("text %q links %+v", p.Text, p.Links)
	}
	if len(p.Media) != 1 {
		t.Fatalf("media: %+v", p.Media)
	}
	// the size a chat needs, the better sound, and never a file from elsewhere
	if v := p.Media[0]; v.Kind != "video" || v.URL != "https://v.redd.it/vid123abc/CMAF_720.mp4" || v.Audio != "https://v.redd.it/vid123abc/CMAF_AUDIO_128.mp4" || v.W != 720 || v.H != 1280 || v.Duration != 63.5 || !strings.HasPrefix(v.Thumb, "https://external-preview.redd.it/thumb.png") {
		t.Errorf("video: %+v", v)
	}
	if r.Title != "A clip" || r.Author != "u/tyrano_dyroc" || r.Media != p.Media[0].URL {
		t.Errorf("plain card: %+v", r)
	}
	if n.asked("www.reddit.com/comments/abc123.json") != 1 {
		t.Error("the JSON is tried first")
	}

	// Both refused: vxReddit's card, with the counts it writes into its name.
	vx := `<html><head><meta property="og:site_name" content="u/tyrano_dyroc on r/funny - ⬆️ 50789 | 💬 802"><meta property="og:title" content="A clip"><meta property="og:image" content="https://external-preview.redd.it/t.png"><meta property="og:video" content="https://vxreddit.com/redditvideo.mp4?video_url=x"><meta property="og:video:type" content="video/mp4"><meta property="og:video:width" content="720"><meta property="og:video:height" content="1280"></head></html>`
	f, _ = network(t, map[string]http.Handler{"vxreddit.com": paths(map[string]http.Handler{"/comments/abc123": body("text/html", vx)})})
	_, p = mustPost(t, f, "https://www.reddit.com/comments/abc123/")
	if p.Name != "u/tyrano_dyroc" || p.Community != "r/funny" || p.Likes != 50789 || p.Replies != 802 || len(p.Media) != 1 || p.Media[0].Kind != "video" || p.Media[0].W != 720 {
		t.Errorf("vxreddit post: %+v", p)
	}
}

const telegramWidgetHTML = `<html><body class="widget_frame_base tgme_widget body_widget_post emoji_image nodark">
<div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="durov/43" data-post-id="43">
 <div class="tgme_widget_message_user"><a href="https://t.me/durov"><i class="tgme_widget_message_user_photo bgcolor2" data-content="P"><img src="https://cdn4.telesco.pe/file/avatar.jpg"></i></a></div>
 <div class="tgme_widget_message_bubble">
  <div class="tgme_widget_message_author accent_color"><a class="tgme_widget_message_owner_name" href="https://t.me/durov"><span dir="auto">Pavel Durov</span></a><a class="tgme_widget_message_owner_labels" href="https://t.me/durov"><i class="verified-icon"> ✔</i></a></div>
  <div class="tgme_widget_message_forwarded_from accent_color">Forwarded from <a class="tgme_widget_message_forwarded_from_name" href="https://t.me/telegram/100"><span dir="auto">Telegram News</span></a></div>
  <div class="tgme_widget_message_grouped_wrap js-message_grouped_wrap"><div class="tgme_widget_message_grouped js-message_grouped"><div class="tgme_widget_message_grouped_layer js-message_grouped_layer">
   <a class="tgme_widget_message_photo_wrap grouped_media_wrap blured js-message_photo" style="left:0px;top:0px;width:800px;height:400px;margin-right:2px;background-image:url('https://cdn1.telesco.pe/file/photo.jpg')" href="https://t.me/durov/43?single"><div class="grouped_media_helper"></div><div class="tgme_widget_message_photo" style="padding-top:50%"></div></a>
   <a class="tgme_widget_message_video_player grouped_media_wrap blured js-message_video_player" href="https://t.me/durov/44?single"><i class="tgme_widget_message_video_thumb" style="background-image:url('//cdn1.telesco.pe/file/thumb.jpg')"></i>
    <div class="tgme_widget_message_video_wrap" style="width:640px;padding-top:56.25%"><video src="https://cdn4.telesco.pe/file/video.mp4" class="tgme_widget_message_video js-message_video" width="100%" height="100%" muted></video></div>
    <div class="message_video_play js-message_video_play"></div><time class="message_video_duration js-message_video_duration">1:05</time></a>
  </div></div></div>
  <div class="tgme_widget_message_text js-message_text" dir="auto">We ship <b>1</b> update in 10 days.<br/>See <a href="https://t.me/telegram/1" target="_blank">1</a> and <a href="https://example.com/long/path" target="_blank">the notes</a> or <a href="https://t.me/durov" target="_blank">@durov</a><br/><br/><br/>Bye <i class="emoji" style="background-image:url('//telegram.org/img/emoji/40/F09F918D.png')"><b>👍</b></i></div>
  <div class="tgme_widget_message_reactions js-message_reactions"><span class="tgme_reaction"><i class="emoji"><b>👍</b></i>2.04K</span><span class="tgme_reaction"><i class="emoji"><b>❤</b></i>840</span></div>
  <div class="tgme_widget_message_footer js-message_footer"><div class="tgme_widget_message_info js-message_info"><span class="tgme_widget_message_views">873K</span><span class="copyonly"> views</span><span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/durov/43"><time datetime="2016-10-09T18:53:49+00:00" class="datetime">Oct 9, 2016</time></a></span></div></div>
 </div>
</div></body></html>`

func TestTelegramPost(t *testing.T) {
	const link = "https://t.me/durov/43"
	f, _ := network(t, map[string]http.Handler{
		// asked for under the capitals the link was written with; Telegram's
		// own markup names the channel in small letters
		"t.me": paths(map[string]http.Handler{"/Durov/43": http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("embed") != "1" {
				http.Error(w, "the page, not the widget", http.StatusNotFound)
				return
			}
			body("text/html; charset=utf-8", telegramWidgetHTML).ServeHTTP(w, r)
		})}),
	})
	s := &Service{Fetcher: f}
	r, err := s.Lookup(context.Background(), "https://t.me/s/Durov/43")
	if err != nil || r.Post == nil {
		t.Fatalf("lookup: %v %+v", err, r)
	}
	p := r.Post
	if p.Site != "Telegram" || p.Name != "Pavel Durov" || p.Handle != "Durov" || !p.Verified || p.AuthorURL != "https://t.me/Durov" {
		t.Errorf("author: %+v", p)
	}
	if p.Community != "Telegram News" || p.CommunityURL != "https://t.me/telegram/100" {
		t.Errorf("forwarded from: %q %q", p.Community, p.CommunityURL)
	}
	// a line break is a line, a run of them one blank line, an emoji its character
	want := "We ship 1 update in 10 days.\nSee 1 and the notes or @durov\n\nBye 👍"
	if p.Text != want {
		t.Errorf("text:\n%q\nwant\n%q", p.Text, want)
	}
	// The app finds a link's words by looking for them in order. The linked
	// "1" comes after two others, so looking would land on the wrong one:
	// that link is left out, and the ones that cannot be mistaken stay.
	if len(p.Links) != 2 || p.Links[0] != (PostLink{Text: "the notes", URL: "https://example.com/long/path"}) || p.Links[1] != (PostLink{Text: "@durov", URL: "https://t.me/durov"}) {
		t.Errorf("links: %+v", p.Links)
	}
	if p.Views != 873000 || p.Likes != 2880 || p.Created != 1476039229000 {
		t.Errorf("views %d reactions %d created %d", p.Views, p.Likes, p.Created)
	}
	if len(p.Media) != 2 || p.Media[0].Kind != "photo" || p.Media[0].W != 800 || p.Media[0].H != 400 || p.Media[1].Kind != "video" || p.Media[1].W != 640 || p.Media[1].H != 360 || p.Media[1].Duration != 65 {
		t.Fatalf("media: %+v", p.Media)
	}
	const canonical = "https://t.me/Durov/43"
	if p.Media[0].URL != canonical+"#nexa-asset=m0" || p.Media[1].Thumb != canonical+"#nexa-asset=t1" || p.Avatar != canonical+"#nexa-asset=avatar" {
		t.Errorf("named files: %+v", p.Media)
	}
	for name, want := range map[string]string{"m0": "https://cdn1.telesco.pe/file/photo.jpg", "m1": "https://cdn4.telesco.pe/file/video.mp4", "t1": "https://cdn1.telesco.pe/file/thumb.jpg", "avatar": "https://cdn4.telesco.pe/file/avatar.jpg"} {
		u, _ := url.Parse(canonical + "#nexa-asset=" + name)
		if a, _, err := s.Asset(context.Background(), u); err != nil || a.URL.String() != want {
			t.Errorf("asset %s: %v %v", name, a, err)
		}
	}

	// The widget gone: the channel's preview page, which shows a run of
	// messages. Only the one asked for is read.
	preview := strings.Replace(telegramWidgetHTML, `<div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="durov/43"`,
		`<div class="tgme_widget_message js-widget_message" data-post="durov/42"><div class="tgme_widget_message_author"><a class="tgme_widget_message_owner_name"><span>Someone Else</span></a></div><div class="tgme_widget_message_text js-message_text">the message before</div></div>
<div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="durov/43"`, 1)
	f, _ = network(t, map[string]http.Handler{"t.me": paths(map[string]http.Handler{"/s/durov/43": body("text/html", preview)})})
	_, p = mustPost(t, f, link)
	if p.Name != "Pavel Durov" || !strings.HasPrefix(p.Text, "We ship 1 update") {
		t.Errorf("post from the preview page: %+v", p)
	}

	// A private channel, a deleted message: neither page has it, and the link
	// is an ordinary link.
	f, _ = network(t, map[string]http.Handler{"t.me": http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body("text/html", `<html><head><meta property="og:title" content="Telegram: Contact @durov"></head><body><div class="tgme_widget_message_error">Post not found</div></body></html>`).ServeHTTP(w, r)
	})})
	if r := mustFetch(t, f, link); r.Post != nil || r.Title != "Telegram: Contact @durov" {
		t.Errorf("a missing message: %+v", r)
	}
}

const mastodonStatusJSON = `{"id":"117156549508722805","created_at":"2026-08-25T14:11:16.256Z","sensitive":false,"spoiler_text":"","url":"https://mastodon.test/@Mastodon/117156549508722805",
 "replies_count":17,"reblogs_count":106,"favourites_count":462,
 "content":"<p>Thanks <span class=\"h-card\"><a href=\"https://other.test/@hannah\" class=\"u-url mention\">@<span>hannah</span></a></span>!</p><p>Read <a href=\"https://blog.test/a/very/long/address\"><span class=\"invisible\">https://</span><span class=\"ellipsis\">blog.test/a/very/lon</span><span class=\"invisible\">g/address</span></a><br><a href=\"https://mastodon.test/tags/fediverse\" class=\"mention hashtag\">#<span>fediverse</span></a> :blobcat:</p>",
 "account":{"id":"13179","username":"Mastodon","acct":"Mastodon","display_name":"Mastodon","url":"https://mastodon.test/@Mastodon","avatar":"https://files.mastodon.test/a.gif","avatar_static":"https://files.mastodon.test/a.png"},
 "media_attachments":[{"id":"1","type":"image","url":"https://files.mastodon.test/1.png","preview_url":"https://files.mastodon.test/1s.png","description":"A chart","meta":{"original":{"width":1600,"height":900}}},
  {"id":"2","type":"gifv","url":"https://files.mastodon.test/2.mp4","preview_url":"https://files.mastodon.test/2.png","meta":{"original":{"width":320,"height":240,"duration":2.5}}},
  {"id":"3","type":"audio","url":"https://files.mastodon.test/3.mp3"}],
 "poll":{"id":"9","expires_at":"2026-08-26T14:11:16.000Z","expired":false,"votes_count":4,"options":[{"title":"Yes","votes_count":3},{"title":"No","votes_count":1}]}}`

func TestMastodonPost(t *testing.T) {
	f, _ := network(t, map[string]http.Handler{
		"mastodon.test": paths(map[string]http.Handler{"/api/v1/statuses/117156549508722805": jsonBody(mastodonStatusJSON)}),
	})
	_, p := mustPost(t, f, "https://mastodon.test/@Mastodon/117156549508722805")
	// said in full, a handle is the same wherever it is read
	if p.Site != "Mastodon" || p.Name != "Mastodon" || p.Handle != "Mastodon@mastodon.test" || p.Avatar != "https://files.mastodon.test/a.png" {
		t.Errorf("author: %+v", p)
	}
	// the markup read for its words: the whole of a shortened address, paragraphs and lines
	if want := "Thanks @hannah!\n\nRead https://blog.test/a/very/long/address\n#fediverse :blobcat:"; p.Text != want {
		t.Errorf("text:\n%q\nwant\n%q", p.Text, want)
	}
	if len(p.Links) != 2 || p.Links[0] != (PostLink{Text: "@hannah", URL: "https://other.test/@hannah"}) || p.Links[1] != (PostLink{Text: "#fediverse", URL: "https://mastodon.test/tags/fediverse"}) {
		t.Errorf("links: %+v", p.Links)
	}
	if p.Replies != 17 || p.Reposts != 106 || p.Likes != 462 || p.Created == 0 {
		t.Errorf("counts: %+v", p)
	}
	if len(p.Media) != 2 || p.Media[0].Kind != "photo" || p.Media[0].Alt != "A chart" || p.Media[0].W != 1600 || p.Media[1].Kind != "gif" || p.Media[1].Thumb == "" {
		t.Errorf("media: %+v", p.Media)
	}
	if p.Poll == nil || p.Poll.Votes != 4 || p.Poll.Choices[0].Percent != 75 || p.Poll.Choices[1].Percent != 25 {
		t.Errorf("poll: %+v", p.Poll)
	}

	// A content warning is the line the author put above the post, and covers its media.
	warned := strings.Replace(mastodonStatusJSON, `"spoiler_text":""`, `"spoiler_text":"Spoilers for the finale"`, 1)
	f, _ = network(t, map[string]http.Handler{"mastodon.test": jsonBody(warned)})
	if _, p := mustPost(t, f, "https://mastodon.test/@Mastodon/117156549508722805"); p.Title != "Spoilers for the finale" || !p.Sensitive {
		t.Errorf("content warning: title %q sensitive %v", p.Title, p.Sensitive)
	}

	// An address shaped like a Mastodon post on a site that is not one: its
	// API is not there, and the page is fetched like any other.
	f, n := network(t, map[string]http.Handler{
		"blog.test": paths(map[string]http.Handler{"/@writer/1234567890123": body("text/html", ogOnlyPage)}),
	})
	if r := mustFetch(t, f, "https://blog.test/@writer/1234567890123"); r.Post != nil || r.Title != "Jack on X" {
		t.Errorf("a lookalike: %+v", r)
	}
	if n.asked("blog.test/api/v1/statuses/1234567890123") != 1 {
		t.Error("the server is asked whether it is Mastodon")
	}
}

// Threads' page for embedding a post, as it writes it for a crawler.
const threadsEmbedHTML = `<html><body class="x1 Locale_en_US" dir="ltr"><div class="Embed"><div class="LinkContainer"><a target="_blank" href="https://www.threads.com/&#064;gem/post/DXhZAMkljvS"></a></div>
<div class="EmbedContainer EmbedContainerTopRightLogo"><div><div class="OuterContainer OuterContainerFull">
<div class="AvatarContainer"><img class="img" src="https://scontent.cdninstagram.com/avatar.jpg?oe=1&amp;x=2" alt="gem" height="36" width="36" /></div>
<div class="HeaderContainer HeaderContainerFull"><div class="NameContainer"><div class="AuthorIdentity"><a href="https://www.threads.com/&#064;gem" target="_blank" class="HeaderLink"><span>gem</span></a><div class="VerifiedBadge"><svg></svg></div></div>
<div class="HeaderTrailingActions"><span class="EmbedFollowSeparator" aria-hidden="true">·</span><a href="https://www.threads.com/intent/follow?username=gem" target="_blank" class="EmbedFollowButton">Follow</a></div></div></div>
<div class="BodyContainerNoThreadLine"><span class="TextContentContainerFull TextContentContainer"><span class="BodyTextContainer"><span>Ten minutes! See <a href="https://example.com/long">the page</a><br/>#soon</span></span></span>
<div class="SoloMediaContainer"><div class="SingleInnerMediaContainerVideo SingleInnerMediaContainer"><video controls="1" loop="1" poster="https://scontent.cdninstagram.com/poster.jpg?oe=1"><source src="https://scontent.cdninstagram.com/clip.mp4?oe=1" /></video><div class="VideoPlayOverlay"><div class="VideoPlayButton"><svg></svg></div></div></div>
<div class="MediaScrollImageContainer"><img src="https://scontent.cdninstagram.com/photo.jpg?oe=1" alt="A photo" /></div></div>
<div class="PostDateContainer"><span class="Timestamp">9:50 AM · Apr 24, 2026</span></div>
<div class="ActionBarContainer"><span class="ActionBarIcon"><svg></svg><span class="ActionBarCount">989</span></span><span class="ActionBarIcon"><svg></svg><span class="ActionBarCount">57</span></span><span class="ActionBarIcon"><svg></svg></span><span class="ActionBarIcon"><svg></svg><span class="ActionBarCount">10</span></span></div></div>
</div></div></div><div class="BarcelonaBigLogoContainer"><span class="BarcelonaLogoText">View on Threads</span></div></div></body></html>`

const threadsPageHTML = `<html><head><meta property="og:title" content="Gem (&#064;gem) on Threads" /><meta property="og:url" content="https://www.threads.com/&#064;gem/post/DXhZAMkljvS" /></head><body></body></html>`

func TestThreadsPost(t *testing.T) {
	const canonical = "https://www.threads.com/@gem/post/DXhZAMkljvS"
	f, n := network(t, map[string]http.Handler{
		"www.threads.com": paths(map[string]http.Handler{
			"/@gem/post/DXhZAMkljvS/embed": body("text/html; charset=utf-8", threadsEmbedHTML),
			"/@gem/post/DXhZAMkljvS":       body("text/html; charset=utf-8", threadsPageHTML),
		}),
	})
	s := &Service{Fetcher: f}
	r, err := s.Lookup(context.Background(), "https://www.threads.net/@gem/post/DXhZAMkljvS?xmt=abc")
	if err != nil || r.Post == nil {
		t.Fatalf("lookup: %v %+v", err, r)
	}
	p := r.Post
	// the handle from the embed page, the name from the title of the post's own page
	if p.Site != "Threads" || p.Name != "Gem" || p.Handle != "gem" || !p.Verified || p.URL != canonical || p.AuthorURL != "https://www.threads.com/@gem" {
		t.Errorf("post: %+v", p)
	}
	if p.Text != "Ten minutes! See the page\n#soon" || len(p.Links) != 1 || p.Links[0] != (PostLink{Text: "the page", URL: "https://example.com/long"}) {
		t.Errorf("text %q links %+v", p.Text, p.Links)
	}
	// likes, replies and reposts by their place; the one with no number is none
	if p.Likes != 989 || p.Replies != 57 || p.Reposts != 0 {
		t.Errorf("counts: %d %d %d", p.Likes, p.Replies, p.Reposts)
	}
	// the time is in the post's code, to the millisecond
	if p.Created != 1777049411106 {
		t.Errorf("created: %d", p.Created)
	}
	if len(p.Media) != 2 || p.Media[0].Kind != "video" || p.Media[1].Kind != "photo" || p.Media[1].Alt != "A photo" {
		t.Fatalf("media: %+v", p.Media)
	}
	// Threads' files are Instagram's, signed for a few days: named, not held
	if p.Avatar != canonical+"#nexa-asset=avatar" || p.Media[0].URL != canonical+"#nexa-asset=m0" || p.Media[0].Thumb != canonical+"#nexa-asset=t0" {
		t.Errorf("named files: %+v", p)
	}
	for name, want := range map[string]string{"m0": "https://scontent.cdninstagram.com/clip.mp4?oe=1", "t0": "https://scontent.cdninstagram.com/poster.jpg?oe=1", "m1": "https://scontent.cdninstagram.com/photo.jpg?oe=1", "avatar": "https://scontent.cdninstagram.com/avatar.jpg?oe=1&x=2"} {
		u, _ := url.Parse(canonical + "#nexa-asset=" + name)
		if a, _, err := s.Asset(context.Background(), u); err != nil || a.URL.String() != want {
			t.Errorf("asset %s: %v %v", name, a, err)
		}
	}
	if n.asked("api.atmosphere.tools/2/threads/status/DXhZAMkljvS") != 0 {
		t.Error("nobody else's service is asked while Threads' own page answers")
	}

	// A link by the post's code alone: its page says whose it is.
	f, _ = network(t, map[string]http.Handler{
		"www.threads.com": paths(map[string]http.Handler{
			"/t/DXhZAMkljvS":               body("text/html; charset=utf-8", threadsPageHTML),
			"/@gem/post/DXhZAMkljvS/embed": body("text/html; charset=utf-8", threadsEmbedHTML),
			"/@gem/post/DXhZAMkljvS":       body("text/html; charset=utf-8", threadsPageHTML),
		}),
	})
	if _, p := mustPost(t, f, "https://www.threads.com/t/DXhZAMkljvS"); p.Handle != "gem" || p.URL != canonical || p.Avatar != canonical+"#nexa-asset=avatar" {
		t.Errorf("post by its code: %+v", p)
	}

	// A post that is not to be embedded: the atmosphere API, which also knows the post it quotes.
	atmosphere := `{"code":200,"status":{"url":"https://www.threads.com/@gem/post/DXhZAMkljvS/","text":"Ten minutes! @friend #soon","author":{"name":"Gem","screen_name":"gem","avatar_url":"https://scontent.cdninstagram.com/a.jpg?oe=1"},"likes":1,"created_timestamp":1777049411,
 "quote":{"url":"https://www.threads.com/@friend/post/DXaaaaaaaaa/","text":"earlier","author":{"name":"Friend","screen_name":"friend","avatar_url":"https://scontent.cdninstagram.com/f.jpg?oe=1"},"media":{"photos":[{"type":"photo","url":"https://scontent.cdninstagram.com/q.jpg?oe=1","width":10,"height":10}]}}}}`
	f, _ = network(t, map[string]http.Handler{
		"www.threads.com":      body("text/html", `<html><body><div class="EmbedError"><span class="ErrorText">Thread not available</span></div></body></html>`),
		"api.atmosphere.tools": paths(map[string]http.Handler{"/2/threads/status/DXhZAMkljvS": jsonBody(atmosphere)}),
	})
	s = &Service{Fetcher: f}
	r, err = s.Lookup(context.Background(), canonical)
	if err != nil || r.Post == nil {
		t.Fatalf("lookup: %v %+v", err, r)
	}
	p = r.Post
	if p.Name != "Gem" || p.Text != "Ten minutes! @friend #soon" || p.Avatar != canonical+"#nexa-asset=avatar" {
		t.Errorf("post from the fixer: %+v", p)
	}
	// a quoted post's files are named under the post that quotes it
	q := p.Quote
	if q == nil || q.Handle != "friend" || q.Avatar != canonical+"#nexa-asset=q.avatar" || len(q.Media) != 1 || q.Media[0].URL != canonical+"#nexa-asset=q.m0" {
		t.Fatalf("quote: %+v", q)
	}
	u, _ := url.Parse(q.Media[0].URL)
	if a, _, err := s.Asset(context.Background(), u); err != nil || a.URL.String() != "https://scontent.cdninstagram.com/q.jpg?oe=1" {
		t.Errorf("quoted file: %v %v", a, err)
	}
}

// An Instagram or Threads post's code is its number, which starts with the time.
func TestShortcodeTime(t *testing.T) {
	for code, want := range map[string]int64{
		"BsOGulcndj-": 1546621545106, // 2019-01-04T17:05:45Z, the egg
		"DXhZAMkljvS": 1777049411106,
		"Dd6dppxEgV7": 1790775610555,
	} {
		if got := shortcodeTime(code); got != want {
			t.Errorf("shortcodeTime(%s) = %d, want %d", code, got, want)
		}
	}
	// a private post's long code, something that is not a code, a time yet to come
	for _, code := range []string{"", "AAAAAAAAAAA", "not a code!", "CxYz" + strings.Repeat("A", 40), "____________"} {
		if got := shortcodeTime(code); got != 0 {
			t.Errorf("shortcodeTime(%q) = %d", code, got)
		}
	}
}

func TestHTMLText(t *testing.T) {
	base, _ := url.Parse("https://site.test/dir/")
	cases := []struct{ in, want string }{
		{"plain words", "plain words"},
		{"<p>one</p><p>two</p>", "one\n\ntwo"},
		{"a<br>b<br/><br><br><br>c", "a\nb\n\nc"},
		{"  <p>  spaced \n   out  </p>\n<p>next</p>  ", "spaced out\n\nnext"},
		{"<div>line</div><div>line two</div>", "line\nline two"},
		{"<ul><li>one</li><li>two</li></ul>after", "one\ntwo\n\nafter"},
		{"<pre>keep\n  this</pre>", "keep\n  this"},
		{"before<script>alert(1)</script><style>p{}</style>after", "beforeafter"},
		{"x <b>bold</b> <i>it</i>y", "x bold ity"},
		{`an <img alt=":emoji:" src="x.png"> here`, "an :emoji: here"},
		{"<p>trailing space </p> <p> leading</p>", "trailing space\n\nleading"},
	}
	for _, c := range cases {
		if got, _ := htmlText(c.in, base); got != c.want {
			t.Errorf("htmlText(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	text, links := htmlText(`<p>See <a href="/a">the page</a>, <a href="https://x.test/b"> another </a>,<br><a href="https://x.test/c">https://x.test/c</a> <a href="javascript:alert(1)">bad</a> <a href="mailto:a@b.c">mail</a> <a href="//cdn.test/d">cdn</a><a href="">empty</a></p>`, base)
	if text != "See the page, another ,\nhttps://x.test/c bad mail cdnempty" {
		t.Errorf("text: %q", text)
	}
	want := []PostLink{{Text: "the page", URL: "https://site.test/a"}, {Text: "another", URL: "https://x.test/b"}, {Text: "cdn", URL: "https://cdn.test/d"}}
	if len(links) != len(want) {
		t.Fatalf("links: %+v", links)
	}
	for i, l := range links {
		// each with its place, so that a card can tell which words it is on
		if l.Text != want[i].Text || l.URL != want[i].URL || !l.placed || text[l.at:l.at+len(l.Text)] != l.Text {
			t.Errorf("link %d: %+v", i, l)
		}
	}
}

func TestPostIsHeldToWhatACardCarries(t *testing.T) {
	site := postSites["twitter"]
	ref := &postRef{platform: "twitter", user: "jack", id: "20"}
	p := &Post{
		Name:      "  Jack \n Dorsey ",
		Handle:    "@jack",
		AuthorURL: "javascript:alert(1)",
		Avatar:    "data:image/png;base64,AAAA",
		URL:       "/relative",
		Text:      "\n  " + strings.Repeat("é", maxPostText+50),
		Replies:   -4,
		Quote:     &Post{Name: "Q", Text: "quoted", Quote: &Post{Name: "deeper", Text: "x"}, Media: []PostMedia{{Kind: "photo", URL: "ftp://x/y.png"}}},
	}
	for i := 0; i < maxPostMedia+5; i++ {
		p.Media = append(p.Media, PostMedia{Kind: "photo", URL: fmt.Sprintf("https://img.test/%d.jpg", i), W: 10, H: 10})
	}
	p.Media[1] = PostMedia{Kind: "audio", URL: "https://img.test/a.mp3"}
	p.Media[2] = PostMedia{Kind: "video", Thumb: "https://img.test/poster.jpg", W: -1, H: 99999, Duration: -3}
	p.Media[3] = PostMedia{Kind: "video"}
	p.Media[4] = PostMedia{Kind: "photo", URL: "file:///etc/passwd"}
	p.finish(ref, site)

	if p.Name != "Jack Dorsey" || p.Handle != "jack" || p.AuthorURL != "" || p.Avatar != "" || p.URL != "https://x.com/jack/status/20" {
		t.Errorf("fields: %+v", p)
	}
	if n := len([]rune(p.Text)); n != maxPostText || strings.HasPrefix(p.Text, "\n") {
		t.Errorf("text is %d runes", n)
	}
	if p.Replies != 0 {
		t.Errorf("replies: %d", p.Replies)
	}
	if len(p.Media) != maxPostMedia {
		t.Fatalf("media: %d", len(p.Media))
	}
	for _, m := range p.Media {
		if m.Kind == "audio" || strings.HasPrefix(m.URL, "file:") || (m.URL == "" && m.Thumb == "") {
			t.Errorf("media that should not be carried: %+v", m)
		}
	}
	// a video may be only its poster, with no made-up shape
	if v := p.Media[1]; v.Kind != "video" || v.URL != "" || v.Thumb == "" || v.W != 0 || v.H != 0 || v.Duration != 0 {
		t.Errorf("poster-only video: %+v", v)
	}
	if q := p.Quote; q == nil || q.Quote != nil || len(q.Media) != 0 || q.Platform != "twitter" {
		t.Errorf("quote: %+v", q)
	}

	// Links: only where the app's in-order search finds the right words.
	p = &Post{Name: "n", Text: "  one two one three", Links: []PostLink{
		{Text: "one", URL: "https://a.test/second", at: 10, placed: true}, // the second "one": the search would find the first
		{Text: "two", URL: "https://a.test/two", at: 6, placed: true},
		{Text: "three", URL: "javascript:x", at: 14, placed: true},
		{Text: "three", URL: "https://a.test/three"}, // a source with no places: wherever the search lands
		{Text: "absent", URL: "https://a.test/absent"},
		{Text: "https://a.test/same", URL: "https://a.test/same"},
	}}
	p.finish(ref, site)
	if p.Text != "one two one three" || len(p.Links) != 2 || p.Links[0].Text != "two" || p.Links[1] != (PostLink{Text: "three", URL: "https://a.test/three"}) {
		t.Errorf("links: %q %+v", p.Text, p.Links)
	}

	// Nothing to draw is no post.
	for _, empty := range []*Post{nil, {}, {Name: "only a name"}, {Text: "only text"}} {
		if empty.usable() {
			t.Errorf("usable: %+v", empty)
		}
	}
}

func TestLooseNumbers(t *testing.T) {
	for in, want := range map[string]int64{"1.4K": 1400, "2,043": 2043, "3.1M": 3_100_000, "873K": 873_000, "12": 12, "": 0, "abc": 0, "1b": 1_000_000_000} {
		if got := count(in); got != want {
			t.Errorf("count(%q) = %d, want %d", in, got, want)
		}
	}
	for in, want := range map[string]float64{"1:05": 65, "0:09": 9, "1:02:03": 3723, "": 0, "x": 0} {
		if got := clock(in); got != want {
			t.Errorf("clock(%q) = %v, want %v", in, got, want)
		}
	}
	if got := runes("héllo wörld", 1, 5); got != "éllo" {
		t.Errorf("runes: %q", got)
	}
}

// The app waits longer for a post's card than for a link's, so it keeps its
// own copy of which hosts are posts (web/src/lib/postLinks.ts). The two lists
// are the same list.
func TestAppKnowsTheSameHosts(t *testing.T) {
	src, err := os.ReadFile("../../web/src/lib/postLinks.ts")
	if err != nil {
		t.Skipf("the app's source is not here: %v", err)
	}
	listed := func(name string) map[string]bool {
		t.Helper()
		m := regexp.MustCompile(`(?s)const ` + name + ` = new Set\(\[(.*?)\]\)`).FindSubmatch(src)
		if m == nil {
			t.Fatalf("no %s in postLinks.ts", name)
		}
		out := map[string]bool{}
		for _, q := range regexp.MustCompile(`"([^"]+)"`).FindAllSubmatch(m[1], -1) {
			out[string(q[1])] = true
		}
		return out
	}
	same := func(what string, app map[string]bool, server map[string]string) {
		t.Helper()
		for host := range server {
			if !app[host] {
				t.Errorf("%s: the app does not know %s", what, host)
			}
		}
		for host := range app {
			if server[host] == "" {
				t.Errorf("%s: the app knows %s, which the server does not", what, host)
			}
		}
	}
	same("hosts", listed("HOSTS"), postHosts)
	same("exact hosts", listed("EXACT_HOSTS"), postHostsExact)
}
