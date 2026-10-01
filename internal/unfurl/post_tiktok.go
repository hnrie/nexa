package unfurl

// TikTok.
//
// TikTok's page carries the whole post as data for its own scripts, and that
// is read first: the author, the caption, the counts, the cover, and among the
// video's addresses the one kind that plays without the page's cookies
// ("/aweme/v1/play/", which answers with the file's place on TikTok's file
// servers). This is the route fxTikTok takes. The atmosphere API is second
// (post_fx.go), and TikTok's oEmbed last: no video from that one, but the
// caption, the author and the cover, which open the post.
//
// Every address TikTok gives is signed for a few hours, so a card names its
// files instead of holding them (assets.go).

import (
	"context"
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
)

var tiktokDataRe = regexp.MustCompile(`(?s)<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>`)

type tiktokItem struct {
	ID         string   `json:"id"`
	Desc       string   `json:"desc"`
	CreateTime looseInt `json:"createTime"`
	Author     *struct {
		UniqueID     string `json:"uniqueId"`
		Nickname     string `json:"nickname"`
		AvatarMedium string `json:"avatarMedium"`
		AvatarThumb  string `json:"avatarThumb"`
		Verified     bool   `json:"verified"`
	} `json:"author"`
	Stats struct {
		Likes    looseInt `json:"diggCount"`
		Shares   looseInt `json:"shareCount"`
		Comments looseInt `json:"commentCount"`
		Plays    looseInt `json:"playCount"`
	} `json:"stats"`
	Video *struct {
		Width       looseInt `json:"width"`
		Height      looseInt `json:"height"`
		Duration    looseInt `json:"duration"`
		Cover       string   `json:"cover"`
		OriginCover string   `json:"originCover"`
		BitrateInfo []struct {
			CodecType string   `json:"CodecType"`
			Bitrate   looseInt `json:"Bitrate"`
			PlayAddr  struct {
				URLs []string `json:"UrlList"`
			} `json:"PlayAddr"`
		} `json:"bitrateInfo"`
		PlayAddrStruct *struct {
			URLs []string `json:"UrlList"`
		} `json:"PlayAddrStruct"`
	} `json:"video"`
	ImagePost *struct {
		Images []struct {
			ImageURL struct {
				URLs []string `json:"urlList"`
			} `json:"imageURL"`
			Width  looseInt `json:"imageWidth"`
			Height looseInt `json:"imageHeight"`
		} `json:"images"`
	} `json:"imagePost"`
}

// cookieless is the first of a video's addresses that plays without the
// cookies the page set.
func cookieless(urls []string) string {
	for _, u := range urls {
		if strings.Contains(u, "/aweme/v1/play/") {
			return u
		}
	}
	return ""
}

// file is the copy of the video to play: one every browser decodes (H.264),
// the best under maxVideoBitrate or else the smallest.
func (it *tiktokItem) file() string {
	v := it.Video
	if v == nil {
		return ""
	}
	best, bestRate := "", int64(-1)
	least, leastRate := "", int64(-1)
	for _, b := range v.BitrateInfo {
		if !strings.Contains(strings.ToLower(b.CodecType), "h264") {
			continue
		}
		u := cookieless(b.PlayAddr.URLs)
		if u == "" {
			continue
		}
		rate := int64(b.Bitrate)
		if rate <= maxVideoBitrate && rate > bestRate {
			best, bestRate = u, rate
		}
		if leastRate < 0 || rate < leastRate {
			least, leastRate = u, rate
		}
	}
	switch {
	case best != "":
		return best
	case least != "":
		return least
	case v.PlayAddrStruct != nil:
		return cookieless(v.PlayAddrStruct.URLs)
	}
	return ""
}

