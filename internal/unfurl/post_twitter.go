package unfurl

// X (Twitter), when FxTwitter has no answer.
//
// X gives a crawler nothing, and its own API is closed. What is left open is
// the endpoint its "embed this post" widget reads (cdn.syndication.twimg.com),
// which is X's own data without a login, and vxTwitter's API, another public
// fixer. FxTwitter is asked first (post_fx.go) because it gives the most:
// polls, quotes, views, reposts, every size of a video.

import (
	"context"
	"html"
	"math"
	"strconv"
	"strings"
)

const (
	twitterSyndicationAPI = "https://cdn.syndication.twimg.com/tweet-result"
	vxTwitterAPI          = "https://api.vxtwitter.com/Twitter/status/"
)

// syndicationToken is the token X's embed script sends with a post's id:
//
//	((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "")
func syndicationToken(id string) string {
	n, err := strconv.ParseFloat(id, 64)
	if err != nil || n <= 0 {
		return "a"
	}
	token := strings.NewReplacer("0", "", ".", "").Replace(jsBase36(n / 1e15 * math.Pi))
	if token == "" {
		return "a"
	}
	return token
}

// jsBase36 writes a positive number the way JavaScript's toString(36) does:
// the whole part, then digits of the fraction for as long as they still tell
// this number from its neighbours, the last one rounded. (V8's
// DoubleToRadixCString; a shorter or longer run of digits is a different
// token.)
func jsBase36(value float64) string {
	const chars = "0123456789abcdefghijklmnopqrstuvwxyz"
	whole := math.Floor(value)
	fraction := value - whole
	delta := math.Max(math.Nextafter(0, 1), 0.5*(math.Nextafter(value, math.Inf(1))-value))
	var digits []byte
	if fraction >= delta {
		for {
			// The conversions keep each step a step of its own. Left to
			// itself the compiler may fuse the multiply into the subtraction
			// below, which rounds once instead of twice and ends on a
			// different digit than JavaScript does.
			fraction = float64(fraction * 36)
			delta = float64(delta * 36)
			digit := int(fraction)
			digits = append(digits, chars[digit])
			fraction = float64(fraction - float64(digit))
			if (fraction > 0.5 || (fraction == 0.5 && digit&1 == 1)) && fraction+delta > 1 {
				// round up, carrying through the digits already written
				for {
					if len(digits) == 0 {
						whole++
						break
					}
					last := strings.IndexByte(chars, digits[len(digits)-1])
					digits = digits[:len(digits)-1]
					if last+1 < 36 {
						digits = append(digits, chars[last+1])
						break
					}
				}
				break
			}
			if fraction < delta {
				break
			}
		}
	}
	out := strconv.FormatInt(int64(whole), 36)
	if len(digits) > 0 {
		out += "." + string(digits)
	}
	return out
}

type synTweet struct {
	Typename  string   `json:"__typename"`
	ID        string   `json:"id_str"`
	Text      string   `json:"text"`
	Range     []int    `json:"display_text_range"`
	CreatedAt string   `json:"created_at"`
	Likes     looseInt `json:"favorite_count"`
	Replies   looseInt `json:"conversation_count"`
	Sensitive bool     `json:"possibly_sensitive"`
	ReplyTo   string   `json:"in_reply_to_screen_name"`
	User      *struct {
		Name       string `json:"name"`
		ScreenName string `json:"screen_name"`
		Avatar     string `json:"profile_image_url_https"`
		Verified   bool   `json:"verified"`
		Blue       bool   `json:"is_blue_verified"`
	} `json:"user"`
	Entities struct {
		URLs []struct {
			URL      string `json:"url"`
			Expanded string `json:"expanded_url"`
		} `json:"urls"`
	} `json:"entities"`
	Media []struct {
		Type string `json:"type"`
		URL  string `json:"media_url_https"`
		Alt  string `json:"ext_alt_text"`
		Info struct {
			Width  looseInt `json:"width"`
			Height looseInt `json:"height"`
		} `json:"original_info"`
		Video *struct {
			Duration looseInt `json:"duration_millis"`
			Variants []struct {
				Bitrate     looseInt `json:"bitrate"`
				ContentType string   `json:"content_type"`
				URL         string   `json:"url"`
			} `json:"variants"`
		} `json:"video_info"`
	} `json:"mediaDetails"`
	Quoted *synTweet `json:"quoted_tweet"`
}

