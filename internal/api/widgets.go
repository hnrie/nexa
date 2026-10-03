package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/games"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/store"
)

// Profile widgets: sections of a profile that show what someone is into. The
// games they love most, are playing, want to play and have played, found on
// IGDB (internal/games) or added by name with a picture of their own, and
// cards they make themselves: a title, a picture, a few words, a handful of
// numbers and a link. Shown to anyone who sees the profile, in the order they
// are put in.

const (
	maxWidgets      = 8
	maxCustomCards  = 4
	maxWidgetNote   = 200
	maxPlaying      = 5
	maxGameList     = 20
	maxGameTags     = 3
	maxGameTag      = 20
	maxGameName     = 100
	maxWidgetTitle  = 40
	maxWidgetText   = 300
	maxWidgetStats  = 6
	maxStatLabel    = 24
	maxStatValue    = 40
	maxLinkLabel    = 32
	maxLinkURL      = 512
	maxWidgetsBytes = 24 << 10
	// how large a widget's picture is kept: square ones (a card's picture
	// beside its title), wide ones (across a card's top) and covers (a game
	// added by name, in the shape of a box)
	widgetSquareSide           = 256
	widgetWideW, widgetWideH   = 720, 300
	widgetCoverW, widgetCoverH = 300, 400
)

type widgetGame struct {
	// ID is IGDB's for the game; Cover the image id of its cover there.
	ID    string `json:"id,omitempty"`
	Cover string `json:"cover,omitempty"`
	// Name is the game's; Image a picture of the person's own for one the list does not have.
	Name  string   `json:"name"`
	Image string   `json:"image,omitempty"`
	Tags  []string `json:"tags,omitempty"`
}

type widgetStat struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type widgetLink struct {
	URL   string `json:"url"`
	Label string `json:"label,omitempty"`
}

type widget struct {
	ID    string       `json:"id"`
	Type  string       `json:"type"`
	Games []widgetGame `json:"games,omitempty"`
	Note  string       `json:"note,omitempty"`
	Title string       `json:"title,omitempty"`
	Image string       `json:"image,omitempty"`
	Shape string       `json:"shape,omitempty"`
	Text  string       `json:"text,omitempty"`
	Stats []widgetStat `json:"stats,omitempty"`
	Link  *widgetLink  `json:"link,omitempty"`
}

var widgetID = regexp.MustCompile(`^[a-z0-9]{4,16}$`)

func (s *Server) widgetRoutes(mux *http.ServeMux) {
	mux.Handle("PUT /api/v1/users/@me/widgets", s.authed(s.handleWidgetsPut))
	mux.Handle("POST /api/v1/users/@me/widgets/image", s.userLimited(s.limUpload, s.handleWidgetImage))
	mux.Handle("GET /api/v1/games/search", s.authed(s.handleGameSearch))
	mux.Handle("GET /media/game/{cover}", ipLimited(s.limProxy, s.handleGameCover))
}

// line is a single line of someone's own words, cleaned, at most max runes.
func line(raw string, max int) (string, bool) {
	return CleanText(strings.NewReplacer("\n", " ", "\t", " ").Replace(raw), max)
}

// cleanGame checks one game of a widget. A game found on IGDB is named and
// drawn as IGDB has it (known), whatever was sent; when IGDB cannot be asked,
// what was sent is kept, checked for shape.
func (s *Server) cleanGame(in widgetGame, tags bool, known map[string]games.Game) (widgetGame, string) {
	out := widgetGame{}
	if in.ID != "" {
		if !games.IDPattern.MatchString(in.ID) {
			return out, "That game isn't one from the games search."
		}
		out.ID = in.ID
		if g, ok := known[in.ID]; ok {
			out.Name, out.Cover = g.Name, g.Cover
		} else {
			name, ok := line(in.Name, maxGameName)
			if !ok || name == "" {
				return out, "Each game needs a name."
			}
			out.Name = name
			if games.CoverPattern.MatchString(in.Cover) {
				out.Cover = in.Cover
			}
		}
	} else {
		name, ok := line(in.Name, maxGameName)
		if !ok || name == "" {
			return out, "Each game needs a name of at most 100 characters."
		}
		out.Name = name
		if in.Image != "" {
			if _, err := ids.Parse(in.Image); err != nil {
				return out, "That game's picture has gone. Put it up again."
			}
			out.Image = in.Image
		}
	}
	if tags {
		if len(in.Tags) > maxGameTags {
			return out, "A game has at most three tags."
		}
		for _, raw := range in.Tags {
			tag, ok := line(raw, maxGameTag)
			if !ok {
				return out, "A tag is at most 20 characters."
			}
			if tag != "" {
				out.Tags = append(out.Tags, tag)
			}
		}
	}
	return out, ""
}