func (it *tiktokItem) post() *Post {
	if it == nil || it.Author == nil || it.Author.UniqueID == "" {
		return nil
	}
	a := it.Author
	p := &Post{
		Name:      a.Nickname,
		Handle:    a.UniqueID,
		AuthorURL: "https://www.tiktok.com/@" + a.UniqueID,
		Avatar:    a.AvatarMedium,
		Verified:  a.Verified,
		Text:      it.Desc,
		Created:   millis(float64(it.CreateTime)),
		Replies:   int64(it.Stats.Comments),
		Reposts:   int64(it.Stats.Shares),
		Likes:     int64(it.Stats.Likes),
		Views:     int64(it.Stats.Plays),
	}
	if p.Avatar == "" {
		p.Avatar = a.AvatarThumb
	}
	if it.ImagePost != nil && len(it.ImagePost.Images) > 0 {
		for _, img := range it.ImagePost.Images {
			if len(img.ImageURL.URLs) == 0 {
				continue
			}
			p.Media = append(p.Media, PostMedia{Kind: "photo", URL: img.ImageURL.URLs[0], W: int(img.Width), H: int(img.Height)})
		}
		if it.ID != "" {
			p.URL = "https://www.tiktok.com/@" + a.UniqueID + "/photo/" + it.ID
		}
		return p
	}
	if v := it.Video; v != nil {
		m := PostMedia{Kind: "video", URL: it.file(), Thumb: v.OriginCover, W: int(v.Width), H: int(v.Height), Duration: float64(v.Duration)}
		if m.Thumb == "" {
			m.Thumb = v.Cover
		}
		p.Media = append(p.Media, m)
	}
	if it.ID != "" {
		p.URL = "https://www.tiktok.com/@" + a.UniqueID + "/video/" + it.ID
	}
	return p
}

func tiktokPage(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	body, _, err := f.get(ctx, ref.link(), map[string]string{"User-Agent": browserUA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9"}, 0)
	if err != nil {
		return nil, err
	}
	m := tiktokDataRe.FindSubmatch(body)
	if m == nil {
		return nil, errNoPost
	}
	var data struct {
		Scope map[string]json.RawMessage `json:"__DEFAULT_SCOPE__"`
	}
	if err := json.Unmarshal(m[1], &data); err != nil {
		return nil, err
	}
	var detail struct {
		ItemInfo struct {
			Item *tiktokItem `json:"itemStruct"`
		} `json:"itemInfo"`
	}
	if raw, ok := data.Scope["webapp.video-detail"]; !ok || json.Unmarshal(raw, &detail) != nil {
		return nil, errNoPost
	}
	p := detail.ItemInfo.Item.post()
	if p == nil {
		return nil, errNoPost
	}
	// A video with no address that plays is better asked of the next source
	// than shown as a still picture.
	for _, media := range p.Media {
		if media.Kind == "video" && media.URL == "" {
			return nil, errNoPost
		}
	}
	return p, nil
}

func tiktokOEmbed(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	var o struct {
		Title  string   `json:"title"`
		Name   string   `json:"author_name"`
		Handle string   `json:"author_unique_id"`
		URL    string   `json:"author_url"`
		Thumb  string   `json:"thumbnail_url"`
		ThumbW looseInt `json:"thumbnail_width"`
		ThumbH looseInt `json:"thumbnail_height"`
	}
	if err := f.getJSON(ctx, "https://www.tiktok.com/oembed?url="+url.QueryEscape(ref.link()), nil, &o); err != nil {
		return nil, err
	}
	if o.Name == "" && o.Handle == "" {
		return nil, errNoPost
	}
	p := &Post{Name: o.Name, Handle: o.Handle, AuthorURL: o.URL, Text: o.Title}
	if o.Thumb != "" {
		kind := "video"
		if ref.kind == "photo" {
			kind = "photo"
		}
		m := PostMedia{Kind: kind, W: int(o.ThumbW), H: int(o.ThumbH)}
		if kind == "photo" {
			m.URL = o.Thumb
		} else {
			m.Thumb = o.Thumb
		}
		p.Media = append(p.Media, m)
	}
	return p, nil
}
