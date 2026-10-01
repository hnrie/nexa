package unfurl

// Social posts, drawn by the app as posts.
//
// A link to a post on X, Bluesky, TikTok, Instagram, Reddit, Telegram,
// Threads or Mastodon gets a card of its own: who wrote it, what it says, its
// pictures and video, how many people answered, and the post it quotes. A
// page's preview tags carry little of that, and several of these sites write
// none at all for a crawler, so a post is read from where its data is: the
// site's own public API or page data where there is one, then the public
// services that exist to fix these embeds (FxTwitter, FxBluesky and the
// atmosphere API behind them, vxTwitter, vxReddit), and last the page's own
// tags, like any other link.
//
// Every source may fail, and each failure only means the next one is asked:
// a service that is down, slow, or has changed what it answers costs a post
// its richer card and nothing else. When all of them fail the link still gets
// the card any link gets, and when that fails too the message goes without.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// Variables so that a test can shorten them; nothing else changes them.
var (
	// postBudget is how long the sources for one post may take between them.
	// The sender's app waits about this long for a post's card before it
	// sends without one (PREVIEW_WAIT_POST in the composer), so a source that
	// has not answered by then is not waited for.
	postBudget = 4200 * time.Millisecond
	// postSourceWait bounds one source, so a slow one leaves time for the next.
	postSourceWait = 2600 * time.Millisecond
	// postRetryPause is how long a source that answered with a server error
	// is left alone before it is asked the one more time.
	postRetryPause = 200 * time.Millisecond
)