// cleanWidgets checks widgets their owner sent and writes them the one way
// they are kept. The second result is why they were refused.
func (s *Server) cleanWidgets(ctx context.Context, raw json.RawMessage) (string, string) {
	var in []widget
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", "widgets must be a list."
	}
	if len(in) > maxWidgets {
		return "", "A profile has at most eight widgets."
	}
	// every IGDB game named, looked up in one go (most are known from the search that found them)
	var gameIDs []string
	for _, w := range in {
		for _, g := range w.Games {
			if games.IDPattern.MatchString(g.ID) {
				gameIDs = append(gameIDs, g.ID)
			}
		}
	}
	known := map[string]games.Game{}
	if len(gameIDs) > 0 && s.Games.On() {
		lctx, cancel := context.WithTimeout(ctx, 8*time.Second)
		found, err := s.Games.Lookup(lctx, gameIDs)
		cancel()
		if err != nil {
			s.Log.Warn("igdb lookup", "err", err)
		}
		known = found
	}
	out := make([]widget, 0, len(in))
	seenType := map[string]bool{}
	seenID := map[string]bool{}
	cards := 0
	for i, w := range in {
		next := widget{ID: w.ID, Type: w.Type}
		if !widgetID.MatchString(next.ID) || seenID[next.ID] {
			next.ID = "w" + strconv.FormatInt(time.Now().UnixMilli()%1_000_000_000, 36) + strconv.Itoa(i)
		}
		seenID[next.ID] = true
		switch w.Type {
		case "favorite", "playing", "wishlist", "played":
			if seenType[w.Type] {
				return "", "A profile has one of each kind of games widget."
			}
			seenType[w.Type] = true
			most := map[string]int{"favorite": 1, "playing": maxPlaying, "wishlist": maxGameList, "played": maxGameList}[w.Type]
			if len(w.Games) == 0 || len(w.Games) > most {
				return "", "A games widget holds between one game and its most."
			}
			for _, g := range w.Games {
				clean, problem := s.cleanGame(g, w.Type == "playing", known)
				if problem != "" {
					return "", problem
				}
				next.Games = append(next.Games, clean)
			}
			if w.Type == "favorite" {
				note, ok := CleanText(w.Note, maxWidgetNote)
				if !ok {
					return "", "What you say about your favourite is at most 200 characters."
				}
				next.Note = note
			}
		case "custom":
			cards++
			if cards > maxCustomCards {
				return "", "A profile has at most four cards of your own."
			}
			title, ok := line(w.Title, maxWidgetTitle)
			if !ok || title == "" {
				return "", "A card needs a title of at most 40 characters."
			}
			next.Title = title
			text, ok := CleanText(w.Text, maxWidgetText)
			if !ok {
				return "", "A card's words are at most 300 characters."
			}
			next.Text = text
			if w.Image != "" {
				if _, err := ids.Parse(w.Image); err != nil {
					return "", "That card's picture has gone. Put it up again."
				}
				next.Image = w.Image
				next.Shape = "wide"
				if w.Shape == "square" {
					next.Shape = "square"
				}
			}
			if len(w.Stats) > maxWidgetStats {
				return "", "A card has at most six stats."
			}
			for _, st := range w.Stats {
				label, ok1 := line(st.Label, maxStatLabel)
				value, ok2 := line(st.Value, maxStatValue)
				if !ok1 || !ok2 {
					return "", "A card's labels are at most 24 characters, and their values at most 40."
				}
				if label == "" && value == "" {
					continue
				}
				if label == "" || value == "" {
					return "", "Each stat on a card needs a label and a value."
				}
				next.Stats = append(next.Stats, widgetStat{Label: label, Value: value})
			}
			if w.Link != nil && strings.TrimSpace(w.Link.URL) != "" {
				raw := strings.TrimSpace(w.Link.URL)
				u, err := url.Parse(raw)
				if err != nil || len(raw) > maxLinkURL || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil {
					return "", "A card's link must be a web address starting with https://."
				}
				label, ok := line(w.Link.Label, maxLinkLabel)
				if !ok {
					return "", "A link's words are at most 32 characters."
				}
				next.Link = &widgetLink{URL: u.String(), Label: label}
			}
			if next.Text == "" && next.Image == "" && len(next.Stats) == 0 && next.Link == nil {
				return "", "A card needs something on it besides its title."
			}
		default:
			return "", "That isn't a kind of widget."
		}
		out = append(out, next)
	}
	if len(out) == 0 {
		return "", ""
	}
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		return "", "widgets could not be read."
	}
	text := strings.TrimSuffix(b.String(), "\n")
	if len(text) > maxWidgetsBytes {
		return "", "That's more than a profile can hold. Take a few games out."
	}
	return text, ""
}

// widgetsJSON is widgets as they go out: a list, empty for none.
func widgetsJSON(raw string) json.RawMessage {
	if raw == "" {
		return json.RawMessage("[]")
	}
	return json.RawMessage(raw)
}

