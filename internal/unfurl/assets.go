package unfurl

// Files that move.
//
// TikTok, Instagram, Threads and Telegram sign the addresses of their
// pictures and videos, and a signature lasts hours or days. A card lives
// inside its message for good, so an address copied into it would be a broken
// picture by next week. For these sites a card holds a name instead: the
// post's own address with "#nexa-asset=m0" after it, "the first file of that
// post". The media proxy asks Asset where that file is today, which reads the
// post again (and keeps it a while, since a video is fetched in many pieces)
// and answers with the address the site gives now.

import (
	"context"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// assetMark starts the fragment that makes an address a name.
const assetMark = "nexa-asset="

// assetTTL is how long a post read for its files is kept. Shorter than any
// of these sites' signatures, long enough to watch a video through.
const assetTTL = 20 * time.Minute

func assetName(post, name string) string { return post + "#" + assetMark + name }

// named is the post with every file's address replaced by its name under
// link, the post's own address.
func (p *Post) named(link string) *Post { return p.namedAs(link, "") }

func (p *Post) namedAs(link, prefix string) *Post {
	out := *p
	if out.Avatar != "" {
		out.Avatar = assetName(link, prefix+"avatar")
	}
	if len(p.Media) > 0 {
		out.Media = make([]PostMedia, len(p.Media))
		for i, m := range p.Media {
			n := strconv.Itoa(i)
			if m.URL != "" {
				m.URL = assetName(link, prefix+"m"+n)
			}
			if m.Thumb != "" {
				m.Thumb = assetName(link, prefix+"t"+n)
			}
			if m.Audio != "" {
				m.Audio = assetName(link, prefix+"a"+n)
			}
			out.Media[i] = m
		}
	}
	if p.Quote != nil {
		out.Quote = p.Quote.namedAs(link, prefix+"q.")
	}
	return &out
}

// file is the address a name stands for in this post, or "".
func (p *Post) file(name string) string {
	if rest, ok := strings.CutPrefix(name, "q."); ok {
		if p.Quote == nil {
			return ""
		}
		return p.Quote.file(rest)
	}
	if name == "avatar" {
		return p.Avatar
	}
	if len(name) < 2 {
		return ""
	}
	i, err := strconv.Atoi(name[1:])
	if err != nil || i < 0 || i >= len(p.Media) {
		return ""
	}
	switch name[0] {
	case 'm':
		return p.Media[i].URL
	case 't':
		return p.Media[i].Thumb
	case 'a':
		return p.Media[i].Audio
	}
	return ""
}

// Asset is where a named file is now, and what to send when asking for it.
type Asset struct {
	URL    *url.URL
	Header map[string]string
}

// flight is one reading of a post that others asking for it wait on.
type flight struct {
	done chan struct{}
	post *Post
}

// Asset answers for a name in a card. named is false when target is an
// ordinary address, to be fetched as it stands; for a name, the error says
// that the file could not be found today.
func (s *Service) Asset(ctx context.Context, target *url.URL) (asset *Asset, named bool, err error) {
	if target == nil {
		return nil, false, nil
	}
	name, ok := strings.CutPrefix(target.Fragment, assetMark)
	if !ok {
		return nil, false, nil
	}
	link := *target
	link.Fragment, link.RawFragment = "", ""
	ref := postRefOf(&link)
	if ref == nil || ref.short != nil || s.Fetcher == nil {
		return nil, true, ErrUnsupported
	}
	p := s.livePost(ctx, ref)
	if p == nil {
		return nil, true, ErrUnsupported
	}
	u, err := url.Parse(p.file(name))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, true, ErrUnsupported
	}
	a := &Asset{URL: u}
	if ref.platform == "tiktok" {
		// TikTok's file servers answer a browser that came from TikTok
		a.Header = map[string]string{"User-Agent": browserUA, "Referer": "https://www.tiktok.com/"}
	}
	return a, true, nil
}

// livePost is a post as its site gives it now, with the addresses its files
// have today. One reading serves everyone asking while it is under way, and
// everyone after for assetTTL.
func (s *Service) livePost(ctx context.Context, ref *postRef) *Post {
	key := ref.link()
	s.mu.Lock()
	if s.posts == nil {
		s.posts = NewCache(500, assetTTL)
		s.flights = map[string]*flight{}
	}
	if r, _, ok := s.posts.Get(key); ok && r != nil {
		s.mu.Unlock()
		return r.Post
	}
	if fl, ok := s.flights[key]; ok {
		s.mu.Unlock()
		select {
		case <-fl.done:
			return fl.post
		case <-ctx.Done():
			return nil
		}
	}
	fl := &flight{done: make(chan struct{})}
	s.flights[key] = fl
	s.mu.Unlock()

	// not the asker's context: the others waiting should not lose the post
	// because the first to ask went away
	rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.Fetcher.timeout())
	fl.post, _ = s.Fetcher.readPost(rctx, ref)
	cancel()

	s.mu.Lock()
	delete(s.flights, key)
	if fl.post != nil {
		s.posts.Put(key, &Result{Post: fl.post}, nil)
	}
	s.mu.Unlock()
	close(fl.done)
	return fl.post
}
