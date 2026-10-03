// Package music finds the artists, albums and songs people put on their
// profile, in Deezer's catalogue (https://developers.deezer.com/api), and
// keeps their pictures. Searches go from this server and the pictures are
// fetched once and kept here, so nobody using Nexa contacts Deezer
// themselves. Deezer's API needs no key; its terms keep it to non-commercial
// use, and the app credits it under the music search.
//
// A search finds more than names (rank.go): a song's title finds who made it
// and the album it is on, and an album's title finds its songs and its
// artist.
package music

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Kind is what a search looks for, one for each kind of music widget.
type Kind string

const (
	Artists Kind = "artists"
	Albums  Kind = "albums"
	Songs   Kind = "songs"
)

// Item is an artist, an album or a song as Deezer has it.
type Item struct {
	// ID is Deezer's, as a string.
	ID   string `json:"id"`
	Name string `json:"name"`
	// By is an album's or a song's artist.
	By string `json:"by,omitempty"`
	// Art is the id of its picture on Deezer: an artist's photo, an album's
	// cover, or the cover of the album a song is on.
	Art string `json:"art,omitempty"`
	// Duration is a song's length in seconds.
	Duration int `json:"duration,omitempty"`
	// Album is the album a song is on, which tells its versions apart.
	Album string `json:"album,omitempty"`
	// Record is what an album is when it is not an album: "single", "ep" or "compile".
	Record string `json:"record,omitempty"`
	// Fans is how many follow an artist on Deezer.
	Fans int64 `json:"fans,omitempty"`
	// Via is the song or album an artist was found through, when it was not
	// their name that matched.
	Via *Via `json:"via,omitempty"`
}

// Via is the song or album that brought an artist into a search.
type Via struct {
	// Kind is "song" or "album".
	Kind string `json:"kind"`
	Name string `json:"name"`
}

var (
	// ErrUnknown is an artist, album, song or picture Deezer does not have.
	ErrUnknown = errors.New("music: not known")

	// IDPattern and ArtPattern are the shapes of Deezer's ids and picture ids.
	IDPattern  = regexp.MustCompile(`^[0-9]{1,20}$`)
	ArtPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
	// a picture's address on Deezer, which is where its id is read from
	artInURL = regexp.MustCompile(`/images/(?:artist|cover)/([0-9a-f]{32})/`)
	// a version of a song that is the song, cleaned up: "Dreams (2004 Remaster)" is "Dreams"
	remaster = regexp.MustCompile(`(?i)remaster`)
)

const (
	searchTTL   = 24 * time.Hour
	maxCached   = 2000
	maxArtSize  = 2 << 20
	listSize    = 25
	maxAnswered = 20
)

// ArtSizes are the sizes a picture is kept at, square: "s" for rows and
// lines, "l" for the shelves, each at three times the size it is drawn.
var ArtSizes = map[string]string{"s": "120x120", "l": "400x400"}

// ArtKinds are the two kinds of picture: an artist's photo and a cover.
var ArtKinds = map[string]bool{"artist": true, "cover": true}

// Client searches Deezer and keeps pictures.
type Client struct {
	// Dir is where pictures are kept.
	Dir    string
	HTTP   *http.Client
	API    string
	Images string
	Log    *slog.Logger

	limit *rate.Limiter

	mu      sync.Mutex
	answers map[string]answer
	known   map[string]Item

	artMu    sync.Mutex
	inFlight map[string]chan struct{}
}

// answer is one of Deezer's lists, as a search brought it, kept a day.
type answer struct {
	at   time.Time
	list any
}

