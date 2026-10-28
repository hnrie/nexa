package api

import (
	"net/http"

	"evilion.xyz/chat/internal/ids"
)

func (s *Server) requireNSFWConsent(w http.ResponseWriter, r *http.Request, id ids.ID) bool {
	srv, err := s.Store.ServerByID(r.Context(), id)
	if err != nil {
		WriteError(w, err)
		return false
	}
	if srv.NSFW && r.URL.Query().Get("nsfw") != "1" {
		WriteError(w, E(http.StatusForbidden, "nsfw_age_required", "Confirm that you are 18 or older to view or join this server."))
		return false
	}
	return true
}

func (s *Server) clearNSFWTag(w http.ResponseWriter, r *http.Request, id ids.ID) bool {
	srv, err := s.Store.ServerByID(r.Context(), id)
	if err == nil && srv.Tag != nil {
		err = s.removeServerTag(r.Context(), srv)
	}
	if err != nil {
		WriteError(w, err)
		return false
	}
	return true
}
