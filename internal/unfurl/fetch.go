package unfurl

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/net/html"
)

const (
	defaultUserAgent = "EvilionChat-Unfurl/1.0 (+https://chat.evilion.xyz)"
	defaultTimeout   = 6 * time.Second
	defaultMaxBytes  = 2 << 20
	mediaHeadBytes   = 64 << 10
	maxRedirects     = 3
	maxTitleRunes    = 256
	maxDescRunes     = 2048
)

// MaxMediaBytes is the largest body the media proxy passes through.
const MaxMediaBytes = 25 << 20

// ProxyImageTypes are the image types the media proxy passes through. An image
// link of any other type (SVG, HEIC, TIFF) would only show as a broken picture,
// so it gets no image preview.
var ProxyImageTypes = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true,
	"image/avif": true, "image/bmp": true, "image/x-icon": true, "image/vnd.microsoft.icon": true,
}

// Result is a link preview.
type Result struct {
	URL         string `json:"url"`
	Type        string `json:"type"` // link | image | gif | video | youtube
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	SiteName    string `json:"site_name,omitempty"`
	Image       string `json:"image,omitempty"`
	ImageW      int    `json:"image_w,omitempty"`
	ImageH      int    `json:"image_h,omitempty"`
	VideoID     string `json:"video_id,omitempty"`
	Mime        string `json:"mime,omitempty"`
	Color       string `json:"color,omitempty"`
	// InviteCode is set when the link is an invite to this instance, so the
	// client can offer to join instead of opening a page.
	InviteCode  string `json:"invite_code,omitempty"`
	MemberCount int    `json:"member_count,omitempty"`
	OnlineCount int    `json:"online_count,omitempty"`
}

// Fetcher fetches previews with SSRF protection.
type Fetcher struct {
	Timeout   time.Duration
	MaxBytes  int64
	UserAgent string
	Resolver  Resolver
	Transport http.RoundTripper
}

func (f *Fetcher) timeout() time.Duration {
	if f.Timeout > 0 {
		return f.Timeout
	}
	return defaultTimeout
}

func (f *Fetcher) maxBytes() int64 {
	if f.MaxBytes > 0 {
		return f.MaxBytes
	}
	return defaultMaxBytes
}

func (f *Fetcher) userAgent() string {
	if f.UserAgent != "" {
		return f.UserAgent
	}
	return defaultUserAgent
}

func (f *Fetcher) transport() http.RoundTripper {
	if f.Transport != nil {
		return f.Transport
	}
	return &http.Transport{
		Proxy:               nil,
		DialContext:         f.guardedDial,
		DisableKeepAlives:   true,
		TLSHandshakeTimeout: 5 * time.Second,
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
		ForceAttemptHTTP2:   true,
	}
}

// validate checks a URL syntactically and resolves its host to public addresses.
func (f *Fetcher) validate(ctx context.Context, u *url.URL) error {
	if err := checkURL(u); err != nil {
		return err
	}
	_, err := f.resolvePublic(ctx, u.Hostname())
	return err
}

// Client returns an http.Client that refuses private addresses and redirects
// away from them, for callers that need the raw bytes (the media proxy).
func (f *Fetcher) Client() *http.Client {
	return &http.Client{
		Transport: f.transport(),
		Timeout:   f.timeout(),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > maxRedirects {
				return errors.New("too many redirects")
			}
			return checkURL(req.URL)
		},
	}
}

// StreamClient is Client without a deadline on the whole exchange, for the
// media proxy: a big GIF on a weak connection can take minutes to pass through,
// which is fine while it keeps moving. Bound its requests with Watch.
func (f *Fetcher) StreamClient() *http.Client {
	c := f.Client()
	c.Timeout = 0
	return c
}

// Watchdog cancels a request that goes the fetcher's timeout without progress:
// no response yet, or no bytes read from its body.
type Watchdog struct {
	timer *time.Timer
	idle  time.Duration
}

