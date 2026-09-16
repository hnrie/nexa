package unfurl

// Video players a preview may open in a frame.
//
// A frame runs whatever the other site serves, so only these are allowed, and
// only because a video needs a player the page cannot supply. Everything else
// a preview shows — pictures, text, colours — is drawn by the client from
// fields this package fills in, never from markup someone else wrote. The
// players are pinned to one address each, built from an id this file has
// checked, so a link cannot smuggle a different page in through one of them.

import (
	"net/url"
	"regexp"
	"strings"
)

// Player is a frame a preview may open, and the site it belongs to.
type Player struct {
	// Site names the provider, for the label above the card.
	Site string
	// URL is the exact address of the frame.
	URL string
}

var (
	vimeoRe      = regexp.MustCompile(`^/(?:video/)?(\d{6,12})(?:/([0-9a-f]{6,16}))?$`)
	twitchVodRe  = regexp.MustCompile(`^/videos/(\d{5,15})$`)
	twitchClipRe = regexp.MustCompile(`^[A-Za-z0-9_-]{5,100}$`)
	dailyRe      = regexp.MustCompile(`^[A-Za-z0-9]{5,20}$`)
	streamableRe = regexp.MustCompile(`^[A-Za-z0-9]{3,20}$`)
	loomRe       = regexp.MustCompile(`^[0-9a-f]{20,40}$`)
)

func host(u *url.URL) string {
	h := strings.ToLower(u.Hostname())
	h = strings.TrimPrefix(h, "www.")
	return strings.TrimPrefix(h, "m.")
}

// PlayerFor returns the frame for a link to a video, or nil for anything else.
// `parentHost` is the host the page runs on, which Twitch insists on knowing.
func PlayerFor(u *url.URL, parentHost string) *Player {
	if u == nil {
		return nil
	}
	if id := YouTubeID(u); id != "" {
		return &Player{Site: "YouTube", URL: "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&rel=0"}
	}
	h := host(u)
	path := strings.TrimSuffix(u.Path, "/")
	switch {
	case h == "vimeo.com" || h == "player.vimeo.com":
		if m := vimeoRe.FindStringSubmatch(path); m != nil {
			src := "https://player.vimeo.com/video/" + m[1] + "?autoplay=1"
			if m[2] != "" {
				src += "&h=" + m[2]
			}
			return &Player{Site: "Vimeo", URL: src}
		}
	case h == "twitch.tv" || h == "clips.twitch.tv" || h == "player.twitch.tv":
		if parentHost == "" {
			return nil
		}
		if m := twitchVodRe.FindStringSubmatch(path); m != nil {
			return &Player{Site: "Twitch", URL: "https://player.twitch.tv/?video=" + m[1] + "&autoplay=true&parent=" + url.QueryEscape(parentHost)}
		}
		slug := ""
		if h == "clips.twitch.tv" {
			slug = strings.TrimPrefix(path, "/")
		} else if i := strings.Index(path, "/clip/"); i >= 0 {
			slug = path[i+len("/clip/"):]
		}
		if slug != "" && twitchClipRe.MatchString(slug) {
			return &Player{Site: "Twitch", URL: "https://clips.twitch.tv/embed?clip=" + url.QueryEscape(slug) + "&autoplay=true&parent=" + url.QueryEscape(parentHost)}
		}
	case h == "dailymotion.com" || h == "dai.ly":
		id := strings.TrimPrefix(strings.TrimPrefix(path, "/video/"), "/")
		if i := strings.IndexAny(id, "_/"); i >= 0 {
			id = id[:i]
		}
		if dailyRe.MatchString(id) {
			return &Player{Site: "Dailymotion", URL: "https://www.dailymotion.com/embed/video/" + id + "?autoplay=1"}
		}
	case h == "streamable.com":
		id := strings.TrimPrefix(path, "/")
		if streamableRe.MatchString(id) {
			return &Player{Site: "Streamable", URL: "https://streamable.com/e/" + id + "?autoplay=1"}
		}
	case h == "loom.com":
		id := strings.TrimPrefix(strings.TrimPrefix(path, "/share/"), "/embed/")
		if i := strings.IndexByte(id, '?'); i >= 0 {
			id = id[:i]
		}
		if loomRe.MatchString(id) {
			return &Player{Site: "Loom", URL: "https://www.loom.com/embed/" + id}
		}
	}
	return nil
}
