package unfurl

import (
	"net/url"
	"regexp"
	"strings"
)

var ytIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// YouTubeID extracts a video id from the URL forms YouTube uses, or "".
func YouTubeID(u *url.URL) string {
	if u == nil {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	host = strings.TrimPrefix(host, "www.")
	host = strings.TrimPrefix(host, "m.")
	host = strings.TrimPrefix(host, "music.")
	path := u.Path
	var id string
	switch host {
	case "youtu.be":
		id = strings.Trim(path, "/")
		if i := strings.IndexByte(id, '/'); i >= 0 {
			id = id[:i]
		}
	case "youtube.com", "youtube-nocookie.com":
		switch {
		case path == "/watch":
			id = u.Query().Get("v")
		case strings.HasPrefix(path, "/shorts/"), strings.HasPrefix(path, "/embed/"), strings.HasPrefix(path, "/live/"):
			rest := strings.TrimPrefix(strings.TrimPrefix(strings.TrimPrefix(path, "/shorts/"), "/embed/"), "/live/")
			id = strings.Trim(rest, "/")
			if i := strings.IndexByte(id, '/'); i >= 0 {
				id = id[:i]
			}
		}
	default:
		return ""
	}
	if !ytIDRe.MatchString(id) {
		return ""
	}
	return id
}
