package unfurl

// Mastodon.
//
// Mastodon is thousands of servers under their own names, so a post is known
// only by the shape of its address ("/@name/1234…"). The server it names is
// asked for the post through the API every Mastodon server answers without a
// login; a server that is something else has no such API, the request fails,
// and the link is fetched like any other. The atmosphere API (post_fx.go) is
// second, for a server that keeps its API to its own members.

import (
	"context"
	"net/url"
	"strings"
)

type mastodonStatus struct {
	URL        string   `json:"url"`
	CreatedAt  string   `json:"created_at"`
	Content    string   `json:"content"`
	Spoiler    string   `json:"spoiler_text"`
	Sensitive  bool     `json:"sensitive"`
	Replies    looseInt `json:"replies_count"`
	Reblogs    looseInt `json:"reblogs_count"`
	Favourites looseInt `json:"favourites_count"`
	Account    *struct {
		Acct        string `json:"acct"`
		DisplayName string `json:"display_name"`
		Avatar      string `json:"avatar_static"`
		URL         string `json:"url"`
	} `json:"account"`
	Media []struct {
		Type        string `json:"type"`
		URL         string `json:"url"`
		PreviewURL  string `json:"preview_url"`
		Description string `json:"description"`
		Meta        struct {
			Original struct {
				Width    looseInt `json:"width"`
				Height   looseInt `json:"height"`
				Duration float64  `json:"duration"`
			} `json:"original"`
		} `json:"meta"`
	} `json:"media_attachments"`
	Poll *struct {
		Options []struct {
			Title string   `json:"title"`
			Votes looseInt `json:"votes_count"`
		} `json:"options"`
		Votes     looseInt `json:"votes_count"`
		ExpiresAt string   `json:"expires_at"`
	} `json:"poll"`
}

func (s *mastodonStatus) post(host string) *Post {
	if s == nil || s.Account == nil || s.Account.Acct == "" {
		return nil
	}
	base, _ := url.Parse("https://" + host + "/")
	text, links := htmlText(s.Content, base)
	// an account on this server is named without it; said in full, a handle
	// is the same wherever it is read
	handle := s.Account.Acct
	if !strings.Contains(handle, "@") {
		handle += "@" + host
	}
	p := &Post{
		URL:       s.URL,
		Name:      s.Account.DisplayName,
		Handle:    handle,
		AuthorURL: s.Account.URL,
		Avatar:    s.Account.Avatar,
		// a content warning is the line the author put above the post
		Title:     s.Spoiler,
		Text:      text,
		Links:     links,
		Created:   parseTime(s.CreatedAt),
		Replies:   int64(s.Replies),
		Reposts:   int64(s.Reblogs),
		Likes:     int64(s.Favourites),
		Sensitive: s.Sensitive || s.Spoiler != "",
	}
	for _, m := range s.Media {
		pm := PostMedia{W: int(m.Meta.Original.Width), H: int(m.Meta.Original.Height), Alt: m.Description}
		switch m.Type {
		case "image":
			pm.Kind, pm.URL = "photo", m.URL
		case "gifv":
			pm.Kind, pm.URL, pm.Thumb = "gif", m.URL, m.PreviewURL
		case "video":
			pm.Kind, pm.URL, pm.Thumb, pm.Duration = "video", m.URL, m.PreviewURL, m.Meta.Original.Duration
		default:
			continue
		}
		p.Media = append(p.Media, pm)
	}
	if s.Poll != nil {
		poll := &PostPoll{Votes: int64(s.Poll.Votes), Ends: parseTime(s.Poll.ExpiresAt)}
		for _, o := range s.Poll.Options {
			c := PollChoice{Label: o.Title, Votes: int64(o.Votes)}
			if poll.Votes > 0 {
				c.Percent = float64(c.Votes) * 100 / float64(poll.Votes)
			}
			poll.Choices = append(poll.Choices, c)
		}
		p.Poll = poll
	}
	return p
}

func mastodonAPI(f *Fetcher, ctx context.Context, ref *postRef) (*Post, error) {
	var s mastodonStatus
	if err := f.getJSON(ctx, "https://"+ref.host+"/api/v1/statuses/"+ref.id, nil, &s); err != nil {
		return nil, err
	}
	p := s.post(ref.host)
	if p == nil {
		return nil, errNoPost
	}
	return p, nil
}
