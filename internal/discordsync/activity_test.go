package discordsync

import (
	"encoding/json"
	"testing"

	"evilion.xyz/chat/internal/store"
)

func decode(t *testing.T, raw []json.RawMessage) []map[string]any {
	t.Helper()
	out := []map[string]any{}
	for _, r := range raw {
		var m map[string]any
		if err := json.Unmarshal(r, &m); err != nil {
			t.Fatal(err)
		}
		out = append(out, m)
	}
	return out
}

func parse(t *testing.T, js string) []discordActivity {
	t.Helper()
	var list []discordActivity
	if err := json.Unmarshal([]byte(js), &list); err != nil {
		t.Fatal(err)
	}
	return list
}

func TestToNexaMapsEachKind(t *testing.T) {
	list := parse(t, `[
		{"name":"Spotify","type":2,"id":"spotify:1","details":"Song","state":"A; B","sync_id":"4cOdK2wGLETKBW3PvgPWqT","party":{"id":"spotify:123"},
		 "assets":{"large_image":"spotify:ab67616d0000b273","large_text":"Album"},"timestamps":{"start":1700000000000,"end":1700000200000},"buttons":["Play"]},
		{"name":"Minecraft","type":0,"application_id":"356875570916753438","details":"Survival","state":"In a party","party":{"size":[2,4]},"timestamps":{"start":1700000000000},
		 "assets":{"large_image":"1234567890","small_image":"mp:external/abc/https/example.com/a.png"}},
		{"name":"Twitch","type":1,"url":"https://www.twitch.tv/someone","details":"Speedrun","state":"Celeste","assets":{"large_image":"twitch:someone"}},
		{"name":"Custom Status","type":4,"state":"busy"},
		{"name":"YouTube","type":3,"details":"A video"},
		{"name":"Chess","type":5}
	]`)
	got := decode(t, toNexa(list, store.DiscordKindsAll))
	if len(got) != 5 {
		t.Fatalf("want 5 activities (the custom status left out), got %d: %v", len(got), got)
	}
	song := got[0]
	if song["state"] != "A, B" || song["details_url"] != "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT" || song["party"] != nil || song["buttons"] != nil {
		t.Fatalf("song: %v", song)
	}
	if ts := song["timestamps"].(map[string]any); ts["end"].(float64) != 1700000200000 {
		t.Fatalf("song times: %v", ts)
	}
	game := got[1]
	if game["application_id"] != "356875570916753438" || game["party"].(map[string]any)["size"] == nil || game["assets"].(map[string]any)["large_image"] != "1234567890" {
		t.Fatalf("game: %v", game)
	}
	stream := got[2]
	if stream["type"].(float64) != 1 || stream["details_url"] != "https://www.twitch.tv/someone" {
		t.Fatalf("stream: %v", stream)
	}
}

func TestToNexaKeepsOnlyChosenKinds(t *testing.T) {
	list := parse(t, `[{"name":"Spotify","type":2},{"name":"Minecraft","type":0},{"name":"YouTube","type":3}]`)
	got := decode(t, toNexa(list, store.DiscordKindPlaying|store.DiscordKindWatching))
	if len(got) != 2 || got[0]["name"] != "Minecraft" || got[1]["name"] != "YouTube" {
		t.Fatalf("kinds: %v", got)
	}
	if n := len(toNexa(list, 0)); n != 0 {
		t.Fatalf("nothing chosen still shows %d", n)
	}
}

func TestToNexaCapsAtFive(t *testing.T) {
	var list []discordActivity
	for i := 0; i < 8; i++ {
		list = append(list, discordActivity{Name: "Game", Type: 0})
	}
	if n := len(toNexa(list, store.DiscordKindsAll)); n != 5 {
		t.Fatalf("got %d", n)
	}
}
