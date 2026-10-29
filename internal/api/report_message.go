package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

type reportedAttachment struct {
	BlobID  ids.ID `json:"blob_id"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	Size    int64  `json:"size"`
	Key     string `json:"key,omitempty"`
	Preview bool   `json:"preview,omitempty"`
}
type reportedMessage struct {
	Content     map[string]json.RawMessage `json:"content"`
	Attachments []reportedAttachment       `json:"attachments"`
	EditedAt    *int64                     `json:"edited_at"`
}

func (s *Server) captureReportedMessage(r *http.Request, target *reportTarget, evidence *reportedMessage) error {
	if evidence == nil || len(evidence.Content) == 0 {
		return E(400, "report_message_required", "Reporting a message requires its full readable content and all attachments.")
	}
	m, err := s.Store.MessageByID(r.Context(), target.ID, auth.UserFrom(r.Context()).ID)
	if err != nil {
		return ErrNotFound
	}
	if (m.EditedAt == nil) != (evidence.EditedAt == nil) || m.EditedAt != nil && *m.EditedAt != *evidence.EditedAt {
		return E(409, "report_message_changed", "This message was edited. Reopen the report to share its current content.")
	}
	allowed := map[string]bool{"t": true, "att": true, "sticker": true, "embeds": true, "flags": true, "poll": true, "fwd": true, "hook": true, "call": true, "type": true}
	for field := range evidence.Content {
		if !allowed[field] {
			return E(400, "report_message_invalid", "Invalid message content.")
		}
	}
	available := map[ids.ID]bool{}
	for _, a := range m.Attachments {
		available[a.BlobID] = true
	}
	seen := map[ids.ID]bool{}
	for i, a := range evidence.Attachments {
		evidence.Attachments[i].Name = truncateRunes(a.Name, 255)
		evidence.Attachments[i].Type = truncateRunes(a.Type, 255)
		if !available[a.BlobID] || seen[a.BlobID] || a.Size < 0 {
			return E(400, "report_message_files", "Share every attachment belonging to the reported message.")
		}
		b, err := s.Store.BlobByID(r.Context(), a.BlobID)
		if err != nil {
			return ErrNotFound
		}
		if b.Encrypted {
			key, err := base64.StdEncoding.DecodeString(a.Key)
			if err != nil || len(key) != 32 {
				return E(400, "report_message_files", "A reported attachment requires its own file key.")
			}
		} else if a.Size != b.Size {
			return E(400, "report_message_files", "Invalid attachment size.")
		}
		if b.Encrypted && (a.Size > b.Size || b.Size != 12+a.Size+max(int64(1), (a.Size+(4<<20)-1)/(4<<20))*20) {
			return E(400, "report_message_files", "Invalid attachment size.")
		}
		key, _ := base64.StdEncoding.DecodeString(a.Key)
		if s.Media == nil || s.Media.ValidateReportedAttachment(r.Context(), a.BlobID, key, a.Size) != nil {
			return E(400, "report_message_files", "A reported attachment could not be opened. Reopen the message before reporting it.")
		}
		seen[a.BlobID] = true
	}
	if len(seen) != len(available) {
		return E(400, "report_message_files", "Share every attachment belonging to the reported message.")
	}
	// Strip per-file keys from the readable snapshot. Only the validated file
	// descriptors retain keys, and publicReportSnapshot removes those on output.
	raw, _ := json.Marshal(evidence.Content)
	var readable any
	_ = json.Unmarshal(raw, &readable)
	var strip func(any)
	strip = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			delete(x, "key")
			for _, child := range x {
				strip(child)
			}
		case []any:
			for _, child := range x {
				strip(child)
			}
		}
	}
	strip(readable)
	var sticker struct {
		ID     ids.ID `json:"id"`
		Blob   ids.ID `json:"blob"`
		Name   string `json:"name"`
		Format string `json:"format"`
	}
	if raw := evidence.Content["sticker"]; len(raw) > 0 && json.Unmarshal(raw, &sticker) == nil && sticker.Blob != 0 {
		if blob, err := s.Store.BlobByID(r.Context(), sticker.Blob); err == nil && blob.Kind == "sticker" && !blob.Encrypted {
			target.Snapshot["message_sticker"] = map[string]any{"blob_id": sticker.Blob, "name": truncateRunes(sticker.Name, 255), "format": sticker.Format}
		}
	}
	target.Snapshot["message_content"] = readable
	target.Snapshot["_message_files"] = evidence.Attachments
	return nil
}

// File keys are retained privately for this report's authenticated downloads;
// they are never sent in report lists, detail JSON, or rendered snapshots.
func publicReportSnapshot(v *store.SafetyReport) {
	var snapshot map[string]json.RawMessage
	if json.Unmarshal(v.Snapshot, &snapshot) == nil {
		delete(snapshot, "_message_files")
		v.Snapshot = mustJSON(snapshot)
	}
}
func messageReportFiles(v *store.SafetyReport) []reportedAttachment {
	var snapshot struct {
		Files []reportedAttachment `json:"_message_files"`
	}
	_ = json.Unmarshal(v.Snapshot, &snapshot)
	return snapshot.Files
}
