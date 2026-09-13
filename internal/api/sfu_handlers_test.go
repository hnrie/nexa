package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"evilion.xyz/chat/internal/realtime"
)

// realtimeStandIn answers like Cloudflare Realtime and remembers what it was asked.
type realtimeStandIn struct {
	mu       sync.Mutex
	sessions int
	mids     int
	closed   map[string]bool // sessions whose tracks were force-closed
	pulled   []string        // track names pulled
}

func newRealtimeStandIn(t *testing.T) (*realtimeStandIn, *httptest.Server) {
	t.Helper()
	rt := &realtimeStandIn{closed: map[string]bool{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rt.mu.Lock()
		defer rt.mu.Unlock()
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		w.Header().Set("Content-Type", "application/json")
		path := strings.TrimPrefix(r.URL.Path, "/apps/app/sessions/")
		switch {
		case r.URL.Path == "/apps/app/sessions/new":
			rt.sessions++
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"sessionId": "sess-" + strconv.Itoa(rt.sessions)})
		case strings.HasSuffix(path, "/tracks/new"):
			tracks := []map[string]any{}
			for _, x := range body["tracks"].([]any) {
				t := x.(map[string]any)
				mid, _ := t["mid"].(string)
				if mid == "" {
					mid = strconv.Itoa(rt.mids)
					rt.mids++
				}
				if t["location"] == "remote" {
					rt.pulled = append(rt.pulled, t["trackName"].(string))
				}
				tracks = append(tracks, map[string]any{"mid": mid, "trackName": t["trackName"], "sessionId": t["sessionId"]})
			}
			if _, offered := body["sessionDescription"]; offered {
				_ = json.NewEncoder(w).Encode(map[string]any{"sessionDescription": map[string]any{"type": "answer", "sdp": "v=0 answer"}, "tracks": tracks})
			} else {
				_ = json.NewEncoder(w).Encode(map[string]any{"requiresImmediateRenegotiation": true, "sessionDescription": map[string]any{"type": "offer", "sdp": "v=0 sfu offer"}, "tracks": tracks})
			}
		case strings.HasSuffix(path, "/renegotiate"):
			_ = json.NewEncoder(w).Encode(map[string]any{"sessionDescription": map[string]any{"type": "answer", "sdp": "v=0 answer"}})
		case strings.HasSuffix(path, "/tracks/close"):
			if body["force"] == true {
				rt.closed[strings.TrimSuffix(path, "/tracks/close")] = true
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"tracks": body["tracks"]})
		case r.Method == http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"tracks": []map[string]any{{"mid": "0"}}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return rt, srv
}

func (rt *realtimeStandIn) wasClosed(session string) bool {
	for i := 0; i < 40; i++ {
		rt.mu.Lock()
		done := rt.closed[session]
		rt.mu.Unlock()
		if done {
			return true
		}
		time.Sleep(50 * time.Millisecond)
	}
	return false
}

var offerSDP = map[string]any{"type": "offer", "sdp": "v=0 client offer"}

// nextVoiceState waits for a voice_state that matches, skipping earlier ones.
func nextVoiceState(g *gw, match func(map[string]any) bool) map[string]any {
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		ev := g.next("voice_state", time.Until(deadline))
		if ev == nil {
			return nil
		}
		if match(ev) {
			return ev
		}
	}
	return nil
}

func mediaCount(ev map[string]any) int {
	m, _ := ev["media"].(map[string]any)
	return len(m)
}

