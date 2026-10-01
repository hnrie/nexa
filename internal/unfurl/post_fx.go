package unfurl

// The FxEmbed status format.
//
// FxTwitter (api.fxtwitter.com), FxBluesky (api.fxbsky.app) and the
// atmosphere API behind them (api.atmosphere.tools: Instagram, TikTok,
// Threads, Mastodon) answer with the same "status" object, so one reader
// serves six sources. These are other people's services, run for free: every
// field is read as it may be missing, and a status that makes no sense is
// simply no answer.

import (
	"context"
	"encoding/json"
	"net/url"
	"strconv"
	"strings"
)

const (
	fxTwitterAPI  = "https://api.fxtwitter.com/2/status/"
	fxBlueskyAPI  = "https://api.fxbsky.app/2/status/"
	atmosphereAPI = "https://api.atmosphere.tools/2/"

	// maxVideoBitrate picks the copy of a video a chat needs: 720p, not the
	// ten megabits a second of the original.
	maxVideoBitrate = 2_600_000
)

// looseInt is a whole number however the service wrote it: 12, 12.0, "12",
// or null. Anything else is no number, not an error: one odd count should not
// cost a post its card.
type looseInt int64

func (n *looseInt) UnmarshalJSON(b []byte) error {
	s := strings.Trim(strings.TrimSpace(string(b)), `"`)
	if s == "" || s == "null" {
		return nil
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil && f == f && f > -1e18 && f < 1e18 {
		*n = looseInt(f)
	}
	return nil
}

type fxAnswer struct {
	Status *fxStatus `json:"status"`
}

type fxStatus struct {
	URL       string   `json:"url"`
	Text      string   `json:"text"`
	Created   looseInt `json:"created_timestamp"`
	Likes     looseInt `json:"likes"`
	Reposts   looseInt `json:"reposts"`
	Replies   looseInt `json:"replies"`
	Views     looseInt `json:"views"`
	Sensitive bool     `json:"possibly_sensitive"`
	Author    *struct {
		Name         string `json:"name"`
		ScreenName   string `json:"screen_name"`
		AvatarURL    string `json:"avatar_url"`
		URL          string `json:"url"`
		Verification *struct {
			Verified bool `json:"verified"`
		} `json:"verification"`
	} `json:"author"`
	Media *struct {
		All    []fxItem `json:"all"`
		Photos []fxItem `json:"photos"`
		Videos []fxItem `json:"videos"`
	} `json:"media"`
	Quote *fxStatus `json:"quote"`
	Poll  *struct {
		Choices []struct {
			Label      string   `json:"label"`
			Count      looseInt `json:"count"`
			Percentage float64  `json:"percentage"`
		} `json:"choices"`
		TotalVotes looseInt `json:"total_votes"`
		EndsAt     string   `json:"ends_at"`
	} `json:"poll"`
	// an object naming the account answered, or in older answers just its handle
	ReplyingTo json.RawMessage `json:"replying_to"`
	Note       *struct {
		Text string `json:"text"`
	} `json:"community_note"`
}

type fxItem struct {
	Type      string   `json:"type"`
	URL       string   `json:"url"`
	Thumbnail string   `json:"thumbnail_url"`
	Width     looseInt `json:"width"`
	Height    looseInt `json:"height"`
	Duration  float64  `json:"duration"`
	Format    string   `json:"format"`
	Alt       string   `json:"altText"`
	Formats   []struct {
		Container string   `json:"container"`
		Codec     string   `json:"codec"`
		Bitrate   looseInt `json:"bitrate"`
		URL       string   `json:"url"`
	} `json:"formats"`
}

// file is the copy of a video to play: an mp4 any browser decodes, the best
// under maxVideoBitrate or else the smallest there is. "" when there is only
// a stream.
func (it *fxItem) file() string {
	best, bestRate := "", int64(-1)
	least, leastRate := "", int64(-1)
	for _, f := range it.Formats {
		if f.URL == "" || (f.Container != "" && f.Container != "mp4") || (f.Codec != "" && f.Codec != "h264") {
			continue
		}
		rate := int64(f.Bitrate)
		if rate <= maxVideoBitrate && rate > bestRate {
			best, bestRate = f.URL, rate
		}
		if leastRate < 0 || rate < leastRate {
			least, leastRate = f.URL, rate
		}
	}
	switch {
	case best != "":
		return best
	case least != "":
		return least
	case strings.Contains(it.URL, ".m3u8"):
		return ""
	}
	return it.URL
}

// still reports whether a "gif" is a picture file rather than a short video.
func (it *fxItem) still() bool {
	if strings.HasPrefix(it.Format, "image/") {
		return true
	}
	u, err := url.Parse(it.URL)
	return err == nil && strings.HasSuffix(strings.ToLower(u.Path), ".gif")
}

func (s *fxStatus) post(quoted bool) *Post {
	if s == nil || s.Author == nil {
		return nil
	}
	p := &Post{
		URL:       s.URL,
		Name:      s.Author.Name,
		Handle:    s.Author.ScreenName,
		AuthorURL: s.Author.URL,
		Avatar:    s.Author.AvatarURL,
		Verified:  s.Author.Verification != nil && s.Author.Verification.Verified,
		Text:      s.Text,
		Created:   millis(float64(s.Created)),
		Replies:   int64(s.Replies),
		Reposts:   int64(s.Reposts),
		Likes:     int64(s.Likes),
		Views:     int64(s.Views),
		Sensitive: s.Sensitive,
	}
	if s.Media != nil {
		items := s.Media.All
		if len(items) == 0 {
			items = append(append(items, s.Media.Photos...), s.Media.Videos...)
		}
		for i := range items {
			it := &items[i]
			m := PostMedia{W: int(it.Width), H: int(it.Height), Alt: it.Alt}
			switch {
			case it.Type == "photo" || (it.Type == "gif" && it.still()):
				m.Kind, m.URL = "photo", it.URL
			case it.Type == "video" || it.Type == "gif":
				m.Kind, m.URL, m.Thumb, m.Duration = it.Type, it.file(), it.Thumbnail, it.Duration
			default:
				continue
			}
			p.Media = append(p.Media, m)
		}
	}
	if s.Poll != nil {
		poll := &PostPoll{Votes: int64(s.Poll.TotalVotes), Ends: parseTime(s.Poll.EndsAt)}
		for _, c := range s.Poll.Choices {
			poll.Choices = append(poll.Choices, PollChoice{Label: c.Label, Votes: int64(c.Count), Percent: c.Percentage})
		}
		p.Poll = poll
	}
	if len(s.ReplyingTo) > 0 {
		var to struct {
			ScreenName string `json:"screen_name"`
		}
		if json.Unmarshal(s.ReplyingTo, &to) == nil && to.ScreenName != "" {
			p.ReplyTo = to.ScreenName
		} else {
			_ = json.Unmarshal(s.ReplyingTo, &p.ReplyTo)
		}
	}
	if s.Note != nil {
		p.Note = s.Note.Text
	}
	if !quoted {
		// a post that has been deleted is quoted as an empty shell: no author
		p.Quote = s.Quote.post(true)
	}
	return p
}

// fxPost reads one status from an API that speaks this format.
func fxPost(f *Fetcher, ctx context.Context, address string) (*Post, error) {
	var a fxAnswer
	if err := f.getJSON(ctx, address, nil, &a); err != nil {
		return nil, err
	}
	p := a.Status.post(false)
	if p == nil {
		return nil, errNoPost
	}
	return p, nil
}

func twitterFx(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	return fxPost(f, ctx, fxTwitterAPI+ref.id)
}

func blueskyFx(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	return fxPost(f, ctx, fxBlueskyAPI+url.PathEscape(ref.user)+"/"+url.PathEscape(ref.id))
}

func tiktokAtmosphere(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	return fxPost(f, ctx, atmosphereAPI+"tiktok/status/"+ref.id)
}

func instagramAtmosphere(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	return fxPost(f, ctx, atmosphereAPI+"instagram/status/"+url.PathEscape(ref.id))
}

func threadsAtmosphere(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	return fxPost(f, ctx, atmosphereAPI+"threads/status/"+url.PathEscape(ref.id))
}

func mastodonAtmosphere(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	return fxPost(f, ctx, atmosphereAPI+"mastodon/"+url.PathEscape(ref.host)+"/status/"+ref.id)
}
