package unfurl

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// fetcherFor starts a test server and returns a Fetcher that reaches it under the
// public-looking name "example.test": the resolver reports a public address (so the
// SSRF guard is satisfied) while the injected transport dials the loopback listener.
func fetcherFor(t *testing.T, h http.Handler) (*Fetcher, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	tr := &http.Transport{
		DisableKeepAlives: true,
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, network, srv.Listener.Addr().String())
		},
	}
	t.Cleanup(tr.CloseIdleConnections)
	f := &Fetcher{
		Timeout:   5 * time.Second,
		Transport: tr,
		Resolver: fakeResolver{
			"example.test":    {"8.8.8.8"},
			"other.test":      {"1.1.1.1"},
			"www.youtube.com": {"8.8.8.8"},
			"youtu.be":        {"8.8.8.8"},
		},
	}
	return f, srv
}

// body serves a fixed content type and payload.
func body(ct, payload string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", ct)
		w.Write([]byte(payload))
	})
}

func bodyBytes(ct string, payload []byte) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", ct)
		w.Write(payload)
	})
}

func mustFetch(t *testing.T, f *Fetcher, url string) *Result {
	t.Helper()
	res, err := f.Fetch(context.Background(), url)
	if err != nil {
		t.Fatalf("Fetch(%q): %v", url, err)
	}
	if res == nil {
		t.Fatalf("Fetch(%q): nil result", url)
	}
	return res
}

const ogPage = `<!doctype html>
<html><head>
<title>ignored html title</title>
<meta property="og:title" content="Open Graph Title">
<meta property="og:description" content="A   description
with newlines.">
<meta property="og:site_name" content="Example Site">
<meta property="og:image" content="https://cdn.example.test/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:type" content="article">
<meta property="og:url" content="https://example.test/canonical">
<meta name="twitter:title" content="Twitter Title">
<meta name="description" content="html description">
<meta name="theme-color" content="#5865f2">
</head><body>hi</body></html>`

func TestFetchOpenGraph(t *testing.T) {
	var gotUA, gotAccept, gotMethod string
	f, _ := fetcherFor(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA, gotAccept, gotMethod = r.Header.Get("User-Agent"), r.Header.Get("Accept"), r.Method
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(ogPage))
	}))
	res := mustFetch(t, f, "http://example.test/page")

	if res.Type != "link" {
		t.Errorf("Type = %q, want link", res.Type)
	}
	if res.URL != "http://example.test/page" {
		t.Errorf("URL = %q", res.URL)
	}
	if res.Title != "Open Graph Title" {
		t.Errorf("Title = %q", res.Title)
	}
	if res.Description != "A description with newlines." {
		t.Errorf("Description = %q, want whitespace collapsed", res.Description)
	}
	if res.SiteName != "Example Site" {
		t.Errorf("SiteName = %q", res.SiteName)
	}
	if res.Image != "https://cdn.example.test/og.png" {
		t.Errorf("Image = %q", res.Image)
	}
	if res.ImageW != 1200 || res.ImageH != 630 {
		t.Errorf("dims = %dx%d, want 1200x630", res.ImageW, res.ImageH)
	}
	if res.Color != "#5865f2" {
		t.Errorf("Color = %q", res.Color)
	}
	if gotMethod != http.MethodGet {
		t.Errorf("method = %q, want GET", gotMethod)
	}
	if gotUA != defaultUserAgent {
		t.Errorf("User-Agent = %q, want %q", gotUA, defaultUserAgent)
	}
	if gotAccept != "text/html,image/*,video/*,*/*;q=0.5" {
		t.Errorf("Accept = %q", gotAccept)
	}
}

func TestFetchTwitterFallback(t *testing.T) {
	const page = `<html><head><title>html title</title>
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Twitter Title">
<meta name="twitter:description" content="Twitter description">
<meta name="twitter:image" content="https://cdn.example.test/t.jpg">
<meta property="og:image:width" content="800">
</head><body></body></html>`
	f, _ := fetcherFor(t, body("text/html", page))
	res := mustFetch(t, f, "http://example.test/page")

	if res.Title != "Twitter Title" {
		t.Errorf("Title = %q, want twitter over html", res.Title)
	}
	if res.Description != "Twitter description" {
		t.Errorf("Description = %q", res.Description)
	}
	if res.Image != "https://cdn.example.test/t.jpg" {
		t.Errorf("Image = %q", res.Image)
	}
	if res.ImageW != 0 || res.ImageH != 0 {
		t.Errorf("dims = %dx%d, want 0x0 for a non-og image", res.ImageW, res.ImageH)
	}
}

