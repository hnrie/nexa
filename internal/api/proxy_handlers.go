package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"evilion.xyz/chat/internal/unfurl"
)

// The media proxy fetches remote images on the user's behalf so that opening a
// chat never reveals their address to whoever hosts the picture. Only URLs this
// server itself signed can be fetched, so it is not an open proxy: the client
// never learns the key and cannot mint links of its own.

const (
	maxProxyBytes  = unfurl.MaxMediaBytes
	proxyCacheCtl  = "public, max-age=604800, immutable"
	proxySigLength = 16 // bytes of HMAC kept, base64url encoded
)

// proxyTypes are the video and audio types passed through; images are
// unfurl.ProxyImageTypes, which leaves out SVG because it can script.
var proxyTypes = map[string]bool{
	"video/mp4": true, "video/webm": true, "video/quicktime": true,
	"audio/mpeg": true, "audio/mp4": true, "audio/ogg": true,
}

// proxyTTL is how long a signed media link stays usable. Long enough for a
// page someone left open overnight, short enough that a link lifted from a
// response does not become a permanent way to make this server fetch things.
const proxyTTL = 24 * time.Hour

func (s *Server) proxyRoutes(mux *http.ServeMux) {
	// Fetching on a caller's behalf costs this server bandwidth in both
	// directions, so it is metered per address whether or not anyone is
	// signed in.
	mux.Handle("GET /media/proxy/{sig}/{url}", ipLimited(s.limProxy, s.handleMediaProxy))
	mux.Handle("HEAD /media/proxy/{sig}/{url}", ipLimited(s.limProxy, s.handleMediaProxy))
}

func (s *Server) proxySignature(expires, encoded string) string {
	mac := hmac.New(sha256.New, s.Secret)
	mac.Write([]byte("media-proxy/v2"))
	mac.Write([]byte(expires))
	mac.Write([]byte{0})
	mac.Write([]byte(encoded))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil)[:proxySigLength])
}

// ProxyURL rewrites a remote URL into a signed path on this server. Anything
// that is not an absolute http(s) URL (including our own paths) is returned
// unchanged so callers can apply it blindly.
func (s *Server) ProxyURL(raw string) string {
	if raw == "" || len(s.Secret) == 0 {
		return raw
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return raw
	}
	encoded := base64.RawURLEncoding.EncodeToString([]byte(raw))
	// The expiry rides in the signature segment rather than a segment of its
	// own, so the path keeps the shape clients already read a filename out of.
	expires := strconv.FormatInt(time.Now().Add(proxyTTL).Unix(), 10)
	return "/media/proxy/" + expires + "-" + s.proxySignature(expires, encoded) + "/" + encoded
}

func (s *Server) handleMediaProxy(w http.ResponseWriter, r *http.Request) {
	encoded := r.PathValue("url")
	expires, mac, ok := strings.Cut(r.PathValue("sig"), "-")
	if !ok || !hmac.Equal([]byte(mac), []byte(s.proxySignature(expires, encoded))) {
		http.Error(w, "bad signature", http.StatusForbidden)
		return
	}
	// A signature with no expiry is a capability that never goes away: lift one
	// out of any response and this server fetches for you, for good.
	if at, err := strconv.ParseInt(expires, 10, 64); err != nil || time.Now().Unix() > at {
		http.Error(w, "expired", http.StatusForbidden)
		return
	}
	rawBytes, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		http.Error(w, "bad url", http.StatusBadRequest)
		return
	}
	target, err := url.Parse(string(rawBytes))
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") {
		http.Error(w, "bad url", http.StatusBadRequest)
		return
	}
	if s.Unfurl == nil {
		http.Error(w, "proxy unavailable", http.StatusServiceUnavailable)
		return
	}
	f := s.Unfurl.MediaFetcher()
	if err := f.Validate(r.Context(), target); err != nil {
		http.Error(w, "blocked", http.StatusForbidden)
		return
	}
	// No deadline on the whole transfer, which a slow phone can stretch past any
	// sensible one; the request is dropped only once it stops making progress.
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	watch := f.Watch(cancel)
	defer watch.Stop()
	req, err := http.NewRequestWithContext(ctx, r.Method, target.String(), nil)
	if err != nil {
		http.Error(w, "bad url", http.StatusBadRequest)
		return
	}
	req.Header.Set("User-Agent", f.UA())
	req.Header.Set("Accept", "image/*,video/*,audio/*;q=0.8,*/*;q=0.1")
	// a Range request lets the browser seek inside proxied video, and a long
	// one comes through a piece at a time instead of being refused
	if rng := r.Header.Get("Range"); rng != "" {
		req.Header.Set("Range", narrowRange(rng, maxProxyBytes))
	}
	res, err := f.StreamClient().Do(req)
	if err != nil {
		http.Error(w, "upstream failed", http.StatusBadGateway)
		return
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusPartialContent {
		http.Error(w, "upstream said "+strconv.Itoa(res.StatusCode), http.StatusBadGateway)
		return
	}
	ct := strings.ToLower(strings.TrimSpace(strings.Split(res.Header.Get("Content-Type"), ";")[0]))
	if !proxyTypes[ct] && !unfurl.ProxyImageTypes[ct] {
		http.Error(w, "unsupported media type", http.StatusUnsupportedMediaType)
		return
	}
	if n, err := strconv.ParseInt(res.Header.Get("Content-Length"), 10, 64); err == nil && n > maxProxyBytes {
		http.Error(w, "too large", http.StatusRequestEntityTooLarge)
		return
	}
	h := w.Header()
	h.Set("Content-Type", ct)
	h.Set("Cache-Control", proxyCacheCtl)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	if v := res.Header.Get("Content-Length"); v != "" {
		h.Set("Content-Length", v)
	}
	if v := res.Header.Get("Content-Range"); v != "" {
		h.Set("Content-Range", v)
	}
	if v := res.Header.Get("Accept-Ranges"); v != "" {
		h.Set("Accept-Ranges", v)
	}
	w.WriteHeader(res.StatusCode)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = io.Copy(w, watch.Body(io.LimitReader(res.Body, maxProxyBytes)))
}

// narrowRange limits a single "bytes=start-[end]" range to at most max bytes.
// A video player opens with "bytes=0-", the whole file; answered with the first
// part, it asks for the rest as it plays, so a video over max still plays
// while no one response is larger than max. Suffix and multi-part ranges pass
// unchanged.
func narrowRange(h string, max int64) string {
	spec, ok := strings.CutPrefix(strings.TrimSpace(h), "bytes=")
	if !ok || strings.Contains(spec, ",") {
		return h
	}
	startS, endS, ok := strings.Cut(spec, "-")
	start, err := strconv.ParseInt(strings.TrimSpace(startS), 10, 64)
	if !ok || err != nil || start < 0 {
		return h
	}
	last := start + max - 1
	if endS = strings.TrimSpace(endS); endS != "" {
		end, err := strconv.ParseInt(endS, 10, 64)
		if err != nil || end < start {
			return h
		}
		last = min(last, end)
	}
	return "bytes=" + strconv.FormatInt(start, 10) + "-" + strconv.FormatInt(last, 10)
}
