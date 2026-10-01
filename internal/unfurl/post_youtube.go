package unfurl

// YouTube videos, drawn as posts: the channel with its picture, badge and
// subscribers, the video's title and description, how long it runs, how many
// people watched and liked it, when it went up, and whether it is live. The
// app plays it in YouTube's own player, fetched through this server
// (internal/api/youtube_proxy.go), so watching tells YouTube nothing about
// who is watching.
//
// It is read from YouTube's InnerTube API, the one its own pages call: the
// player endpoint for the video (its details; the streams it keeps for a
// browser) and the next endpoint for the channel. The open-source services
// people swap into YouTube links to fix their embeds (koutube, FixYouTube)
// read the same data through Invidious; asking YouTube leaves out the
// middleman. oEmbed, which answers anyone, is the fallback: a title, a
// channel and a picture.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

const (
	youtubeAPI = "https://www.youtube.com/youtubei/v1/"
	// youtubeClientVersion is the web client InnerTube is told it is talking
	// to. YouTube answers versions months old, so it needs no keeping up.
	youtubeClientVersion = "2.20260930.01.00"
	// youtubeNextBytes bounds the next endpoint's answer, which carries a
	// page of recommendations nobody here reads (half a megabyte).
	youtubeNextBytes = 3 << 20
)

// youtubeStart is when a link asks the video to start: t=90, t=90s, t=1m30s
// or t=1h2m3s, in seconds. 0 without one.
func youtubeStart(u *url.URL) int {
	if u == nil {
		return 0
	}
	raw := u.Query().Get("t")
	if raw == "" {
		raw = u.Query().Get("start")
	}
	if raw == "" && strings.HasPrefix(u.Fragment, "t=") {
		raw = strings.TrimPrefix(u.Fragment, "t=")
	}
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return 0
	}
	if n, err := strconv.Atoi(strings.TrimSuffix(raw, "s")); err == nil {
		return max(0, min(n, 24*60*60))
	}
	m := youtubeTimeRe.FindStringSubmatch(raw)
	if m == nil {
		return 0
	}
	h, _ := strconv.Atoi(m[1])
	mi, _ := strconv.Atoi(m[2])
	s, _ := strconv.Atoi(m[3])
	return max(0, min(h*3600+mi*60+s, 24*60*60))
}

var youtubeTimeRe = regexp.MustCompile(`^(?:(\d{1,2})h)?(?:(\d{1,4})m)?(?:(\d{1,5})s)?$`)

// youtubeRefOf reads a YouTube link, the fixers' included, as a post.
func youtubeRefOf(u *url.URL) *postRef {
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	own := *u
	switch {
	case host == "koutu.be":
		own.Host = "youtu.be"
	case strings.HasSuffix(host, "koutube.com"):
		own.Host = strings.TrimSuffix(host, "koutube.com") + "youtube.com"
	}
	id := YouTubeID(&own)
	if id == "" {
		return nil
	}
	ref := &postRef{platform: "youtube", id: id}
	if strings.HasPrefix(own.Path, "/shorts/") {
		ref.kind = "shorts"
	}
	return ref
}

// youtubeText is one of InnerTube's pieces of text: plain, or in runs.
type youtubeText struct {
	SimpleText string `json:"simpleText"`
	Runs       []struct {
		Text string `json:"text"`
	} `json:"runs"`
}

func (t youtubeText) String() string {
	if t.SimpleText != "" {
		return t.SimpleText
	}
	var b strings.Builder
	for _, r := range t.Runs {
		b.WriteString(r.Text)
	}
	return b.String()
}

type youtubeThumbs struct {
	Thumbnails []struct {
		URL    string   `json:"url"`
		Width  looseInt `json:"width"`
		Height looseInt `json:"height"`
	} `json:"thumbnails"`
}

