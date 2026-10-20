package api

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"evilion.xyz/chat/internal/unfurl"
)

// A GIF picked in the app's search is sealed with one of our own proxy paths;
// bot libraries parse embed addresses as absolute URLs, as Discord's always are.
func TestLinkEmbedVideoIsAbsolute(t *testing.T) {
	s, _ := newTestServer(t)
	s.Cfg.PublicURL = "https://nexa.example"
	b := s.builder(context.Background(), nil, nil)
	e := b.linkEmbed(unfurl.Result{URL: "/media/proxy/1-sig/aHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL3guZ2lm", Type: "gif",
		Media: "/media/proxy/1-sig/aHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL3guZ2lm", Image: "/media/proxy/1-sig/aHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL3guZ2lm", MediaKind: "video"})
	for _, u := range []string{e.URL, e.Thumbnail.URL, e.Thumbnail.ProxyURL, e.Video.URL, e.Video.ProxyURL} {
		if !strings.HasPrefix(u, "https://nexa.example/media/proxy/") {
			t.Fatalf("embed address %q is not absolute", u)
		}
	}
}

// A server restart tells a bot to reconnect, as Discord does; Authentication
// failed would make its library give up until someone starts it again.
func TestBotGatewayRestartAsksForReconnect(t *testing.T) {
	s, ts := newTestServer(t)
	owner, _ := register(t, ts, "owner")
	_, botToken := makeApp(t, ts, owner, "Restarter")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/bot-gateway?v=10&encoding=json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	read := func() map[string]any {
		_, b, err := c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		return m
	}
	read() // hello
	id, _ := json.Marshal(map[string]any{"op": 2, "d": map[string]any{"token": botToken, "intents": 0,
		"properties": map[string]any{"os": "linux", "browser": "t", "device": "t"}}})
	if err := c.Write(ctx, websocket.MessageText, id); err != nil {
		t.Fatal(err)
	}
	for m := read(); m["t"] != "READY"; m = read() {
	}
	s.hub.CloseAll(websocket.StatusGoingAway, "server restarting")
	for {
		_, b, err := c.Read(ctx)
		if err != nil {
			if code := websocket.CloseStatus(err); code != 4000 {
				t.Fatalf("closed with %d (%v), want 4000 after op 7", code, err)
			}
			return
		}
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		if m["op"] == float64(7) {
			continue
		}
	}
}
