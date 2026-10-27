package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

type call struct {
	method, path, auth, agent string
	body                      map[string]any
	rawBody                   string
}

// standIn answers like the Realtime API: one session with two tracks.
func standIn(t *testing.T) (*Client, *[]call) {
	t.Helper()
	calls := &[]call{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		c := call{method: r.Method, path: r.URL.Path, auth: r.Header.Get("Authorization"), agent: r.Header.Get("User-Agent"), rawBody: string(raw)}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &c.body)
		}
		*calls = append(*calls, c)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/apps/app1/sessions/new":
			if len(raw) > 0 {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, `{"errorCode":"decoding_error","errorDescription":"Body JSON validation error: sessionDescription"}`)
				return
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"sessionId":"s1"}`)
		case r.URL.Path == "/apps/app1/sessions/s1/tracks/new":
			_, _ = io.WriteString(w, `{"requiresImmediateRenegotiation":true,"sessionDescription":{"sdp":"v=0 offer","type":"offer"},"tracks":[{"mid":"0","trackName":"t-a","sessionId":"s2"}]}`)
		case r.URL.Path == "/apps/app1/sessions/s1/renegotiate":
			_, _ = io.WriteString(w, `{"sessionDescription":{"sdp":"v=0 answer","type":"answer"}}`)
		case r.URL.Path == "/apps/app1/sessions/s1" && r.Method == http.MethodGet:
			_, _ = io.WriteString(w, `{"tracks":[{"mid":"0","trackName":"a","location":"local","status":"active"},{"mid":"1","trackName":"b","location":"remote","status":"active"}]}`)
		case r.URL.Path == "/apps/app1/sessions/s1/tracks/close":
			_, _ = io.WriteString(w, `{"requiresImmediateRenegotiation":false,"tracks":[{"mid":"0"},{"mid":"1"}]}`)
		case r.URL.Path == "/apps/app1/sessions/bad/tracks/new":
			_, _ = io.WriteString(w, `{"errorCode":"invalid_request","errorDescription":"no such track"}`)
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"errorCode":"not_found"}`)
		}
	}))
	t.Cleanup(srv.Close)
	c := New("app1", "secret1")
	c.Base = srv.URL
	return c, calls
}

func TestClientTalksLikeTheAPI(t *testing.T) {
	c, calls := standIn(t)
	ctx := context.Background()

	id, err := c.NewSession(ctx)
	if err != nil || id != "s1" {
		t.Fatalf("new session: %q %v", id, err)
	}
	first := (*calls)[0]
	if first.method != "POST" || first.auth != "Bearer secret1" || !strings.HasPrefix(first.agent, "evilion-chat/") || first.rawBody != "" {
		t.Errorf("session call: %+v", first)
	}

	res, err := c.AddTracks(ctx, "s1", nil, []Track{{Location: "remote", SessionID: "s2", TrackName: "t-a"}})
	if err != nil || !res.Renegotiate || res.Description == nil || res.Description.Type != "offer" || len(res.Tracks) != 1 || res.Tracks[0].Mid != "0" {
		t.Fatalf("add tracks: %+v %v", res, err)
	}
	sent := (*calls)[1].body["tracks"].([]any)[0].(map[string]any)
	if sent["location"] != "remote" || sent["sessionId"] != "s2" || sent["trackName"] != "t-a" {
		t.Errorf("track sent in the API's naming: %v", sent)
	}
	if _, ok := (*calls)[1].body["sessionDescription"]; ok {
		t.Error("no description is sent when pulling")
	}

	answer, err := c.Renegotiate(ctx, "s1", SessionDescription{SDP: "v=0 mine", Type: "answer"})
	if err != nil || answer == nil || answer.Type != "answer" {
		t.Fatalf("renegotiate: %+v %v", answer, err)
	}
	if d := (*calls)[2].body["sessionDescription"].(map[string]any); d["type"] != "answer" || d["sdp"] != "v=0 mine" {
		t.Errorf("renegotiate body: %v", (*calls)[2].body)
	}

	if err := c.CloseSession(ctx, "s1"); err != nil {
		t.Fatal(err)
	}
	closeCall := (*calls)[len(*calls)-1]
	mids := closeCall.body["tracks"].([]any)
	if closeCall.method != "PUT" || closeCall.body["force"] != true || len(mids) != 2 {
		t.Errorf("closing a session force-closes every track: %+v", closeCall)
	}
}

func TestClientErrors(t *testing.T) {
	c, _ := standIn(t)
	ctx := context.Background()
	_, err := c.AddTracks(ctx, "bad", nil, []Track{{Location: "remote", SessionID: "x", TrackName: "y"}})
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.Code != "invalid_request" {
		t.Errorf("an errorCode in a 200 is an error: %v", err)
	}
	if _, err := c.SessionTracks(ctx, "gone"); !errors.Is(err, ErrSessionGone) {
		t.Errorf("unknown session: %v", err)
	}
	if err := c.CloseSession(ctx, "gone"); err != nil {
		t.Errorf("closing a session the SFU forgot is fine: %v", err)
	}
	if New("", "x") != nil || New("x", "") != nil {
		t.Error("no client without both keys")
	}
}

func TestCloseSessionRefusesPerTrackErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `{"tracks":[{"mid":"0","location":"local"}]}`)
		} else {
			_, _ = io.WriteString(w, `{"tracks":[{"mid":"0","errorCode":"temporarily_unavailable"}]}`)
		}
	}))
	defer server.Close()
	client := New("app", "secret")
	client.Base = server.URL
	if err := client.CloseSession(context.Background(), "session"); err == nil {
		t.Fatal("a per-track refusal was treated as confirmed closure")
	}
}

// TestLiveSession runs against Cloudflare itself when REALTIME_LIVE=1 and the
// app's keys are in the environment; it opens and closes an empty session.
func TestLiveSession(t *testing.T) {
	if os.Getenv("REALTIME_LIVE") != "1" {
		t.Skip("set REALTIME_LIVE=1 with REALTIME_APP_ID and REALTIME_APP_SECRET to run")
	}
	c := New(os.Getenv("REALTIME_APP_ID"), os.Getenv("REALTIME_APP_SECRET"))
	if c == nil {
		t.Fatal("keys missing")
	}
	ctx := context.Background()
	id, err := c.NewSession(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.SessionTracks(ctx, id); err != nil {
		t.Fatalf("session tracks: %v", err)
	}
	if err := c.CloseSession(ctx, id); err != nil {
		t.Fatalf("close: %v", err)
	}
}