const (
	maxPostText    = 4000
	maxPostMedia   = 10
	maxPostLinks   = 20
	maxPollChoices = 10

	// browserUA is for the sites that only hand their page data to a browser.
	browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

// Post is a social post: everything its card draws.
type Post struct {
	// Platform is the word the app keys a post's look on ("twitter",
	// "bluesky", "tiktok", "instagram", "reddit", "telegram", "threads",
	// "mastodon"), and Site the service's name as people say it.
	Platform string `json:"platform"`
	Site     string `json:"site,omitempty"`
	// URL is the post on its own site, whatever address the link used.
	URL string `json:"url,omitempty"`
	// Who wrote it. Handle has no "@".
	Name      string `json:"name,omitempty"`
	Handle    string `json:"handle,omitempty"`
	AuthorURL string `json:"author_url,omitempty"`
	Avatar    string `json:"avatar,omitempty"`
	Verified  bool   `json:"verified,omitempty"`
	// Community is where it was posted, for the sites that have such places:
	// "r/pics", or the channel a Telegram message was forwarded from.
	Community    string `json:"community,omitempty"`
	CommunityURL string `json:"community_url,omitempty"`
	// Title is a post's own headline (Reddit), above its text.
	Title string `json:"title,omitempty"`
	Text  string `json:"text,omitempty"`
	// Links are the addresses behind words the text shows in their place: a
	// shortened link, a link with a label. In the order they appear.
	Links []PostLink `json:"links,omitempty"`
	// ReplyTo is the handle this post answers.
	ReplyTo string `json:"reply_to,omitempty"`
	// Created is when it was posted, in Unix millis.
	Created int64       `json:"created,omitempty"`
	Media   []PostMedia `json:"media,omitempty"`
	Poll    *PostPoll   `json:"poll,omitempty"`
	Quote   *Post       `json:"quote,omitempty"`
	// Counts, where the site gives them. Likes is a Reddit post's score and
	// the sum of a Telegram message's reactions.
	Replies int64 `json:"replies,omitempty"`
	Reposts int64 `json:"reposts,omitempty"`
	Likes   int64 `json:"likes,omitempty"`
	Views   int64 `json:"views,omitempty"`
	// Sensitive is set where the site marks the post as not for everyone;
	// the app covers its media until asked.
	Sensitive bool `json:"sensitive,omitempty"`
	// Note is a note readers added under the post (X's community notes).
	Note string `json:"note,omitempty"`
}

// PostMedia is one picture or video of a post.
type PostMedia struct {
	// Kind is "photo", "video", or "gif": a silent video that loops.
	Kind string `json:"kind"`
	// URL is the file itself. A video with none is one the app cannot play
	// (a stream, a site that keeps its files to itself); its picture is
	// shown and opens the post.
	URL   string `json:"url,omitempty"`
	Thumb string `json:"thumb,omitempty"`
	// Audio is a video's sound where the site keeps it in a file of its own
	// (Reddit); the app plays the two together.
	Audio    string  `json:"audio,omitempty"`
	W        int     `json:"w,omitempty"`
	H        int     `json:"h,omitempty"`
	Duration float64 `json:"duration,omitempty"`
	Alt      string  `json:"alt,omitempty"`
}

// PostLink is the address behind some words of a post's text. The app finds
// each link's words by looking for them in the text, in order, each after the
// one before.
type PostLink struct {
	Text string `json:"text"`
	URL  string `json:"url"`
	// at is where the words are in the text, in bytes, when the source knows
	// (placed). A link the app's search would put somewhere else is dropped
	// rather than sent to land on the wrong words (tidy).
	at     int
	placed bool
}

// PostPoll is a post's poll as it stood when the card was made.
type PostPoll struct {
	Choices []PollChoice `json:"choices"`
	Votes   int64        `json:"votes,omitempty"`
	// Ends is when voting closes or closed, in Unix millis.
	Ends int64 `json:"ends,omitempty"`
}

// PollChoice is one answer of a poll, and its share of the votes in percent.
type PollChoice struct {
	Label   string  `json:"label"`
	Votes   int64   `json:"votes,omitempty"`
	Percent float64 `json:"percent"`
}

// postRef is a link read as a post: which service, and what names it there.
type postRef struct {
	platform string
	// id is the post's own id on its service, and user whose it is where the
	// address says: a handle, a channel, a subreddit.
	id, user string
	// host is the server a Mastodon post lives on.
	host string
	// kind tells a TikTok photo post from a video.
	kind string
	// short is set for an address that only says where the post is once it
	// is followed: vm.tiktok.com, a Reddit share link.
	short *url.URL
}

// link is the post's address on its own site.
func (p *postRef) link() string {
	switch p.platform {
	case "twitter":
		user := p.user
		if user == "" {
			user = "i"
		}
		return "https://x.com/" + user + "/status/" + p.id
	case "bluesky":
		return "https://bsky.app/profile/" + p.user + "/post/" + p.id
	case "tiktok":
		kind := p.kind
		if kind == "" {
			kind = "video"
		}
		user := p.user
		if user == "" {
			// TikTok finds a post by its id alone, whoever the address names
			user = "i"
		}
		return "https://www.tiktok.com/@" + user + "/" + kind + "/" + p.id
	case "instagram":
		return "https://www.instagram.com/p/" + p.id + "/"
	case "reddit":
		return "https://www.reddit.com/comments/" + p.id + "/"
	case "telegram":
		return "https://t.me/" + p.user + "/" + p.id
	case "threads":
		if p.user == "" {
			return "https://www.threads.com/t/" + p.id
		}
		return "https://www.threads.com/@" + p.user + "/post/" + p.id
	case "mastodon":
		return "https://" + p.host + "/@" + p.user + "/" + p.id
	}
	return ""
}

// postSource reads a post from one place. An error or a post with nothing in
// it sends the caller on to the next source.
type postSource func(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error)

// postSite is one service: its name, the colour and icon of its cards, and
// where its posts are read from, best first.
type postSite struct {
	name, color, icon string
	sources           []postSource
	// expiring is set where the site's file addresses stop working after a
	// while, so a card holds names for them instead (see assets.go).
	expiring bool
}

var postSites = map[string]*postSite{}

func init() {
	// in init, since the sources name functions that read postSites
	postSites["twitter"] = &postSite{
		name: "X", color: "#1d9bf0", icon: "https://abs.twimg.com/favicons/twitter.3.ico",
		sources: []postSource{twitterFx, twitterSyndication, twitterVx},
	}
	postSites["bluesky"] = &postSite{
		name: "Bluesky", color: "#1185fe", icon: "https://bsky.app/static/favicon-32x32.png",
		sources: []postSource{blueskyAPI, blueskyFx},
	}
	postSites["tiktok"] = &postSite{
		name: "TikTok", color: "#fe2c55", icon: "https://www.tiktok.com/favicon.ico",
		sources: []postSource{tiktokPage, tiktokAtmosphere, tiktokOEmbed}, expiring: true,
	}
	postSites["instagram"] = &postSite{
		name: "Instagram", color: "#e1306c", icon: "https://www.instagram.com/favicon.ico",
		sources: []postSource{instagramEmbed, instagramAtmosphere, instagramPage}, expiring: true,
	}
	postSites["reddit"] = &postSite{
		name: "Reddit", color: "#ff4500", icon: "https://www.redditstatic.com/shreddit/assets/favicon/192x192.png",
		sources: []postSource{redditJSON, redditFeed, redditVx},
	}
	postSites["telegram"] = &postSite{
		name: "Telegram", color: "#29a9eb", icon: "https://telegram.org/img/t_logo.png",
		sources: []postSource{telegramWidget, telegramPreview}, expiring: true,
	}
	postSites["threads"] = &postSite{
		name: "Threads", color: "#8a8d91", icon: "https://www.threads.com/favicon.ico",
		sources: []postSource{threadsEmbed, threadsAtmosphere}, expiring: true,
	}
	postSites["mastodon"] = &postSite{
		name: "Mastodon", color: "#6364ff", icon: "https://joinmastodon.org/favicon-32x32.png",
		sources: []postSource{mastodonAPI, mastodonAtmosphere},
	}
}

// Hosts that are a service or stand in for one. The stand-ins are the "fixer"
// domains people swap into a link so that other apps embed it; here they mean
// the post they point at, and its card is the same whichever was pasted.
var postHosts = map[string]string{
	"x.com": "twitter", "twitter.com": "twitter", "fxtwitter.com": "twitter", "fixupx.com": "twitter",
	"vxtwitter.com": "twitter", "fixvx.com": "twitter", "twittpr.com": "twitter", "nitter.net": "twitter", "xcancel.com": "twitter",
	"bsky.app": "bluesky", "fxbsky.app": "bluesky", "bskx.app": "bluesky", "bskye.app": "bluesky", "vxbsky.app": "bluesky",
	"tiktok.com": "tiktok", "tnktok.com": "tiktok", "tfxktok.com": "tiktok", "vxtiktok.com": "tiktok", "kktiktok.com": "tiktok",
	"tiktxk.com": "tiktok", "tiktokez.com": "tiktok",
	"instagram.com": "instagram", "ddinstagram.com": "instagram", "kkinstagram.com": "instagram", "instagramez.com": "instagram",
	"eeinstagram.com": "instagram", "vxinstagram.com": "instagram", "uuinstagram.com": "instagram",
	"reddit.com": "reddit", "rxddit.com": "reddit", "vxreddit.com": "reddit", "redditez.com": "reddit", "rxyddit.com": "reddit",
	"threads.net": "threads", "threads.com": "threads", "fixthreads.net": "threads", "vxthreads.net": "threads",
}

// Hosts that mean a service only under their exact name: their subdomains
// are something else (i.redd.it is a picture, not a post).
var postHostsExact = map[string]string{
	"redd.it": "reddit",
	"t.me":    "telegram", "telegram.me": "telegram", "telegram.dog": "telegram",
	"fx-t.me": "telegram", "txlegram.me": "telegram", "txlegram.org": "telegram",
}

var (
	twitterPathRe   = regexp.MustCompile(`^/(?:#!/)?([A-Za-z0-9_]{1,20})/status(?:es)?/(\d{1,20})(?:/|$)`)
	twitterIPathRe  = regexp.MustCompile(`^/i/(?:web/)?status/(\d{1,20})(?:/|$)`)
	blueskyPathRe   = regexp.MustCompile(`^/profile/([A-Za-z0-9.:_-]{3,255})/post/([A-Za-z0-9._:~-]{1,64})/?$`)
	tiktokPathRe    = regexp.MustCompile(`^/@([A-Za-z0-9_.]{0,32})/(video|photo)/(\d{8,20})(?:/|$)`)
	tiktokIDPathRe  = regexp.MustCompile(`^/(?:v|embed/v2|embed|share/video|player/v1)/(\d{8,20})(?:\.html)?/?$`)
	tiktokShortRe   = regexp.MustCompile(`^/(?:t/)?([A-Za-z0-9_-]{5,32})/?$`)
	instagramPathRe = regexp.MustCompile(`^/(?:[A-Za-z0-9_.]{1,40}/)?(?:p|reel|reels|tv)/([A-Za-z0-9_-]{5,60})(?:/|$)`)
	instagramShare  = regexp.MustCompile(`^/share/(?:p|reel|reels)?/?[A-Za-z0-9_-]{5,60}/?$`)
	redditPathRe    = regexp.MustCompile(`^/(?:(?:r|u|user)/([A-Za-z0-9_-]{1,40})/)?comments/([a-z0-9]{2,10})(?:/|$)`)
	redditGalleryRe = regexp.MustCompile(`^/gallery/([a-z0-9]{2,10})/?$`)
	redditShareRe   = regexp.MustCompile(`^/(?:r|u|user)/[A-Za-z0-9_-]{1,40}/s/[A-Za-z0-9]{4,40}/?$`)
	redditShortRe   = regexp.MustCompile(`^/([a-z0-9]{2,10})/?$`)
	telegramPathRe  = regexp.MustCompile(`^/(?:s/)?([A-Za-z][A-Za-z0-9_]{3,31})/(\d{1,10})/?$`)
	threadsPathRe   = regexp.MustCompile(`^/@([A-Za-z0-9_.]{1,40})/post/([A-Za-z0-9_-]{5,60})(?:/|$)`)
	threadsTPathRe  = regexp.MustCompile(`^/t/([A-Za-z0-9_-]{5,60})/?$`)
	mastodonPathRe  = regexp.MustCompile(`^/@([A-Za-z0-9_]{1,64}(?:@[A-Za-z0-9.-]{1,255})?)/(\d{10,24})/?$`)
	mastodonUserRe  = regexp.MustCompile(`^/users/([A-Za-z0-9_]{1,64})/statuses/(\d{10,24})/?$`)
)

// postPlatform is the service a host belongs to, or "".
func postPlatform(host string) string {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	if p := postHostsExact[host]; p != "" {
		return p
	}
	// "www.", "m.", "old.", "vm.", a fixer's "d." and "g.": the service is
	// named by the last two labels
	labels := strings.Split(host, ".")
	if len(labels) < 2 || len(labels) > 4 {
		return ""
	}
	return postHosts[strings.Join(labels[len(labels)-2:], ".")]
}

// postRefOf reads a link as a post, or returns nil for anything else.
func postRefOf(u *url.URL) *postRef {
	if u == nil || (u.Scheme != "http" && u.Scheme != "https") {
		return nil
	}
	host := strings.ToLower(u.Hostname())
	path := u.Path
	switch postPlatform(host) {
	case "twitter":
		if m := twitterPathRe.FindStringSubmatch(path); m != nil && m[1] != "i" {
			return &postRef{platform: "twitter", user: m[1], id: m[2]}
		}
		if m := twitterIPathRe.FindStringSubmatch(path); m != nil {
			return &postRef{platform: "twitter", id: m[1]}
		}
	case "bluesky":
		if m := blueskyPathRe.FindStringSubmatch(path); m != nil {
			return &postRef{platform: "bluesky", user: m[1], id: m[2]}
		}
	case "tiktok":
		if m := tiktokPathRe.FindStringSubmatch(path); m != nil {
			return &postRef{platform: "tiktok", user: m[1], kind: m[2], id: m[3]}
		}
		if m := tiktokIDPathRe.FindStringSubmatch(path); m != nil {
			return &postRef{platform: "tiktok", id: m[1]}
		}
		// vm.tiktok.com/ZMabc and tiktok.com/t/ZMabc say where the post is
		// only once followed, and it is TikTok itself that knows
		first, _, _ := strings.Cut(host, ".")
		if (first == "vm" || first == "vt" || strings.HasPrefix(path, "/t/")) && tiktokShortRe.MatchString(path) {
			short := *u
			short.Scheme, short.RawQuery, short.Fragment = "https", "", ""
			if first == "vm" || first == "vt" {
				short.Host = first + ".tiktok.com"
			} else {
				short.Host = "www.tiktok.com"
			}
			return &postRef{platform: "tiktok", short: &short}
		}
	case "instagram":
		// a share link first: "/share/p/…" also reads as an account named "share"
		if instagramShare.MatchString(path) {
			short := *u
			short.Scheme, short.Host, short.RawQuery, short.Fragment = "https", "www.instagram.com", "", ""
			return &postRef{platform: "instagram", short: &short}
		}
		if m := instagramPathRe.FindStringSubmatch(path); m != nil {
			return &postRef{platform: "instagram", id: m[1]}
		}
	case "reddit":
		if host == "redd.it" {
			if m := redditShortRe.FindStringSubmatch(path); m != nil {
				return &postRef{platform: "reddit", id: m[1]}
			}
			return nil
		}
		if m := redditPathRe.FindStringSubmatch(path); m != nil {
			return &postRef{platform: "reddit", user: m[1], id: m[2]}
		}
		if m := redditGalleryRe.FindStringSubmatch(path); m != nil {
			return &postRef{platform: "reddit", id: m[1]}
		}
		if redditShareRe.MatchString(path) {
			short := *u
			short.Scheme, short.Host, short.RawQuery, short.Fragment = "https", "www.reddit.com", "", ""
			return &postRef{platform: "reddit", short: &short}
		}
	case "telegram":
		if m := telegramPathRe.FindStringSubmatch(path); m != nil {
			return &postRef{platform: "telegram", user: m[1], id: m[2]}
		}
	case "threads":
		if m := threadsPathRe.FindStringSubmatch(path); m != nil {
			return &postRef{platform: "threads", user: m[1], id: m[2]}
		}
		if m := threadsTPathRe.FindStringSubmatch(path); m != nil {
			return &postRef{platform: "threads", id: m[1]}
		}
	case "":
		// Mastodon is thousands of servers, known only by the shape of a
		// post's address. The server is asked whether it is one before
		// anything is believed (mastodonAPI).
		if m := mastodonPathRe.FindStringSubmatch(path); m != nil {
			return &postRef{platform: "mastodon", host: host, user: m[1], id: m[2]}
		}
		if m := mastodonUserRe.FindStringSubmatch(path); m != nil {
			return &postRef{platform: "mastodon", host: host, user: m[1], id: m[2]}
		}
	}
	return nil
}

// PostHost reports whether a link's host is a service whose posts get a card
// of their own. The app waits longer for these.
func PostHost(host string) bool { return postPlatform(host) != "" }

// postResult is the preview for a link to a post, or nil when the link is not
// one or no source could read it.
func (f *Fetcher) postResult(ctx context.Context, link *url.URL) *Result {
	ref := postRefOf(link)
	if ref == nil {
		return nil
	}
	p, ref := f.readPost(ctx, ref)
	if p == nil {
		return nil
	}
	f.sizes(ctx, p)
	if f.seen != nil {
		f.seen(ref, p)
	}
	site := postSites[ref.platform]
	if site.expiring {
		p = p.named(ref.link())
	}
	return p.result(link.String(), site)
}

// readPost asks a post's sources in turn and returns the first that answers
// with something to show, along with the post's own address once a short
// link has been followed.
func (f *Fetcher) readPost(ctx context.Context, ref *postRef) (*Post, *postRef) {
	ctx, cancel := context.WithTimeout(ctx, postBudget)
	defer cancel()
	if ref.short != nil {
		if ref = f.followShort(ctx, ref); ref == nil {
			return nil, nil
		}
	}
	site := postSites[ref.platform]
	if site == nil {
		return nil, nil
	}
	for _, source := range site.sources {
		if ctx.Err() != nil {
			break
		}
		p := f.ask(ctx, source, ref)
		if p == nil {
			continue
		}
		p.finish(ref, site)
		if p.usable() {
			return p, ref
		}
	}
	return nil, nil
}

// ask puts a post to one source, within that source's share of the time. A
// source that answers with a server error is asked once more after a moment:
// the public services these are answer 500 now and then and are fine on the
// next request, and a card lost to that is lost for good, since a message
// keeps the card it was sent with.
func (f *Fetcher) ask(ctx context.Context, source postSource, ref *postRef) *Post {
	sctx, stop := context.WithTimeout(ctx, postSourceWait)
	defer stop()
	for attempt := 0; ; attempt++ {
		p, err := source(f, sctx, ref)
		if err == nil {
			return p
		}
		var failed *statusError
		if attempt > 0 || !errors.As(err, &failed) || failed.code < 500 {
			return nil
		}
		select {
		case <-sctx.Done():
			return nil
		case <-time.After(postRetryPause):
		}
	}
}

// statusError is a server answering with something other than what was asked for.
type statusError struct {
	host string
	code int
}

func (e *statusError) Error() string { return fmt.Sprintf("unfurl: %s answered %d", e.host, e.code) }

// followShort finds the post a short link leads to.
func (f *Fetcher) followShort(ctx context.Context, ref *postRef) *postRef {
	final, err := f.finalURL(ctx, ref.short.String(), map[string]string{"User-Agent": browserUA})
	if err != nil {
		return nil
	}
	next := postRefOf(final)
	if next == nil || next.short != nil || next.platform != ref.platform {
		return nil
	}
	return next
}

// sizes fills in the shape of the pictures a source gave without one, while
// there is time. A card is laid out before its pictures arrive, and a picture
// of unknown shape moves everything under it when it does.
func (f *Fetcher) sizes(ctx context.Context, p *Post) {
	ctx, cancel := context.WithTimeout(ctx, 900*time.Millisecond)
	defer cancel()
	var wg sync.WaitGroup
	measure := func(media []PostMedia) {
		for i := range media[:min(len(media), 4)] {
			m := &media[i]
			from := m.URL
			if m.Kind != "photo" {
				from = m.Thumb
			}
			if from == "" || (m.W > 0 && m.H > 0) {
				continue
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				m.W, m.H = f.imageSize(ctx, from)
			}()
		}
	}
	measure(p.Media)
	if p.Quote != nil {
		measure(p.Quote.Media)
	}
	wg.Wait()
}

// usable reports whether there is anything to draw.
func (p *Post) usable() bool {
	if p == nil {
		return false
	}
	return (p.Name != "" || p.Handle != "" || p.Community != "") && (p.Text != "" || p.Title != "" || len(p.Media) > 0 || p.Poll != nil || p.Quote != nil)
}

// finish holds a post to what a card may carry: the service's names, text of
// a bounded length, web addresses and nothing else in the fields that are
// addresses, and a quote that quotes nothing further.
func (p *Post) finish(ref *postRef, site *postSite) {
	p.Platform, p.Site = ref.platform, site.name
	if !webAddress(p.URL) {
		p.URL = ref.link()
	}
	p.tidy()
	// one address for a post, whichever of X's names a source wrote it under
	if ref.platform == "twitter" && p.Handle != "" {
		p.URL = "https://x.com/" + p.Handle + "/status/" + ref.id
	}
	if q := p.Quote; q != nil {
		q.Platform, q.Site = ref.platform, site.name
		q.Quote = nil
		q.tidy()
		if !q.usable() {
			p.Quote = nil
		}
	}
}

func (p *Post) tidy() {
	p.Name = clip(collapse(p.Name), maxTitleRunes)
	p.Handle = clip(strings.TrimPrefix(collapse(p.Handle), "@"), maxTitleRunes)
	p.Community = clip(collapse(p.Community), maxTitleRunes)
	p.Title = clip(collapse(p.Title), 300)
	// what is cut from the front moves every link's place by as much
	lead := len(p.Text) - len(strings.TrimLeftFunc(p.Text, unicode.IsSpace))
	p.Text = clip(strings.TrimSpace(p.Text), maxPostText)
	p.ReplyTo = clip(strings.TrimPrefix(collapse(p.ReplyTo), "@"), maxTitleRunes)
	p.Note = clip(strings.TrimSpace(p.Note), maxDescRunes)
	for _, field := range []*string{&p.URL, &p.AuthorURL, &p.Avatar, &p.CommunityURL} {
		if !webAddress(*field) {
			*field = ""
		}
	}
	links := p.Links[:0]
	from := 0
	for _, l := range p.Links {
		// a link is only worth carrying when the text shows other words for it
		if l.Text == "" || l.Text == l.URL || !webAddress(l.URL) || len(links) == maxPostLinks {
			continue
		}
		// found the way the app will look for it, and only kept where that
		// finds the words the link is really on
		found := strings.Index(p.Text[from:], l.Text)
		if found < 0 || (l.placed && from+found != l.at-lead) {
			continue
		}
		from += found + len(l.Text)
		links = append(links, PostLink{Text: l.Text, URL: l.URL})
	}
	p.Links = links
	if len(p.Links) == 0 {
		p.Links = nil
	}
	media := p.Media[:0]
	for _, m := range p.Media {
		if len(media) == maxPostMedia {
			break
		}
		if m.Kind != "photo" && m.Kind != "video" && m.Kind != "gif" {
			continue
		}
		for _, field := range []*string{&m.URL, &m.Thumb, &m.Audio} {
			if !webAddress(*field) {
				*field = ""
			}
		}
		// a picture is its file; a video may be only its poster
		if m.URL == "" && (m.Kind == "photo" || m.Thumb == "") {
			continue
		}
		if m.W <= 0 || m.H <= 0 || m.W > 20000 || m.H > 20000 {
			m.W, m.H = 0, 0
		}
		if m.Duration < 0 || m.Duration > 24*60*60 {
			m.Duration = 0
		}
		m.Alt = clip(strings.TrimSpace(m.Alt), 1000)
		media = append(media, m)
	}
	p.Media = media
	if len(p.Media) == 0 {
		p.Media = nil
	}
	if poll := p.Poll; poll != nil {
		if len(poll.Choices) > maxPollChoices {
			poll.Choices = poll.Choices[:maxPollChoices]
		}
		for i := range poll.Choices {
			c := &poll.Choices[i]
			c.Label = clip(collapse(c.Label), 200)
			c.Percent = min(100, max(0, c.Percent))
			c.Votes = max(0, c.Votes)
		}
		if len(poll.Choices) < 2 {
			p.Poll = nil
		}
	}
	p.Replies, p.Reposts, p.Likes, p.Views = max(0, p.Replies), max(0, p.Reposts), max(0, p.Likes), max(0, p.Views)
	if p.Created < 0 {
		p.Created = 0
	}
}

// webAddress reports whether s is an absolute http(s) address.
func webAddress(s string) bool {
	if s == "" || len(s) > 4096 {
		return false
	}
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

// result is the preview a post travels in. Beside the post itself it fills
// the fields every link's card has, so an app from before posts had their own
// card still shows who said what, with the picture or the video.
func (p *Post) result(link string, site *postSite) *Result {
	r := &Result{URL: link, Type: "link", SiteName: site.name, Color: site.color, Icon: site.icon, Post: p}
	who := p.Name
	switch {
	case who == "" && p.Handle != "":
		who = "@" + p.Handle
	case who != "" && p.Handle != "" && !strings.EqualFold(who, p.Handle):
		who += " (@" + p.Handle + ")"
	}
	if who == "" {
		who = p.Community
	}
	if p.Title != "" {
		r.Title, r.Author, r.AuthorURL = p.Title, who, p.AuthorURL
	} else {
		r.Title = clip(who, maxTitleRunes)
	}
	r.Description = clip(p.Text, maxDescRunes)
	r.PublishedAt = p.Created
	for _, m := range p.Media {
		if m.Kind == "photo" {
			r.Image, r.ImageW, r.ImageH, r.ImageLayout = m.URL, m.W, m.H, "large"
			break
		}
		if m.URL != "" {
			r.Media, r.MediaKind, r.MediaMime, r.MediaW, r.MediaH = m.URL, "video", "video/mp4", m.W, m.H
		}
		if m.Thumb != "" {
			r.Image, r.ImageW, r.ImageH, r.ImageLayout = m.Thumb, m.W, m.H, "large"
		}
		break
	}
	return r
}

// errNoPost is a source saying it has nothing for this post.
var errNoPost = errors.New("unfurl: no post")

// get fetches an address through the guard and returns what it said, up to
// max bytes, with the address it ended at. Only a 200 is an answer.
func (f *Fetcher) get(ctx context.Context, rawURL string, header map[string]string, max int64) ([]byte, *url.URL, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, nil, ErrBlocked
	}
	if err := f.validate(ctx, u); err != nil {
		return nil, nil, err
	}
	client := &http.Client{
		Transport: f.transport(),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > maxRedirects {
				return errors.New("unfurl: too many redirects")
			}
			return f.validate(req.Context(), req.URL)
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, nil, ErrBlocked
	}
	req.Header.Set("User-Agent", f.userAgent())
	req.Header.Set("Accept-Language", "en")
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, res.Request.URL, &statusError{host: u.Hostname(), code: res.StatusCode}
	}
	if max <= 0 {
		max = f.maxBytes()
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, max+1))
	if err != nil {
		return nil, res.Request.URL, err
	}
	if int64(len(body)) > max {
		return nil, res.Request.URL, ErrTooLarge
	}
	return body, res.Request.URL, nil
}