func TestFetchTitleOnly(t *testing.T) {
	f, _ := fetcherFor(t, body("text/html", "<html><head><title>  Hello \n\t World </title></head><body>x</body></html>"))
	res := mustFetch(t, f, "http://example.test/page")
	if res.Title != "Hello World" {
		t.Errorf("Title = %q, want collapsed", res.Title)
	}
	if res.Description != "" || res.Image != "" {
		t.Errorf("unexpected extras: %+v", res)
	}
	// with no og:site_name the card still names where the link goes
	if res.SiteName != "example.test" {
		t.Errorf("SiteName = %q, want the host", res.SiteName)
	}
	if res.Type != "link" {
		t.Errorf("Type = %q, want link", res.Type)
	}
}

func TestFetchEntitiesDecoded(t *testing.T) {
	f, _ := fetcherFor(t, body("text/html", `<html><head><title>Tom &amp; Jerry &#8212; fun</title>
<meta name="description" content="caf&eacute; &lt;b&gt;"></head></html>`))
	res := mustFetch(t, f, "http://example.test/page")
	if res.Title != "Tom & Jerry — fun" {
		t.Errorf("Title = %q", res.Title)
	}
	if res.Description != "café <b>" {
		t.Errorf("Description = %q", res.Description)
	}
}

func TestFetchRelativeImageResolved(t *testing.T) {
	f, _ := fetcherFor(t, body("text/html",
		`<html><head><title>t</title><meta property="og:image" content="/img/a.png"></head></html>`))
	res := mustFetch(t, f, "http://example.test/deep/page?q=1")
	if res.Image != "http://example.test/img/a.png" {
		t.Errorf("Image = %q, want absolute", res.Image)
	}
}

func TestFetchRelativeImageDotSegment(t *testing.T) {
	f, _ := fetcherFor(t, body("text/html",
		`<html><head><title>t</title><meta property="og:image" content="cover.png"></head></html>`))
	res := mustFetch(t, f, "http://example.test/deep/page")
	if res.Image != "http://example.test/deep/cover.png" {
		t.Errorf("Image = %q", res.Image)
	}
}

func TestFetchNonHTTPImageDropped(t *testing.T) {
	f, _ := fetcherFor(t, body("text/html",
		`<html><head><title>t</title><meta property="og:image" content="javascript:alert(1)"></head></html>`))
	res := mustFetch(t, f, "http://example.test/page")
	if res.Image != "" {
		t.Errorf("Image = %q, want dropped", res.Image)
	}
	if res.Title != "t" {
		t.Errorf("Title = %q", res.Title)
	}
}

func TestFetchThemeColor(t *testing.T) {
	cases := []struct{ in, want string }{
		{"#5865f2", "#5865f2"},
		{"#ABCDEF", "#abcdef"},
		{"  #abc  ", "#aabbcc"},
		{"rebeccapurple", ""},
		{"rgb(1,2,3)", ""},
		{"#12345", ""},
		{"#ggghhh", ""},
		{"", ""},
	}
	for _, tc := range cases {
		page := fmt.Sprintf(`<html><head><title>t</title><meta name="theme-color" content=%q></head></html>`, tc.in)
		f, _ := fetcherFor(t, body("text/html", page))
		res := mustFetch(t, f, "http://example.test/page")
		if res.Color != tc.want {
			t.Errorf("theme-color %q => %q, want %q", tc.in, res.Color, tc.want)
		}
	}
}

func TestFetchTruncatesLongText(t *testing.T) {
	long := strings.Repeat("é", 3000)
	page := fmt.Sprintf(`<html><head><meta property="og:title" content=%q><meta property="og:description" content=%q></head></html>`, long, long)
	f, _ := fetcherFor(t, body("text/html", page))
	res := mustFetch(t, f, "http://example.test/page")
	if n := len([]rune(res.Title)); n != 256 {
		t.Errorf("title runes = %d, want 256", n)
	}
	if n := len([]rune(res.Description)); n != 2048 {
		t.Errorf("description runes = %d, want 2048", n)
	}
}

func TestFetchNothingToEmbed(t *testing.T) {
	f, _ := fetcherFor(t, body("text/html", "<html><body><p>just text</p></body></html>"))
	res, err := f.Fetch(context.Background(), "http://example.test/page")
	if !errors.Is(err, ErrUnsupported) {
		t.Fatalf("err = %v, want ErrUnsupported", err)
	}
	if res != nil {
		t.Errorf("res = %+v, want nil", res)
	}
}

