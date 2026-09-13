package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/realtime"
	"evilion.xyz/chat/internal/store"
	"evilion.xyz/chat/internal/voice"
)

// Calls through Cloudflare Realtime SFU. chatd is the SFU's signalling proxy:
// it opens one session per call device, publishes that device's tracks under
// names only it knows, and lets a device pull only the tracks of people in its
// own call. Media is encrypted frame by frame in the browsers, so the SFU
// forwards what it cannot read, and nobody reaches anybody else's address.

const maxSDPBytes = 256 << 10

func (s *Server) sfuRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/voice/sfu/session", s.authed(s.handleSFUSession))
	mux.Handle("POST /api/v1/voice/sfu/publish", s.authed(s.handleSFUPublish))
	mux.Handle("POST /api/v1/voice/sfu/subscribe", s.authed(s.handleSFUSubscribe))
	mux.Handle("PUT /api/v1/voice/sfu/renegotiate", s.authed(s.handleSFURenegotiate))
	mux.Handle("PUT /api/v1/voice/sfu/close", s.authed(s.handleSFUClose))
}

// sfuCaller returns the caller and their call on this device, answering the
// request itself when there is none.
func (s *Server) sfuCaller(w http.ResponseWriter, r *http.Request) (*store.User, voice.State, bool) {
	if s.Realtime == nil {
		WriteError(w, E(http.StatusNotFound, "sfu_off", "Calls do not go through an SFU on this server."))
		return nil, voice.State{}, false
	}
	me := auth.UserFrom(r.Context())
	se := auth.SessionFrom(r.Context())
	if ok, retry := s.limVoice.Allow("sfu:" + me.ID.String()); !ok {
		w.Header().Set("Retry-After", retryAfter(retry))
		WriteError(w, ErrRateLimited)
		return nil, voice.State{}, false
	}
	st, ok := s.Voice.Get(me.ID)
	// the device making the request is the one in the call
	if !ok || se == nil || st.SessionID != se.ID {
		WriteError(w, E(http.StatusConflict, "not_in_voice", "Join the call first."))
		return nil, voice.State{}, false
	}
	return me, st, true
}

func sfuUnavailable(w http.ResponseWriter, err error) {
	var apiErr *realtime.Error
	if errors.As(err, &apiErr) && apiErr.Status >= 400 && apiErr.Status < 500 {
		WriteError(w, E(http.StatusBadRequest, "sfu_refused", "The call service refused that: "+apiErr.Description))
		return
	}
	WriteError(w, E(http.StatusBadGateway, "sfu_unavailable", "The call service could not be reached. Try again in a moment."))
}

func validDescription(d *realtime.SessionDescription, want ...string) bool {
	if d == nil || d.SDP == "" || len(d.SDP) > maxSDPBytes {
		return false
	}
	for _, t := range want {
		if d.Type == t {
			return true
		}
	}
	return false
}

// handleSFUSession opens the SFU session for the caller's call, replacing any
// earlier one of it.
func (s *Server) handleSFUSession(w http.ResponseWriter, r *http.Request) {
	me, st, ok := s.sfuCaller(w, r)
	if !ok {
		return
	}
	id, err := s.Realtime.NewSession(r.Context())
	if err != nil {
		s.Log.Warn("sfu session", "err", err)
		sfuUnavailable(w, err)
		return
	}
	old, ok := s.Voice.SetSFU(me.ID, st.ChannelID, st.ConnID, id)
	if !ok {
		// the call ended or moved while the session was being opened
		s.closeSFUSession(id)
		WriteError(w, E(http.StatusConflict, "not_in_voice", "Join the call first."))
		return
	}
	if old != "" {
		s.closeSFUSession(old)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"session_id": id})
}

type sfuPublishReq struct {
	SessionID string                       `json:"session_id"`
	Offer     *realtime.SessionDescription `json:"offer"`
	Tracks    []struct {
		Mid     string `json:"mid"`
		Kind    string `json:"kind"`
		Bitrate int64  `json:"bitrate"`
	} `json:"tracks"`
}

