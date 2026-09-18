// Package cache is the shared state chatd keeps outside the database when
// there is more than one of it: who is online, how often someone has asked for
// something, and the events one process has to hand to the others.
//
// None of it is worth a row in a table. Presence changes every few seconds and
// is worthless a minute after it is written; a rate limit is a counter that
// expires; an event has one moment to reach a socket and is then gone. Redis
// holds all three well, and with no Redis configured each one falls back to
// this process's own memory — which is exactly right while there is only one.
package cache

import (
	"context"
	"errors"
	"time"
)

// ErrNotSupported is returned by a backend that cannot do what was asked.
var ErrNotSupported = errors.New("not supported by this backend")

// Cache is what chatd needs from shared state.
type Cache interface {
	// Online marks a user as connected to this process for ttl. Calling it
	// again refreshes the mark, which is how a process says it is still there.
	Online(ctx context.Context, userID, node string, ttl time.Duration) error
	// Offline drops one process's mark; the user is still online if another
	// process holds one.
	Offline(ctx context.Context, userID, node string) error
	// IsOnline says whether any process holds a mark for this user.
	IsOnline(ctx context.Context, userID string) (bool, error)
	// OnlineAmong filters a list down to those that are online, in one round
	// trip rather than one per user.
	OnlineAmong(ctx context.Context, userIDs []string) (map[string]bool, error)

	// Allow is a token bucket shared by every process: n per window for key.
	Allow(ctx context.Context, key string, n int, window time.Duration) (bool, time.Duration, error)
	// ResetRate forgets a key's count, so a successful login clears the
	// failures before it wherever the counting happens.
	ResetRate(ctx context.Context, key string) error

	// Publish hands an event to every process, including this one.
	Publish(ctx context.Context, channel string, payload []byte) error
	// Subscribe delivers what other processes publish until ctx ends.
	Subscribe(ctx context.Context, channel string, fn func(payload []byte)) error

	// Close lets go of whatever it holds.
	Close() error
}

// Open returns the cache for a Redis URL, or the in-process one when the URL
// is empty. A URL that cannot be reached is an error rather than a quiet
// fallback: running several processes against separate memories would lose
// presence and let rate limits through, and nobody would notice.
func Open(url string) (Cache, error) {
	if url == "" {
		return NewMemory(), nil
	}
	return NewRedis(url)
}