// New is a client keeping pictures in dir.
func New(dir string) *Client {
	return &Client{
		Dir: dir,
		HTTP: &http.Client{
			Timeout: 15 * time.Second,
			// a picture Deezer does not have is a redirect to a stand-in, which is not the picture
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		API:    "https://api.deezer.com",
		Images: "https://cdn-images.dzcdn.net/images",
		Log:    slog.Default(),
		// Deezer lets a caller make fifty requests every five seconds
		limit:    rate.NewLimiter(8, 8),
		answers:  map[string]answer{},
		known:    map[string]Item{},
		inFlight: map[string]chan struct{}{},
	}
}

// On says whether there is a search to offer.
func (c *Client) On() bool {
	return c != nil
}

// What Deezer sends, as much of it as is used.
type (
	dzError struct {
		Type    string `json:"type"`
		Message string `json:"message"`
		Code    int    `json:"code"`
	}
	dzArtist struct {
		ID      int64  `json:"id"`
		Name    string `json:"name"`
		Picture string `json:"picture_small"`
		Fans    int64  `json:"nb_fan"`
	}
	dzAlbum struct {
		ID     int64     `json:"id"`
		Title  string    `json:"title"`
		MD5    string    `json:"md5_image"`
		Cover  string    `json:"cover_small"`
		Record string    `json:"record_type"`
		Artist *dzArtist `json:"artist"`
	}
	dzTrack struct {
		ID       int64     `json:"id"`
		Title    string    `json:"title"`
		Short    string    `json:"title_short"`
		Version  string    `json:"title_version"`
		Duration int       `json:"duration"`
		Rank     int64     `json:"rank"`
		MD5      string    `json:"md5_image"`
		Artist   *dzArtist `json:"artist"`
		Album    *dzAlbum  `json:"album"`
	}
)

// get asks Deezer for one thing and reads its answer into out. Deezer says
// what went wrong in the body of an answer that is otherwise fine.
func (c *Client) get(ctx context.Context, path string, query url.Values, out any) error {
	if !c.On() {
		return errors.New("music: no client")
	}
	if err := c.limit.Wait(ctx); err != nil {
		return err
	}
	u := c.API + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	res.Body.Close()
	if err != nil {
		return err
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("music: Deezer answered %d", res.StatusCode)
	}
	var problem struct {
		Error *dzError `json:"error"`
	}
	if err := json.Unmarshal(raw, &problem); err != nil {
		return err
	}
	if e := problem.Error; e != nil {
		// 800 is "no data": nothing with that id
		if e.Code == 800 {
			return ErrUnknown
		}
		return fmt.Errorf("music: Deezer refused (%d %s)", e.Code, e.Message)
	}
	return json.Unmarshal(raw, out)
}

// list is one of Deezer's searches ("artist", "album" or "track") for q,
// kept for a day.
func list[T any](ctx context.Context, c *Client, what, q string) ([]T, error) {
	key := what + "\x00" + strings.ToLower(q)
	c.mu.Lock()
	hit, ok := c.answers[key]
	c.mu.Unlock()
	if l, isList := hit.list.([]T); ok && isList && time.Since(hit.at) < searchTTL {
		return l, nil
	}
	var page struct {
		Data []T `json:"data"`
	}
	if err := c.get(ctx, "/search/"+what, url.Values{"q": {q}, "limit": {strconv.Itoa(listSize)}}, &page); err != nil {
		return nil, err
	}
	c.mu.Lock()
	if len(c.answers) > maxCached {
		c.answers = map[string]answer{}
	}
	c.answers[key] = answer{at: time.Now(), list: page.Data}
	c.mu.Unlock()
	return page.Data, nil
}

// artOf is a picture's id, from where Deezer gives it: an id of its own, or
// its address. Deezer's stand-in for a missing picture has none.
func artOf(md5, address string) string {
	if ArtPattern.MatchString(md5) {
		return md5
	}
	if m := artInURL.FindStringSubmatch(address); m != nil {
		return m[1]
	}
	return ""
}

func idOf(n int64) string {
	if n <= 0 {
		return ""
	}
	return strconv.FormatInt(n, 10)
}

func name(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len([]rune(s)) > 100 {
		s = string([]rune(s)[:100])
	}
	return s
}

func (a *dzArtist) item() Item {
	if a == nil {
		return Item{}
	}
	return Item{ID: idOf(a.ID), Name: name(a.Name), Art: artOf("", a.Picture), Fans: a.Fans}
}

// item is an album as found: its artist is the one Deezer gives it, or, for
// an album that came with a song, the song's (by).
func (a *dzAlbum) item(by string) Item {
	if a == nil {
		return Item{}
	}
	it := Item{ID: idOf(a.ID), Name: name(a.Title), Art: artOf(a.MD5, a.Cover), By: by}
	if a.Artist != nil {
		it.By = name(a.Artist.Name)
	}
	if r := strings.ToLower(a.Record); r == "single" || r == "ep" || r == "compile" {
		it.Record = r
	}
	return it
}

// item is a song as found. A remastered one goes by the song's own name; a
// live one, a mix or a demo keeps what it is.
func (t *dzTrack) item() Item {
	title := t.Title
	if strings.TrimSpace(t.Short) != "" && remaster.MatchString(t.Version) {
		title = t.Short
	}
	it := Item{ID: idOf(t.ID), Name: name(title), Duration: t.Duration}
	if t.Artist != nil {
		it.By = name(t.Artist.Name)
	}
	cover := ""
	if t.Album != nil {
		it.Album = name(t.Album.Title)
		cover = t.Album.Cover
	}
	it.Art = artOf(t.MD5, cover)
	if t.Album != nil && it.Art == "" {
		it.Art = artOf(t.Album.MD5, "")
	}
	return it
}

// remember keeps what a search or a lookup said about things, so a widget
// saved with them is named and drawn as Deezer has them without asking again.
func (c *Client) remember(kind Kind, items ...Item) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.known) > maxCached*4 {
		c.known = map[string]Item{}
	}
	for _, it := range items {
		if it.ID == "" || it.Name == "" {
			continue
		}
		c.known[string(kind)+":"+it.ID] = Item{ID: it.ID, Name: it.Name, By: it.By, Art: it.Art, Duration: it.Duration}
	}
}