// getJSON fetches an address and reads its answer into out.
func (f *Fetcher) getJSON(ctx context.Context, rawURL string, header map[string]string, out any) error {
	h := map[string]string{"Accept": "application/json"}
	for k, v := range header {
		h[k] = v
	}
	body, _, err := f.get(ctx, rawURL, h, 0)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, out)
}

// finalURL follows an address through its redirects and returns where it
// ends, reading nothing of the page there.
func (f *Fetcher) finalURL(ctx context.Context, rawURL string, header map[string]string) (*url.URL, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, ErrBlocked
	}
	if err := f.validate(ctx, u); err != nil {
		return nil, err
	}
	client := &http.Client{
		Transport: f.transport(),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > maxRedirects+2 {
				return errors.New("unfurl: too many redirects")
			}
			return f.validate(req.Context(), req.URL)
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, ErrBlocked
	}
	req.Header.Set("User-Agent", f.userAgent())
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	res.Body.Close()
	return res.Request.URL, nil
}

// millis reads a time in seconds, as most of these services give it.
func millis(seconds float64) int64 {
	if seconds <= 0 || seconds > 1e11 {
		return 0
	}
	return int64(seconds * 1000)
}

// count reads a number a page wrote for people: "1.4K", "2,043", "3.1M".
func count(s string) int64 {
	s = strings.TrimSpace(strings.ReplaceAll(s, ",", ""))
	if s == "" {
		return 0
	}
	mult := 1.0
	switch s[len(s)-1] {
	case 'k', 'K':
		mult, s = 1e3, s[:len(s)-1]
	case 'm', 'M':
		mult, s = 1e6, s[:len(s)-1]
	case 'b', 'B':
		mult, s = 1e9, s[:len(s)-1]
	}
	n, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || n < 0 {
		return 0
	}
	return int64(n*mult + 0.5)
}

// runes cuts s to the runes from start up to end, as the services that count
// a text's characters count them.
func runes(s string, start, end int) string {
	if start < 0 {
		start = 0
	}
	if end <= start {
		return ""
	}
	if utf8.RuneCountInString(s) <= end && start == 0 {
		return s
	}
	r := []rune(s)
	if start > len(r) {
		return ""
	}
	if end > len(r) {
		end = len(r)
	}
	return string(r[start:end])
}
