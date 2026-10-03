package music

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	artMJ      = "aa000000000000000000000000000001"
	artThrill  = "aa000000000000000000000000000002"
	artDeluxe  = "cc000000000000000000000000000001"
	artAlbum   = "cc000000000000000000000000000002"
	artWeeknd  = "aa000000000000000000000000000003"
	artOKComp  = "cc000000000000000000000000000003"
	artRadio   = "aa000000000000000000000000000004"
	artLemaitr = "cc000000000000000000000000000004"
)

func pic(kind, md5 string) string {
	return "https://cdn-images.dzcdn.net/images/" + kind + "/" + md5 + "/56x56-000000-80-0-0.jpg"
}

// answers are what the fake Deezer says, by path and what was searched for.
var answers = map[string]string{
	"/search/artist?thriller": `{"data":[
		{"id":390388,"name":"Thriller","nb_fan":323,"picture_small":"` + pic("artist", artThrill) + `"},
		{"id":296600541,"name":"Krimi und Thriller Hörbücher","nb_fan":5893,"picture_small":"https://cdn-images.dzcdn.net/images/artist//56x56-000000-80-0-0.jpg"}]}`,
	"/search/track?thriller": `{"data":[
		{"id":555639,"title":"Thriller","duration":357,"rank":942416,"md5_image":"` + artDeluxe + `",
		 "artist":{"id":259,"name":"Michael Jackson","picture_small":"` + pic("artist", artMJ) + `"},
		 "album":{"id":72819,"title":"Thriller 25 Super Deluxe Edition","md5_image":"` + artDeluxe + `"}},
		{"id":7,"title":"Moth To A Flame","duration":234,"rank":900000,"md5_image":"` + artAlbum + `",
		 "artist":{"id":8,"name":"Swedish House Mafia","picture_small":"` + pic("artist", artWeeknd) + `"},
		 "album":{"id":9,"title":"Paradise Again","md5_image":"` + artAlbum + `"}}]}`,
	"/search/album?thriller": `{"data":[
		{"id":96126,"title":"Thriller","record_type":"album","md5_image":"` + artAlbum + `","artist":{"id":259,"name":"Michael Jackson"}},
		{"id":49012482,"title":"Thriller (Steve Aoki Midnight Hour Remix)","record_type":"single","md5_image":"` + artDeluxe + `","artist":{"id":259,"name":"Michael Jackson"}},
		{"id":5,"title":"Now That's What I Call Thriller","record_type":"compile","artist":{"id":5080,"name":"Various Artists"}}]}`,
	"/search/artist?weeknd": `{"data":[
		{"id":11005292,"name":"Weeknd","nb_fan":2100},
		{"id":4050205,"name":"The Weeknd","nb_fan":14716046,"picture_small":"` + pic("artist", artWeeknd) + `"}]}`,
	"/search/track?weeknd": `{"data":[]}`,
	"/search/album?weeknd": `{"data":[]}`,
	"/search/track?bohemian rapsody": `{"data":[
		{"id":4091937401,"title":"Bohemian Rhapsody (Live Aid)","title_short":"Bohemian Rhapsody","title_version":"(Live Aid)","duration":354,"rank":958949,"md5_image":"` + artAlbum + `",
		 "artist":{"id":412,"name":"Queen"},"album":{"id":1,"title":"A Night At The Opera","md5_image":"` + artAlbum + `"}}]}`,
	"/search/artist?bohemian rapsody": `{"data":[{"id":279863,"name":"Bohemian Rhapsody","nb_fan":5368}]}`,
	"/search/album?bohemian rapsody":  `{"data":[]}`,
	"/search/track?ok computer": `{"data":[
		{"id":1442956262,"title":"Ok Computer","duration":200,"rank":99750,"md5_image":"` + artLemaitr + `",
		 "artist":{"id":3,"name":"Lemaitre"},"album":{"id":4,"title":"Ok Computer","md5_image":"` + artLemaitr + `"}}]}`,
	`/search/track?album:"ok computer"`: `{"data":[
		{"id":138539979,"title":"Let Down","duration":299,"rank":928986,"md5_image":"` + artOKComp + `",
		 "artist":{"id":399,"name":"Radiohead","picture_small":"` + pic("artist", artRadio) + `"},"album":{"id":14879699,"title":"OK Computer","md5_image":"` + artOKComp + `"}},
		{"id":138539981,"title":"Karma Police (Remastered)","title_short":"Karma Police","title_version":"(Remastered)","duration":264,"rank":898957,"md5_image":"` + artOKComp + `",
		 "artist":{"id":399,"name":"Radiohead"},"album":{"id":14879699,"title":"OK Computer","md5_image":"` + artOKComp + `"}},
		{"id":1,"title":"Some Other Song","duration":100,"rank":950000,"md5_image":"` + artOKComp + `",
		 "artist":{"id":2,"name":"Someone"},"album":{"id":3,"title":"Okay Computers Forever","md5_image":"` + artOKComp + `"}}]}`,
	"/search/artist?busy": `{"error":{"type":"Exception","message":"Quota limit exceeded","code":4}}`,
	"/search/album?busy":  `{"error":{"type":"Exception","message":"Quota limit exceeded","code":4}}`,
	"/search/track?busy":  `{"error":{"type":"Exception","message":"Quota limit exceeded","code":4}}`,
	"/artist/399":         `{"id":399,"name":"Radiohead","nb_fan":4099141,"picture_small":"` + pic("artist", artRadio) + `"}`,
	"/album/14879699":     `{"id":14879699,"title":"OK Computer","record_type":"album","md5_image":"` + artOKComp + `","artist":{"id":399,"name":"Radiohead"}}`,
	"/track/138539981":    `{"id":138539981,"title":"Karma Police","duration":264,"md5_image":"` + artOKComp + `","artist":{"id":399,"name":"Radiohead"},"album":{"id":14879699,"title":"OK Computer"}}`,
}