func TestFetchIgnoresMetaRefresh(t *testing.T) {
	page := `<html><head><title>Stay</title>
<meta http-equiv="refresh" content="0;url=http://127.0.0.1:1/evil">
<meta http-equiv="Content-Type" content="text/html"></head></html>`
	f, _ := fetcherFor(t, body("text/html", page))
	res := mustFetch(t, f, "http://example.test/page")
	if res.Title != "Stay" || res.URL != "http://example.test/page" {
		t.Errorf("res = %+v, want the original page", res)
	}
}

func pngOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func gifOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var buf bytes.Buffer
	img := image.NewPaletted(image.Rect(0, 0, w, h), color.Palette{color.Black, color.White})
	if err := gif.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestFetchImagePNG(t *testing.T) {
	f, _ := fetcherFor(t, bodyBytes("image/png", pngOf(t, 3, 5)))
	res := mustFetch(t, f, "http://example.test/a.png")
	if res.Type != "image" {
		t.Errorf("Type = %q, want image", res.Type)
	}
	if res.Mime != "image/png" {
		t.Errorf("Mime = %q", res.Mime)
	}
	if res.ImageW != 3 || res.ImageH != 5 {
		t.Errorf("dims = %dx%d, want 3x5", res.ImageW, res.ImageH)
	}
	if res.Image != "http://example.test/a.png" || res.URL != res.Image {
		t.Errorf("Image = %q, URL = %q", res.Image, res.URL)
	}
}

func TestFetchImageGIF(t *testing.T) {
	f, _ := fetcherFor(t, bodyBytes("image/gif", gifOf(t, 4, 6)))
	res := mustFetch(t, f, "http://example.test/a.gif")
	if res.Type != "gif" {
		t.Errorf("Type = %q, want gif", res.Type)
	}
	if res.Mime != "image/gif" || res.ImageW != 4 || res.ImageH != 6 {
		t.Errorf("res = %+v", res)
	}
}

// An image served with a generic image content type but a .gif URL still counts as a gif.
func TestFetchGIFByExtension(t *testing.T) {
	f, _ := fetcherFor(t, bodyBytes("image/GIF; charset=binary", gifOf(t, 2, 2)))
	res := mustFetch(t, f, "http://example.test/anim.GIF")
	if res.Type != "gif" || res.Mime != "image/gif" {
		t.Errorf("Type = %q, Mime = %q, want gif", res.Type, res.Mime)
	}
}

func TestFetchImageUndecodable(t *testing.T) {
	f, _ := fetcherFor(t, bodyBytes("image/webp", []byte("RIFF....WEBPVP8 not-really")))
	res := mustFetch(t, f, "http://example.test/a.webp")
	if res.Type != "image" || res.Mime != "image/webp" {
		t.Errorf("res = %+v", res)
	}
	if res.ImageW != 0 || res.ImageH != 0 {
		t.Errorf("dims = %dx%d, want 0x0", res.ImageW, res.ImageH)
	}
}

// Media bodies must not be slurped: the fetch completes after the first 64 KiB even
// though the server promises a megabyte and then stalls.
func TestFetchImageReadsOnlyHead(t *testing.T) {
	head := make([]byte, 64<<10)
	copy(head, pngOf(t, 3, 5))
	f, _ := fetcherFor(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Length", strconv.Itoa(1<<20))
		w.Write(head)
		w.(http.Flusher).Flush()
		select { // stall: only a reader that stops at 64 KiB gets an answer
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	f.Timeout = 2 * time.Second
	res := mustFetch(t, f, "http://example.test/big.png")
	if res.ImageW != 3 || res.ImageH != 5 {
		t.Errorf("dims = %dx%d, want 3x5", res.ImageW, res.ImageH)
	}
}

func TestFetchVideo(t *testing.T) {
	for _, ct := range []string{"video/mp4", "video/webm"} {
		f, _ := fetcherFor(t, body(ct, "\x00\x00\x00\x18ftypmp42 binary junk"))
		res := mustFetch(t, f, "http://example.test/clip")
		if res.Type != "video" {
			t.Errorf("%s: Type = %q, want video", ct, res.Type)
		}
		if res.Mime != ct {
			t.Errorf("%s: Mime = %q", ct, res.Mime)
		}
		if res.Image != "" {
			t.Errorf("%s: Image = %q, want empty", ct, res.Image)
		}
	}
}

func TestFetchUnsupportedContentType(t *testing.T) {
	for _, ct := range []string{"application/json", "application/pdf", "text/plain", ""} {
		f, _ := fetcherFor(t, body(ct, `{"a":1}`))
		_, err := f.Fetch(context.Background(), "http://example.test/data")
		if !errors.Is(err, ErrUnsupported) {
			t.Errorf("content-type %q: err = %v, want ErrUnsupported", ct, err)
		}
	}
}

// An image the media proxy will not pass on would only be a broken picture.
func TestFetchImageTheProxyRefuses(t *testing.T) {
	for _, ct := range []string{"image/svg+xml", "image/heic", "image/tiff"} {
		f, _ := fetcherFor(t, body(ct, "<svg/>"))
		if _, err := f.Fetch(context.Background(), "http://example.test/logo"); !errors.Is(err, ErrUnsupported) {
			t.Errorf("%s: err = %v, want ErrUnsupported", ct, err)
		}
	}
	f, _ := fetcherFor(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Length", strconv.Itoa(MaxMediaBytes+1))
		w.Write(pngOf(t, 3, 5))
	}))
	if _, err := f.Fetch(context.Background(), "http://example.test/huge.png"); !errors.Is(err, ErrUnsupported) {
		t.Errorf("oversized: err = %v, want ErrUnsupported", err)
	}
}

