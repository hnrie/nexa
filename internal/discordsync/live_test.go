//go:build discordlive

package discordsync

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"testing"
	"time"
)

// TestLiveGateway connects to the real Discord with the bot in
// DISCORD_BOT_TOKEN and checks the whole start: identify with the privileged
// intents, READY, the activity server, and its members with their presence.
//
//	DISCORD_BOT_TOKEN=... go test -tags discordlive -run TestLiveGateway -v ./internal/discordsync/
func TestLiveGateway(t *testing.T) {
	token := os.Getenv("DISCORD_BOT_TOKEN")
	if token == "" {
		t.Skip("DISCORD_BOT_TOKEN is not set")
	}
	api := &rest{base: DefaultAPI, client: &http.Client{Timeout: 20 * time.Second}, bot: token}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	got := map[string]json.RawMessage{}
	done := make(chan struct{})
	var g *Gateway
	g = &Gateway{
		Token:   token,
		Intents: IntentGuilds | IntentGuildMembers | IntentGuildPresences,
		URL:     api.gatewayURL,
		Log:     slog.Default(),
		Dispatch: func(event string, data json.RawMessage) {
			t.Logf("event %s (%d bytes)", event, len(data))
			got[event] = data
			if event == "GUILD_CREATE" {
				var gc struct {
					ID string `json:"id"`
				}
				_ = json.Unmarshal(data, &gc)
				if err := g.RequestMembers(ctx, gc.ID, nil, "live"); err != nil {
					t.Errorf("request members: %v", err)
				}
			}
			if event == "GUILD_MEMBERS_CHUNK" {
				var c struct {
					Members []struct {
						User struct {
							ID       string `json:"id"`
							Username string `json:"username"`
						} `json:"user"`
					} `json:"members"`
					Presences []struct {
						User struct {
							ID string `json:"id"`
						} `json:"user"`
						Status     string            `json:"status"`
						Activities []json.RawMessage `json:"activities"`
					} `json:"presences"`
				}
				_ = json.Unmarshal(data, &c)
				for _, m := range c.Members {
					t.Logf("member %s %s", m.User.ID, m.User.Username)
				}
				for _, p := range c.Presences {
					t.Logf("presence %s %s, %d activities", p.User.ID, p.Status, len(p.Activities))
					for _, a := range p.Activities {
						t.Logf("  %s", a)
					}
				}
				close(done)
			}
		},
	}
	go func() { _ = g.Run(ctx) }()
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatalf("no member chunk; events seen: %v", keys(got))
	}
	if _, ok := got["READY"]; !ok {
		t.Error("no READY")
	}
}

func keys(m map[string]json.RawMessage) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	return out
}
