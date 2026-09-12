package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// The media proxy fetches remote images on the user's behalf so that opening a
// chat never reveals their address to whoever hosts the picture. Only URLs this
// server itself signed can be fetched, so it is not an open proxy: the client
// never learns the key and cannot mint links of its own.

const (
	maxProxyBytes  = 25 << 20
	proxyCacheCtl  = "public, max-age=604800, immutable"
	proxySigLength = 16 // bytes of HMAC kept, base64url encoded
)

var proxyTypes = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true,
	"image/avif": true, "image/bmp": true, "image/x-icon": true, "image/vnd.microsoft.icon": true,
	"image/svg+xml": false, // SVG can script; never pass it through
	"video/mp4":     true, "video/webm": true, "video/quicktime": true,
	"audio/mpeg": true, "audio/mp4": true, "audio/ogg": true,
}

func (s *Server) proxyRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /media/proxy/{sig}/{url}", s.handleMediaProxy)
	mux.HandleFunc("HEAD /media/proxy/{sig}/{url}", s.handleMediaProxy)
}

func (s *Server) proxySignature(encoded string) string {
	mac := hmac.New(sha256.New, s.Secret)
	mac.Write([]byte("media-proxy/v1"))
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
	return "/media/proxy/" + s.proxySignature(encoded) + "/" + encoded
}

func (s *Server) handleMediaProxy(w http.ResponseWriter, r *http.Request) {
	encoded := r.PathValue("url")
	if !hmac.Equal([]byte(r.PathValue("sig")), []byte(s.proxySignature(encoded))) {
		http.Error(w, "bad signature", http.StatusForbidden)
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
	req, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), nil)
	if err != nil {
		http.Error(w, "bad url", http.StatusBadRequest)
		return
	}
	req.Header.Set("User-Agent", f.UA())
	req.Header.Set("Accept", "image/*,video/*,audio/*;q=0.8,*/*;q=0.1")
	// a Range request lets the browser seek inside proxied video
	if rng := r.Header.Get("Range"); rng != "" {
		req.Header.Set("Range", rng)
	}
	res, err := f.Client().Do(req)
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
	if !proxyTypes[ct] {
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
	_, _ = io.Copy(w, io.LimitReader(res.Body, maxProxyBytes))
}