// Known is what a search or a lookup has already said about something.
func (c *Client) Known(kind Kind, id string) (Item, bool) {
	if !c.On() {
		return Item{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	it, ok := c.known[string(kind)+":"+id]
	return it, ok
}

// Lookup asks Deezer about one artist, album or song.
func (c *Client) Lookup(ctx context.Context, kind Kind, id string) (Item, error) {
	if !IDPattern.MatchString(id) {
		return Item{}, ErrUnknown
	}
	if it, ok := c.Known(kind, id); ok {
		return it, nil
	}
	var it Item
	switch kind {
	case Artists:
		var a dzArtist
		if err := c.get(ctx, "/artist/"+id, nil, &a); err != nil {
			return Item{}, err
		}
		it = a.item()
		it.Fans = 0
	case Albums:
		var a dzAlbum
		if err := c.get(ctx, "/album/"+id, nil, &a); err != nil {
			return Item{}, err
		}
		it = a.item("")
		it.Record = ""
	case Songs:
		var t dzTrack
		if err := c.get(ctx, "/track/"+id, nil, &t); err != nil {
			return Item{}, err
		}
		it = t.item()
		it.Album = ""
	default:
		return Item{}, ErrUnknown
	}
	if it.ID != id || it.Name == "" {
		return Item{}, ErrUnknown
	}
	c.remember(kind, it)
	return it, nil
}

// Kept is where a picture is kept at a size, if it has been fetched already.
func (c *Client) Kept(kind, art, size string) (string, bool) {
	if _, ok := ArtSizes[size]; !ok || !ArtKinds[kind] || !ArtPattern.MatchString(art) {
		return "", false
	}
	path := filepath.Join(c.Dir, kind, art+"-"+size+".jpg")
	if fi, err := os.Stat(path); err == nil && fi.Size() > 0 {
		return path, true
	}
	return "", false
}

// ArtFile is a picture kept at a size ("s" or "l"), fetched the first time it
// is asked for. Only Deezer's own picture addresses are ever fetched.
func (c *Client) ArtFile(ctx context.Context, kind, art, size string) (string, error) {
	dims, ok := ArtSizes[size]
	if !ok || !ArtKinds[kind] || !ArtPattern.MatchString(art) {
		return "", ErrUnknown
	}
	if path, ok := c.Kept(kind, art, size); ok {
		return path, nil
	}
	path := filepath.Join(c.Dir, kind, art+"-"+size+".jpg")
	c.artMu.Lock()
	if wait, ok := c.inFlight[path]; ok {
		c.artMu.Unlock()
		select {
		case <-wait:
		case <-ctx.Done():
			return "", ctx.Err()
		}
		if fi, err := os.Stat(path); err == nil && fi.Size() > 0 {
			return path, nil
		}
		return "", ErrUnknown
	}
	done := make(chan struct{})
	c.inFlight[path] = done
	c.artMu.Unlock()
	// the fetch outlives a viewer who gave up, so the next one finds it kept
	fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	err := c.fetchArt(fctx, kind+"/"+art+"/"+dims+"-000000-80-0-0.jpg", path)
	cancel()
	c.artMu.Lock()
	delete(c.inFlight, path)
	c.artMu.Unlock()
	close(done)
	return path, err
}

func (c *Client) fetchArt(ctx context.Context, rel, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.Images+"/"+rel, nil)
	if err != nil {
		return err
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound || (res.StatusCode >= 300 && res.StatusCode < 400) {
		return ErrUnknown
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("music: picture answered %d", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maxArtSize+1))
	if err != nil {
		return err
	}
	if len(data) > maxArtSize || len(data) < 8 {
		return errors.New("music: picture of the wrong size")
	}
	if ct := http.DetectContentType(data); ct != "image/jpeg" && ct != "image/png" && ct != "image/webp" {
		return fmt.Errorf("music: picture is %s", ct)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".art-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