// best is the largest picture no wider than maxW, or else the smallest.
func (t youtubeThumbs) best(maxW int) (string, int, int) {
	pick, pw, ph := "", 0, 0
	least, lw, lh := "", 0, 0
	for _, th := range t.Thumbnails {
		w, h := int(th.Width), int(th.Height)
		if !webAddress(th.URL) && !strings.HasPrefix(th.URL, "//") {
			continue
		}
		u := th.URL
		if strings.HasPrefix(u, "//") {
			u = "https:" + u
		}
		if w <= maxW && w > pw {
			pick, pw, ph = u, w, h
		}
		if least == "" || w < lw {
			least, lw, lh = u, w, h
		}
	}
	if pick == "" {
		return least, lw, lh
	}
	return pick, pw, ph
}

type youtubePlayer struct {
	PlayabilityStatus struct {
		Status string `json:"status"`
	} `json:"playabilityStatus"`
	VideoDetails *struct {
		VideoID          string        `json:"videoId"`
		Title            string        `json:"title"`
		LengthSeconds    looseInt      `json:"lengthSeconds"`
		ChannelID        string        `json:"channelId"`
		ShortDescription string        `json:"shortDescription"`
		ViewCount        looseInt      `json:"viewCount"`
		Author           string        `json:"author"`
		IsLive           bool          `json:"isLive"`
		IsUpcoming       bool          `json:"isUpcoming"`
		Thumbnail        youtubeThumbs `json:"thumbnail"`
	} `json:"videoDetails"`
	Microformat struct {
		Renderer *struct {
			PublishDate     string        `json:"publishDate"`
			UploadDate      string        `json:"uploadDate"`
			LikeCount       looseInt      `json:"likeCount"`
			OwnerProfileURL string        `json:"ownerProfileUrl"`
			IsFamilySafe    *bool         `json:"isFamilySafe"`
			Thumbnail       youtubeThumbs `json:"thumbnail"`
			LiveBroadcast   *struct {
				IsLiveNow      bool   `json:"isLiveNow"`
				StartTimestamp string `json:"startTimestamp"`
			} `json:"liveBroadcastDetails"`
		} `json:"playerMicroformatRenderer"`
	} `json:"microformat"`
}

type youtubeNext struct {
	Contents struct {
		TwoColumn struct {
			Results struct {
				Results struct {
					Contents []struct {
						Primary *struct {
							VideoActions struct {
								Menu struct {
									TopLevelButtons []json.RawMessage `json:"topLevelButtons"`
								} `json:"menuRenderer"`
							} `json:"videoActions"`
						} `json:"videoPrimaryInfoRenderer"`
						Secondary *struct {
							Owner struct {
								Renderer struct {
									Thumbnail           youtubeThumbs `json:"thumbnail"`
									Title               youtubeText   `json:"title"`
									SubscriberCountText youtubeText   `json:"subscriberCountText"`
									NavigationEndpoint  struct {
										BrowseEndpoint struct {
											BrowseID         string `json:"browseId"`
											CanonicalBaseURL string `json:"canonicalBaseUrl"`
										} `json:"browseEndpoint"`
									} `json:"navigationEndpoint"`
									Badges []struct {
										Badge struct {
											Style string `json:"style"`
										} `json:"metadataBadgeRenderer"`
									} `json:"badges"`
								} `json:"videoOwnerRenderer"`
							} `json:"owner"`
						} `json:"videoSecondaryInfoRenderer"`
					} `json:"contents"`
				} `json:"results"`
			} `json:"results"`
		} `json:"twoColumnWatchNextResults"`
	} `json:"contents"`
}

// youtubeLikesRe finds the like button's count in the next endpoint's answer,
// which buries it under half a dozen view models: "title":"19M".
var youtubeLikesRe = regexp.MustCompile(`"iconName":"LIKE","title":"([0-9.,]+[KMB]?)"`)