// fakeDeezer answers as Deezer's API and its picture server do, and counts
// what it was asked.
type fakeDeezer struct {
	ts       *httptest.Server
	mu       sync.Mutex
	asked    map[string]int
	pictures atomic.Int32
	// previews counts what was asked of the preview server; refuseOnce has it
	// turn the first signature away, as Deezer does one that ran out
	previews   atomic.Int32
	refuseOnce atomic.Bool
}

// song is thirty seconds of an mp3, near enough.
var song = append([]byte("ID3\x04"), bytes.Repeat([]byte{0xff, 0xfb, 0x90, 0x64}, 250)...)

func newFake(t *testing.T) *fakeDeezer {
	f := &fakeDeezer{asked: map[string]int{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/", func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.URL.Path, "/api")
		if strings.HasPrefix(key, "/search/") {
			// Deezer does not mind case
			key += "?" + strings.ToLower(r.URL.Query().Get("q"))
			if r.URL.Query().Get("limit") != "25" {
				http.Error(w, "limit", http.StatusBadRequest)
				return
			}
		}
		f.mu.Lock()
		f.asked[key]++
		f.mu.Unlock()
		// songs whose preview is wherever this fake is, signed for fifteen minutes
		signed := fmt.Sprintf("%s/preview/song.mp3?hdnea=exp=%d~acl=/preview/song.mp3*~hmac=ab12", f.ts.URL, time.Now().Add(15*time.Minute).Unix())
		switch key {
		case "/track/777":
			_, _ = io.WriteString(w, `{"id":777,"title":"Karma Police","duration":264,"preview":"`+signed+`","artist":{"id":399,"name":"Radiohead"}}`)
			return
		case "/track/778":
			_, _ = io.WriteString(w, `{"id":778,"title":"No Preview","preview":"","artist":{"id":1,"name":"Someone"}}`)
			return
		case "/track/779":
			_, _ = io.WriteString(w, `{"id":779,"title":"Elsewhere","preview":"https://example.com/song.mp3","artist":{"id":1,"name":"Someone"}}`)
			return
		}
		body, ok := answers[key]
		if !ok {
			body = `{"error":{"type":"DataException","message":"no data","code":800}}`
		}
		_, _ = io.WriteString(w, body)
	})
	mux.HandleFunc("GET /images/{kind}/{art}/{file}", func(w http.ResponseWriter, r *http.Request) {
		f.pictures.Add(1)
		if r.PathValue("art") != artOKComp {
			// Deezer sends a picture it does not have to a stand-in
			http.Redirect(w, r, "/images/cover/default.jpg", http.StatusFound)
			return
		}
		if r.PathValue("file") != "400x400-000000-80-0-0.jpg" && r.PathValue("file") != "120x120-000000-80-0-0.jpg" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte("\xff\xd8\xff\xe0 a jpeg, near enough"))
	})
	mux.HandleFunc("GET /preview/song.mp3", func(w http.ResponseWriter, r *http.Request) {
		f.previews.Add(1)
		if !strings.Contains(r.URL.RawQuery, "hmac=ab12") || f.refuseOnce.CompareAndSwap(true, false) {
			http.Error(w, "signature", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(song))
	})
	// over TLS, as Deezer is: a preview anywhere but https is refused
	f.ts = httptest.NewTLSServer(mux)
	t.Cleanup(f.ts.Close)
	return f
}

