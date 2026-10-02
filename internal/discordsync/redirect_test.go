package discordsync

import (
	"context"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"evilion.xyz/chat/internal/discordsync/fakediscord"
)

func redirectService(api string, cfg Config) *Service {
	cfg.ClientID, cfg.ClientSecret, cfg.BotToken, cfg.API = "client-id", "client-secret", "bot-token", api
	return New(cfg, nil, nil, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

// Which callback Discord is asked to come back through, for someone starting
// at each of Nexa's addresses, from what Discord says it lists.
func TestRedirectIsOneDiscordLists(t *testing.T) {
	const own, alt, moved = "https://nexa.test", "https://alt.test", "https://old.test"
	cb := func(origin string) string { return origin + callbackPath }
	ctx := context.Background()
	fake := fakediscord.New()
	defer fake.Close()
	cfg := Config{PublicURL: own + "/", Origins: []string{own, alt, moved}}

	for _, c := range []struct {
		name   string
		listed []string
		back   string
		want   string
	}{
		{"where they started, when it is listed", []string{cb(own), cb(alt)}, alt, cb(alt)},
		{"Nexa's own, when where they started is not", []string{cb(moved), cb(own)}, alt, cb(own)},
		{"Nexa's own for nobody in particular", []string{cb(moved), cb(own)}, "", cb(own)},
		{"another address of Nexa's, when its own is not listed yet", []string{cb(moved)}, own, cb(moved)},
		{"the first of its other addresses that is listed", []string{cb(moved), cb(alt)}, own, cb(alt)},
		{"Nexa's own when nothing is listed", []string{}, alt, cb(own)},
		{"never somewhere that is not Nexa's", []string{"https://evil.example" + callbackPath}, "https://evil.example", cb(own)},
		{"as Discord has it written", []string{"https://Nexa.test" + callbackPath}, own, "https://Nexa.test" + callbackPath},
	} {
		fake.Redirects(c.listed...)
		s := redirectService(fake.API(), cfg)
		if got := s.redirectFor(ctx, c.back); got != c.want {
			t.Errorf("%s: %s, want %s", c.name, got, c.want)
		}
	}

	// named in chatd.env, it is that one whatever Discord lists
	fake.Redirects(cb(own))
	named := redirectService(fake.API(), Config{PublicURL: own, Origins: cfg.Origins, RedirectURL: cb(moved)})
	if got := named.redirectFor(ctx, alt); got != cb(moved) {
		t.Errorf("named: %s", got)
	}
	if r, listed, known := named.Redirect(ctx); r != cb(moved) || listed || !known {
		t.Errorf("named and not listed: %s listed %v known %v", r, listed, known)
	}
}

// Discord is asked again once its answer has aged, and an answer it cannot
// give leaves the last one standing.
func TestListedRedirectsAreAskedAgain(t *testing.T) {
	const own, moved = "https://nexa.test", "https://old.test"
	ctx := context.Background()
	fake := fakediscord.New()
	fake.Redirects(moved + callbackPath)
	s := redirectService(fake.API(), Config{PublicURL: own, Origins: []string{own, moved}})
	if got := s.redirectFor(ctx, own); got != moved+callbackPath {
		t.Fatalf("before the new address is listed: %s", got)
	}
	// the new address is listed in the Developer Portal: within the minute the old answer stands
	fake.Redirects(moved+callbackPath, own+callbackPath)
	if got := s.redirectFor(ctx, own); got != moved+callbackPath {
		t.Fatalf("within the minute: %s", got)
	}
	age := func(d time.Duration) {
		s.mu.Lock()
		s.listedAsked = s.listedAsked.Add(-d)
		s.mu.Unlock()
	}
	// whoever looks at the bot's settings sees it sooner
	age(listedTTLAdmin + time.Second)
	if r, listed, known := s.Redirect(ctx); r != own+callbackPath || !listed || !known {
		t.Fatalf("for an admin: %s listed %v known %v", r, listed, known)
	}
	if got := s.redirectFor(ctx, own); got != own+callbackPath {
		t.Fatalf("after it is listed: %s", got)
	}
	// Discord away: the last answer stands
	fake.Close()
	age(listedTTL + time.Second)
	if got := s.redirectFor(ctx, own); got != own+callbackPath {
		t.Fatalf("with Discord away: %s", got)
	}
	if _, listed, known := s.Redirect(ctx); !listed || !known {
		t.Fatalf("with Discord away: listed %v known %v", listed, known)
	}
}

// Before Discord has ever answered, the callback is the one under Nexa's own
// address, and nothing is said about whether it is listed.
func TestRedirectBeforeDiscordAnswers(t *testing.T) {
	gone := httptest.NewServer(nil)
	api := gone.URL + "/api/v10"
	gone.Close()
	s := redirectService(api, Config{PublicURL: "https://nexa.test", Origins: []string{"https://nexa.test", "https://old.test"}})
	r, listed, known := s.Redirect(context.Background())
	if r != "https://nexa.test"+callbackPath || listed || known {
		t.Fatalf("%s listed %v known %v", r, listed, known)
	}
}
