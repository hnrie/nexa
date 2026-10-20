package api

import (
	"bytes"
	"crypto/hmac"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/store"
)

// The CDN bot libraries fetch pictures and files from, at /cdn: the paths
// the libraries build from a picture's hash (avatars, server icons, role
// icons, emoji, stickers), the default avatars, and the signed addresses of
// messages' files. A library is pointed here the way it is pointed at this
// server's API (discord.py's Asset.BASE, discord.js's rest.cdn option).
//
// A picture's hash is its blob's id, "a_" first when it moves. A file's
// address is signed for whoever it was handed to and lasts a day; a file
// that is end-to-end encrypted is opened here only for the bot it was
// signed for, with the key the message it came with holds for that bot.

func (s *Server) botCDNRoutes(mux *http.ServeMux) {
	for _, p := range []string{"avatars", "banners", "icons", "splashes", "discovery-splashes", "role-icons", "app-icons", "app-assets", "guild-tag-badges", "team-icons"} {
		mux.HandleFunc("GET /cdn/"+p+"/{owner}/{file}", s.cdnPicture)
	}
	mux.HandleFunc("GET /cdn/guilds/{guild}/users/{user}/avatars/{file}", s.cdnPicture)
	mux.HandleFunc("GET /cdn/guilds/{guild}/users/{user}/banners/{file}", s.cdnPicture)
	mux.HandleFunc("GET /cdn/emojis/{file}", s.cdnEmoji)
	mux.HandleFunc("GET /cdn/stickers/{file}", s.cdnSticker)
	mux.HandleFunc("GET /cdn/embed/avatars/{file}", s.cdnDefaultAvatar)
	mux.HandleFunc("GET /cdn/attachments/{channel}/{attachment}/{name}", s.cdnAttachment)
	mux.HandleFunc("GET /cdn/ephemeral-attachments/{app}/{blob}/{name}", s.cdnInteractionFile)
}

// cdnName splits a file name into its stem and extension.
func cdnName(file string) (string, string) {
	ext := strings.ToLower(path.Ext(file))
	return strings.TrimSuffix(file, path.Ext(file)), strings.TrimPrefix(ext, ".")
}

// cdnSize reads ?size=, a power of two from 16 to 4096.
func cdnSize(r *http.Request) int {
	n, err := strconv.Atoi(r.URL.Query().Get("size"))
	if err != nil || n < 16 || n > 4096 || n&(n-1) != 0 {
		return 0
	}
	return n
}

// servePicture serves a public picture, at a size and still when the
// extension asks for a still format, as the protocol's CDN does.
func (s *Server) servePicture(w http.ResponseWriter, r *http.Request, id ids.ID, ext string) {
	b, err := s.Store.BlobByID(r.Context(), id)
	if err != nil || b.Encrypted || b.Blocked || !media.PublicKinds[b.Kind] {
		http.NotFound(w, r)
		return
	}
	still := b.Animated && ext != "gif" && !(ext == "webp" && r.URL.Query().Get("animated") == "true")
	size := cdnSize(r)
	if size > 0 || still {
		if s.Media.ServePublicSized(w, r, b.Kind, id, size, still) {
			return
		}
	}
	if !s.Media.ServePublic(w, r, b.Kind, id) {
		http.NotFound(w, r)
	}
}