// handleSFUPublish publishes the caller's tracks with their offer.
func (s *Server) handleSFUPublish(w http.ResponseWriter, r *http.Request) {
	me, st, ok := s.sfuCaller(w, r)
	if !ok {
		return
	}
	var req sfuPublishReq
	if err := ReadJSON(w, r, &req, maxSDPBytes+8<<10); err != nil {
		WriteError(w, err)
		return
	}
	if req.SessionID == "" || req.SessionID != st.SFUSession {
		WriteError(w, E(http.StatusConflict, "sfu_session_gone", "That call session has ended. Start it again."))
		return
	}
	if !validDescription(req.Offer, "offer") || len(req.Tracks) == 0 || len(req.Tracks) > 4 {
		WriteError(w, E(http.StatusBadRequest, "bad_request", "Publishing needs an offer and one to four tracks."))
		return
	}
	seen := map[string]bool{}
	tracks := make([]realtime.Track, 0, len(req.Tracks))
	names := map[string]string{}
	for _, t := range req.Tracks {
		if !realtime.ValidKind(t.Kind) || seen[t.Kind] || t.Mid == "" || len(t.Mid) > 16 {
			WriteError(w, E(http.StatusBadRequest, "bad_request", "Each track needs a mid and a kind of its own."))
			return
		}
		seen[t.Kind] = true
		if realtime.IsVideo(t.Kind) && !s.Meter.VideoAllowed(r.Context()) {
			WriteError(w, E(http.StatusForbidden, "video_paused", "Video is paused until next month to keep calls free."))
			return
		}
		name := me.ID.String() + "-" + t.Kind + "-" + randomHex(6)
		names[t.Mid] = name
		tracks = append(tracks, realtime.Track{Location: "local", Mid: t.Mid, TrackName: name})
	}
	res, err := s.Realtime.AddTracks(r.Context(), req.SessionID, req.Offer, tracks)
	if err != nil {
		s.Log.Warn("sfu publish", "err", err)
		sfuUnavailable(w, err)
		return
	}
	failed := map[string]bool{}
	for _, t := range res.Tracks {
		if t.ErrorCode != "" {
			failed[t.Mid] = true
		}
	}
	var latest voice.State
	published := false
	for _, t := range req.Tracks {
		if failed[t.Mid] {
			continue
		}
		bps := int64(0)
		if t.Kind == realtime.KindScreen {
			bps = realtime.ClampScreenBps(t.Bitrate)
		}
		if next, ok := s.Voice.SetTrack(me.ID, req.SessionID, t.Kind, names[t.Mid], bps); ok {
			latest, published = next, true
		}
	}
	if published {
		s.sfuSyncLive(latest)
		if ch, err := s.Store.ChannelByID(r.Context(), latest.ChannelID); err == nil {
			s.Bcast.EmitUsers(s.voiceAudience(r.Context(), ch), "voice_state", statePayload(latest))
		}
	}
	WriteJSON(w, http.StatusOK, map[string]any{"answer": res.Description, "failed": len(failed)})
}

type sfuSubscribeReq struct {
	SessionID string `json:"session_id"`
	Tracks    []struct {
		UserID ids.ID `json:"user_id"`
		Kind   string `json:"kind"`
	} `json:"tracks"`
}

type sfuPulled struct {
	Mid    string `json:"mid,omitempty"`
	UserID ids.ID `json:"user_id"`
	Kind   string `json:"kind"`
	// Tag is the pulled track's tag, as voice states carry it
	Tag   string `json:"tag,omitempty"`
	Error string `json:"error,omitempty"`
}

// handleSFUSubscribe pulls tracks of people in the caller's call.
func (s *Server) handleSFUSubscribe(w http.ResponseWriter, r *http.Request) {
	me, st, ok := s.sfuCaller(w, r)
	if !ok {
		return
	}
	var req sfuSubscribeReq
	if err := ReadJSON(w, r, &req, 16<<10); err != nil {
		WriteError(w, err)
		return
	}
	if req.SessionID == "" || req.SessionID != st.SFUSession {
		WriteError(w, E(http.StatusConflict, "sfu_session_gone", "That call session has ended. Start it again."))
		return
	}
	if len(req.Tracks) == 0 || len(req.Tracks) > 64 {
		WriteError(w, E(http.StatusBadRequest, "bad_request", "Ask for one to 64 tracks."))
		return
	}
	out := make([]sfuPulled, 0, len(req.Tracks))
	type want struct {
		target voice.State
		kind   string
		name   string
	}
	var wants []want
	videoAllowed := true
	checkedVideo := false
	for _, t := range req.Tracks {
		p := sfuPulled{UserID: t.UserID, Kind: t.Kind}
		target, ok := s.Voice.Get(t.UserID)
		switch {
		case !realtime.ValidKind(t.Kind):
			p.Error = "bad_kind"
		case t.UserID == me.ID || !ok || target.ChannelID != st.ChannelID || target.SFUSession == "":
			// only people in the same call, and never yourself
			p.Error = "not_in_call"
		case target.Tracks.Get(t.Kind) == "":
			p.Error = "not_published"
		default:
			if realtime.IsVideo(t.Kind) {
				if !checkedVideo {
					videoAllowed, checkedVideo = s.Meter.VideoAllowed(r.Context()), true
				}
				if !videoAllowed {
					p.Error = "video_paused"
					break
				}
			}
			wants = append(wants, want{target: target, kind: t.Kind, name: target.Tracks.Get(t.Kind)})
			continue
		}
		out = append(out, p)
	}
	if len(wants) == 0 {
		// nothing to pull: each entry says why, and there is nothing to negotiate
		WriteJSON(w, http.StatusOK, map[string]any{"offer": nil, "renegotiate": false, "tracks": out})
		return
	}
	tracks := make([]realtime.Track, 0, len(wants))
	for _, x := range wants {
		tracks = append(tracks, realtime.Track{Location: "remote", SessionID: x.target.SFUSession, TrackName: x.name})
	}
	res, err := s.Realtime.AddTracks(r.Context(), req.SessionID, nil, tracks)
	if err != nil {
		s.Log.Warn("sfu subscribe", "err", err)
		sfuUnavailable(w, err)
		return
	}
	byName := map[string]realtime.Track{}
	for _, t := range res.Tracks {
		byName[t.TrackName] = t
	}
	for _, x := range wants {
		p := sfuPulled{UserID: x.target.UserID, Kind: x.kind}
		got, ok := byName[x.name]
		switch {
		case !ok:
			p.Error = "not_returned"
		case got.ErrorCode != "":
			p.Error = got.ErrorCode
		default:
			p.Mid = got.Mid
			p.Tag = voice.TrackTag(x.name)
			s.Meter.Start(req.SessionID, got.Mid, realtime.Source(x.target.SFUSession, x.kind), realtime.RateFor(x.kind, x.target.ScreenBps))
		}
		out = append(out, p)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"offer": res.Description, "renegotiate": res.Renegotiate, "tracks": out})
}