func (s *Server) handleWidgetsPut(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	// every save is shown to everyone who opens the profile
	if ok, retry := s.limProfile.Allow("profile:" + me.ID.String()); !ok {
		w.Header().Set("Retry-After", retryAfter(retry))
		WriteError(w, ErrRateLimited)
		return
	}
	var req struct {
		Widgets json.RawMessage `json:"widgets"`
	}
	if err := ReadJSON(w, r, &req, 64<<10); err != nil {
		WriteError(w, err)
		return
	}
	if len(req.Widgets) == 0 || string(req.Widgets) == "null" {
		req.Widgets = json.RawMessage("[]")
	}
	clean, problem := s.cleanWidgets(r.Context(), req.Widgets)
	if problem != "" {
		WriteError(w, E(http.StatusBadRequest, "invalid_widgets", problem))
		return
	}
	if err := s.Store.SetUserWidgets(r.Context(), me.ID, clean); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			WriteError(w, E(http.StatusBadRequest, "invalid_widgets", "One of those pictures has gone. Put it up again."))
			return
		}
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"widgets": widgetsJSON(clean)})
}

// handleWidgetImage takes a picture for a widget with the part framed, cut
// here square or wide and kept small. It is held for a day: saving widgets
// that name it keeps it.
func (s *Server) handleWidgetImage(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	lim := s.limitsFor("widget")
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, lim.MaxBytes+1))
	if err != nil || int64(len(data)) > lim.MaxBytes {
		WriteError(w, media.ErrTooLarge)
		return
	}
	if width, height, err := media.ImageDims(bytes.NewReader(data)); err != nil {
		WriteError(w, media.ErrUnsupported)
		return
	} else if err := lim.Check(width, height); err != nil {
		WriteError(w, err)
		return
	}
	shape := r.URL.Query().Get("shape")
	spec := media.CropSpec{Rect: cropFromQuery(r), MaxW: widgetSquareSide, MaxH: widgetSquareSide}
	switch shape {
	case "wide":
		spec.MaxW, spec.MaxH = widgetWideW, widgetWideH
	case "cover":
		spec.MaxW, spec.MaxH = widgetCoverW, widgetCoverH
	default:
		shape = "square"
	}
	out, _, err := media.Crop(data, spec)
	if err != nil {
		WriteError(w, cropError(err))
		return
	}
	b, err := s.Media.PutPublic(r.Context(), "widget", bytes.NewReader(out), media.Limits{MaxBytes: int64(len(out)) + 1, MaxW: spec.MaxW, MaxH: spec.MaxH}, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	s.releaseBlob(r.Context(), b.ID)
	WriteJSON(w, http.StatusOK, map[string]any{"id": b.ID, "shape": shape, "animated": b.Animated})
}

// handleGameSearch finds games on IGDB by name.
func (s *Server) handleGameSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	list := []games.Game{}
	on := s.Games.On()
	if on && q != "" && len(q) <= 100 {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		found, err := s.Games.Search(ctx, q, 24)
		cancel()
		if err != nil {
			s.Log.Warn("igdb search", "err", err)
			WriteError(w, E(http.StatusBadGateway, "games_unavailable", "Game search isn't answering right now. Try again in a moment, or add the game by name."))
			return
		}
		list = found
	}
	WriteJSON(w, http.StatusOK, map[string]any{"games": list, "ready": on})
}

// handleGameCover serves a game's cover, fetched from IGDB once and kept. It
// only ever fetches IGDB's own picture addresses.
func (s *Server) handleGameCover(w http.ResponseWriter, r *http.Request) {
	cover := r.PathValue("cover")
	size := r.URL.Query().Get("size")
	if size != "s" {
		size = "l"
	}
	if s.Games == nil || !games.CoverPattern.MatchString(cover) {
		http.NotFound(w, r)
		return
	}
	path, err := s.Games.CoverFile(r.Context(), cover, size)
	if err != nil {
		if errors.Is(err, games.ErrUnknown) {
			http.NotFound(w, r)
			return
		}
		http.Error(w, "could not fetch the cover", http.StatusBadGateway)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	head := make([]byte, 512)
	n, _ := io.ReadFull(f, head)
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", http.DetectContentType(head[:n]))
	// an image id names one picture for good
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", time.Time{}, f)
}

// widgetsText is widgets as words a moderation case can keep: a line a
// widget, with its games and what was said about them, or a card's title,
// words, stats and link.
func widgetsText(raw string) string {
	var list []widget
	if raw == "" || json.Unmarshal([]byte(raw), &list) != nil {
		return raw
	}
	lines := make([]string, 0, len(list))
	for _, w := range list {
		var parts []string
		if w.Type == "custom" {
			parts = append(parts, w.Title)
			if w.Text != "" {
				parts = append(parts, w.Text)
			}
			for _, st := range w.Stats {
				parts = append(parts, st.Label+": "+st.Value)
			}
			if w.Link != nil {
				parts = append(parts, strings.TrimSpace(w.Link.Label+" "+w.Link.URL))
			}
		} else {
			for _, g := range w.Games {
				name := g.Name
				if len(g.Tags) > 0 {
					name += " [" + strings.Join(g.Tags, ", ") + "]"
				}
				parts = append(parts, name)
			}
			if w.Note != "" {
				parts = append(parts, w.Note)
			}
		}
		lines = append(lines, w.Type+": "+strings.Join(parts, " / "))
	}
	return strings.Join(lines, "\n")
}