// The proxy's client has no deadline on the whole transfer: a slow body that
// keeps moving arrives whole, and one that stops is cut off.
func TestStreamClientWatchesForProgress(t *testing.T) {
	f, _ := fetcherFor(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/gif")
		for i := 0; i < 8; i++ {
			w.Write([]byte("GIF89a.."))
			w.(http.Flusher).Flush()
			if r.URL.Path == "/stalls" && i == 1 {
				<-r.Context().Done()
				return
			}
			time.Sleep(60 * time.Millisecond)
		}
	}))
	f.Timeout = 200 * time.Millisecond
	get := func(path string) ([]byte, error) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		watch := f.Watch(cancel)
		defer watch.Stop()
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://example.test"+path, nil)
		res, err := f.StreamClient().Do(req)
		if err != nil {
			return nil, err
		}
		defer res.Body.Close()
		return io.ReadAll(watch.Body(res.Body))
	}
	if b, err := get("/slow"); err != nil || len(b) != 64 {
		t.Errorf("slow but steady: %d bytes, %v", len(b), err)
	}
	start := time.Now()
	if _, err := get("/stalls"); err == nil {
		t.Error("a stalled body should fail")
	}
	if time.Since(start) > 2*time.Second {
		t.Errorf("stall noticed after %v", time.Since(start))
	}
}

func TestFetchNon2xx(t *testing.T) {
	for _, code := range []int{404, 403, 410} {
		f, _ := fetcherFor(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "no", code)
		}))
		_, err := f.Fetch(context.Background(), "http://example.test/gone")
		if !errors.Is(err, ErrUnsupported) {
			t.Errorf("status %d: err = %v, want ErrUnsupported", code, err)
		}
	}
	f, _ := fetcherFor(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", 503)
	}))
	_, err := f.Fetch(context.Background(), "http://example.test/gone")
	if err == nil {
		t.Error("status 503: err = nil, want error")
	}
	if errors.Is(err, ErrUnsupported) {
		t.Error("status 503 must not be negatively cacheable")
	}
}

func redirectChain(t *testing.T) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/r/", func(w http.ResponseWriter, r *http.Request) {
		n, err := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/r/"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if n <= 1 {
			http.Redirect(w, r, "/page", http.StatusFound)
			return
		}
		http.Redirect(w, r, fmt.Sprintf("/r/%d", n-1), http.StatusFound)
	})
	mux.Handle("/page", body("text/html", "<html><head><title>End</title></head></html>"))
	return mux
}

func TestFetchRedirects(t *testing.T) {
	f, _ := fetcherFor(t, redirectChain(t))
	res := mustFetch(t, f, "http://example.test/r/3")
	if res.Title != "End" {
		t.Errorf("Title = %q", res.Title)
	}
	if res.URL != "http://example.test/page" {
		t.Errorf("URL = %q, want the final URL", res.URL)
	}

	if _, err := f.Fetch(context.Background(), "http://example.test/r/4"); err == nil {
		t.Error("4 redirects: err = nil, want error")
	}
}

func TestFetchRedirectToPrivateBlocked(t *testing.T) {
	f, _ := fetcherFor(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://127.0.0.1:1/internal", http.StatusFound)
	}))
	_, err := f.Fetch(context.Background(), "http://example.test/redir")
	if !errors.Is(err, ErrBlocked) {
		t.Fatalf("err = %v, want ErrBlocked", err)
	}
}

func TestFetchRedirectToNonHTTPBlocked(t *testing.T) {
	f, _ := fetcherFor(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "ftp://example.test/file", http.StatusFound)
	}))
	if _, err := f.Fetch(context.Background(), "http://example.test/redir"); !errors.Is(err, ErrBlocked) {
		t.Fatalf("err = %v, want ErrBlocked", err)
	}
}

