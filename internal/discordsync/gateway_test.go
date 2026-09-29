package discordsync

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"evilion.xyz/chat/internal/discordsync/fakediscord"
)

func fakeGateway(t *testing.T) (*fakediscord.Server, *Gateway, *[]string, *sync.Mutex) {
	t.Helper()
	fake := fakediscord.New()
	t.Cleanup(fake.Close)
	api := &rest{base: fake.API(), client: &http.Client{Timeout: 5 * time.Second}, bot: "bot-token"}
	var mu sync.Mutex
	events := []string{}
	g := &Gateway{
		Token:   "bot-token",
		Intents: IntentGuilds | IntentGuildMembers | IntentGuildPresences,
		URL:     api.gatewayURL,
		Log:     slog.New(slog.NewTextHandler(io.Discard, nil)),
		Dispatch: func(event string, _ json.RawMessage) {
			mu.Lock()
			events = append(events, event)
			mu.Unlock()
		},
	}
	return fake, g, &events, &mu
}

func waitEvents(t *testing.T, mu *sync.Mutex, events *[]string, want string, n int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		mu.Lock()
		count := strings.Count(strings.Join(*events, ","), want)
		mu.Unlock()
		if count >= n {
			return
		}
		if time.Now().After(deadline) {
			mu.Lock()
			defer mu.Unlock()
			t.Fatalf("waited for %d %s, saw %v", n, want, *events)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestGatewayResumesAfterADrop(t *testing.T) {
	fake, g, events, mu := fakeGateway(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = g.Run(ctx) }()
	waitEvents(t, mu, events, "READY", 1)
	// a drop Discord allows resuming from resumes rather than identifying again
	fake.Drop(4000)
	waitEvents(t, mu, events, "RESUMED", 1)
	if identifies, resumes := fake.Sessions(); identifies != 1 || resumes != 1 {
		t.Fatalf("identifies %d, resumes %d", identifies, resumes)
	}
	// one it does not (session timed out) identifies afresh
	fake.Drop(4009)
	waitEvents(t, mu, events, "READY", 2)
	if identifies, _ := fake.Sessions(); identifies != 2 {
		t.Fatalf("identifies %d", identifies)
	}
}

func TestGatewayStopsForGoodOnAWrongToken(t *testing.T) {
	_, g, _, _ := fakeGateway(t)
	g.Token = "wrong"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := g.Run(ctx)
	var fatal *FatalError
	if !errors.As(err, &fatal) || fatal.Code != websocket.StatusCode(4004) {
		t.Fatalf("want a fatal 4004, got %v", err)
	}
}

func TestWithQuery(t *testing.T) {
	for in, want := range map[string]string{
		"wss://gateway.discord.gg":            "wss://gateway.discord.gg/?encoding=json&v=10",
		"wss://gateway-us-east1-b.discord.gg": "wss://gateway-us-east1-b.discord.gg/?encoding=json&v=10",
		"ws://127.0.0.1:5000/gw":              "ws://127.0.0.1:5000/gw?encoding=json&v=10",
	} {
		if got := withQuery(in); got != want {
			t.Errorf("%s: %s", in, got)
		}
	}
}
