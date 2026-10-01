package unfurl

// Instagram.
//
// Instagram shows a logged-out visitor's scripts very little, and what its
// pages carry changes often. Three places still have a post, and each is
// asked in turn:
//
//   - the page Instagram makes for embedding a post on other sites
//     (/p/CODE/embed/captioned/), written out in full for a crawler, with the
//     same data Instagram's own scripts get for a video or a carousel. This
//     is Instagram's own, needs nobody else's service, and is first;
//   - the atmosphere API (post_fx.go), a public fixer that keeps up with
//     Instagram when the embed page changes;
//   - the post's own page, whose preview tags have the author, the first
//     picture and the start of the caption, with oEmbed for the rest of it.
//
// Instagram's file addresses are signed for a few days, so a card names its
// files instead of holding them (assets.go).

import (
	"bytes"
	"context"
	"encoding/json"
	"net/url"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

var (
	// "Just An Egg 🥚 (@world_record_egg) • Instagram photo"
	instagramTitleRe = regexp.MustCompile(`^(.*?) \(@([A-Za-z0-9_.]{1,40})\) • Instagram`)
	// "60M likes, 3M comments - world_record_egg on January 4, 2019: "caption""
	instagramDescRe = regexp.MustCompile(`(?s)^([\d.,]+[KMB]?) likes?, ([\d.,]+[KMB]?) comments? - ([A-Za-z0-9_.]{1,40}) on [^:]{3,40}: "(.*)"\.?\s*$`)
	// the address the page gives for itself names the account before the post
	instagramOwnerRe = regexp.MustCompile(`^/([A-Za-z0-9_.]{1,40})/(?:p|reel|reels|tv)/`)
)

// igMedia is a post as Instagram's own scripts are given it.
type igMedia struct {
	Dimensions struct {
		Width  looseInt `json:"width"`
		Height looseInt `json:"height"`
	} `json:"dimensions"`
	DisplayURL string   `json:"display_url"`
	IsVideo    bool     `json:"is_video"`
	VideoURL   string   `json:"video_url"`
	Duration   float64  `json:"video_duration"`
	Views      looseInt `json:"video_view_count"`
	Alt        string   `json:"accessibility_caption"`
	TakenAt    looseInt `json:"taken_at_timestamp"`
	Caption    struct {
		Edges []struct {
			Node struct {
				Text string `json:"text"`
			} `json:"node"`
		} `json:"edges"`
	} `json:"edge_media_to_caption"`
	Comments struct {
		Count looseInt `json:"count"`
	} `json:"edge_media_to_comment"`
	Likes struct {
		Count looseInt `json:"count"`
	} `json:"edge_liked_by"`
	Owner *struct {
		Username   string `json:"username"`
		FullName   string `json:"full_name"`
		ProfilePic string `json:"profile_pic_url"`
		Verified   bool   `json:"is_verified"`
	} `json:"owner"`
	Children struct {
		Edges []struct {
			Node igMedia `json:"node"`
		} `json:"edges"`
	} `json:"edge_sidecar_to_children"`
}

func (m *igMedia) media() PostMedia {
	out := PostMedia{Kind: "photo", URL: m.DisplayURL, W: int(m.Dimensions.Width), H: int(m.Dimensions.Height), Alt: m.Alt}
	if m.IsVideo && m.VideoURL != "" {
		out.Kind, out.URL, out.Thumb, out.Duration = "video", m.VideoURL, m.DisplayURL, m.Duration
	}
	return out
}

// instagramEmbedData is the post's data from the embed page's script, where
// the page has it: a video's file and a carousel's pictures are only there.
// The script hands Instagram's own code a JSON text inside a string
// ("contextJSON"), which is read as that: a string, then the JSON in it.
func instagramEmbedData(body []byte) *igMedia {
	text, ok := jsonStringAfter(body, `"contextJSON":"`)
	if !ok {
		return nil
	}
	var context struct {
		Data *struct {
			Media *igMedia `json:"shortcode_media"`
		} `json:"gql_data"`
	}
	if json.Unmarshal([]byte(text), &context) != nil || context.Data == nil {
		return nil
	}
	return context.Data.Media
}

// instagramEmbed reads a post from the page Instagram makes for embedding it
// on other sites, which it writes out in full for a crawler: Instagram's own
// data, and nobody else's service.
func instagramEmbed(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	link := ref.link()
	name := f.nameBeside(ctx, link, instagramTitleRe, "twitter:title")
	body, _, err := f.get(ctx, link+"embed/captioned/", map[string]string{"Accept": "text/html"}, 0)
	if err != nil {
		return nil, err
	}
	p := &Post{Created: shortcodeTime(ref.id)}
	if m := instagramEmbedData(body); m != nil && m.Owner != nil && m.Owner.Username != "" {
		p.Handle, p.Name, p.Avatar, p.Verified = m.Owner.Username, m.Owner.FullName, m.Owner.ProfilePic, m.Owner.Verified
		if len(m.Caption.Edges) > 0 {
			p.Text = m.Caption.Edges[0].Node.Text
		}
		p.Likes, p.Replies, p.Views = int64(m.Likes.Count), int64(m.Comments.Count), int64(m.Views)
		if at := millis(float64(m.TakenAt)); at > 0 {
			p.Created = at
		}
		if len(m.Children.Edges) > 0 {
			for i := range m.Children.Edges {
				p.Media = append(p.Media, m.Children.Edges[i].Node.media())
			}
		} else {
			p.Media = append(p.Media, m.media())
		}
	} else {
		// a single picture: the page is all markup
		doc, err := html.Parse(bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		p.Handle = plain(findClass(doc, "UsernameText"))
		if p.Handle == "" {
			return nil, errNoPost
		}
		p.Avatar = attr(findTag(findClass(doc, "Avatar"), "img"), "src")
		p.Verified = findClass(doc, "VerifiedSprite") != nil
		if img := findClass(doc, "EmbeddedMediaImage"); img != nil {
			src := largest(attr(img, "srcset"))
			if src == "" {
				src = attr(img, "src")
			}
			p.Media = append(p.Media, PostMedia{Kind: "photo", URL: src})
		}
		// "60,292,678 likes"
		if words := strings.Fields(plain(findClass(doc, "SocialProof"))); len(words) > 0 {
			p.Likes = count(words[0])
		}
		// the caption starts with the author's name and ends with a link to the comments
		p.Text, _ = nodeTextExcept(findClass(doc, "Caption"), nil, func(n *html.Node) bool {
			return hasClass(n, "CaptionUsername") || hasClass(n, "CaptionComments")
		})
	}
	if p.Name == "" {
		p.Name = name()
	}
	p.AuthorURL = "https://www.instagram.com/" + p.Handle + "/"
	return p, nil
}

func instagramPage(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	body, final, err := f.get(ctx, ref.link(), map[string]string{"Accept": "text/html"}, 0)
	if err != nil {
		return nil, err
	}
	meta := parseMeta(body)
	p := &Post{}
	if m := instagramTitleRe.FindStringSubmatch(decoded(meta.first("twitter:title"))); m != nil {
		p.Name, p.Handle = m[1], m[2]
	}
	if own, err := url.Parse(meta.first("og:url")); err == nil && p.Handle == "" {
		if m := instagramOwnerRe.FindStringSubmatch(own.Path); m != nil {
			p.Handle = m[1]
		}
	}
	if p.Name == "" {
		p.Name = strings.TrimSuffix(decoded(meta.first("og:title")), " on Instagram")
	}
	p.Text = decoded(meta.text("og:description", "description"))
	if m := instagramDescRe.FindStringSubmatch(p.Text); m != nil {
		p.Likes, p.Replies, p.Text = count(m[1]), count(m[2]), m[4]
		if p.Handle == "" {
			p.Handle = m[3]
		}
	}
	image := resolveImage(final, meta.first("og:image", "twitter:image"))
	video := ""
	if playableVideo[strings.ToLower(meta.first("og:video:type"))] {
		video = resolveImage(final, meta.first("og:video:secure_url", "og:video"))
	}
	switch {
	case video != "":
		p.Media = []PostMedia{{Kind: "video", URL: video, Thumb: image}}
	case image != "":
		p.Media = []PostMedia{{Kind: "photo", URL: image}}
	}
	// The page cuts the caption short; oEmbed has all of it. Without it the
	// card keeps the start, which is still the post.
	if p.Handle == "" || strings.HasSuffix(p.Text, "...") || strings.HasSuffix(p.Text, "…") {
		var o struct {
			Title  string `json:"title"`
			Author string `json:"author_name"`
		}
		if f.getJSON(ctx, "https://www.instagram.com/api/v1/oembed/?url="+url.QueryEscape(ref.link()), nil, &o) == nil {
			if o.Title != "" {
				p.Text = o.Title
			}
			if p.Handle == "" {
				p.Handle = o.Author
			}
		}
	}
	if p.Handle == "" {
		return nil, errNoPost
	}
	p.Created = shortcodeTime(ref.id)
	p.AuthorURL = "https://www.instagram.com/" + p.Handle + "/"
	return p, nil
}
