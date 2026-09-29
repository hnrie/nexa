package discordsync

import (
	"encoding/json"
	"regexp"
	"strings"

	"evilion.xyz/chat/internal/store"
)

// discordActivity is an activity as a PRESENCE_UPDATE carries it.
type discordActivity struct {
	Name              string `json:"name"`
	Type              int    `json:"type"`
	URL               string `json:"url"`
	ID                string `json:"id"`
	ApplicationID     string `json:"application_id"`
	StatusDisplayType *int   `json:"status_display_type"`
	Details           string `json:"details"`
	DetailsURL        string `json:"details_url"`
	State             string `json:"state"`
	StateURL          string `json:"state_url"`
	SyncID            string `json:"sync_id"`
	Instance          bool   `json:"instance"`
	Timestamps        *struct {
		Start json.Number `json:"start"`
		End   json.Number `json:"end"`
	} `json:"timestamps"`
	Assets *struct {
		LargeImage string `json:"large_image"`
		LargeText  string `json:"large_text"`
		LargeURL   string `json:"large_url"`
		SmallImage string `json:"small_image"`
		SmallText  string `json:"small_text"`
		SmallURL   string `json:"small_url"`
	} `json:"assets"`
	Party *struct {
		ID   string  `json:"id"`
		Size []int64 `json:"size"`
	} `json:"party"`
}

// Discord's activity types.
const (
	typePlaying   = 0
	typeStreaming = 1
	typeListening = 2
	typeWatching  = 3
	typeCustom    = 4
	typeCompeting = 5
)

// kindOf is the setting bit an activity type falls under, or 0 for one that
// never shows (a custom status, which a Nexa account has its own of).
func kindOf(t int) int {
	switch t {
	case typePlaying:
		return store.DiscordKindPlaying
	case typeStreaming:
		return store.DiscordKindStreaming
	case typeListening:
		return store.DiscordKindListening
	case typeWatching:
		return store.DiscordKindWatching
	case typeCompeting:
		return store.DiscordKindCompeting
	}
	return 0
}

var spotifyTrack = regexp.MustCompile(`^[A-Za-z0-9]{8,40}$`)

// toNexa turns what Discord says a person is doing into activities in the
// shape the desktop app sends them, keeping only the kinds they chose. The
// hub cleans them exactly as it cleans the desktop app's.
func toNexa(list []discordActivity, kinds int) []json.RawMessage {
	out := []json.RawMessage{}
	for _, a := range list {
		k := kindOf(a.Type)
		if k == 0 || kinds&k == 0 || strings.TrimSpace(a.Name) == "" {
			continue
		}
		in := map[string]any{"name": a.Name, "type": a.Type}
		if a.ApplicationID != "" {
			in["application_id"] = a.ApplicationID
		}
		if a.StatusDisplayType != nil {
			in["status_display_type"] = *a.StatusDisplayType
		}
		set := func(key, v string) {
			if v != "" {
				in[key] = v
			}
		}
		set("details", a.Details)
		set("state", a.State)
		set("details_url", a.DetailsURL)
		set("state_url", a.StateURL)
		spotify := a.Type == typeListening && (strings.HasPrefix(a.ID, "spotify:") || strings.EqualFold(a.Name, "Spotify"))
		if spotify {
			// Spotify's artists come joined with semicolons, which Discord shows with commas
			if a.State != "" {
				in["state"] = strings.ReplaceAll(a.State, "; ", ", ")
			}
			if a.DetailsURL == "" && spotifyTrack.MatchString(a.SyncID) {
				in["details_url"] = "https://open.spotify.com/track/" + a.SyncID
			}
		}
		if a.Type == typeStreaming && a.URL != "" && a.DetailsURL == "" {
			// the stream itself, which is where its title leads
			in["details_url"] = a.URL
		}
		if a.Instance {
			in["instance"] = true
		}
		if ts := a.Timestamps; ts != nil {
			t := map[string]any{}
			if v, err := ts.Start.Int64(); err == nil && v > 0 {
				t["start"] = v
			}
			if v, err := ts.End.Int64(); err == nil && v > 0 {
				t["end"] = v
			}
			if len(t) > 0 {
				in["timestamps"] = t
			}
		}
		if as := a.Assets; as != nil {
			m := map[string]any{}
			for key, v := range map[string]string{"large_image": as.LargeImage, "large_text": as.LargeText, "large_url": as.LargeURL, "small_image": as.SmallImage, "small_text": as.SmallText, "small_url": as.SmallURL} {
				if v != "" {
					m[key] = v
				}
			}
			if len(m) > 0 {
				in["assets"] = m
			}
		}
		if p := a.Party; p != nil && !spotify {
			m := map[string]any{}
			if p.ID != "" {
				m["id"] = p.ID
			}
			if len(p.Size) == 2 {
				m["size"] = p.Size
			}
			if len(m) > 0 {
				in["party"] = m
			}
		}
		// Discord gives bots a button's label but never where it goes, so buttons are left out.
		raw, err := json.Marshal(in)
		if err != nil {
			continue
		}
		out = append(out, raw)
		if len(out) == 5 {
			break
		}
	}
	return out
}