func (f *fakeDeezer) times(key string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.asked[key]
}

func (f *fakeDeezer) client(t *testing.T) *Client {
	c := New(t.TempDir())
	c.API = f.ts.URL + "/api"
	c.Images = f.ts.URL + "/images"
	c.PreviewHost = "127.0.0.1"
	c.HTTP.Transport = f.ts.Client().Transport
	return c
}

func names(list []Item) []string {
	out := make([]string, len(list))
	for i, it := range list {
		out[i] = it.Name
	}
	return out
}

func TestAnArtistIsFoundThroughTheirSong(t *testing.T) {
	c := newFake(t).client(t)
	got, err := c.Search(context.Background(), Artists, "  Thriller ")
	if err != nil {
		t.Fatal(err)
	}
	// the band named after the song comes after the one who made it, and a
	// song that matched only through someone featured on it brings nobody
	if strings.Join(names(got), "|") != "Michael Jackson|Thriller|Krimi und Thriller Hörbücher" {
		t.Fatalf("artists: %v", names(got))
	}
	mj := got[0]
	if mj.ID != "259" || mj.Art != artMJ || mj.Via == nil || mj.Via.Kind != "song" || mj.Via.Name != "Thriller" {
		t.Errorf("Michael Jackson: %+v %+v", mj, mj.Via)
	}
	if got[1].Fans != 323 || got[1].Via != nil || got[1].Art != artThrill {
		t.Errorf("the band: %+v", got[1])
	}
	// Deezer's stand-in for a missing picture is no picture
	if got[2].Art != "" {
		t.Errorf("stand-in kept: %+v", got[2])
	}
	// what a search brought is known, to save it without asking again
	if it, ok := c.Known(Artists, "259"); !ok || it.Name != "Michael Jackson" || it.Art != artMJ {
		t.Errorf("known: %+v %v", it, ok)
	}
}

func TestFansCountForMoreThanAnEarlierPlace(t *testing.T) {
	c := newFake(t).client(t)
	got, err := c.Search(context.Background(), Artists, "weeknd")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Name != "The Weeknd" || got[0].Fans != 14716046 {
		t.Fatalf("artists: %+v", got)
	}
}

func TestASlipOfTheFingersStillFindsIt(t *testing.T) {
	c := newFake(t).client(t)
	got, err := c.Search(context.Background(), Artists, "bohemian rapsody")
	if err != nil {
		t.Fatal(err)
	}
	// a live version keeps what it is
	if len(got) < 2 || got[0].Name != "Queen" || got[0].Via == nil || got[0].Via.Name != "Bohemian Rhapsody (Live Aid)" {
		t.Fatalf("artists: %+v", got)
	}
}

func TestAlbumsComeWithTheAlbumsOfTheirSongs(t *testing.T) {
	c := newFake(t).client(t)
	got, err := c.Search(context.Background(), Albums, "thriller")
	if err != nil {
		t.Fatal(err)
	}
	// the album of the song that matched, the album of that name, then the single
	if strings.Join(names(got), "|") != "Thriller 25 Super Deluxe Edition|Thriller|Thriller (Steve Aoki Midnight Hour Remix)|Now That's What I Call Thriller" {
		t.Fatalf("albums: %v", names(got))
	}
	if got[0].By != "Michael Jackson" || got[0].Art != artDeluxe || got[2].Record != "single" || got[3].Record != "compile" {
		t.Errorf("albums: %+v", got)
	}
	// an album that came with a song is not known by its own artist, so a save asks about it
	if _, ok := c.Known(Albums, "72819"); ok {
		t.Error("an album from a song was taken as known")
	}
	if it, ok := c.Known(Albums, "96126"); !ok || it.By != "Michael Jackson" {
		t.Errorf("known album: %+v %v", it, ok)
	}
}