// innertube posts body to one of InnerTube's endpoints as YouTube's own web
// pages do, and reads the answer into out.
func (f *Fetcher) innertube(ctx context.Context, endpoint string, body map[string]any, max int64, out any) ([]byte, error) {
	u, _ := url.Parse(youtubeAPI + endpoint + "?prettyPrint=false")
	if err := f.validate(ctx, u); err != nil {
		return nil, err
	}
	body["context"] = map[string]any{"client": map[string]any{"clientName": "WEB", "clientVersion": youtubeClientVersion, "hl": "en", "gl": "US"}}
	buf, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(buf))
	if err != nil {
		return nil, ErrBlocked
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept-Language", "en")
	req.Header.Set("Origin", "https://www.youtube.com")
	req.Header.Set("X-Youtube-Client-Name", "1")
	req.Header.Set("X-Youtube-Client-Version", youtubeClientVersion)
	res, err := f.Client().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, &statusError{host: u.Hostname(), code: res.StatusCode}
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > max {
		return nil, ErrTooLarge
	}
	return raw, json.Unmarshal(raw, out)
}

// youtubeInnertube reads a video from InnerTube: the video from the player
// endpoint and, beside it, its channel from the next endpoint. The channel
// is only a better card; a video read without it is still a post.
func youtubeInnertube(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	var (
		next    youtubeNext
		nextRaw []byte
		nextErr error
		wg      sync.WaitGroup
	)
	wg.Add(1)
	go func() {
		defer wg.Done()
		nextRaw, nextErr = f.innertube(ctx, "next", map[string]any{"videoId": ref.id}, youtubeNextBytes, &next)
	}()
	var player youtubePlayer
	_, err := f.innertube(ctx, "player", map[string]any{"videoId": ref.id, "contentCheckOk": true, "racyCheckOk": true}, f.maxBytes(), &player)
	wg.Wait()
	if err != nil {
		return nil, err
	}
	vd, mf := player.VideoDetails, player.Microformat.Renderer
	// a video that is gone or private has no details, only a reason
	if vd == nil || vd.VideoID != ref.id || vd.Title == "" {
		return nil, errNoPost
	}
	p := &Post{
		URL:   ref.link(),
		Name:  vd.Author,
		Title: vd.Title,
		Text:  vd.ShortDescription,
		Views: int64(vd.ViewCount),
	}
	if vd.ChannelID != "" {
		p.AuthorURL = "https://www.youtube.com/channel/" + vd.ChannelID
	}
	if vd.IsLive {
		p.Live = "now"
	} else if vd.IsUpcoming {
		p.Live = "upcoming"
	}
	thumb, w, h := vd.Thumbnail.best(1280)
	if mf != nil {
		p.Likes = int64(mf.LikeCount)
		p.Created = parseTime(mf.PublishDate)
		if p.Created == 0 {
			p.Created = parseTime(mf.UploadDate)
		}
		if lb := mf.LiveBroadcast; lb != nil {
			if lb.IsLiveNow {
				p.Live = "now"
			}
			if at := parseTime(lb.StartTimestamp); at > 0 && p.Live != "" {
				p.Created = at
			}
		}
		if handle := youtubeHandle(mf.OwnerProfileURL); handle != "" {
			p.Handle = handle
			p.AuthorURL = "https://www.youtube.com/@" + handle
		}
		// YouTube marks what it holds back from people not signed in, or too young
		if mf.IsFamilySafe != nil && !*mf.IsFamilySafe {
			p.Sensitive = true
		}
		if t, tw, th := mf.Thumbnail.best(1280); tw > w {
			thumb, w, h = t, tw, th
		}
	}
	// the thumbnail at the video's own shape: a Short stands up
	if ref.kind == "shorts" {
		thumb, w, h = "https://i.ytimg.com/vi/"+ref.id+"/oardefault.jpg", 0, 0
	} else if thumb == "" {
		thumb, w, h = "https://i.ytimg.com/vi/"+ref.id+"/hqdefault.jpg", 480, 360
	}
	duration := float64(vd.LengthSeconds)
	if p.Live == "now" || p.Live == "upcoming" {
		duration = 0
	}
	p.Media = []PostMedia{{Kind: "video", Thumb: youtubeThumbURL(thumb), W: w, H: h, Duration: duration, Alt: vd.Title}}
	if nextErr == nil {
		youtubeChannel(p, &next, nextRaw)
	}
	return p, nil
}

