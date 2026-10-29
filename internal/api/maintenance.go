package api

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"time"
)

func (s *Server) maintenanceRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/maintenance", s.maintenanceStatus)
}

// The host owns the schedule; chatd only reads it. Missing or invalid files
// fail closed to no notice, and never expose paths or invoke host commands.
func (s *Server) maintenanceStatus(w http.ResponseWriter, r *http.Request) {
	var schedule struct {
		RebootAt int64 `json:"reboot_at"`
	}
	if s.Cfg.MaintenanceFile != "" {
		if f, err := os.Open(s.Cfg.MaintenanceFile); err == nil {
			defer f.Close()
			if err := json.NewDecoder(io.LimitReader(f, 4096)).Decode(&schedule); err != nil {
				schedule.RebootAt = 0
			}
		}
	}
	if schedule.RebootAt < 0 {
		schedule.RebootAt = 0
	}
	w.Header().Set("Cache-Control", "no-store")
	WriteJSON(w, http.StatusOK, map[string]any{"reboot_at": schedule.RebootAt, "now": time.Now().UnixMilli(), "notice_ms": (150 * time.Minute).Milliseconds()})
}
