package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis is the shared state when several chatd processes serve one Nexa.
//
// Presence is a set per user holding the processes that see them, each member
// with its own expiry, so a process that dies stops counting on its own rather
// than leaving someone online forever. Rate limits are counters with a TTL,
// incremented and expired in one round trip. Events are plain pub/sub: one
// process publishes, every process hands it to whichever sockets it holds.
type Redis struct {
	client *redis.Client
	prefix string
}

func NewRedis(url string) (*Redis, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("redis url: %w", err)
	}
	client := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		client.Close()
		return nil, fmt.Errorf("redis: %w", err)
	}
	return &Redis{client: client, prefix: "chatd:"}, nil
}

func (r *Redis) key(parts ...string) string {
	out := r.prefix
	for i, p := range parts {
		if i > 0 {
			out += ":"
		}
		out += p
	}
	return out
}

// Presence is a sorted set of process names scored by when each mark runs out,
// so a process that dies stops counting without anything having to sweep.
//
// The clock is Redis's own, read inside the script, never the caller's: several
// chatd processes will not have exactly the same time, and they must not
// disagree about who is online.
var onlineScript = redis.NewScript(`
local t = redis.call("TIME")
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call("ZADD", KEYS[1], now + tonumber(ARGV[1]), ARGV[2])
redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[1]) * 2)
return 1
`)

// aliveScript drops the marks that have run out and returns how many are left,
// for as many users as it is given, in one round trip.
var aliveScript = redis.NewScript(`
local t = redis.call("TIME")
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local out = {}
for i = 1, #KEYS do
  redis.call("ZREMRANGEBYSCORE", KEYS[i], "-inf", "(" .. now)
  out[i] = redis.call("ZCARD", KEYS[i])
end
return out
`)

func (r *Redis) Online(ctx context.Context, userID, node string, ttl time.Duration) error {
	return onlineScript.Run(ctx, r.client, []string{r.key("online", userID)}, ttl.Milliseconds(), node).Err()
}

func (r *Redis) Offline(ctx context.Context, userID, node string) error {
	return r.client.ZRem(ctx, r.key("online", userID), node).Err()
}

func (r *Redis) IsOnline(ctx context.Context, userID string) (bool, error) {
	n, err := r.aliveCount(ctx, userID)
	return n > 0, err
}

func (r *Redis) aliveCount(ctx context.Context, userID string) (int64, error) {
	counts, err := r.aliveCounts(ctx, []string{userID})
	if err != nil || len(counts) == 0 {
		return 0, err
	}
	return counts[0], nil
}

func (r *Redis) aliveCounts(ctx context.Context, userIDs []string) ([]int64, error) {
	keys := make([]string, len(userIDs))
	for i, id := range userIDs {
		keys[i] = r.key("online", id)
	}
	res, err := aliveScript.Run(ctx, r.client, keys).Result()
	if err != nil {
		return nil, err
	}
	list, ok := res.([]any)
	if !ok {
		return nil, fmt.Errorf("redis: unexpected reply %v", res)
	}
	out := make([]int64, len(list))
	for i, v := range list {
		n, _ := v.(int64)
		out[i] = n
	}
	return out, nil
}

func (r *Redis) OnlineAmong(ctx context.Context, userIDs []string) (map[string]bool, error) {
	out := make(map[string]bool, len(userIDs))
	if len(userIDs) == 0 {
		return out, nil
	}
	counts, err := r.aliveCounts(ctx, userIDs)
	if err != nil {
		return nil, err
	}
	for i, id := range userIDs {
		if i < len(counts) && counts[i] > 0 {
			out[id] = true
		}
	}
	return out, nil
}

// allowScript is one round trip: count this attempt, set the window's life the
// first time, and say how long is left when the count is over.
var allowScript = redis.NewScript(`
local n = redis.call("INCR", KEYS[1])
if n == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
if n > tonumber(ARGV[1]) then
  return {0, redis.call("PTTL", KEYS[1])}
end
return {1, 0}
`)

func (r *Redis) Allow(ctx context.Context, key string, n int, window time.Duration) (bool, time.Duration, error) {
	res, err := allowScript.Run(ctx, r.client, []string{r.key("rate", key)}, n, window.Milliseconds()).Result()
	if err != nil {
		return false, 0, err
	}
	vals, ok := res.([]any)
	if !ok || len(vals) != 2 {
		return false, 0, fmt.Errorf("redis: unexpected reply %v", res)
	}
	allowed, _ := vals[0].(int64)
	ms, _ := vals[1].(int64)
	if ms < 0 {
		ms = window.Milliseconds()
	}
	return allowed == 1, time.Duration(ms) * time.Millisecond, nil
}

// ResetRate forgets a key's count, for the successful login that clears the
// failures before it.
func (r *Redis) ResetRate(ctx context.Context, key string) error {
	return r.client.Del(ctx, r.key("rate", key)).Err()
}

func (r *Redis) Publish(ctx context.Context, channel string, payload []byte) error {
	return r.client.Publish(ctx, r.key("ev", channel), payload).Err()
}

func (r *Redis) Subscribe(ctx context.Context, channel string, fn func([]byte)) error {
	sub := r.client.Subscribe(ctx, r.key("ev", channel))
	if _, err := sub.Receive(ctx); err != nil {
		sub.Close()
		return err
	}
	go func() {
		defer sub.Close()
		ch := sub.Channel()
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				fn([]byte(msg.Payload))
			}
		}
	}()
	return nil
}

func (r *Redis) Close() error { return r.client.Close() }
