package api

import (
	"encoding/json"
	"net/http"

	"evilion.xyz/chat/internal/gateway"
	"evilion.xyz/chat/internal/rpcapps"
)

// WireActivities lets the gateway show Rich Presence activities: their images
// go through this server's media proxy, and their Discord applications are
// looked up (and cached) by this server rather than by each viewer.
func (s *Server) WireActivities(hub *gateway.Hub) {
	if s.Apps == nil {
		s.Apps = rpcapps.New()
	}
	if hub == nil {
		return
	}
	hub.ProxyURL = s.ProxyURL
	hub.Apps = s.Apps
	s.activityHub = hub
}

func (s *Server) activityRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/activities/preview", s.authed(s.handleActivityPreview))
}

// handleActivityPreview shows the desktop app how activities will look to
// others (named, with their art resolved) without showing them to anyone.
func (s *Server) handleActivityPreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Activities []json.RawMessage `json:"activities"`
	}
	if err := ReadJSON(w, r, &body, 64<<10); err != nil {
		WriteError(w, err)
		return
	}
	out := []gateway.Activity{}
	if s.activityHub != nil {
		out = append(out, s.activityHub.ResolveActivities(body.Activities)...)
	}
	WriteJSON(w, http.StatusOK, out)
}
