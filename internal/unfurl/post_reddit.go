package unfurl

// Reddit.
//
// Reddit's JSON gives a whole post (text, score, comments, every picture of a
// gallery, the video), and is asked first, but Reddit refuses it to many
// servers. The post's feed is open where the JSON is not and still has the
// title, the author, the subreddit, the text, the picture and the time, so
// it is second. vxReddit, a public fixer, is last.
//
// A Reddit video is two files, the picture and the sound, listed in a small
// manifest beside them. A card carries both and the app plays them together
// (PostMedia.Audio).

import (
	"context"
	"encoding/xml"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

const (
	redditBase   = "https://www.reddit.com"
	redditVideos = "https://v.redd.it/"
	vxRedditBase = "https://vxreddit.com"
)

type redditPost struct {
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	SelftextHTML string   `json:"selftext_html"`
	Selftext     string   `json:"selftext"`
	Author       string   `json:"author"`
	Subreddit    string   `json:"subreddit_name_prefixed"`
	Score        looseInt `json:"score"`
	Comments     looseInt `json:"num_comments"`
	Created      float64  `json:"created_utc"`
	Over18       bool     `json:"over_18"`
	Spoiler      bool     `json:"spoiler"`
	Permalink    string   `json:"permalink"`
	Dest         string   `json:"url_overridden_by_dest"`
	IsSelf       bool     `json:"is_self"`
	Preview      *struct {
		Images []struct {
			Source struct {
				URL    string   `json:"url"`
				Width  looseInt `json:"width"`
				Height looseInt `json:"height"`
			} `json:"source"`
		} `json:"images"`
	} `json:"preview"`
	MediaMetadata map[string]struct {
		Kind string `json:"e"`
		S    struct {
			U   string   `json:"u"`
			GIF string   `json:"gif"`
			X   looseInt `json:"x"`
			Y   looseInt `json:"y"`
		} `json:"s"`
	} `json:"media_metadata"`
	Gallery *struct {
		Items []struct {
			MediaID string `json:"media_id"`
			Caption string `json:"caption"`
		} `json:"items"`
	} `json:"gallery_data"`
	Media *struct {
		Video *struct {
			FallbackURL string   `json:"fallback_url"`
			Width       looseInt `json:"width"`
			Height      looseInt `json:"height"`
			Duration    looseInt `json:"duration"`
			IsGIF       bool     `json:"is_gif"`
		} `json:"reddit_video"`
	} `json:"secure_media"`
	Crossposts []redditPost `json:"crosspost_parent_list"`
}

var redditVideoRe = regexp.MustCompile(`^https://v\.redd\.it/([a-z0-9]{6,20})(?:/|$)`)

func (r *redditPost) post(f *Fetcher, ctx context.Context, quoted bool) *Post {
	if r == nil || r.Title == "" {
		return nil
	}
	base, _ := url.Parse(redditBase + "/")
	p := &Post{
		Title:     r.Title,
		Community: r.Subreddit,
		Created:   millis(r.Created),
		Replies:   int64(r.Comments),
		Likes:     int64(r.Score),
		Sensitive: r.Over18 || r.Spoiler,
	}
	if r.Permalink != "" {
		p.URL = redditBase + r.Permalink
	}
	if r.Subreddit != "" {
		p.CommunityURL = redditBase + "/" + r.Subreddit + "/"
	}
	if r.Author != "" && r.Author != "[deleted]" {
		p.Name, p.AuthorURL = "u/"+r.Author, redditBase+"/user/"+r.Author
	}
	if r.SelftextHTML != "" {
		p.Text, p.Links = htmlText(r.SelftextHTML, base)
	} else {
		p.Text = r.Selftext
	}
	var thumb PostMedia
	if r.Preview != nil && len(r.Preview.Images) > 0 {
		src := r.Preview.Images[0].Source
		thumb = PostMedia{URL: src.URL, W: int(src.Width), H: int(src.Height)}
	}
	dest, _ := url.Parse(r.Dest)
	switch {
	case r.Media != nil && r.Media.Video != nil:
		v := r.Media.Video
		m := PostMedia{Kind: "video", Thumb: thumb.URL, W: int(v.Width), H: int(v.Height), Duration: float64(v.Duration)}
		if v.IsGIF {
			m.Kind = "gif"
		}
		if id := redditVideoRe.FindStringSubmatch(v.FallbackURL); id != nil {
			if !f.redditVideo(ctx, id[1], &m) {
				// no manifest: the one size Reddit names, which has no sound
				m.URL, _, _ = strings.Cut(v.FallbackURL, "?")
			}
		}
		p.Media = append(p.Media, m)
	case r.Gallery != nil && len(r.MediaMetadata) > 0:
		for _, item := range r.Gallery.Items {
			meta, ok := r.MediaMetadata[item.MediaID]
			if !ok {
				continue
			}
			m := PostMedia{Kind: "photo", URL: meta.S.U, W: int(meta.S.X), H: int(meta.S.Y), Alt: item.Caption}
			if meta.S.GIF != "" {
				m.URL = meta.S.GIF
			}
			p.Media = append(p.Media, m)
		}
	case dest != nil && (dest.Host == "i.redd.it" || dest.Host == "i.imgur.com") && imagePath(dest.Path):
		p.Media = append(p.Media, PostMedia{Kind: "photo", URL: r.Dest, W: thumb.W, H: thumb.H})
	case !r.IsSelf && r.Dest != "":
		// a link post is its link, with the picture Reddit made of the page
		if !strings.Contains(p.Text, r.Dest) {
			p.Text = strings.TrimSpace(r.Dest + "\n\n" + p.Text)
		}
		if thumb.URL != "" {
			thumb.Kind = "photo"
			p.Media = append(p.Media, thumb)
		}
	}
	if !quoted && len(r.Crossposts) > 0 {
		p.Quote = r.Crossposts[0].post(f, ctx, true)
		// a crosspost repeats its parent's media; it belongs to the parent
		if p.Quote != nil && len(p.Quote.Media) > 0 {
			p.Media = nil
		}
	}
	return p
}

func imagePath(path string) bool {
	path = strings.ToLower(path)
	for _, ext := range []string{".jpg", ".jpeg", ".png", ".gif", ".webp"} {
		if strings.HasSuffix(path, ext) {
			return true
		}
	}
	return false
}

func redditJSON(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	var listing []struct {
		Data struct {
			Children []struct {
				Data redditPost `json:"data"`
			} `json:"children"`
		} `json:"data"`
	}
	if err := f.getJSON(ctx, redditBase+"/comments/"+ref.id+".json?raw_json=1&limit=1", nil, &listing); err != nil {
		return nil, err
	}
	if len(listing) == 0 || len(listing[0].Data.Children) == 0 {
		return nil, errNoPost
	}
	p := listing[0].Data.Children[0].Data.post(f, ctx, false)
	if p == nil {
		return nil, errNoPost
	}
	return p, nil
}

type atomEntry struct {
	ID     string `xml:"id"`
	Title  string `xml:"title"`
	Author struct {
		Name string `xml:"name"`
		URI  string `xml:"uri"`
	} `xml:"author"`
	Category struct {
		Label string `xml:"label,attr"`
	} `xml:"category"`
	Content string `xml:"content"`
	Link    struct {
		Href string `xml:"href,attr"`
	} `xml:"link"`
	Published string `xml:"published"`
	Thumbnail struct {
		URL string `xml:"url,attr"`
	} `xml:"http://search.yahoo.com/mrss/ thumbnail"`
}

func redditFeed(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	body, _, err := f.get(ctx, redditBase+"/comments/"+ref.id+"/.rss?limit=1", map[string]string{"Accept": "application/atom+xml,application/xml;q=0.9,*/*;q=0.5"}, 0)
	if err != nil {
		return nil, err
	}
	var feed struct {
		Entries []atomEntry `xml:"entry"`
	}
	if err := xml.Unmarshal(body, &feed); err != nil {
		return nil, err
	}
	// the post is the entry named for it; the others are its comments
	var entry *atomEntry
	for i := range feed.Entries {
		if feed.Entries[i].ID == "t3_"+ref.id {
			entry = &feed.Entries[i]
			break
		}
	}
	if entry == nil || entry.Title == "" {
		return nil, errNoPost
	}
	p := &Post{
		URL:       entry.Link.Href,
		Title:     entry.Title,
		Community: entry.Category.Label,
		Created:   parseTime(entry.Published),
	}
	if p.Community != "" {
		p.CommunityURL = redditBase + "/" + p.Community + "/"
	}
	if name := strings.TrimPrefix(strings.TrimSpace(entry.Author.Name), "/"); name != "" && name != "u/[deleted]" {
		p.Name, p.AuthorURL = name, entry.Author.URI
	}
	base, _ := url.Parse(redditBase + "/")
	root := &html.Node{Type: html.ElementNode, Data: "div"}
	for _, n := range parseFragment(entry.Content) {
		root.AppendChild(n)
	}
	// The post's own words sit in a block of their own; around it the feed
	// writes "submitted by", [link] and [comments].
	if md := findClass(root, "md"); md != nil {
		p.Text, p.Links = nodeText(md, base)
	}
	dest, preview := "", ""
	walk(root, func(n *html.Node) bool {
		if n.Type != html.ElementNode {
			return true
		}
		switch n.Data {
		case "a":
			if plain(n) == "[link]" {
				dest = attr(n, "href")
			}
		case "img":
			if preview == "" {
				preview = attr(n, "src")
			}
		}
		return true
	})
	if preview == "" {
		preview = entry.Thumbnail.URL
	}
	target, _ := url.Parse(dest)
	switch {
	case target == nil || dest == "" || dest == entry.Link.Href:
		// a text post: its link is itself
	case target.Host == "v.redd.it":
		m := PostMedia{Kind: "video", Thumb: preview}
		if id := redditVideoRe.FindStringSubmatch(dest); id != nil {
			f.redditVideo(ctx, id[1], &m)
		}
		p.Media = append(p.Media, m)
	case (target.Host == "i.redd.it" || target.Host == "i.imgur.com") && imagePath(target.Path):
		p.Media = append(p.Media, PostMedia{Kind: "photo", URL: dest})
	case strings.HasSuffix(target.Host, "reddit.com") && strings.HasPrefix(target.Path, "/gallery/"):
		// the feed has a gallery's first picture only
		if preview != "" {
			p.Media = append(p.Media, PostMedia{Kind: "photo", URL: preview})
		}
	default:
		if !strings.Contains(p.Text, dest) {
			p.Text = strings.TrimSpace(dest + "\n\n" + p.Text)
		}
		if preview != "" {
			p.Media = append(p.Media, PostMedia{Kind: "photo", URL: preview})
		}
	}
	return p, nil
}

var isoDurationRe = regexp.MustCompile(`^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$`)

// redditVideo fills in a video's files from its manifest: the picture in the
// size a chat needs, and the sound, which Reddit keeps beside it. It reports
// whether the manifest named a picture file.
func (f *Fetcher) redditVideo(ctx context.Context, id string, m *PostMedia) bool {
	body, _, err := f.get(ctx, redditVideos+id+"/DASHPlaylist.mpd", nil, 512<<10)
	if err != nil {
		return false
	}
	var mpd struct {
		Duration string `xml:"mediaPresentationDuration,attr"`
		Periods  []struct {
			Sets []struct {
				ContentType string `xml:"contentType,attr"`
				MimeType    string `xml:"mimeType,attr"`
				Reps        []struct {
					MimeType  string `xml:"mimeType,attr"`
					Width     int    `xml:"width,attr"`
					Height    int    `xml:"height,attr"`
					Bandwidth int64  `xml:"bandwidth,attr"`
					BaseURL   string `xml:"BaseURL"`
				} `xml:"Representation"`
			} `xml:"AdaptationSet"`
		} `xml:"Period"`
	}
	if xml.Unmarshal(body, &mpd) != nil {
		return false
	}
	var video, least, audio string
	var videoRate, leastRate, audioRate int64 = -1, -1, -1
	var w, h, leastW, leastH int
	for _, period := range mpd.Periods {
		for _, set := range period.Sets {
			for _, rep := range set.Reps {
				name := strings.TrimSpace(rep.BaseURL)
				// a file beside the manifest, by a plain name: nothing that could point elsewhere
				if name == "" || strings.ContainsAny(name, "/\\?#:") {
					continue
				}
				kind := strings.ToLower(set.ContentType + " " + set.MimeType + " " + rep.MimeType)
				if strings.Contains(kind, "audio") || strings.Contains(strings.ToLower(name), "audio") {
					if rep.Bandwidth > audioRate {
						audio, audioRate = name, rep.Bandwidth
					}
					continue
				}
				if rep.Bandwidth <= maxVideoBitrate && rep.Bandwidth > videoRate {
					video, videoRate, w, h = name, rep.Bandwidth, rep.Width, rep.Height
				}
				if leastRate < 0 || rep.Bandwidth < leastRate {
					least, leastRate, leastW, leastH = name, rep.Bandwidth, rep.Width, rep.Height
				}
			}
		}
	}
	if video == "" {
		video, w, h = least, leastW, leastH
	}
	if video == "" {
		return false
	}
	m.URL = redditVideos + id + "/" + video
	if audio != "" {
		m.Audio = redditVideos + id + "/" + audio
	}
	if w > 0 && h > 0 {
		m.W, m.H = w, h
	}
	if d := isoDurationRe.FindStringSubmatch(mpd.Duration); d != nil && m.Duration == 0 {
		hours, _ := strconv.ParseFloat(d[1], 64)
		minutes, _ := strconv.ParseFloat(d[2], 64)
		seconds, _ := strconv.ParseFloat(d[3], 64)
		m.Duration = hours*3600 + minutes*60 + seconds
	}
	return true
}

// "u/someone on r/pics - ⬆️ 50789 | 💬 802"
var vxRedditSiteRe = regexp.MustCompile(`^(u/[A-Za-z0-9_-]{1,40}) on (r/[A-Za-z0-9_]{1,40})(?:\s*-\s*\S+\s*(\d+)\s*\|\s*\S+\s*(\d+))?`)

func redditVx(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	body, final, err := f.get(ctx, vxRedditBase+"/comments/"+ref.id, map[string]string{"Accept": "text/html"}, 0)
	if err != nil {
		return nil, err
	}
	meta := parseMeta(body)
	p := &Post{Title: decoded(meta.first("og:title")), Text: decoded(meta.text("og:description"))}
	m := vxRedditSiteRe.FindStringSubmatch(decoded(meta.first("og:site_name")))
	if m == nil || p.Title == "" {
		return nil, errNoPost
	}
	p.Name, p.AuthorURL = m[1], redditBase+"/user/"+strings.TrimPrefix(m[1], "u/")
	p.Community, p.CommunityURL = m[2], redditBase+"/"+m[2]+"/"
	p.Likes, _ = strconv.ParseInt(m[3], 10, 64)
	p.Replies, _ = strconv.ParseInt(m[4], 10, 64)
	image := resolveImage(final, meta.first("og:image"))
	width, _ := strconv.Atoi(meta.first("og:video:width", "og:image:width"))
	height, _ := strconv.Atoi(meta.first("og:video:height", "og:image:height"))
	switch {
	case playableVideo[strings.ToLower(meta.first("og:video:type"))] && meta.first("og:video") != "":
		p.Media = []PostMedia{{Kind: "video", URL: resolveImage(final, meta.first("og:video:secure_url", "og:video")), Thumb: image, W: width, H: height}}
	case image != "":
		p.Media = []PostMedia{{Kind: "photo", URL: image, W: width, H: height}}
	}
	return p, nil
}