// youtubeThumbURL is a thumbnail's address without what only ties it to one
// page view (the signed crop parameters some come with).
func youtubeThumbURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	if strings.HasSuffix(u.Hostname(), "ytimg.com") {
		u.RawQuery = ""
	}
	return u.String()
}

// youtubeHandle is the handle in a channel's address ("@RickAstleyYT"), or "".
func youtubeHandle(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	h, ok := strings.CutPrefix(u.Path, "/@")
	if !ok {
		return ""
	}
	h, _, _ = strings.Cut(h, "/")
	if h, err = url.PathUnescape(h); err != nil || h == "" || len(h) > 100 {
		return ""
	}
	return h
}

// youtubeChannel fills in the channel from the next endpoint's answer: its
// picture, handle, subscribers and badge, and the likes where the player
// endpoint left them out.
func youtubeChannel(p *Post, next *youtubeNext, raw []byte) {
	for _, c := range next.Contents.TwoColumn.Results.Results.Contents {
		if c.Secondary == nil {
			continue
		}
		o := c.Secondary.Owner.Renderer
		if avatar, _, _ := o.Thumbnail.best(176); avatar != "" {
			p.Avatar = avatar
		}
		if name := o.Title.String(); name != "" && p.Name == "" {
			p.Name = name
		}
		if h := youtubeHandle("https://www.youtube.com" + o.NavigationEndpoint.BrowseEndpoint.CanonicalBaseURL); h != "" && p.Handle == "" {
			p.Handle = h
			p.AuthorURL = "https://www.youtube.com/@" + h
		}
		// "4.55M subscribers"
		if subs, _, _ := strings.Cut(o.SubscriberCountText.String(), " "); subs != "" {
			p.Subscribers = count(subs)
		}
		for _, b := range o.Badges {
			if strings.HasPrefix(b.Badge.Style, "BADGE_STYLE_TYPE_VERIFIED") {
				p.Verified = true
			}
		}
	}
	if p.Likes == 0 {
		if m := youtubeLikesRe.FindSubmatch(raw); m != nil {
			p.Likes = count(string(m[1]))
		}
	}
}

// youtubeOEmbed is what oEmbed says of a video: its title, its channel and
// its picture. YouTube answers it for anyone.
func youtubeOEmbed(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	var o struct {
		Title      string `json:"title"`
		AuthorName string `json:"author_name"`
		AuthorURL  string `json:"author_url"`
	}
	if err := f.getJSON(ctx, "https://www.youtube.com/oembed?format=json&url="+url.QueryEscape(ref.link()), nil, &o); err != nil {
		return nil, err
	}
	if o.Title == "" {
		return nil, errNoPost
	}
	p := &Post{URL: ref.link(), Name: o.AuthorName, Title: o.Title}
	if h := youtubeHandle(o.AuthorURL); h != "" {
		p.Handle, p.AuthorURL = h, "https://www.youtube.com/@"+h
	} else if webAddress(o.AuthorURL) {
		p.AuthorURL = o.AuthorURL
	}
	thumb, w, h := "https://i.ytimg.com/vi/"+ref.id+"/hqdefault.jpg", 480, 360
	if ref.kind == "shorts" {
		thumb, w, h = "https://i.ytimg.com/vi/"+ref.id+"/oardefault.jpg", 0, 0
	}
	p.Media = []PostMedia{{Kind: "video", Thumb: thumb, W: w, H: h, Alt: o.Title}}
	return p, nil
}
