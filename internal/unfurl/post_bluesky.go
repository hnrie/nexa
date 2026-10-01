package unfurl

// Bluesky.
//
// Bluesky's own API is open and needs no login (public.api.bsky.app), so a
// post is read straight from it: the author, the text with the links behind
// its shortened addresses, pictures with their shapes, the quoted post, the
// counts. A video is served as a stream, which a plain player cannot play,
// but the file that was uploaded is kept by the author's own server and is
// open too; that is the file a card plays. FxBluesky is second (post_fx.go).

import (
	"context"
	"encoding/json"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	blueskyAPIBase = "https://public.api.bsky.app/xrpc/"
	plcDirectory   = "https://plc.directory/"
	// fxbsky keeps copies of uploaded files, for an account whose own server
	// cannot be found
	blueskyBlobCache = "https://pds-cache.fxbsky.app/"
)

type bskyRatio struct {
	Width  looseInt `json:"width"`
	Height looseInt `json:"height"`
}

type bskyAuthor struct {
	DID          string `json:"did"`
	Handle       string `json:"handle"`
	DisplayName  string `json:"displayName"`
	Avatar       string `json:"avatar"`
	Verification *struct {
		VerifiedStatus        string `json:"verifiedStatus"`
		TrustedVerifierStatus string `json:"trustedVerifierStatus"`
	} `json:"verification"`
}

type bskyRecord struct {
	Text      string      `json:"text"`
	CreatedAt string      `json:"createdAt"`
	Facets    []bskyFacet `json:"facets"`
}

// bskyFacet says what a stretch of a post's text is: a link, a mention, a tag.
type bskyFacet struct {
	Index struct {
		ByteStart int `json:"byteStart"`
		ByteEnd   int `json:"byteEnd"`
	} `json:"index"`
	Features []struct {
		Type string `json:"$type"`
		URI  string `json:"uri"`
		DID  string `json:"did"`
		Tag  string `json:"tag"`
	} `json:"features"`
}

// bskyEmbed is whichever of the embed views a post has: pictures, a video, a
// link card, a quoted post, or a quoted post beside one of the others.
type bskyEmbed struct {
	Type   string `json:"$type"`
	Images []struct {
		Fullsize    string     `json:"fullsize"`
		Alt         string     `json:"alt"`
		AspectRatio *bskyRatio `json:"aspectRatio"`
	} `json:"images"`
	CID          string     `json:"cid"`
	Thumbnail    string     `json:"thumbnail"`
	AspectRatio  *bskyRatio `json:"aspectRatio"`
	Presentation string     `json:"presentation"`
	Alt          string     `json:"alt"`
	External     *struct {
		URI string `json:"uri"`
	} `json:"external"`
	Record json.RawMessage `json:"record"`
	Media  *bskyEmbed      `json:"media"`
}

type bskyPost struct {
	URI     string     `json:"uri"`
	Author  bskyAuthor `json:"author"`
	Record  bskyRecord `json:"record"`
	Embed   *bskyEmbed `json:"embed"`
	Replies looseInt   `json:"replyCount"`
	Reposts looseInt   `json:"repostCount"`
	Likes   looseInt   `json:"likeCount"`
	Labels  []struct {
		Val string `json:"val"`
	} `json:"labels"`
}

// bskyQuoted is a quoted post as an embed carries it.
type bskyQuoted struct {
	URI    string      `json:"uri"`
	Author *bskyAuthor `json:"author"`
	Value  bskyRecord  `json:"value"`
	Embeds []bskyEmbed `json:"embeds"`
	Labels []struct {
		Val string `json:"val"`
	} `json:"labels"`
	Replies looseInt `json:"replyCount"`
	Reposts looseInt `json:"repostCount"`
	Likes   looseInt `json:"likeCount"`
}

// Labels that put a post's media behind a cover.
var bskySensitive = map[string]bool{"porn": true, "sexual": true, "nudity": true, "graphic-media": true, "gore": true, "nsfw": true}

// bskyLink is a post's address on bsky.app, from its at:// name.
func bskyLink(atURI, handle string) string {
	rest, ok := strings.CutPrefix(atURI, "at://")
	if !ok {
		return ""
	}
	parts := strings.Split(rest, "/")
	if len(parts) != 3 || parts[1] != "app.bsky.feed.post" {
		return ""
	}
	who := handle
	if who == "" || who == "handle.invalid" {
		who = parts[0]
	}
	return "https://bsky.app/profile/" + who + "/post/" + parts[2]
}