func TestSongsAreFoundByTheirAlbum(t *testing.T) {
	f := newFake(t)
	c := f.client(t)
	got, err := c.Search(context.Background(), Songs, "OK Computer")
	if err != nil {
		t.Fatal(err)
	}
	// Radiohead's album's songs, which are played far more, then the song of
	// that name; one on an album only near the name is not one of them, and a
	// remastered one goes by its own name
	if strings.Join(names(got), "|") != "Let Down|Karma Police|Ok Computer" {
		t.Fatalf("songs: %v", names(got))
	}
	if s := got[1]; s.By != "Radiohead" || s.Album != "OK Computer" || s.Duration != 264 || s.Art != artOKComp {
		t.Errorf("Karma Police: %+v", s)
	}
	// the quotes of Deezer's own phrase cannot be broken out of: a quote typed
	// is dropped, which makes it the phrase already asked for
	if _, err := c.Search(context.Background(), Songs, `ok" computer`); err != nil {
		t.Fatal(err)
	}
	if f.times(`/search/track?album:"ok computer"`) != 1 || f.times(`/search/track?album:"ok" computer"`) != 0 {
		t.Errorf("phrase: %v", f.asked)
	}
}

func TestAnswersAreKeptForADay(t *testing.T) {
	f := newFake(t)
	c := f.client(t)
	ctx := context.Background()
	for _, kind := range []Kind{Artists, Albums, Artists} {
		if _, err := c.Search(ctx, kind, "Thriller"); err != nil {
			t.Fatal(err)
		}
	}
	// the artist and album searches both ask for the songs, once between them
	for _, key := range []string{"/search/artist?thriller", "/search/track?thriller", "/search/album?thriller"} {
		if n := f.times(key); n != 1 {
			t.Errorf("%s asked %d times", key, n)
		}
	}
}

func TestDeezerRefusingIsTheSearchFailing(t *testing.T) {
	c := newFake(t).client(t)
	if _, err := c.Search(context.Background(), Artists, "busy"); err == nil || !strings.Contains(err.Error(), "Quota") {
		t.Errorf("busy: %v", err)
	}
	// nothing typed is nothing found, without asking
	if got, err := c.Search(context.Background(), Songs, "   "); err != nil || got != nil {
		t.Errorf("empty: %v %v", got, err)
	}
}

func TestLookup(t *testing.T) {
	f := newFake(t)
	c := f.client(t)
	ctx := context.Background()
	song, err := c.Lookup(ctx, Songs, "138539981")
	if err != nil || song.Name != "Karma Police" || song.By != "Radiohead" || song.Duration != 264 || song.Art != artOKComp || song.Album != "" {
		t.Fatalf("song: %+v %v", song, err)
	}
	album, err := c.Lookup(ctx, Albums, "14879699")
	if err != nil || album.Name != "OK Computer" || album.By != "Radiohead" || album.Art != artOKComp {
		t.Fatalf("album: %+v %v", album, err)
	}
	artist, err := c.Lookup(ctx, Artists, "399")
	if err != nil || artist.Name != "Radiohead" || artist.Art != artRadio || artist.Fans != 0 {
		t.Fatalf("artist: %+v %v", artist, err)
	}
	// asked once, then known
	if _, err := c.Lookup(ctx, Artists, "399"); err != nil || f.times("/artist/399") != 1 {
		t.Errorf("asked again: %v %d", err, f.times("/artist/399"))
	}
	if _, err := c.Lookup(ctx, Albums, "123"); !errors.Is(err, ErrUnknown) {
		t.Errorf("unknown album: %v", err)
	}
	if _, err := c.Lookup(ctx, Albums, "../etc"); !errors.Is(err, ErrUnknown) || f.times("/album/../etc") != 0 {
		t.Errorf("odd id: %v", err)
	}
}