type sfuRenegotiateReq struct {
	SessionID   string                       `json:"session_id"`
	Description *realtime.SessionDescription `json:"description"`
}

// handleSFURenegotiate answers the SFU's offer, or sends the caller's own
// (an ICE restart) and returns the SFU's answer.
func (s *Server) handleSFURenegotiate(w http.ResponseWriter, r *http.Request) {
	_, st, ok := s.sfuCaller(w, r)
	if !ok {
		return
	}
	var req sfuRenegotiateReq
	if err := ReadJSON(w, r, &req, maxSDPBytes+4<<10); err != nil {
		WriteError(w, err)
		return
	}
	if req.SessionID == "" || req.SessionID != st.SFUSession {
		WriteError(w, E(http.StatusConflict, "sfu_session_gone", "That call session has ended. Start it again."))
		return
	}
	if !validDescription(req.Description, "offer", "answer") {
		WriteError(w, E(http.StatusBadRequest, "bad_request", "A session description is needed."))
		return
	}
	d, err := s.Realtime.Renegotiate(r.Context(), req.SessionID, *req.Description)
	if err != nil {
		s.Log.Warn("sfu renegotiate", "err", err)
		sfuUnavailable(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"description": d})
}

type sfuCloseReq struct {
	SessionID string                       `json:"session_id"`
	Mids      []string                     `json:"mids"`
	Offer     *realtime.SessionDescription `json:"offer"`
}

// handleSFUClose stops pulled tracks by mid, with the caller's offer.
func (s *Server) handleSFUClose(w http.ResponseWriter, r *http.Request) {
	_, st, ok := s.sfuCaller(w, r)
	if !ok {
		return
	}
	var req sfuCloseReq
	if err := ReadJSON(w, r, &req, maxSDPBytes+8<<10); err != nil {
		WriteError(w, err)
		return
	}
	if req.SessionID == "" || req.SessionID != st.SFUSession {
		WriteError(w, E(http.StatusConflict, "sfu_session_gone", "That call session has ended. Start it again."))
		return
	}
	if len(req.Mids) == 0 || len(req.Mids) > 64 || (req.Offer != nil && !validDescription(req.Offer, "offer")) {
		WriteError(w, E(http.StatusBadRequest, "bad_request", "Closing needs one to 64 mids and, optionally, an offer."))
		return
	}
	for _, mid := range req.Mids {
		s.Meter.Stop(req.SessionID, mid)
	}
	res, err := s.Realtime.CloseTracks(r.Context(), req.SessionID, req.Mids, req.Offer, req.Offer == nil)
	if err != nil {
		s.Log.Warn("sfu close", "err", err)
		sfuUnavailable(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"answer": res.Description, "renegotiate": res.Renegotiate})
}

// closeSFUSession stops charging a session and force-closes it at the SFU in
// the background, so a device that left or was removed is cut off at once.
func (s *Server) closeSFUSession(session string) {
	if session == "" || s.Realtime == nil {
		return
	}
	s.Meter.StopSession(session)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.Realtime.CloseSession(ctx, session); err != nil {
			s.Log.Warn("sfu close session", "err", err)
		}
	}()
}

// sfuSyncLive tells the meter which of a call's published tracks are sending:
// a camera that is off, or a share that ended, costs nothing to pull.
func (s *Server) sfuSyncLive(st voice.State) {
	if s.Meter == nil || st.SFUSession == "" {
		return
	}
	s.Meter.SetSourceLive(realtime.Source(st.SFUSession, realtime.KindVideo), st.Video)
	s.Meter.SetSourceLive(realtime.Source(st.SFUSession, realtime.KindScreen), st.Streaming)
	s.Meter.SetSourceLive(realtime.Source(st.SFUSession, realtime.KindScreenAudio), st.Streaming)
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