func (r *bskyRecord) links() []PostLink {
	var out []PostLink
	// in the order the text has them, which is the order a card needs
	facets := slices.Clone(r.Facets)
	slices.SortStableFunc(facets, func(a, b bskyFacet) int { return a.Index.ByteStart - b.Index.ByteStart })
	for _, facet := range facets {
		start, end := facet.Index.ByteStart, facet.Index.ByteEnd
		if start < 0 || end > len(r.Text) || start >= end {
			continue
		}
		label := r.Text[start:end]
		if !utf8.ValidString(label) {
			continue
		}
		for _, feat := range facet.Features {
			switch {
			case strings.HasSuffix(feat.Type, "#link") && feat.URI != "":
				out = append(out, PostLink{Text: label, URL: feat.URI, at: start, placed: true})
			case strings.HasSuffix(feat.Type, "#mention") && feat.DID != "":
				out = append(out, PostLink{Text: label, URL: "https://bsky.app/profile/" + feat.DID, at: start, placed: true})
			case strings.HasSuffix(feat.Type, "#tag") && feat.Tag != "":
				out = append(out, PostLink{Text: label, URL: "https://bsky.app/hashtag/" + url.PathEscape(feat.Tag), at: start, placed: true})
			}
		}
	}
	return out
}

func (a *bskyAuthor) fill(p *Post) {
	p.Name, p.Handle, p.Avatar = a.DisplayName, a.Handle, a.Avatar
	who := a.Handle
	if who == "" || who == "handle.invalid" {
		who, p.Handle = a.DID, ""
	}
	p.AuthorURL = "https://bsky.app/profile/" + who
	p.Verified = a.Verification != nil && (a.Verification.VerifiedStatus == "valid" || a.Verification.TrustedVerifierStatus == "valid")
}

// media reads an embed's pictures or video into a post. did is whose post it
// is, and blob builds the address of a file that account uploaded.
func (e *bskyEmbed) media(p *Post, did string, blob func(did, cid string) string) {
	if e == nil {
		return
	}
	switch {
	case strings.HasPrefix(e.Type, "app.bsky.embed.images"):
		for _, img := range e.Images {
			m := PostMedia{Kind: "photo", URL: img.Fullsize, Alt: img.Alt}
			if img.AspectRatio != nil {
				m.W, m.H = int(img.AspectRatio.Width), int(img.AspectRatio.Height)
			}
			p.Media = append(p.Media, m)
		}
	case strings.HasPrefix(e.Type, "app.bsky.embed.video"):
		m := PostMedia{Kind: "video", Thumb: e.Thumbnail, Alt: e.Alt}
		if e.Presentation == "gif" {
			m.Kind = "gif"
		}
		if e.AspectRatio != nil {
			m.W, m.H = int(e.AspectRatio.Width), int(e.AspectRatio.Height)
		}
		if e.CID != "" && did != "" {
			m.URL = blob(did, e.CID)
		}
		p.Media = append(p.Media, m)
	case strings.HasPrefix(e.Type, "app.bsky.embed.external"):
		if e.External == nil || e.External.URI == "" {
			return
		}
		// a GIF from the picker is a link card to the file itself
		if u, err := url.Parse(e.External.URI); err == nil && strings.HasSuffix(strings.ToLower(u.Path), ".gif") {
			m := PostMedia{Kind: "photo", URL: e.External.URI}
			m.W, _ = strconv.Atoi(u.Query().Get("ww"))
			m.H, _ = strconv.Atoi(u.Query().Get("hh"))
			p.Media = append(p.Media, m)
			return
		}
		// any other card is a link the post makes; it reads as one in the text
		if !strings.Contains(p.Text, e.External.URI) {
			if p.Text != "" {
				p.Text += "\n\n"
			}
			p.Text += e.External.URI
		}
	case strings.HasPrefix(e.Type, "app.bsky.embed.recordWithMedia"):
		e.Media.media(p, did, blob)
	}
}

