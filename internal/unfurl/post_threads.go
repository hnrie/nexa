package unfurl

// Threads.
//
// Threads shows a logged-out visitor's scripts very little, but it has a page
// made for embedding a post on other sites (…/post/CODE/embed), which it
// writes out in full for a crawler: the author, the picture, the words, the
// video's file, the counts. That is Threads' own data and needs nobody
// else's service, so it is read first. The account's display name is only in
// the post page's title, and is fetched beside it. The atmosphere API
// (post_fx.go) is second; it knows quotes and carousels, when it answers.
//
// The files are served from Instagram's addresses, signed for a few days, so
// a card names its files instead of holding them (assets.go).

import (
	"context"
	"net/url"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html"
)

const threadsBase = "https://www.threads.com"

// "Gem (@spiramidgareorzea) on Threads"
var threadsTitleRe = regexp.MustCompile(`^(.*) \(@([A-Za-z0-9_.]{1,40})\) on Threads$`)

// pageName is the display name a site writes into the title of a post's page
// ("Name (@handle) on Threads"), or "" when the page or the name is not there.
func (f *Fetcher) pageName(ctx context.Context, address string, re *regexp.Regexp, tags ...string) string {
	body, _, err := f.get(ctx, address, map[string]string{"Accept": "text/html"}, 0)
	if err != nil {
		return ""
	}
	if m := re.FindStringSubmatch(decoded(parseMeta(body).first(tags...))); m != nil {
		return m[1]
	}
	return ""
}

// nameBeside starts looking up a display name while the caller reads the
// post, and returns a way to collect it: the name if it is in by then or
// comes within a moment, "" otherwise. A card is not kept waiting for a name.
func (f *Fetcher) nameBeside(ctx context.Context, address string, re *regexp.Regexp, tags ...string) func() string {
	found := make(chan string, 1)
	go func() { found <- f.pageName(ctx, address, re, tags...) }()
	return func() string {
		select {
		case name := <-found:
			return name
		case <-time.After(700 * time.Millisecond):
			return ""
		case <-ctx.Done():
			return ""
		}
	}
}

func threadsEmbed(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	if ref.user == "" {
		// a link by the post's code alone ("/t/CODE"): its page says whose it is
		body, _, err := f.get(ctx, ref.link(), map[string]string{"Accept": "text/html"}, 0)
		if err != nil {
			return nil, err
		}
		own, _ := url.Parse(parseMeta(body).first("og:url"))
		named := postRefOf(own)
		if named == nil || named.platform != "threads" || named.user == "" || named.id != ref.id {
			return nil, errNoPost
		}
		ref.user = named.user
	}
	link := ref.link()
	name := f.nameBeside(ctx, link, threadsTitleRe, "og:title", "twitter:title")
	body, _, err := f.get(ctx, link+"/embed", map[string]string{"Accept": "text/html"}, 0)
	if err != nil {
		return nil, err
	}
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	// a post that is gone, private, or not to be embedded
	if findClass(doc, "EmbedError") != nil {
		return nil, errNoPost
	}
	// the post asked for is the last one shown: an answer is drawn under what it answers
	posts := allClass(doc, "OuterContainer")
	if len(posts) == 0 {
		return nil, errNoPost
	}
	root := posts[len(posts)-1]
	p := &Post{Created: shortcodeTime(ref.id)}
	p.Handle = plain(findClass(root, "HeaderLink"))
	if p.Handle == "" {
		return nil, errNoPost
	}
	p.AuthorURL = threadsBase + "/@" + p.Handle
	p.Avatar = attr(findTag(findClass(root, "AvatarContainer"), "img"), "src")
	p.Verified = findClass(root, "VerifiedBadge") != nil
	if len(posts) > 1 {
		p.ReplyTo = plain(findClass(posts[len(posts)-2], "HeaderLink"))
	}
	p.Text, p.Links = nodeText(findClass(root, "BodyTextContainer"), nil)
	// pictures and videos are whatever sits in the post's media boxes, in order
	inMedia := func(n *html.Node) bool { return classHas(n, "Media") }
	each(root, func(n *html.Node) bool {
		if n.Type != html.ElementNode || !within(n, inMedia) {
			return true
		}
		switch n.Data {
		case "video":
			m := PostMedia{Kind: "video", URL: attr(n, "src"), Thumb: attr(n, "poster")}
			if m.URL == "" {
				m.URL = attr(findTag(n, "source"), "src")
			}
			p.Media = append(p.Media, m)
			return false
		case "img":
			if src := attr(n, "src"); src != "" {
				p.Media = append(p.Media, PostMedia{Kind: "photo", URL: src, Alt: attr(n, "alt")})
			}
			return false
		}
		return true
	})
	// likes, replies and reposts, in the order the page draws them; one with no number is none
	for i, icon := range allClass(root, "ActionBarIcon") {
		n := count(plain(findClass(icon, "ActionBarCount")))
		switch i {
		case 0:
			p.Likes = n
		case 1:
			p.Replies = n
		case 2:
			p.Reposts = n
		}
	}
	p.Name = name()
	return p, nil
}