func TestPicturesAreFetchedOnceAndOnlyFromDeezer(t *testing.T) {
	f := newFake(t)
	c := f.client(t)
	ctx := context.Background()
	p, err := c.ArtFile(ctx, "cover", artOKComp, "l")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ArtFile(ctx, "cover", artOKComp, "l"); err != nil || f.pictures.Load() != 1 {
		t.Errorf("fetched again: %v %d", err, f.pictures.Load())
	}
	if _, err := c.ArtFile(ctx, "cover", artOKComp, "s"); err != nil || f.pictures.Load() != 2 {
		t.Errorf("small: %v %d", err, f.pictures.Load())
	}
	// a redirect to Deezer's stand-in is not the picture, and is not kept
	if _, err := c.ArtFile(ctx, "artist", artMJ, "s"); !errors.Is(err, ErrUnknown) {
		t.Errorf("stand-in: %v", err)
	}
	for _, bad := range [][3]string{{"cover", "../../../etc/passwd", "l"}, {"cover", artOKComp, "huge"}, {"profile", artOKComp, "l"}, {"cover", strings.ToUpper(artOKComp), "l"}} {
		if _, err := c.ArtFile(ctx, bad[0], bad[1], bad[2]); !errors.Is(err, ErrUnknown) {
			t.Errorf("%v: %v", bad, err)
		}
	}
	if f.pictures.Load() != 3 {
		t.Errorf("asked for odd pictures: %d", f.pictures.Load())
	}
}

func TestFoldAndMatch(t *testing.T) {
	for in, want := range map[string]string{
		"The Weeknd":                   "weeknd",
		"  Björk ":                     "bjork",
		"Simon & Garfunkel":            "simon and garfunkel",
		"AC/DC":                        "ac dc",
		"Bohemian Rhapsody (Live Aid)": "bohemian rhapsody live aid",
		"米津玄師":                         "米津玄師",
	} {
		if got := fold(in); got != want {
			t.Errorf("fold(%q) = %q, want %q", in, got, want)
		}
	}
	for _, c := range []struct {
		q, name string
		want    float64
	}{
		{"weeknd", "weeknd", 4},
		{"bohemian rhapsody", "bohemian rhapsody live aid", 3},
		{"queen bohemian rhapsody", "queen", 3},
		{"bohemian rapsody", "bohemian rhapsody", 3},
		{"bohemian rapsody", "bohemian rhapsody live aid", 2},
		{"night at the opera", "a night at the opera 2011 remaster", 2},
		{"a night at the opera", "a", 0},
		{"radiohead", "robert glasper", 0},
	} {
		if got := match(c.q, c.name); got != c.want {
			t.Errorf("match(%q, %q) = %v, want %v", c.q, c.name, got, c.want)
		}
	}
}

func TestPreviewsArePassedOnAsAsked(t *testing.T) {
	f := newFake(t)
	c := f.client(t)
	ctx := context.Background()
	read := func(id, span string) (int, string, []byte) {
		t.Helper()
		res, err := c.OpenPreview(ctx, id, span)
		if err != nil {
			t.Fatalf("%s %q: %v", id, span, err)
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		return res.StatusCode, res.Header.Get("Content-Range"), body
	}
	// the two bytes Safari asks for first, then the whole of it
	if code, span, body := read("777", "bytes=0-1"); code != 206 || span != fmt.Sprintf("bytes 0-1/%d", len(song)) || string(body) != "ID" {
		t.Errorf("range: %d %q %q", code, span, body)
	}
	if code, _, body := read("777", ""); code != 200 || !bytes.Equal(body, song) {
		t.Errorf("whole: %d %d bytes", code, len(body))
	}
	// one lookup while its signature lasts
	if n := f.times("/track/777"); n != 1 {
		t.Errorf("looked up %d times", n)
	}
	// a signature turned away is asked for again, once
	f.refuseOnce.Store(true)
	if code, _, body := read("777", ""); code != 200 || len(body) != len(song) {
		t.Errorf("after a refusal: %d %d", code, len(body))
	}
	if n := f.times("/track/777"); n != 2 {
		t.Errorf("looked up %d times after a refusal", n)
	}
	// a song with no preview, or one somewhere other than Deezer, has none here
	for _, id := range []string{"778", "779", "123", "../etc"} {
		if _, err := c.OpenPreview(ctx, id, ""); !errors.Is(err, ErrUnknown) {
			t.Errorf("%s: %v", id, err)
		}
	}
	if f.previews.Load() != 4 {
		t.Errorf("preview server asked %d times", f.previews.Load())
	}
}