func (t *synTweet) post(quoted bool) *Post {
	if t == nil || t.User == nil {
		return nil
	}
	// The text as X stores it: the part meant to be read is a range of it
	// (what follows is the link to its own pictures), links are shortened,
	// and & < > are escaped.
	text := t.Text
	if len(t.Range) == 2 {
		text = runes(text, t.Range[0], t.Range[1])
	}
	for _, u := range t.Entities.URLs {
		if u.URL != "" && u.Expanded != "" {
			text = strings.ReplaceAll(text, u.URL, u.Expanded)
		}
	}
	p := &Post{
		Name:      t.User.Name,
		Handle:    t.User.ScreenName,
		AuthorURL: "https://x.com/" + t.User.ScreenName,
		// the picture comes thumbnail sized; the same address names a larger one
		Avatar:    strings.Replace(t.User.Avatar, "_normal.", "_200x200.", 1),
		Verified:  t.User.Verified || t.User.Blue,
		Text:      html.UnescapeString(text),
		Created:   parseTime(t.CreatedAt),
		Replies:   int64(t.Replies),
		Likes:     int64(t.Likes),
		Sensitive: t.Sensitive,
		ReplyTo:   t.ReplyTo,
	}
	if t.ID != "" && t.User.ScreenName != "" {
		p.URL = "https://x.com/" + t.User.ScreenName + "/status/" + t.ID
	}
	for _, m := range t.Media {
		pm := PostMedia{W: int(m.Info.Width), H: int(m.Info.Height), Alt: m.Alt}
		switch m.Type {
		case "photo":
			pm.Kind, pm.URL = "photo", m.URL
		case "video", "animated_gif":
			pm.Kind, pm.Thumb = "video", m.URL
			if m.Type == "animated_gif" {
				pm.Kind = "gif"
			}
			if m.Video != nil {
				pm.Duration = float64(m.Video.Duration) / 1000
				best, bestRate := "", int64(-1)
				least, leastRate := "", int64(-1)
				for _, v := range m.Video.Variants {
					if v.ContentType != "video/mp4" || v.URL == "" {
						continue
					}
					rate := int64(v.Bitrate)
					if rate <= maxVideoBitrate && rate > bestRate {
						best, bestRate = v.URL, rate
					}
					if leastRate < 0 || rate < leastRate {
						least, leastRate = v.URL, rate
					}
				}
				if pm.URL = best; pm.URL == "" {
					pm.URL = least
				}
			}
		default:
			continue
		}
		p.Media = append(p.Media, pm)
	}
	if !quoted {
		p.Quote = t.Quoted.post(true)
	}
	return p
}

func twitterSyndication(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	var t synTweet
	address := twitterSyndicationAPI + "?id=" + ref.id + "&lang=en&token=" + syndicationToken(ref.id)
	if err := f.getJSON(ctx, address, nil, &t); err != nil {
		return nil, err
	}
	// a post that is gone or private answers with a tombstone
	if t.Typename != "" && t.Typename != "Tweet" {
		return nil, errNoPost
	}
	p := t.post(false)
	if p == nil {
		return nil, errNoPost
	}
	return p, nil
}

type vxTweet struct {
	Text       string   `json:"text"`
	Name       string   `json:"user_name"`
	ScreenName string   `json:"user_screen_name"`
	Avatar     string   `json:"user_profile_image_url"`
	Likes      looseInt `json:"likes"`
	Retweets   looseInt `json:"retweets"`
	Replies    looseInt `json:"replies"`
	Epoch      looseInt `json:"date_epoch"`
	URL        string   `json:"tweetURL"`
	Sensitive  bool     `json:"possibly_sensitive"`
	ReplyTo    string   `json:"replyingTo"`
	Media      []struct {
		Type      string   `json:"type"`
		URL       string   `json:"url"`
		Thumbnail string   `json:"thumbnail_url"`
		Alt       string   `json:"altText"`
		Duration  looseInt `json:"duration_millis"`
		Size      struct {
			Width  looseInt `json:"width"`
			Height looseInt `json:"height"`
		} `json:"size"`
	} `json:"media_extended"`
	Quoted *vxTweet `json:"qrt"`
}

func (t *vxTweet) post(quoted bool) *Post {
	if t == nil || t.ScreenName == "" {
		return nil
	}
	p := &Post{
		URL:       t.URL,
		Name:      t.Name,
		Handle:    t.ScreenName,
		AuthorURL: "https://x.com/" + t.ScreenName,
		Avatar:    strings.Replace(t.Avatar, "_normal.", "_200x200.", 1),
		Text:      t.Text,
		Created:   millis(float64(t.Epoch)),
		Replies:   int64(t.Replies),
		Reposts:   int64(t.Retweets),
		Likes:     int64(t.Likes),
		Sensitive: t.Sensitive,
		ReplyTo:   t.ReplyTo,
	}
	for _, m := range t.Media {
		pm := PostMedia{W: int(m.Size.Width), H: int(m.Size.Height), Alt: m.Alt}
		switch m.Type {
		case "image":
			pm.Kind, pm.URL = "photo", m.URL
		case "video", "gif":
			pm.Kind, pm.URL, pm.Thumb, pm.Duration = m.Type, m.URL, m.Thumbnail, float64(m.Duration)/1000
		default:
			continue
		}
		p.Media = append(p.Media, pm)
	}
	if !quoted {
		p.Quote = t.Quoted.post(true)
	}
	return p
}

func twitterVx(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	var t vxTweet
	if err := f.getJSON(ctx, vxTwitterAPI+ref.id, nil, &t); err != nil {
		return nil, err
	}
	p := t.post(false)
	if p == nil {
		return nil, errNoPost
	}
	return p, nil
}
