package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMaintenanceStatus(t *testing.T) {
	for _, tc := range []struct {
		name, content string
		enabled       bool
		want          int64
	}{
		{"disabled", `{"reboot_at":123456}`, false, 0},
		{"enabled", `{"reboot_at":123456}`, true, 123456},
		{"invalid", `broken`, true, 0},
		{"negative", `{"reboot_at":-1}`, true, 0},
		{"missing", "", true, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &Server{}
			if tc.enabled {
				s.Cfg.MaintenanceFile = filepath.Join(t.TempDir(), "schedule.json")
				if tc.content != "" {
					if err := os.WriteFile(s.Cfg.MaintenanceFile, []byte(tc.content), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			w := httptest.NewRecorder()
			s.maintenanceStatus(w, httptest.NewRequest(http.MethodGet, "/api/v1/maintenance", nil))
			var got struct {
				RebootAt int64 `json:"reboot_at"`
				Now      int64 `json:"now"`
				Notice   int64 `json:"notice_ms"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if got.RebootAt != tc.want || got.Notice != 9000000 || time.Now().UnixMilli()-got.Now > 1000 {
				t.Fatalf("unexpected status: %+v", got)
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("schedule must not be cached")
			}
		})
	}
}
