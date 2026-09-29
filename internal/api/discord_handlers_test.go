package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"evilion.xyz/chat/internal/discordsync/fakediscord"
	"evilion.xyz/chat/internal/gateway"
	"evilion.xyz/chat/internal/ids"
)

// discordTestServer is a test server with Discord activity sync on, talking to a fake Discord.
func discordTestServer(t *testing.T) (*Server, *httptest.Server, *fakediscord.Server, *gateway.Hub) {
	t.Helper()
	srv, ts := newTestServer(t)
	fake := fakediscord.New()
	t.Cleanup(fake.Close)
	srv.Cfg.DiscordClientID, srv.Cfg.DiscordClientSecret, srv.Cfg.DiscordBotToken = "client-id", "client-secret", "bot-token"
	srv.Cfg.PublicURL = ts.URL
	srv.discordAPI = fake.API()
	hub := srv.Bcast.(*gateway.Hub)
	srv.WireDiscord(hub)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	srv.StartDiscord(ctx)
	waitFor(t, "the bot to connect", func() bool {
		connected, guild, _ := srv.Discord.Status()
		return connected && guild == fake.GuildID
	})
	return srv, ts, fake, hub
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// linkDiscord goes through Discord's page as the fake's account with this code, and returns where it came back to.
func linkDiscord(t *testing.T, ts *httptest.Server, token, code string) string {
	t.Helper()
	res, body := do(t, ts, "POST", "/api/v1/connections/discord/authorize", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("authorize: %d %v", res.StatusCode, body)
	}
	u, err := url.Parse(body["url"].(string))
	if err != nil || u.Host != "discord.com" {
		t.Fatalf("authorize url: %v %v", body["url"], err)
	}
	q := u.Query()
	if q.Get("scope") != "identify guilds.join" || q.Get("client_id") != "client-id" || q.Get("redirect_uri") != ts.URL+"/api/v1/connections/discord/callback" {
		t.Fatalf("authorize url asks for the wrong thing: %v", q)
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	cb, err := client.Get(ts.URL + "/api/v1/connections/discord/callback?code=" + url.QueryEscape(code) + "&state=" + url.QueryEscape(q.Get("state")))
	if err != nil {
		t.Fatal(err)
	}
	cb.Body.Close()
	if cb.StatusCode != http.StatusSeeOther {
		t.Fatalf("callback: %d", cb.StatusCode)
	}
	back, _ := url.Parse(cb.Header.Get("Location"))
	if back.Path != "/channels/@me" || back.Query().Get("settings") != "activity" {
		t.Fatalf("callback went to %s", back)
	}
	return back.Query().Get("discord")
}

func linked(t *testing.T, ts *httptest.Server, token string) map[string]any {
	t.Helper()
	res, body := do(t, ts, "GET", "/api/v1/connections/discord", token, nil)
	if res.StatusCode != 200 || body["available"] != true {
		t.Fatalf("state: %d %v", res.StatusCode, body)
	}
	l, _ := body["linked"].(map[string]any)
	return l
}

func TestDiscordSyncOffWithoutKeys(t *testing.T) {
	_, ts := newTestServer(t)
	token, _ := register(t, ts, "alice")
	res, body := do(t, ts, "GET", "/api/v1/connections/discord", token, nil)
	if res.StatusCode != 200 || body["available"] != false || body["linked"] != nil {
		t.Fatalf("state without keys: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "POST", "/api/v1/connections/discord/authorize", token, nil); res.StatusCode != 404 || errCode(body) != "discord_unavailable" {
		t.Fatalf("authorize without keys: %d %v", res.StatusCode, body)
	}
}

func TestDiscordLinkMirrorsActivityAndUnlinks(t *testing.T) {
	_, ts, fake, hub := discordTestServer(t)
	token, idStr := register(t, ts, "alice")
	uid, _ := ids.Parse(idStr)
	if fake.Intents&(1<<8) == 0 || fake.Intents&(1<<1) == 0 {
		t.Fatalf("the bot did not ask for presences and members: intents %d", fake.Intents)
	}

	if l := linked(t, ts, token); l != nil {
		t.Fatalf("linked before linking: %v", l)
	}
	const discordID = "900000000000000100"
	if got := linkDiscord(t, ts, token, fake.AddUser(discordID, "alice_d")); got != "linked" {
		t.Fatalf("link: %s", got)
	}
	l := linked(t, ts, token)
	if l == nil || l["id"] != discordID || l["username"] != "alice_d" || l["in_guild"] != true || l["show"] != true {
		t.Fatalf("after linking: %v", l)
	}
	if !fake.Member(discordID) {
		t.Fatal("linking did not add the account to the activity server")
	}

	// What Discord says is shown, cleaned the way the desktop app's activity is
	fake.Presence(discordID, "online", map[string]any{
		"name": "Spotify", "type": 2, "id": "spotify:1", "details": "Never Gonna Give You Up", "state": "Rick Astley; Someone Else",
		"sync_id": "4cOdK2wGLETKBW3PvgPWqT", "assets": map[string]any{"large_image": "spotify:ab67616d0000b273abcdef", "large_text": "Whenever You Need Somebody"},
		"timestamps": map[string]any{"start": time.Now().Add(-time.Minute).UnixMilli(), "end": time.Now().Add(2 * time.Minute).UnixMilli()},
	}, map[string]any{"name": "Custom Status", "type": 4, "state": "hello"})
	waitFor(t, "the song to show", func() bool { return len(hub.LinkedActivities(uid)) == 1 })
	a := hub.LinkedActivities(uid)[0]
	if a.Name != "Spotify" || a.Type != 2 || a.Details != "Never Gonna Give You Up" || a.State != "Rick Astley, Someone Else" || a.Source != "discord" {
		t.Fatalf("song: %+v", a)
	}
	if a.DetailsURL != "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT" || a.Assets == nil || a.Assets.LargeImage == "" || a.Timestamps == nil || a.Timestamps.End == nil {
		t.Fatalf("song details: %+v %+v", a, a.Assets)
	}

	// Listening switched off: the song goes
	if res, body := do(t, ts, "PATCH", "/api/v1/connections/discord", token, map[string]any{"kinds": 1 | 4 | 8 | 16}); res.StatusCode != 200 {
		t.Fatalf("prefs: %d %v", res.StatusCode, body)
	}
	waitFor(t, "the song to go", func() bool { return len(hub.LinkedActivities(uid)) == 0 })
	if res, body := do(t, ts, "PATCH", "/api/v1/connections/discord", token, map[string]any{"kinds": 64}); res.StatusCode != 400 {
		t.Fatalf("kinds that do not exist: %d %v", res.StatusCode, body)
	}
	if res, _ := do(t, ts, "PATCH", "/api/v1/connections/discord", token, map[string]any{"kinds": 31}); res.StatusCode != 200 {
		t.Fatal("prefs back")
	}
	waitFor(t, "the song to come back", func() bool { return len(hub.LinkedActivities(uid)) == 1 })

	// Leaving the activity server stops the activity and says so, and Rejoin puts it back
	g := connectGWReady(t, ts, token)
	defer g.close()
	fake.Leave(discordID)
	ev := g.next("discord_link", 3*time.Second)
	if ev == nil {
		t.Fatal("no discord_link event after leaving")
	}
	if l := ev["linked"].(map[string]any); l["in_guild"] != false || l["left_at"].(float64) <= 0 {
		t.Fatalf("after leaving: %v", l)
	}
	waitFor(t, "the activity to stop", func() bool { return len(hub.LinkedActivities(uid)) == 0 })
	res, body := do(t, ts, "POST", "/api/v1/connections/discord/rejoin", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("rejoin: %d %v", res.StatusCode, body)
	}
	if l := body["linked"].(map[string]any); l["in_guild"] != true || l["left_at"].(float64) != 0 {
		t.Fatalf("after rejoining: %v", l)
	}
	if !fake.Member(discordID) {
		t.Fatal("rejoin did not add the account back")
	}

	// The same Discord account cannot be linked to a second Nexa account
	bobToken, _ := register(t, ts, "bob")
	if got := linkDiscord(t, ts, bobToken, fake.AddUser(discordID, "alice_d")); got != "taken" {
		t.Fatalf("second link: %s", got)
	}
	if l := linked(t, ts, bobToken); l != nil {
		t.Fatalf("bob is linked: %v", l)
	}

	// Unlinking: gone at once, tokens revoked, out of the server
	fake.Presence(discordID, "online", map[string]any{"name": "Minecraft", "type": 0})
	waitFor(t, "the game to show", func() bool { return len(hub.LinkedActivities(uid)) == 1 })
	if res, _ := do(t, ts, "DELETE", "/api/v1/connections/discord", token, nil); res.StatusCode != 204 {
		t.Fatalf("unlink: %d", res.StatusCode)
	}
	if l := linked(t, ts, token); l != nil {
		t.Fatalf("still linked: %v", l)
	}
	waitFor(t, "the game to go", func() bool { return len(hub.LinkedActivities(uid)) == 0 })
	waitFor(t, "Discord to be told", func() bool { return len(fake.Revoked()) == 1 && len(fake.Removed()) == 1 })
	if fake.Removed()[0] != discordID {
		t.Fatalf("removed %v", fake.Removed())
	}
	if res, _ := do(t, ts, "DELETE", "/api/v1/connections/discord", token, nil); res.StatusCode != 404 {
		t.Fatalf("unlink twice: %d", res.StatusCode)
	}
}

func TestDiscordCallbackRefusals(t *testing.T) {
	_, ts, fake, _ := discordTestServer(t)
	token, _ := register(t, ts, "alice")
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	result := func(query string) string {
		t.Helper()
		res, err := client.Get(ts.URL + "/api/v1/connections/discord/callback?" + query)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		u, _ := url.Parse(res.Header.Get("Location"))
		return u.Query().Get("discord")
	}
	// a state nobody asked for, or none at all
	if got := result("code=x&state=made-up"); got != "expired" {
		t.Fatalf("made-up state: %s", got)
	}
	// the person said no on Discord's page
	_, body := do(t, ts, "POST", "/api/v1/connections/discord/authorize", token, nil)
	u, _ := url.Parse(body["url"].(string))
	state := u.Query().Get("state")
	if got := result("error=access_denied&state=" + url.QueryEscape(state)); got != "denied" {
		t.Fatalf("denied: %s", got)
	}
	// a state works once
	if got := result("code=x&state=" + url.QueryEscape(state)); got != "expired" {
		t.Fatalf("state used twice: %s", got)
	}
	// a grant without guilds.join cannot do what the link is for
	fake.Scope("identify")
	if got := linkDiscord(t, ts, token, fake.AddUser("900000000000000200", "carol")); got != "denied" {
		t.Fatalf("without guilds.join: %s", got)
	}
	fake.Scope("identify guilds.join")
	// a code Discord does not know
	if got := linkDiscord(t, ts, token, "not-a-code"); got != "failed" {
		t.Fatalf("bad code: %s", got)
	}
	// a Discord account the server will not take is still linked, and says it is not in the server
	fake.FailJoin(true)
	if got := linkDiscord(t, ts, token, fake.AddUser("900000000000000300", "dave")); got != "linked" {
		t.Fatalf("join refused: %s", got)
	}
	if l := linked(t, ts, token); l == nil || l["in_guild"] != false || l["left_at"].(float64) != 0 {
		t.Fatalf("join refused: %v", l)
	}
	if res, body := do(t, ts, "POST", "/api/v1/connections/discord/rejoin", token, nil); res.StatusCode != 502 || errCode(body) != "discord_join_failed" {
		t.Fatalf("rejoin while refused: %d %v", res.StatusCode, body)
	}
	fake.FailJoin(false)
	if res, body := do(t, ts, "POST", "/api/v1/connections/discord/rejoin", token, nil); res.StatusCode != 200 {
		t.Fatalf("rejoin: %d %v", res.StatusCode, body)
	}
}

func TestDiscordLeftWhileAwayIsNoticedOnConnect(t *testing.T) {
	srv, ts, fake, _ := discordTestServer(t)
	token, _ := register(t, ts, "alice")
	const discordID = "900000000000000400"
	if got := linkDiscord(t, ts, token, fake.AddUser(discordID, "erin")); got != "linked" {
		t.Fatalf("link: %s", got)
	}
	// Discord drops the bot and the account leaves before it is back: a
	// session Discord will not resume starts afresh and counts the members again
	fake.Drop(4009)
	fake.Leave(discordID)
	waitFor(t, "a fresh session", func() bool { n, _ := fake.Sessions(); return n >= 2 })
	waitFor(t, "the leave to be noticed", func() bool {
		l := linked(t, ts, token)
		return l != nil && l["in_guild"] == false
	})
	_ = srv
}