func TestCallsThroughTheSFU(t *testing.T) {
	srv, ts := newTestServer(t)
	rt, cf := newRealtimeStandIn(t)
	srv.Realtime = realtime.New("app", "secret")
	srv.Realtime.Base = cf.URL
	srv.Meter = realtime.NewMeter(srv.Store, 1000)

	tokA, idA := register(t, ts, "alice")
	tokB, _ := register(t, ts, "bob")
	tokC, idC := register(t, ts, "carol")
	view := createServer(t, ts, tokA, "Calls")
	general := channelNamed(view, "general")["id"].(string)
	voiceCh := channelNamed(view, "General")["id"].(string)
	code := inviteFor(t, ts, tokA, general)
	join(t, ts, tokB, code)
	join(t, ts, tokC, code)
	ga := connectGW(t, ts, tokA)
	gb := connectGW(t, ts, tokB)
	connectGW(t, ts, tokC)

	if _, body := do(t, ts, "GET", "/api/v1/voice/ice", tokA, nil); body["sfu"] != true {
		t.Errorf("ice says calls go through the SFU: %v", body)
	}
	// carol is not in the call
	if res, body := do(t, ts, "POST", "/api/v1/voice/sfu/session", tokC, nil); res.StatusCode != 409 || errCode(body) != "not_in_voice" {
		t.Errorf("a session needs a call: %d %v", res.StatusCode, body)
	}
	// a page still set up for peer-to-peer calls is turned away
	ga.op(t, "voice_state", map[string]any{"channel_id": voiceCh})
	if ev := ga.next("voice_error", 3*time.Second); ev == nil || ev["code"] != "sfu_required" {
		t.Errorf("a join without the SFU: %v", ev)
	}
	ga.op(t, "voice_state", map[string]any{"channel_id": voiceCh, "sfu": true})
	ga.next("voice_state", 3*time.Second)
	gb.op(t, "voice_state", map[string]any{"channel_id": voiceCh, "sfu": true})
	gb.next("voice_state", 3*time.Second)
	ga.next("voice_state", 3*time.Second)

	_, body := do(t, ts, "POST", "/api/v1/voice/sfu/session", tokA, nil)
	sessA, _ := body["session_id"].(string)
	_, body = do(t, ts, "POST", "/api/v1/voice/sfu/session", tokB, nil)
	sessB, _ := body["session_id"].(string)
	if sessA == "" || sessB == "" || sessA == sessB {
		t.Fatalf("sessions: %q %q", sessA, sessB)
	}

	// alice publishes her microphone and camera; bob hears which kinds she has
	res, body := do(t, ts, "POST", "/api/v1/voice/sfu/publish", tokA, map[string]any{"session_id": sessA, "offer": offerSDP, "tracks": []map[string]any{{"mid": "0", "kind": "audio"}, {"mid": "1", "kind": "video"}}})
	if res.StatusCode != 200 || body["answer"].(map[string]any)["type"] != "answer" {
		t.Fatalf("publish: %d %v", res.StatusCode, body)
	}
	ev := nextVoiceState(gb, func(e map[string]any) bool { return e["user_id"] == idA && mediaCount(e) > 0 })
	if ev == nil || mediaCount(ev) != 2 {
		t.Fatalf("the voice state lists what alice publishes: %v", ev)
	}
	if raw, _ := json.Marshal(ev); strings.Contains(string(raw), sessA) || strings.Contains(string(raw), "-audio-") {
		t.Errorf("session ids and track names stay on the server: %s", raw)
	}
	// someone else's session id is refused
	if res, body := do(t, ts, "POST", "/api/v1/voice/sfu/publish", tokB, map[string]any{"session_id": sessA, "offer": offerSDP, "tracks": []map[string]any{{"mid": "0", "kind": "audio"}}}); res.StatusCode != 409 || errCode(body) != "sfu_session_gone" {
		t.Errorf("another person's session: %d %v", res.StatusCode, body)
	}

	// bob pulls alice's tracks; what she does not publish, and carol, are refused
	res, body = do(t, ts, "POST", "/api/v1/voice/sfu/subscribe", tokB, map[string]any{"session_id": sessB, "tracks": []map[string]any{{"user_id": idA, "kind": "audio"}, {"user_id": idA, "kind": "video"}, {"user_id": idA, "kind": "screen"}, {"user_id": idC, "kind": "audio"}}})
	if res.StatusCode != 200 || body["renegotiate"] != true || body["offer"].(map[string]any)["type"] != "offer" {
		t.Fatalf("subscribe: %d %v", res.StatusCode, body)
	}
	results := map[string]string{}
	tags := map[string]any{}
	for _, x := range body["tracks"].([]any) {
		p := x.(map[string]any)
		key := p["user_id"].(string) + ":" + p["kind"].(string)
		if e, _ := p["error"].(string); e != "" {
			results[key] = e
		} else if p["mid"] != nil && p["mid"] != "" {
			results[key] = "ok"
			tags[p["kind"].(string)] = p["tag"]
		}
	}
	if results[idA+":audio"] != "ok" || results[idA+":video"] != "ok" || results[idA+":screen"] != "not_published" || results[idC+":audio"] != "not_in_call" {
		t.Errorf("subscribe results: %v", results)
	}
	// what was pulled carries the tags bob saw in alice's voice state
	if media := ev["media"].(map[string]any); tags["audio"] == nil || tags["audio"] != media["audio"] || tags["video"] != media["video"] || media["audio"] == media["video"] {
		t.Errorf("tags: pulled %v, voice state %v", tags, media)
	}
	rt.mu.Lock()
	pulled := len(rt.pulled)
	rt.mu.Unlock()
	if pulled != 2 {
		t.Errorf("only the allowed tracks reach the SFU: %d", pulled)
	}
	// nobody pulls their own tracks
	_, body = do(t, ts, "POST", "/api/v1/voice/sfu/subscribe", tokA, map[string]any{"session_id": sessA, "tracks": []map[string]any{{"user_id": idA, "kind": "audio"}}})
	if body["offer"] != nil || body["tracks"].([]any)[0].(map[string]any)["error"] != "not_in_call" {
		t.Errorf("subscribing to yourself: %v", body)
	}
	if res, body := do(t, ts, "PUT", "/api/v1/voice/sfu/renegotiate", tokB, map[string]any{"session_id": sessB, "description": map[string]any{"type": "answer", "sdp": "v=0 bob answer"}}); res.StatusCode != 200 {
		t.Errorf("renegotiate: %d %v", res.StatusCode, body)
	}
	if res, body := do(t, ts, "PUT", "/api/v1/voice/sfu/close", tokB, map[string]any{"session_id": sessB, "mids": []string{"0"}, "offer": offerSDP}); res.StatusCode != 200 {
		t.Errorf("close: %d %v", res.StatusCode, body)
	}

	// a mute toggle keeps alice's session and what she publishes
	ga.op(t, "voice_state", map[string]any{"channel_id": voiceCh, "self_mute": true, "sfu": true})
	if ev := nextVoiceState(gb, func(e map[string]any) bool { return e["user_id"] == idA && e["self_mute"] == true }); ev == nil || mediaCount(ev) != 2 {
		t.Errorf("a toggle keeps the published tracks: %v", ev)
	}

	// bob starting a new session closes the old one at the SFU
	do(t, ts, "POST", "/api/v1/voice/sfu/session", tokB, nil)
	if !rt.wasClosed(sessB) {
		t.Error("a replaced session is closed")
	}
	// alice hanging up closes hers
	ga.op(t, "voice_state", map[string]any{"channel_id": nil})
	if !rt.wasClosed(sessA) {
		t.Error("hanging up closes the session")
	}

	// near the end of the allowance, video is refused and then calls
	srv.Meter = realtime.NewMeter(srv.Store, 0)
	_, body = do(t, ts, "POST", "/api/v1/voice/sfu/session", tokB, nil)
	sessB2, _ := body["session_id"].(string)
	if res, body := do(t, ts, "POST", "/api/v1/voice/sfu/publish", tokB, map[string]any{"session_id": sessB2, "offer": offerSDP, "tracks": []map[string]any{{"mid": "1", "kind": "video"}}}); res.StatusCode != 403 || errCode(body) != "video_paused" {
		t.Errorf("video paused: %d %v", res.StatusCode, body)
	}
	ga.op(t, "voice_state", map[string]any{"channel_id": voiceCh, "sfu": true})
	if ev := ga.next("voice_error", 3*time.Second); ev == nil || ev["code"] != "calls_paused" {
		t.Errorf("a new call is refused at the limit: %v", ev)
	}
}

