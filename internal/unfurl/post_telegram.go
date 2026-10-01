package unfurl

// Telegram.
//
// A public channel's message has a page meant for embedding
// (t.me/name/1?embed=1), which holds one message as plain markup: the
// channel, its picture, the text, the photos and videos, the views, the time.
// That is read first. The channel's preview page (t.me/s/name/1), which is
// what FxTelegram reads, has the same markup for a run of messages and is
// second. A private channel has neither, and its link gets no post card.
//
// The files are served from addresses Telegram makes up per page, so a card
// names its files instead of holding them (assets.go).

import (
	"context"
	"net/url"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

const telegramBase = "https://t.me/"

func telegramWidget(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	return telegramRead(f, ctx, ref, telegramBase+ref.user+"/"+ref.id+"?embed=1&mode=tme")
}

func telegramPreview(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	return telegramRead(f, ctx, ref, telegramBase+"s/"+ref.user+"/"+ref.id)
}

func telegramRead(f *Fetcher, ctx context.Context, ref *postRef, address string) (*Post, error) {
	body, _, err := f.get(ctx, address, map[string]string{"Accept": "text/html"}, 0)
	if err != nil {
		return nil, err
	}
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	// the message asked for, among however many the page shows
	want := strings.ToLower(ref.user + "/" + ref.id)
	var msg *html.Node
	walk(doc, func(n *html.Node) bool {
		if hasClass(n, "tgme_widget_message") && strings.ToLower(attr(n, "data-post")) == want {
			msg = n
			return false
		}
		return true
	})
	if msg == nil {
		return nil, errNoPost
	}
	p := telegramPost(msg)
	if p == nil {
		return nil, errNoPost
	}
	p.Handle = ref.user
	p.AuthorURL = telegramBase + ref.user
	return p, nil
}

// telegramSize reads the shape of a photo or video from how the page lays it
// out: a width in pixels, and a height as a share of it.
func telegramSize(wrap, inner *html.Node) (int, int) {
	w := 0
	for _, m := range stylePxRe.FindAllStringSubmatch(attr(wrap, "style"), -1) {
		if m[1] == "width" {
			w, _ = strconv.Atoi(m[2])
		}
	}
	pad := stylePadRe.FindStringSubmatch(attr(inner, "style"))
	if pad == nil {
		pad = stylePadRe.FindStringSubmatch(attr(wrap, "style"))
	}
	if w <= 0 || pad == nil {
		return 0, 0
	}
	share, err := strconv.ParseFloat(pad[1], 64)
	if err != nil || share <= 0 {
		return 0, 0
	}
	return w, int(float64(w)*share/100 + 0.5)
}

// clock reads "1:05" or "1:02:03" as seconds.
func clock(s string) float64 {
	total := 0.0
	for _, part := range strings.Split(strings.TrimSpace(s), ":") {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return 0
		}
		total = total*60 + float64(n)
	}
	return total
}

func telegramPost(msg *html.Node) *Post {
	p := &Post{}
	p.Name = plain(findClass(msg, "tgme_widget_message_owner_name"))
	if photo := findClass(msg, "tgme_widget_message_user_photo"); photo != nil {
		p.Avatar = attr(findTag(photo, "img"), "src")
	}
	p.Verified = findClass(msg, "verified-icon") != nil
	if from := findClass(msg, "tgme_widget_message_forwarded_from_name"); from != nil {
		p.Community = plain(from)
		if href := attr(from, "href"); strings.HasPrefix(href, "https://t.me/") {
			p.CommunityURL = href
		}
	}
	base, _ := url.Parse(telegramBase)
	text := findClass(msg, "js-message_text")
	if text == nil {
		text = findClass(msg, "tgme_widget_message_text")
	}
	if text != nil {
		p.Text, p.Links = nodeText(text, base)
	}
	// photos and videos in the order the message shows them
	each(msg, func(n *html.Node) bool {
		switch {
		case hasClass(n, "tgme_widget_message_photo_wrap"):
			m := PostMedia{Kind: "photo", URL: styleURL(attr(n, "style"))}
			m.W, m.H = telegramSize(n, findClass(n, "tgme_widget_message_photo"))
			p.Media = append(p.Media, m)
			return false
		case hasClass(n, "tgme_widget_message_video_player"):
			m := PostMedia{Kind: "video"}
			m.URL = attr(findTag(n, "video"), "src")
			m.Thumb = styleURL(attr(findClass(n, "tgme_widget_message_video_thumb"), "style"))
			m.Duration = clock(plain(findClass(n, "message_video_duration")))
			wrap := findClass(n, "tgme_widget_message_video_wrap")
			m.W, m.H = telegramSize(wrap, wrap)
			p.Media = append(p.Media, m)
			return false
		}
		return true
	})
	p.Views = count(plain(findClass(msg, "tgme_widget_message_views")))
	if t := findTag(findClass(msg, "tgme_widget_message_date"), "time"); t != nil {
		p.Created = parseTime(attr(t, "datetime"))
	}
	// every reaction counts as one: the number after its emoji
	for _, r := range allClass(msg, "tgme_reaction") {
		if last := r.LastChild; last != nil && last.Type == html.TextNode {
			p.Likes += count(last.Data)
		}
	}
	if p.Name == "" {
		return nil
	}
	return p
}