// Watch starts a Watchdog that calls cancel once the request stalls.
func (f *Fetcher) Watch(cancel context.CancelFunc) *Watchdog {
	d := f.timeout()
	return &Watchdog{timer: time.AfterFunc(d, cancel), idle: d}
}

// Body wraps a response body so that every read bringing bytes resets the clock.
func (w *Watchdog) Body(r io.Reader) io.Reader { return watchedReader{r: r, w: w} }

// Stop ends the watch.
func (w *Watchdog) Stop() { w.timer.Stop() }

type watchedReader struct {
	r io.Reader
	w *Watchdog
}

func (r watchedReader) Read(p []byte) (int, error) {
	n, err := r.r.Read(p)
	if n > 0 {
		r.w.timer.Reset(r.w.idle)
	}
	return n, err
}

// Validate reports whether a URL is safe to fetch (public host, http(s) only).
func (f *Fetcher) Validate(ctx context.Context, u *url.URL) error { return f.validate(ctx, u) }

// UA is the user agent the fetcher presents.
func (f *Fetcher) UA() string { return f.userAgent() }

// Fetch retrieves a preview for rawURL.
func (f *Fetcher) Fetch(ctx context.Context, rawURL string) (*Result, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, ErrBlocked
	}
	if err := f.validate(ctx, u); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, f.timeout())
	defer cancel()

	client := &http.Client{
		Transport: f.transport(),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > maxRedirects {
				return errors.New("unfurl: too many redirects")
			}
			return f.validate(req.Context(), req.URL)
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, ErrBlocked
	}
	req.Header.Set("User-Agent", f.userAgent())
	req.Header.Set("Accept", "text/html,image/*,video/*,*/*;q=0.5")
	req.Header.Set("Accept-Language", "en")
	res, err := client.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) && ue.Err != nil {
			return nil, ue.Err
		}
		return nil, err
	}
	defer res.Body.Close()

	final := res.Request.URL
	switch {
	case res.StatusCode >= 200 && res.StatusCode < 300:
	case res.StatusCode >= 500:
		return nil, fmt.Errorf("unfurl: upstream status %d", res.StatusCode)
	default:
		return nil, ErrUnsupported
	}
	ct, _, _ := mime.ParseMediaType(res.Header.Get("Content-Type"))
	ct = strings.ToLower(ct)
	switch {
	case strings.HasPrefix(ct, "image/"):
		// the preview is shown through the media proxy, so only what it passes on
		if !ProxyImageTypes[ct] || res.ContentLength > MaxMediaBytes {
			return nil, ErrUnsupported
		}
		return f.mediaResult(res.Body, final, ct, "image")
	case ct == "video/mp4" || ct == "video/webm":
		return &Result{URL: final.String(), Type: "video", Mime: ct}, nil
	case ct == "text/html" || ct == "application/xhtml+xml":
		return f.htmlResult(res.Body, final)
	}
	return nil, ErrUnsupported
}

// mediaResult reads only the head of an image to learn its dimensions.
func (f *Fetcher) mediaResult(body io.Reader, final *url.URL, ct, typ string) (*Result, error) {
	head := make([]byte, mediaHeadBytes)
	n, _ := io.ReadFull(body, head)
	head = head[:n]
	r := &Result{URL: final.String(), Type: typ, Mime: ct, Image: final.String()}
	if ct == "image/gif" || strings.HasSuffix(strings.ToLower(final.Path), ".gif") {
		r.Type = "gif"
		r.Mime = "image/gif"
	}
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(head)); err == nil {
		r.ImageW, r.ImageH = cfg.Width, cfg.Height
	}
	return r, nil
}

var headCloseRe = regexp.MustCompile(`(?i)</head\s*>`)

