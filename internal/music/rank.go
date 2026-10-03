package music

import (
	"context"
	"math"
	"sort"
	"strings"
	"sync"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// How a search is ranked. Deezer finds things by their names well, and knows
// other names and spellings for them, but each of its lists holds one kind of
// thing: a song's title typed into its artist search finds bands named after
// the song, not who made it. So a search asks every list that could hold the
// answer, and scores each thing it finds on three counts:
//
//   - where Deezer put it, which is how its aliases and spellings count,
//   - how closely its name matches what was typed, and
//   - how popular it is: an artist's fans, a song's rank on Deezer.
//
// Typing "thriller" in the artist search finds a band called Thriller and,
// through the song, Michael Jackson, whose song is far better known; typing
// "ok computer" in the song search finds the songs on Radiohead's album.

const (
	// how much popularity counts for, against a name's match (0 to 4) and a place in a list (0 to 4)
	famed = 1.5
	// an album's popularity, which Deezer's album search does not say
	albumFame = 4.5
	// a song found because it is on an album named what was typed counts this much less than one named it
	onAlbum = 2
	// what a single gives up in the album search, where the albums are what is wanted
	single = 1
)

// placed is what a place in one of Deezer's lists is worth: something for the first four.
func placed(i int) float64 {
	return math.Max(0, 4-float64(i))
}

// fame is an artist's fans on a scale of about 0 to 7.5.
func fame(fans int64) float64 {
	return math.Log10(1 + float64(max(fans, 0)))
}

// rankFame is a song's rank on Deezer (0 to a million) on the same scale:
// the songs below a few hundred thousand are the ones few play.
func rankFame(rank int64) float64 {
	return 7.5 * math.Min(1, math.Max(0, (float64(rank)-300_000)/700_000))
}

// fold is a name the way it is matched: lower case, without accents or
// punctuation, single spaces, and without a leading "the".
func fold(s string) string {
	var b strings.Builder
	space := false
	for _, r := range norm.NFD.String(s) {
		switch {
		case unicode.Is(unicode.Mn, r):
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			if space && b.Len() > 0 {
				b.WriteByte(' ')
			}
			space = false
			b.WriteRune(unicode.ToLower(r))
		case r == '&':
			if b.Len() > 0 {
				b.WriteString(" and")
			}
			space = true
		default:
			space = true
		}
	}
	return strings.TrimPrefix(b.String(), "the ")
}

// match is how closely a name matches what was typed, both folded: 4 for the
// same, 3 for one starting with the other or the same but for a slip of the
// fingers, 2 for one holding the other as whole words, else 0. A name inside
// what was typed must be three letters or more, or every "A" would match.
func match(q, name string) float64 {
	if q == "" || name == "" {
		return 0
	}
	if q == name {
		return 4
	}
	inside := len([]rune(name)) >= 3
	switch {
	case strings.HasPrefix(name, q+" ") || (inside && strings.HasPrefix(q, name+" ")):
		return 3
	case typo(q, name):
		return 3
	case strings.Contains(" "+name+" ", " "+q+" ") || (inside && strings.Contains(" "+q+" ", " "+name+" ")):
		return 2
	case typo(q, opening(name, strings.Count(q, " ")+1)):
		// the slip in a name that goes on: "bohemian rapsody" for "Bohemian Rhapsody (Live Aid)"
		return 2
	}
	return 0
}

// opening is the first n words of a name.
func opening(name string, n int) string {
	words := strings.Fields(name)
	if len(words) <= n {
		return ""
	}
	return strings.Join(words[:n], " ")
}

// typo says whether two names differ by about a letter in every six: one
// missed, one too many, one swapped for another.
func typo(a, b string) bool {
	x, y := []rune(a), []rune(b)
	if len(x) < 4 || len(y) < 4 || len(x) > 80 || len(y) > 80 {
		return false
	}
	most := max(1, len(x)/6)
	if d := len(x) - len(y); d > most || -d > most {
		return false
	}
	// the edit distance, a row at a time
	prev, cur := make([]int, len(y)+1), make([]int, len(y)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(x); i++ {
		cur[0] = i
		for j := 1; j <= len(y); j++ {
			cost := 1
			if x[i-1] == y[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev, cur = cur, prev
	}
	return prev[len(y)] <= most
}

// workMatch is how a song or an album matches by its title (alone, or with
// its artist's name before or after it) and by its artist's name alone.
func workMatch(q string, it Item) (title, by float64) {
	t, a := fold(it.Name), fold(it.By)
	title = match(q, t)
	if a != "" {
		title = max(title, match(q, t+" "+a), match(q, a+" "+t))
	}
	return title, match(q, a)
}

// a candidate is one thing a search could give back, scored as it was best found.
type candidate struct {
	item  Item
	score float64
	first int
}

// ranking gathers what a search finds under what makes two of them the same.
type ranking struct {
	by map[string]*candidate
}

func newRanking() *ranking {
	return &ranking{by: map[string]*candidate{}}
}

// offer puts something found in the running, or scores it again if it was
// found already. The way it scored best is the one kept, with what any other
// way knew that it does not (an artist's fans, a picture).
func (r *ranking) offer(key string, it Item, score float64) {
	if it.ID == "" || it.Name == "" {
		return
	}
	c, ok := r.by[key]
	if !ok {
		r.by[key] = &candidate{item: it, score: score, first: len(r.by)}
		return
	}
	keep, other := c.item, it
	if score > c.score {
		keep, other = it, c.item
		c.score = score
	}
	keep.Fans = max(keep.Fans, other.Fans)
	if keep.Art == "" {
		keep.Art = other.Art
	}
	c.item = keep
}

// top is the best of what was found, best first; even scores keep the order found.
func (r *ranking) top(n int) []Item {
	list := make([]*candidate, 0, len(r.by))
	for _, c := range r.by {
		list = append(list, c)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].score != list[j].score {
			return list[i].score > list[j].score
		}
		return list[i].first < list[j].first
	})
	out := make([]Item, 0, min(n, len(list)))
	for _, c := range list[:min(n, len(list))] {
		out = append(out, c.item)
	}
	return out
}

// Search finds artists, albums or songs for what was typed, best first.
// Deezer's answers are kept for a day.
func (c *Client) Search(ctx context.Context, kind Kind, q string) ([]Item, error) {
	q = strings.Join(strings.Fields(q), " ")
	if r := []rune(q); len(r) > 80 {
		q = string(r[:80])
	}
	if q == "" {
		return nil, nil
	}
	fq := fold(q)
	switch kind {
	case Artists:
		return c.searchArtists(ctx, q, fq)
	case Albums:
		return c.searchAlbums(ctx, q, fq)
	case Songs:
		return c.searchSongs(ctx, q, fq)
	}
	return nil, ErrUnknown
}

// asked is what each of Deezer's lists said, asked at once. One failing
// leaves the others; all of them failing is the search failing.
type asked struct {
	artists       []dzArtist
	albums        []dzAlbum
	tracks        []dzTrack
	tracksOnAlbum []dzTrack
}

func (c *Client) ask(ctx context.Context, q string, artists, albums, tracks, onAlbum bool) (asked, error) {
	var (
		out  asked
		wg   sync.WaitGroup
		mu   sync.Mutex
		errs []error
		n    int
	)
	run := func(f func() error) {
		n++
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := f(); err != nil {
				mu.Lock()
				errs = append(errs, err)
				mu.Unlock()
			}
		}()
	}
	if artists {
		run(func() (err error) { out.artists, err = list[dzArtist](ctx, c, "artist", q); return })
	}
	if albums {
		run(func() (err error) { out.albums, err = list[dzAlbum](ctx, c, "album", q); return })
	}
	if tracks {
		run(func() (err error) { out.tracks, err = list[dzTrack](ctx, c, "track", q); return })
	}
	if onAlbum {
		// Deezer's own way of asking for the songs on an album of that name
		phrase := `album:"` + strings.ReplaceAll(q, `"`, "") + `"`
		run(func() (err error) { out.tracksOnAlbum, err = list[dzTrack](ctx, c, "track", phrase); return })
	}
	wg.Wait()
	if len(errs) == n {
		return out, errs[0]
	}
	if len(errs) > 0 {
		c.Log.Warn("deezer search, in part", "err", errs[0])
	}
	return out, nil
}

// Deezer's artist for compilations, which is nobody to put on a profile
const variousArtists = "various artists"

func (c *Client) searchArtists(ctx context.Context, q, fq string) ([]Item, error) {
	got, err := c.ask(ctx, q, true, true, true, false)
	if err != nil {
		return nil, err
	}
	r := newRanking()
	for i, a := range got.artists {
		it := a.item()
		r.offer(it.ID, it, placed(i)+match(fq, fold(it.Name))+famed*fame(a.Fans))
	}
	// whoever made a song or an album that matched: by their name, or through
	// it. One that matched neither way was found for someone else on it (a
	// song they are featured on), who is not the one it brings.
	through := func(i int, artist *dzArtist, work Item, kind string, popular float64) {
		if artist == nil {
			return
		}
		it := artist.item()
		if fold(it.Name) == variousArtists {
			return
		}
		title, by := workMatch(fq, work)
		m := by
		if title > by {
			m = title
			it.Via = &Via{Kind: kind, Name: work.Name}
		}
		if m == 0 {
			return
		}
		r.offer(it.ID, it, placed(i)+m+famed*popular)
	}
	for i, t := range got.tracks {
		through(i, t.Artist, t.item(), "song", rankFame(t.Rank))
	}
	for i, a := range got.albums {
		through(i, a.Artist, a.item(""), "album", albumFame)
	}
	out := r.top(maxAnswered)
	c.remember(Artists, out...)
	return out, nil
}

func (c *Client) searchAlbums(ctx context.Context, q, fq string) ([]Item, error) {
	got, err := c.ask(ctx, q, false, true, true, false)
	if err != nil {
		return nil, err
	}
	r := newRanking()
	// the same album twice (a clean and an explicit one, an edition for a country) is shown once
	key := func(it Item) string { return fold(it.Name) + "\x00" + fold(it.By) }
	found := make([]Item, 0, len(got.albums))
	for i, a := range got.albums {
		it := a.item("")
		title, by := workMatch(fq, it)
		score := placed(i) + max(title, by) + famed*albumFame
		if it.Record == "single" {
			score -= single
		}
		r.offer(key(it), it, score)
		found = append(found, it)
	}
	// the album a song that matched is on, its artist standing in for the album's
	for i, t := range got.tracks {
		if t.Album == nil {
			continue
		}
		song := t.item()
		it := t.Album.item(song.By)
		title, by := workMatch(fq, song)
		if max(title, by) == 0 {
			continue
		}
		score := placed(i) + max(title, by) + famed*rankFame(t.Rank)
		// a song on an album of its own name is most likely a single
		if fold(it.Name) == fold(song.Name) {
			score -= single
		}
		r.offer(key(it), it, score)
	}
	// only albums Deezer's album search gave are known by their own artist
	c.remember(Albums, found...)
	return r.top(maxAnswered), nil
}

func (c *Client) searchSongs(ctx context.Context, q, fq string) ([]Item, error) {
	got, err := c.ask(ctx, q, false, false, true, true)
	if err != nil {
		return nil, err
	}
	r := newRanking()
	// one song on several albums is shown once, as the version that scored best
	key := func(it Item) string { return fold(it.Name) + "\x00" + fold(it.By) }
	for i, t := range got.tracks {
		it := t.item()
		title, by := workMatch(fq, it)
		r.offer(key(it), it, placed(i)+max(title, by)+famed*rankFame(t.Rank))
	}
	for i, t := range got.tracksOnAlbum {
		it := t.item()
		// Deezer finds albums loosely here; only one named just what was typed counts
		if fold(it.Album) != fq {
			continue
		}
		r.offer(key(it), it, placed(i)+4-onAlbum+famed*rankFame(t.Rank))
	}
	out := r.top(maxAnswered)
	c.remember(Songs, out...)
	return out, nil
}
