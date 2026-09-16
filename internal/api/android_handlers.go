package api

import (
	"encoding/json"
	"html/template"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// The Android app's APK is published into AndroidDir by
// tools/publish_android.py and served from here: the download page and the
// banner read /api/v1/android/latest, and the phone downloads the file itself
// from /android/<name>.
//
// There is no app store in the middle, so the page also hands out the SHA-256
// of what it is serving, and /.well-known/assetlinks.json lets Android open
// this instance's links in the app once it is installed.

var androidFileName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{0,120}\.apk$`)

// androidRelease is manifest.json as the download page gets it.
type androidRelease struct {
	Version     string `json:"version"`
	VersionCode int    `json:"version_code"`
	ReleasedAt  int64  `json:"released_at"`
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
	MinSDK      int    `json:"min_sdk"`
	// Abis says which processors the build carries code for.
	Abis []string `json:"abis,omitempty"`
	// SigningSHA256 is the certificate the APK is signed with, as Android
	// checks it for app links and as a person can check with apksigner.
	SigningSHA256 string `json:"signing_sha256,omitempty"`
}

func (s *Server) androidRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/android/latest", s.handleAndroidLatest)
	mux.HandleFunc("GET /android/{file}", s.handleAndroidFile)
	mux.HandleFunc("HEAD /android/{file}", s.handleAndroidFile)
	mux.HandleFunc("/android/", func(w http.ResponseWriter, r *http.Request) { WriteError(w, ErrNotFound) })
	mux.HandleFunc("GET /.well-known/assetlinks.json", s.handleAssetLinks)
	mux.HandleFunc("GET /native/captcha", s.handleNativeCaptcha)
}

func (s *Server) androidManifest() (androidRelease, bool) {
	raw, err := os.ReadFile(filepath.Join(s.Cfg.AndroidDir, "manifest.json"))
	var rel androidRelease
	if err != nil || json.Unmarshal(raw, &rel) != nil || rel.Version == "" || rel.Name == "" {
		return androidRelease{}, false
	}
	return rel, true
}

func (s *Server) handleAndroidLatest(w http.ResponseWriter, r *http.Request) {
	rel, ok := s.androidManifest()
	if !ok {
		WriteError(w, E(http.StatusNotFound, "no_release", "No Android build has been published yet."))
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	WriteJSON(w, http.StatusOK, rel)
}

func (s *Server) handleAndroidFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	if !androidFileName.MatchString(name) || strings.Contains(name, "..") {
		WriteError(w, ErrNotFound)
		return
	}
	dir, err := filepath.Abs(s.Cfg.AndroidDir)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	fp := filepath.Join(dir, name)
	if filepath.Dir(fp) != dir {
		WriteError(w, ErrNotFound)
		return
	}
	f, err := os.Open(fp)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		WriteError(w, ErrNotFound)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/vnd.android.package-archive")
	// every build's name carries its version
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	h.Set("Content-Disposition", `attachment; filename="`+name+`"`)
	h.Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, name, st.ModTime(), f)
}

// handleAssetLinks tells Android that this site's links belong to the app, so
// an invite opens in it rather than in a browser. It is only served once a
// build has been published with the certificate it was signed with.
func (s *Server) handleAssetLinks(w http.ResponseWriter, r *http.Request) {
	rel, ok := s.androidManifest()
	if !ok || rel.SigningSHA256 == "" {
		WriteError(w, ErrNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	WriteJSON(w, http.StatusOK, []map[string]any{{
		"relation": []string{"delegate_permission/common.handle_all_urls"},
		"target": map[string]any{
			"namespace":                "android_app",
			"package_name":             androidPackage,
			"sha256_cert_fingerprints": []string{rel.SigningSHA256},
		},
	}})
}

const androidPackage = "xyz.evilion.chat"

// captchaPage is the one page the Android app shows in a web view: Cloudflare
// Turnstile, which checks the hostname a challenge was solved on, so it has to
// come from this instance. The token goes back to the app through the bridge
// it installed, and nothing else on this page is ours.
var captchaPage = template.Must(template.New("captcha").Parse(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>One quick check</title>
<style>
  html, body { margin: 0; background: #34353b; color: #f3f3f4;
    font: 15px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { min-height: 100vh; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 16px; padding: 20px; box-sizing: border-box; text-align: center; }
  p { color: #abacb2; margin: 0; }
  button { background: none; border: 0; color: #94a8ff; font: inherit; padding: 8px; }
</style>
</head><body><main>
<p>One quick check that you are a person.</p>
<div id="slot"></div>
<button type="button" onclick="cancel()">Cancel</button>
</main>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer onerror="cancel()"></script>
<script>
  var action = {{.Action}};
  var sitekey = {{.SiteKey}};
  function done(token) { if (window.AndroidCaptcha) window.AndroidCaptcha.onToken(token); }
  function cancel() { if (window.AndroidCaptcha) window.AndroidCaptcha.onCancel(); }
  window.onloadTurnstileCallback = function () {
    turnstile.render("#slot", {
      sitekey: sitekey, action: action, theme: "dark",
      callback: done, "error-callback": cancel, "timeout-callback": cancel,
    });
  };
  var tries = 0;
  (function wait() {
    if (window.turnstile) return window.onloadTurnstileCallback();
    if (++tries > 100) return cancel();
    setTimeout(wait, 100);
  })();
</script>
</body></html>`))

func (s *Server) handleNativeCaptcha(w http.ResponseWriter, r *http.Request) {
	if !s.captchaEnabled() {
		WriteError(w, ErrNotFound)
		return
	}
	action := strings.TrimSpace(r.URL.Query().Get("action"))
	if !reCaptchaAction.MatchString(action) {
		action = "login"
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = captchaPage.Execute(w, map[string]string{"Action": action, "SiteKey": s.Cfg.TurnstileSiteKey})
}

var reCaptchaAction = regexp.MustCompile(`^[a-z_]{1,32}$`)