// htmlResult parses metadata from a bounded read of the page.
func (f *Fetcher) htmlResult(body io.Reader, final *url.URL) (*Result, error) {
	max := f.maxBytes()
	buf, err := io.ReadAll(io.LimitReader(body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(buf)) > max {
		buf = buf[:max]
		if !headCloseRe.Match(buf) {
			return nil, ErrTooLarge
		}
	}
	meta := parseMeta(buf)
	r := &Result{URL: final.String(), Type: "link"}
	r.Title = clip(meta.first("og:title", "twitter:title", "html:title"), maxTitleRunes)
	r.Description = clip(meta.first("og:description", "twitter:description", "description"), maxDescRunes)
	r.SiteName = clip(meta.first("og:site_name"), maxTitleRunes)
	if img := meta.first("og:image", "og:image:url"); img != "" {
		if abs := resolveImage(final, img); abs != "" {
			r.Image = abs
			r.ImageW, _ = strconv.Atoi(meta.first("og:image:width"))
			r.ImageH, _ = strconv.Atoi(meta.first("og:image:height"))
		}
	}
	if r.Image == "" {
		if img := meta.first("twitter:image", "twitter:image:src"); img != "" {
			r.Image = resolveImage(final, img)
		}
	}
	r.Color = themeColor(meta.first("theme-color"))
	if id := YouTubeID(final); id != "" {
		r.Type = "youtube"
		r.VideoID = id
		if r.Image == "" {
			r.Image = "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"
		}
	}
	if r.Title == "" && r.Description == "" && r.Image == "" {
		return nil, ErrUnsupported
	}
	return r, nil
}

type metaSet map[string]string

func (m metaSet) first(keys ...string) string {
	for _, k := range keys {
		if v := m[k]; v != "" {
			return v
		}
	}
	return ""
}

// parseMeta walks the document collecting <meta> and <title> values.
func parseMeta(buf []byte) metaSet {
	out := metaSet{}
	z := html.NewTokenizer(bytes.NewReader(buf))
	inTitle := false
	var title strings.Builder
	for {
		tt := z.Next()
		switch tt {
		case html.ErrorToken:
			if _, ok := out["html:title"]; !ok && title.Len() > 0 {
				out["html:title"] = collapse(title.String())
			}
			return out
		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			switch string(name) {
			case "title":
				inTitle = tt == html.StartTagToken
			case "meta":
				var key, content, prop, nm string
				for hasAttr {
					var k, v []byte
					k, v, hasAttr = z.TagAttr()
					switch strings.ToLower(string(k)) {
					case "property":
						prop = strings.ToLower(string(v))
					case "name":
						nm = strings.ToLower(string(v))
					case "content":
						content = string(v)
					}
				}
				if prop != "" {
					key = prop
				} else {
					key = nm
				}
				if key != "" && content != "" {
					if _, seen := out[key]; !seen {
						out[key] = collapse(content)
					}
				}
			case "body":
				// metadata lives in <head>; stop once the body starts unless the title is still open
				if !inTitle {
					if _, ok := out["html:title"]; !ok && title.Len() > 0 {
						out["html:title"] = collapse(title.String())
					}
					return out
				}
			}
		case html.EndTagToken:
			name, _ := z.TagName()
			if string(name) == "title" && inTitle {
				inTitle = false
				if _, ok := out["html:title"]; !ok {
					out["html:title"] = collapse(title.String())
				}
			}
		case html.TextToken:
			if inTitle {
				title.Write(z.Text())
			}
		}
	}
}

var spaceRe = regexp.MustCompile(`\s+`)

func collapse(s string) string {
	return strings.TrimSpace(spaceRe.ReplaceAllString(s, " "))
}

func clip(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max])
}

func resolveImage(base *url.URL, raw string) string {
	ref, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	abs := base.ResolveReference(ref)
	if abs.Scheme != "http" && abs.Scheme != "https" || abs.Host == "" {
		return ""
	}
	return abs.String()
}

var hexColorRe = regexp.MustCompile(`^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)

func themeColor(raw string) string {
	raw = strings.TrimSpace(raw)
	m := hexColorRe.FindStringSubmatch(raw)
	if m == nil {
		return ""
	}
	h := strings.ToLower(m[1])
	if len(h) == 3 {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	return "#" + h
}
