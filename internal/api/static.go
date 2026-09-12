package api

import (
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// CSP is the content security policy for the web app. hash-wasm needs
// 'wasm-unsafe-eval'; inline style attributes (role colours) need
// 'unsafe-inline' for styles; embeds may load https images/media directly;
// only the privacy-enhanced YouTube host may be framed.
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' wss: https:; frame-src https://www.youtube-nocookie.com; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"

func init() {
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
	_ = mime.AddExtensionType(".wasm", "application/wasm")
	_ = mime.AddExtensionType(".woff2", "font/woff2")
	_ = mime.AddExtensionType(".js", "text/javascript; charset=utf-8")
	_ = mime.AddExtensionType(".mjs", "text/javascript; charset=utf-8")
}

func (s *Server) staticRoutes(mux *http.ServeMux) {
	mux.Handle("/", s.staticHandler())
}

// staticHandler serves the built SPA: real files from WebDist (hashed assets
// immutable, everything else no-cache) and index.html for any other path.
func (s *Server) staticHandler() http.Handler {
	dist, _ := filepath.Abs(s.Cfg.WebDist)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			WriteError(w, E(http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed."))
			return
		}
		p := path.Clean("/" + r.URL.Path)
		if strings.HasPrefix(p, "/api/") || p == "/api" || p == "/gateway" || strings.HasPrefix(p, "/media/") {
			WriteError(w, ErrNotFound)
			return
		}
		if p != "/" {
			fp := filepath.Join(dist, filepath.FromSlash(p))
			if strings.HasPrefix(fp, dist+string(filepath.Separator)) {
				if st, err := os.Stat(fp); err == nil && !st.IsDir() {
					serveStaticFile(w, r, fp, p, st.ModTime())
					return
				}
			}
		}
		index := filepath.Join(dist, "index.html")
		f, err := os.Open(index)
		if err != nil {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("The web app has not been built yet. Run `make web` in the chat directory.\n"))
			return
		}
		defer f.Close()
		st, _ := f.Stat()
		h := w.Header()
		h.Set("Content-Type", "text/html; charset=utf-8")
		h.Set("Cache-Control", "no-cache")
		h.Set("Content-Security-Policy", CSP)
		var mod time.Time
		if st != nil {
			mod = st.ModTime()
		}
		http.ServeContent(w, r, "index.html", mod, f)
	})
}

func serveStaticFile(w http.ResponseWriter, r *http.Request, fp, urlPath string, mod time.Time) {
	f, err := os.Open(fp)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	defer f.Close()
	h := w.Header()
	if ct := mime.TypeByExtension(filepath.Ext(fp)); ct != "" {
		h.Set("Content-Type", ct)
	}
	// Hashed bundles and the emoji artwork are named after their content, so
	// they never change under the same URL.
	if strings.HasPrefix(urlPath, "/assets/") || strings.HasPrefix(urlPath, "/twemoji/") {
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		h.Set("Cache-Control", "no-cache")
	}
	if strings.HasSuffix(fp, ".html") {
		h.Set("Content-Security-Policy", CSP)
	}
	if filepath.Base(fp) == "sw.js" {
		h.Set("Service-Worker-Allowed", "/")
	}
	http.ServeContent(w, r, filepath.Base(fp), mod, f)
}