func (s *Server) cdnPicture(w http.ResponseWriter, r *http.Request) {
	stem, ext := cdnName(r.PathValue("file"))
	id, err := ids.Parse(strings.TrimPrefix(stem, "a_"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	s.servePicture(w, r, id, ext)
}

// cdnEmoji serves an emoji by its id, which is its picture's.
func (s *Server) cdnEmoji(w http.ResponseWriter, r *http.Request) {
	stem, ext := cdnName(r.PathValue("file"))
	id, err := parseBotID(stem)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	s.servePicture(w, r, id, ext)
}

func (s *Server) cdnSticker(w http.ResponseWriter, r *http.Request) {
	stem, ext := cdnName(r.PathValue("file"))
	id, err := parseBotID(stem)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	st, err := s.Store.StickerByID(r.Context(), id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	s.servePicture(w, r, st.BlobID, ext)
}

// defaultAvatarColors are the backgrounds of the default avatars, which the
// libraries ask for by number for an account without a picture.
var defaultAvatarColors = []color.RGBA{{88, 101, 242, 255}, {116, 127, 141, 255}, {59, 165, 92, 255}, {250, 166, 26, 255}, {237, 66, 69, 255}, {235, 69, 158, 255}}

var defaultAvatars struct {
	sync.Once
	png [][]byte
}

// cdnDefaultAvatar serves a default avatar: a round tile in one of the
// default colours, with a lighter ring.
func (s *Server) cdnDefaultAvatar(w http.ResponseWriter, r *http.Request) {
	stem, _ := cdnName(r.PathValue("file"))
	n, err := strconv.Atoi(stem)
	if err != nil || n < 0 || n >= len(defaultAvatarColors) {
		http.NotFound(w, r)
		return
	}
	defaultAvatars.Do(func() {
		for _, c := range defaultAvatarColors {
			const side = 256
			img := image.NewRGBA(image.Rect(0, 0, side, side))
			for y := 0; y < side; y++ {
				for x := 0; x < side; x++ {
					dx, dy := float64(x)-side/2+0.5, float64(y)-side/2+0.5
					d := dx*dx + dy*dy
					switch {
					case d > (side/2)*(side/2):
					case d > (side/2-28)*(side/2-28) || d < (side/2-60)*(side/2-60):
						img.Set(x, y, c)
					default:
						img.Set(x, y, color.RGBA{255, 255, 255, 255})
					}
				}
			}
			var buf bytes.Buffer
			_ = png.Encode(&buf, img)
			defaultAvatars.png = append(defaultAvatars.png, buf.Bytes())
		}
	})
	h := w.Header()
	h.Set("Content-Type", "image/png")
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = w.Write(defaultAvatars.png[n])
}

// checkFileSig checks a signed file address: not expired, and signed for
// the viewer it names.
func (s *Server) checkFileSig(r *http.Request, id ids.ID) (viewer ids.ID, ok bool) {
	q := r.URL.Query()
	ex, err := strconv.ParseInt(q.Get("ex"), 16, 64)
	if err != nil || ex < time.Now().Unix() {
		return 0, false
	}
	if u := q.Get("u"); u != "" {
		if viewer, err = parseBotID(u); err != nil {
			return 0, false
		}
	}
	want := s.fileSig(id, viewer, ex)
	return viewer, hmac.Equal([]byte(want), []byte(q.Get("hm")))
}

// servePlainFile writes a file kept as it came.
func (s *Server) servePlainFile(w http.ResponseWriter, r *http.Request, b *store.Blob, name string) {
	f, _, err := s.Media.Open(r.Context(), b.ID)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	h := w.Header()
	ct := b.Mime
	if ct == "" {
		ct = "application/octet-stream"
	}
	h.Set("Content-Type", ct)
	h.Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": name}))
	h.Set("Cache-Control", "private, max-age=86400")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", time.UnixMilli(b.CreatedAt), f)
}

// cdnAttachment serves one of a message's files at its signed address.
func (s *Server) cdnAttachment(w http.ResponseWriter, r *http.Request) {
	id, err := parseBotID(r.PathValue("attachment"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	viewer, ok := s.checkFileSig(r, id)
	if !ok {
		http.Error(w, "This content is no longer available.", http.StatusNotFound)
		return
	}
	ctx := r.Context()
	name := r.PathValue("name")
	// a file of a message only one person sees
	if ef, err := s.Store.EphemeralFileByID(ctx, id); err == nil {
		b, err := s.Store.BlobByID(ctx, ef.BlobID)
		if err != nil || b.Encrypted {
			http.NotFound(w, r)
			return
		}
		s.servePlainFile(w, r, b, name)
		return
	}
	a, err := s.Store.AttachmentByID(ctx, id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	b, err := s.Store.BlobByID(ctx, a.BlobID)
	if err != nil || b.Blocked {
		http.NotFound(w, r)
		return
	}
	if !b.Encrypted {
		s.servePlainFile(w, r, b, name)
		return
	}
	// an end-to-end encrypted file opens only for the bot it was handed to
	if viewer.IsZero() {
		http.NotFound(w, r)
		return
	}
	bot, err := s.Store.UserByID(ctx, viewer)
	if err != nil || bot.Flags&store.FlagBot == 0 {
		http.NotFound(w, r)
		return
	}
	m, err := s.Store.MessageByID(ctx, a.MessageID, bot.ID)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	p, err := s.decryptForBot(ctx, bot, m, nil)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var key []byte
	for _, meta := range p.Att {
		if meta.BlobID == b.ID.String() {
			key, _ = base64.StdEncoding.DecodeString(meta.Key)
			if meta.Type != "" {
				w.Header().Set("Content-Type", meta.Type)
			}
			break
		}
	}
	if len(key) != 32 {
		http.NotFound(w, r)
		return
	}
	f, _, err := s.Media.Open(ctx, b.ID)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	h := w.Header()
	if h.Get("Content-Type") == "" {
		h.Set("Content-Type", "application/octet-stream")
	}
	h.Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": name}))
	h.Set("Cache-Control", "private, no-store")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("X-Content-Type-Options", "nosniff")
	if err := decryptFileTo(w, io.Reader(f), key); err != nil {
		s.Log.Info("cdn: file did not open", "attachment", id, "err", err)
	}
}

// cdnInteractionFile serves a file someone sent an application with an
// interaction, at the address signed for that application.
func (s *Server) cdnInteractionFile(w http.ResponseWriter, r *http.Request) {
	id, err := parseBotID(r.PathValue("blob"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	app, err := parseBotID(r.PathValue("app"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	q := r.URL.Query()
	ex, err := strconv.ParseInt(q.Get("ex"), 16, 64)
	if err != nil || ex < time.Now().Unix() || !hmac.Equal([]byte(s.fileSig(id, app, ex)), []byte(q.Get("hm"))) {
		http.Error(w, "This content is no longer available.", http.StatusNotFound)
		return
	}
	b, err := s.Store.BlobByID(r.Context(), id)
	if err != nil || b.Encrypted || b.Kind != media.KindWebhookFile {
		http.NotFound(w, r)
		return
	}
	s.servePlainFile(w, r, b, r.PathValue("name"))
}