func TestFetchTooLarge(t *testing.T) {
	payload := "<html><body>" + strings.Repeat("x", 8<<10)
	f, _ := fetcherFor(t, body("text/html", payload))
	f.MaxBytes = 1 << 10
	_, err := f.Fetch(context.Background(), "http://example.test/big")
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("err = %v, want ErrTooLarge", err)
	}
}

func TestFetchLargeBodyWithHeadSucceeds(t *testing.T) {
	payload := `<html><head><title>Big</title><meta property="og:description" content="d"></head><body>` +
		strings.Repeat("x", 8<<10) + "</body></html>"
	f, _ := fetcherFor(t, body("text/html", payload))
	f.MaxBytes = 1 << 10
	res := mustFetch(t, f, "http://example.test/big")
	if res.Title != "Big" || res.Description != "d" {
		t.Errorf("res = %+v", res)
	}
}

func TestFetchTimeout(t *testing.T) {
	f, _ := fetcherFor(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	f.Timeout = 50 * time.Millisecond
	start := time.Now()
	_, err := f.Fetch(context.Background(), "http://example.test/slow")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want context.DeadlineExceeded", err)
	}
	if d := time.Since(start); d > 2*time.Second {
		t.Errorf("took %v, want the timeout to fire", d)
	}
}

func TestFetchCancelledContext(t *testing.T) {
	f, _ := fetcherFor(t, body("text/html", ogPage))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := f.Fetch(ctx, "http://example.test/page"); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestFetchYouTube(t *testing.T) {
	const page = `<html><head><meta property="og:title" content="Never Gonna Give You Up">
<meta property="og:site_name" content="YouTube">
<meta property="og:type" content="video.other">
<meta property="og:video:url" content="https://www.youtube.com/embed/abc123DEF_-">
</head></html>`
	f, _ := fetcherFor(t, body("text/html", page))
	res := mustFetch(t, f, "http://www.youtube.com/watch?v=abc123DEF_-")
	if res.Type != "youtube" {
		t.Errorf("Type = %q, want youtube", res.Type)
	}
	if res.VideoID != "abc123DEF_-" {
		t.Errorf("VideoID = %q", res.VideoID)
	}
	if res.Image != "https://i.ytimg.com/vi/abc123DEF_-/hqdefault.jpg" {
		t.Errorf("Image = %q, want the default thumbnail", res.Image)
	}
	if res.Title != "Never Gonna Give You Up" || res.SiteName != "YouTube" {
		t.Errorf("res = %+v", res)
	}
}

func TestFetchYouTubeKeepsPageImage(t *testing.T) {
	const page = `<html><head><meta property="og:title" content="Vid">
<meta property="og:image" content="https://i.ytimg.com/vi/abc123DEF_-/maxresdefault.jpg"></head></html>`
	f, _ := fetcherFor(t, body("text/html", page))
	res := mustFetch(t, f, "http://www.youtube.com/watch?v=abc123DEF_-")
	if res.Image != "https://i.ytimg.com/vi/abc123DEF_-/maxresdefault.jpg" {
		t.Errorf("Image = %q, want the page's own image", res.Image)
	}
}

// A redirect that lands on a YouTube watch URL still produces a youtube result.
func TestFetchYouTubeAfterRedirect(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/short", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://www.youtube.com/watch?v=abc123DEF_-", http.StatusFound)
	})
	mux.Handle("/watch", body("text/html", `<html><head><title>Vid</title></head></html>`))
	f, _ := fetcherFor(t, mux)
	res := mustFetch(t, f, "http://youtu.be/short")
	if res.Type != "youtube" || res.VideoID != "abc123DEF_-" {
		t.Errorf("res = %+v, want youtube", res)
	}
}

func TestFetcherDefaults(t *testing.T) {
	f := &Fetcher{}
	if f.timeout() != 6*time.Second {
		t.Errorf("timeout = %v, want 6s", f.timeout())
	}
	if f.maxBytes() != 2<<20 {
		t.Errorf("maxBytes = %d, want %d", f.maxBytes(), 2<<20)
	}
	if f.userAgent() != defaultUserAgent {
		t.Errorf("userAgent = %q", f.userAgent())
	}
	f = &Fetcher{Timeout: time.Second, MaxBytes: 10, UserAgent: "x"}
	if f.timeout() != time.Second || f.maxBytes() != 10 || f.userAgent() != "x" {
		t.Error("explicit fields not honoured")
	}
}