func TestSFUOffWithoutKeys(t *testing.T) {
	_, ts := newTestServer(t)
	tok, _ := register(t, ts, "alice")
	view := createServer(t, ts, tok, "Calls")
	voiceCh := channelNamed(view, "General")["id"].(string)
	g := connectGW(t, ts, tok)
	// a page that still thinks calls go through the SFU is sent to join again
	g.op(t, "voice_state", map[string]any{"channel_id": voiceCh, "sfu": true})
	if ev := g.next("voice_error", 3*time.Second); ev == nil || ev["code"] != "sfu_off" {
		t.Errorf("an SFU join without keys: %v", ev)
	}
	g.op(t, "voice_state", map[string]any{"channel_id": voiceCh})
	if ev := g.next("voice_state", 3*time.Second); ev == nil {
		t.Error("a peer-to-peer join goes ahead")
	}
	if res, body := do(t, ts, "POST", "/api/v1/voice/sfu/session", tok, nil); res.StatusCode != 404 || errCode(body) != "sfu_off" {
		t.Errorf("sfu off: %d %v", res.StatusCode, body)
	}
	if _, body := do(t, ts, "GET", "/api/v1/voice/ice", tok, nil); body["sfu"] != false {
		t.Errorf("ice without the SFU: %v", body)
	}
}
