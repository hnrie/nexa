package unfurl

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

const youtubePlayerJSON = `{
  "playabilityStatus": {"status": "UNPLAYABLE", "reason": "Video unavailable"},
  "videoDetails": {
    "videoId": "dQw4w9WgXcQ", "title": "Never Gonna Give You Up", "lengthSeconds": "213",
    "channelId": "UCuAXFkgsw1L7xaCfnd5JJOw", "shortDescription": "The official video.\n#RickAstley",
    "viewCount": "1822014962", "author": "Rick Astley", "isLiveContent": false,
    "thumbnail": {"thumbnails": [
      {"url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg?sqp=abc&rs=def", "width": 480, "height": 360},
      {"url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg", "width": 1920, "height": 1080}
    ]}
  },
  "microformat": {"playerMicroformatRenderer": {
    "publishDate": "2009-10-24T23:57:33-07:00", "uploadDate": "2009-10-24T23:57:33-07:00",
    "likeCount": "19452949", "ownerProfileUrl": "http://www.youtube.com/@RickAstleyYT", "isFamilySafe": true,
    "thumbnail": {"thumbnails": [{"url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg", "width": 1280, "height": 720}]}
  }}
}`

const youtubeNextJSON = `{"contents": {"twoColumnWatchNextResults": {"results": {"results": {"contents": [
  {"videoPrimaryInfoRenderer": {"videoActions": {"menuRenderer": {"topLevelButtons": [
    {"segmentedLikeDislikeButtonViewModel": {"likeButtonViewModel": {"buttonViewModel": {"iconName":"LIKE","title":"19M"}}}}
  ]}}}},
  {"videoSecondaryInfoRenderer": {"owner": {"videoOwnerRenderer": {
    "thumbnail": {"thumbnails": [
      {"url": "https://yt3.ggpht.com/rick=s48-c-k", "width": 48, "height": 48},
      {"url": "https://yt3.ggpht.com/rick=s176-c-k", "width": 176, "height": 176}
    ]},
    "title": {"runs": [{"text": "Rick Astley"}]},
    "subscriberCountText": {"simpleText": "4.55M subscribers"},
    "navigationEndpoint": {"browseEndpoint": {"browseId": "UCuAXFkgsw1L7xaCfnd5JJOw", "canonicalBaseUrl": "/@RickAstleyYT"}},
    "badges": [{"metadataBadgeRenderer": {"style": "BADGE_STYLE_TYPE_VERIFIED_ARTIST"}}]
  }}}}
]}}}}}`

// youtubeAPIHandler answers InnerTube's endpoints, and only as YouTube's own
// web client asks for them: a POST with the video's id and a WEB context.
func youtubeAPIHandler(t *testing.T, player, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "post only", http.StatusMethodNotAllowed)
			return
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"clientName":"WEB"`) || !strings.Contains(string(body), `"videoId":"`) {
			t.Errorf("InnerTube asked without a web context: %s", body)
		}
		switch r.URL.Path {
		case "/youtubei/v1/player":
			player.ServeHTTP(w, r)
		case "/youtubei/v1/next":
			next.ServeHTTP(w, r)
		default:
			http.NotFound(w, r)
		}
	})
}

func TestYouTubePost(t *testing.T) {
	f, _ := network(t, map[string]http.Handler{
		"www.youtube.com": youtubeAPIHandler(t, jsonBody(youtubePlayerJSON), jsonBody(youtubeNextJSON)),
	})
	r, p := mustPost(t, f, "https://youtu.be/dQw4w9WgXcQ?t=1m5s")
	if r.Type != "youtube" || r.VideoID != "dQw4w9WgXcQ" || r.VideoStart != 65 || r.SiteName != "YouTube" {
		t.Errorf("result: type %q id %q start %d site %q", r.Type, r.VideoID, r.VideoStart, r.SiteName)
	}
	if p.Platform != "youtube" || p.URL != "https://www.youtube.com/watch?v=dQw4w9WgXcQ" || p.Title != "Never Gonna Give You Up" || p.Text != "The official video.\n#RickAstley" {
		t.Errorf("post: %+v", p)
	}
	if p.Name != "Rick Astley" || p.Handle != "RickAstleyYT" || p.AuthorURL != "https://www.youtube.com/@RickAstleyYT" || !p.Verified {
		t.Errorf("channel: name %q handle %q url %q verified %v", p.Name, p.Handle, p.AuthorURL, p.Verified)
	}
	if p.Avatar != "https://yt3.ggpht.com/rick=s176-c-k" || p.Subscribers != 4_550_000 {
		t.Errorf("avatar %q subscribers %d", p.Avatar, p.Subscribers)
	}
	if p.Views != 1822014962 || p.Likes != 19452949 || p.Created != 1256453853000 || p.Sensitive || p.Live != "" {
		t.Errorf("counts: views %d likes %d created %d sensitive %v live %q", p.Views, p.Likes, p.Created, p.Sensitive, p.Live)
	}
	if len(p.Media) != 1 {
		t.Fatalf("media: %+v", p.Media)
	}
	// the largest picture a card needs, at its own size, without the parameters that tie it to one page view
	if m := p.Media[0]; m.Kind != "video" || m.URL != "" || m.Thumb != "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" || m.W != 1280 || m.H != 720 || m.Duration != 213 {
		t.Errorf("video: %+v", m)
	}
	// the fields every card has, for an app from before videos had their own
	if r.Image != "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" || r.Title != "Never Gonna Give You Up" || !strings.HasPrefix(r.Author, "Rick Astley") {
		t.Errorf("plain card: image %q title %q author %q", r.Image, r.Title, r.Author)
	}
}