// quoted is the post an embed quotes, if it quotes one that can be shown.
func (e *bskyEmbed) quoted(blob func(did, cid string) string) *Post {
	if e == nil || len(e.Record) == 0 {
		return nil
	}
	raw := e.Record
	if strings.HasPrefix(e.Type, "app.bsky.embed.recordWithMedia") {
		// one level further in: {record: {record: the post}}
		var wrap struct {
			Record json.RawMessage `json:"record"`
		}
		if json.Unmarshal(raw, &wrap) != nil || len(wrap.Record) == 0 {
			return nil
		}
		raw = wrap.Record
	} else if !strings.HasPrefix(e.Type, "app.bsky.embed.record") {
		return nil
	}
	var q bskyQuoted
	// a deleted or blocked post, a feed or a list are quoted too, with no author
	if json.Unmarshal(raw, &q) != nil || q.Author == nil || q.Author.DID == "" {
		return nil
	}
	p := &Post{
		URL:     bskyLink(q.URI, q.Author.Handle),
		Text:    q.Value.Text,
		Links:   q.Value.links(),
		Created: parseTime(q.Value.CreatedAt),
		Replies: int64(q.Replies),
		Reposts: int64(q.Reposts),
		Likes:   int64(q.Likes),
	}
	q.Author.fill(p)
	for i := range q.Embeds {
		q.Embeds[i].media(p, q.Author.DID, blob)
	}
	for _, l := range q.Labels {
		p.Sensitive = p.Sensitive || bskySensitive[l.Val]
	}
	return p
}

func blueskyAPI(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	var answer struct {
		Thread struct {
			Post *bskyPost `json:"post"`
		} `json:"thread"`
	}
	at := "at://" + ref.user + "/app.bsky.feed.post/" + ref.id
	address := blueskyAPIBase + "app.bsky.feed.getPostThread?depth=0&parentHeight=0&uri=" + url.QueryEscape(at)
	if err := f.getJSON(ctx, address, nil, &answer); err != nil {
		return nil, err
	}
	post := answer.Thread.Post
	if post == nil || post.Author.DID == "" {
		return nil, errNoPost
	}
	// Where an account keeps its files is looked up once per account, and
	// only for a post that has a video.
	servers := map[string]string{}
	blob := func(did, cid string) string {
		server, known := servers[did]
		if !known {
			server = f.blueskyServer(ctx, did)
			servers[did] = server
		}
		if server == "" {
			return blueskyBlobCache + url.PathEscape(did) + "/" + url.PathEscape(cid)
		}
		return server + "/xrpc/com.atproto.sync.getBlob?did=" + url.QueryEscape(did) + "&cid=" + url.QueryEscape(cid)
	}
	p := &Post{
		URL:     bskyLink(post.URI, post.Author.Handle),
		Text:    post.Record.Text,
		Links:   post.Record.links(),
		Created: parseTime(post.Record.CreatedAt),
		Replies: int64(post.Replies),
		Reposts: int64(post.Reposts),
		Likes:   int64(post.Likes),
	}
	post.Author.fill(p)
	post.Embed.media(p, post.Author.DID, blob)
	p.Quote = post.Embed.quoted(blob)
	for _, l := range post.Labels {
		p.Sensitive = p.Sensitive || bskySensitive[l.Val]
	}
	return p, nil
}

// blueskyServer is the server an account keeps its data on, from the
// account's identity document, or "" when it cannot be found.
func (f *Fetcher) blueskyServer(ctx context.Context, did string) string {
	var address string
	switch {
	case strings.HasPrefix(did, "did:plc:"):
		address = plcDirectory + url.PathEscape(did)
	case strings.HasPrefix(did, "did:web:"):
		host := strings.TrimPrefix(did, "did:web:")
		if host == "" || strings.ContainsAny(host, "/:?#@") {
			return ""
		}
		address = "https://" + host + "/.well-known/did.json"
	default:
		return ""
	}
	var doc struct {
		Service []struct {
			ID       string `json:"id"`
			Endpoint string `json:"serviceEndpoint"`
		} `json:"service"`
	}
	if err := f.getJSON(ctx, address, nil, &doc); err != nil {
		return ""
	}
	for _, s := range doc.Service {
		if !strings.HasSuffix(s.ID, "#atproto_pds") {
			continue
		}
		u, err := url.Parse(s.Endpoint)
		if err != nil || u.Scheme != "https" || u.Host == "" {
			return ""
		}
		return "https://" + u.Host
	}
	return ""
}
