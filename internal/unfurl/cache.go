package unfurl

import (
	"container/list"
	"context"
	"errors"
	"sync"
	"time"
)

type cacheEntry struct {
	key     string
	res     *Result
	err     error
	expires time.Time
}

// Cache is an LRU with TTL. Successful results and the stable negative
// outcomes (ErrUnsupported, ErrBlocked) are cached; transient errors are not.
type Cache struct {
	mu   sync.Mutex
	size int
	ttl  time.Duration
	ll   *list.List
	m    map[string]*list.Element
	now  func() time.Time
}

// NewCache creates a cache holding up to size entries for ttl (0 = forever).
func NewCache(size int, ttl time.Duration) *Cache {
	if size <= 0 {
		size = 1
	}
	return &Cache{size: size, ttl: ttl, ll: list.New(), m: map[string]*list.Element{}, now: time.Now}
}

func cacheable(err error) bool {
	return err == nil || errors.Is(err, ErrUnsupported) || errors.Is(err, ErrBlocked)
}

// Put stores an outcome when it is cacheable.
func (c *Cache) Put(key string, r *Result, err error) {
	if !cacheable(err) {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	var expires time.Time
	if c.ttl > 0 {
		expires = c.now().Add(c.ttl)
	}
	if el, ok := c.m[key]; ok {
		e := el.Value.(*cacheEntry)
		e.res, e.err, e.expires = r, err, expires
		c.ll.MoveToFront(el)
		return
	}
	el := c.ll.PushFront(&cacheEntry{key: key, res: r, err: err, expires: expires})
	c.m[key] = el
	for c.ll.Len() > c.size {
		last := c.ll.Back()
		c.ll.Remove(last)
		delete(c.m, last.Value.(*cacheEntry).key)
	}
}

// Get returns a cached outcome; ok is false on a miss or an expired entry.
func (c *Cache) Get(key string) (*Result, error, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.m[key]
	if !ok {
		return nil, nil, false
	}
	e := el.Value.(*cacheEntry)
	if !e.expires.IsZero() && !c.now().Before(e.expires) {
		c.ll.Remove(el)
		delete(c.m, key)
		return nil, nil, false
	}
	c.ll.MoveToFront(el)
	return e.res, e.err, true
}

// Len returns the number of entries (expired ones included until touched).
func (c *Cache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ll.Len()
}

// Service ties a Fetcher to a Cache.
type Service struct {
	Fetcher *Fetcher
	Cache   *Cache

	// Posts read for their files (assets.go): kept a while, and read once
	// however many ask at the same moment.
	mu      sync.Mutex
	posts   *Cache
	flights map[string]*flight
	seeding sync.Once
}

// NewService returns production defaults: 6 s, 2 MiB, 2000 entries for 1 h.
func NewService() *Service {
	return &Service{Fetcher: &Fetcher{Timeout: 6 * time.Second, MaxBytes: 2 << 20, UserAgent: defaultUserAgent}, Cache: NewCache(2000, time.Hour)}
}

// MediaFetcher is a looser fetcher for streaming media through the proxy: the
// same SSRF guard, but a longer timeout and no small byte budget.
func (s *Service) MediaFetcher() *Fetcher {
	base := s.Fetcher
	f := &Fetcher{Timeout: 20 * time.Second, MaxBytes: 25 << 20, UserAgent: defaultUserAgent}
	if base != nil {
		f.Resolver = base.Resolver
		f.Transport = base.Transport
		if base.UserAgent != "" {
			f.UserAgent = base.UserAgent
		}
	}
	return f
}

// keep remembers a post just read for its card, so the files the card names
// are found without reading it again.
func (s *Service) keep(ref *postRef, p *Post) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.posts == nil {
		s.posts = NewCache(500, assetTTL)
		s.flights = map[string]*flight{}
	}
	s.posts.Put(ref.link(), &Result{Post: p}, nil)
}

// Lookup returns the cached outcome for rawURL or fetches it.
func (s *Service) Lookup(ctx context.Context, rawURL string) (*Result, error) {
	s.seeding.Do(func() {
		if s.Fetcher != nil && s.Fetcher.seen == nil {
			s.Fetcher.seen = s.keep
		}
	})
	if s.Cache != nil {
		if r, err, ok := s.Cache.Get(rawURL); ok {
			return r, err
		}
	}
	r, err := s.Fetcher.Fetch(ctx, rawURL)
	if s.Cache != nil {
		s.Cache.Put(rawURL, r, err)
	}
	return r, err
}