func TestYouTubeWithoutItsChannel(t *testing.T) {
	// the next endpoint down: the video still gets its card, with what the player endpoint knows
	f, _ := network(t, map[string]http.Handler{
		"www.youtube.com": youtubeAPIHandler(t, jsonBody(youtubePlayerJSON), down()),
	})
	_, p := mustPost(t, f, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
	if p.Name != "Rick Astley" || p.Handle != "RickAstleyYT" || p.Avatar != "" || p.Subscribers != 0 || p.Likes != 19452949 || p.Views == 0 {
		t.Errorf("post without its channel: %+v", p)
	}
}

func TestYouTubeFallsBackToOEmbed(t *testing.T) {
	oembed := `{"title":"Me at the zoo","author_name":"jawed","author_url":"https://www.youtube.com/@jawed","type":"video"}`
	f, n := network(t, map[string]http.Handler{
		"www.youtube.com": http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/oembed" {
				if got := r.URL.Query().Get("url"); got != "https://www.youtube.com/shorts/jNQXAC9IVRw" {
					t.Errorf("oEmbed asked about %q", got)
				}
				jsonBody(oembed).ServeHTTP(w, r)
				return
			}
			down().ServeHTTP(w, r)
		}),
	})
	r, p := mustPost(t, f, "https://www.youtube.com/shorts/jNQXAC9IVRw")
	if r.Type != "youtube" || p.Title != "Me at the zoo" || p.Name != "jawed" || p.Handle != "jawed" || p.URL != "https://www.youtube.com/shorts/jNQXAC9IVRw" {
		t.Errorf("oEmbed post: %+v", p)
	}
	// a Short stands up: its picture at its own shape, measured rather than assumed
	if len(p.Media) != 1 || p.Media[0].Thumb != "https://i.ytimg.com/vi/jNQXAC9IVRw/oardefault.jpg" {
		t.Errorf("short's picture: %+v", p.Media)
	}
	if n.asked("www.youtube.com/youtubei/v1/player") == 0 {
		t.Error("InnerTube was not asked first")
	}
}

func TestYouTubeGoneIsNoPost(t *testing.T) {
	gone := `{"playabilityStatus":{"status":"ERROR","reason":"This video is unavailable"}}`
	f, _ := network(t, map[string]http.Handler{
		"www.youtube.com": youtubeAPIHandler(t, jsonBody(gone), jsonBody(`{}`)),
	})
	if r, err := f.Fetch(t.Context(), "https://www.youtube.com/watch?v=aaaaaaaaaaa"); err == nil && r.Post != nil {
		t.Errorf("a video that is gone made a post: %+v", r.Post)
	}
}

func TestYouTubeRefs(t *testing.T) {
	cases := []struct{ link, id, kind, own string }{
		{"https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x", "dQw4w9WgXcQ", "", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
		{"https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ", "", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
		{"https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ", "", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
		{"https://music.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ", "", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
		{"https://www.youtube.com/shorts/jNQXAC9IVRw", "jNQXAC9IVRw", "shorts", "https://www.youtube.com/shorts/jNQXAC9IVRw"},
		{"https://www.youtube.com/live/jfKfPfyJRdk?feature=share", "jfKfPfyJRdk", "", "https://www.youtube.com/watch?v=jfKfPfyJRdk"},
		{"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ", "", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
		// the fixers people swap into a link mean the video it names
		{"https://koutube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ", "", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
		{"https://koutu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ", "", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
		{"https://www.youtube.com/@RickAstleyYT", "", "", ""},
		{"https://www.youtube.com/watch?v=short", "", "", ""},
		{"https://notyoutube.com/watch?v=dQw4w9WgXcQ", "", "", ""},
	}
	for _, c := range cases {
		u, _ := url.Parse(c.link)
		ref := postRefOf(u)
		if c.id == "" {
			if ref != nil {
				t.Errorf("%s read as %+v", c.link, ref)
			}
			continue
		}
		if ref == nil || ref.platform != "youtube" || ref.id != c.id || ref.kind != c.kind || ref.link() != c.own {
			t.Errorf("%s: %+v (link %q)", c.link, ref, func() string {
				if ref == nil {
					return ""
				}
				return ref.link()
			}())
		}
	}
}

func TestYouTubeStart(t *testing.T) {
	for raw, want := range map[string]int{
		"https://youtu.be/x?t=90":            90,
		"https://youtu.be/x?t=90s":           90,
		"https://youtu.be/x?t=1m30s":         90,
		"https://youtu.be/x?t=1h2m3s":        3723,
		"https://www.youtube.com/watch?v=x":  0,
		"https://youtu.be/x?t=nonsense":      0,
		"https://youtu.be/x?start=42":        42,
		"https://www.youtube.com/watch#t=15": 15,
		"https://youtu.be/x?t=999999999":     24 * 60 * 60,
	} {
		u, _ := url.Parse(raw)
		if got := youtubeStart(u); got != want {
			t.Errorf("%s: %d, want %d", raw, got, want)
		}
	}
}
