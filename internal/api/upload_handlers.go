package api

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/store"
)

const (
	// MaxChunkBytes is the most one request may carry. Cloudflare's free plan
	// refuses a body over 100 MB, so a piece stays well under that; it is also
	// how much has to be sent again after a dropped connection.
	MaxChunkBytes = 32 << 20
	// uploadIdleLife is how long an untouched transfer is kept before its
	// bytes are swept up.
	uploadIdleLife = 24 * time.Hour
	// diskHeadroom is what must remain free after a transfer finishes.
	diskHeadroom = 2 << 30
)

func (s *Server) uploadRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/uploads", s.authed(s.handleUploadCreate))
	mux.Handle("GET /api/v1/uploads/{id}", s.authed(s.handleUploadStatus))
	mux.Handle("PATCH /api/v1/uploads/{id}", s.authed(s.handleUploadChunk))
	mux.Handle("POST /api/v1/uploads/{id}/finish", s.authed(s.handleUploadFinish))
	mux.Handle("DELETE /api/v1/uploads/{id}", s.authed(s.handleUploadCancel))
}

// upload loads a transfer and checks it belongs to the caller.
func (s *Server) upload(w http.ResponseWriter, r *http.Request) (*store.Upload, *store.User) {
	me := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, nil
	}
	up, err := s.Store.UploadByID(r.Context(), id)
	if err != nil || up.UserID != me.ID {
		WriteError(w, ErrNotFound)
		return nil, nil
	}
	return up, me
}

func uploadView(up *store.Upload) map[string]any {
	return map[string]any{"id": up.ID, "size": up.Size, "received": up.Received, "chunk_size": MaxChunkBytes}
}

func (s *Server) handleUploadCreate(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	var req struct {
		Size int64 `json:"size"`
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	if req.Size <= 0 || req.Size > s.Cfg.MaxUploadBytes {
		WriteError(w, E(http.StatusRequestEntityTooLarge, "too_large", "That file is larger than this server accepts."))
		return
	}
	if free, err := freeSpace(s.Media.Dir); err == nil && free < req.Size+diskHeadroom {
		WriteError(w, E(http.StatusInsufficientStorage, "no_space", "This server does not have room for a file that size right now."))
		return
	}
	if ok, retry := s.limUpload.Allow("up:" + me.ID.String()); !ok {
		w.Header().Set("Retry-After", retryAfter(retry))
		WriteError(w, ErrRateLimited)
		return
	}
	up, err := s.Store.CreateUpload(r.Context(), me.ID, req.Size)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusCreated, uploadView(up))
}

// handleUploadStatus says how much has landed, so a client that lost its
// connection can pick up where it left off.
func (s *Server) handleUploadStatus(w http.ResponseWriter, r *http.Request) {
	up, _ := s.upload(w, r)
	if up == nil {
		return
	}
	WriteJSON(w, http.StatusOK, uploadView(up))
}

func (s *Server) handleUploadChunk(w http.ResponseWriter, r *http.Request) {
	up, _ := s.upload(w, r)
	if up == nil {
		return
	}
	offset, err := strconv.ParseInt(r.Header.Get("Upload-Offset"), 10, 64)
	if err != nil || offset < 0 {
		WriteError(w, E(http.StatusBadRequest, "bad_offset", "Upload-Offset must say where this piece belongs."))
		return
	}
	if offset != up.Received {
		// Not an error worth failing over: tell the client where to resume.
		w.Header().Set("Upload-Offset", strconv.FormatInt(up.Received, 10))
		WriteError(w, E(http.StatusConflict, "offset_mismatch", "That piece does not follow on from what has arrived."))
		return
	}
	room := up.Size - up.Received
	if room <= 0 {
		WriteError(w, E(http.StatusBadRequest, "already_complete", "Everything has arrived already."))
		return
	}
	limit := int64(MaxChunkBytes)
	if room < limit {
		limit = room
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit+1)
	end, err := s.Media.AppendSpool(up.ID, offset, r.Body, limit)
	if err != nil {
		if errors.Is(err, media.ErrBadOffset) {
			w.Header().Set("Upload-Offset", strconv.FormatInt(end, 10))
			WriteError(w, E(http.StatusConflict, "offset_mismatch", "That piece does not follow on from what has arrived."))
			return
		}
		if errors.Is(err, media.ErrTooLarge) {
			WriteError(w, E(http.StatusRequestEntityTooLarge, "chunk_too_large", "That piece is larger than this server takes at once."))
			return
		}
		WriteError(w, err)
		return
	}
	if ok, err := s.Store.AdvanceUpload(r.Context(), up.ID, offset, end); err != nil {
		WriteError(w, err)
		return
	} else if !ok {
		// another request moved it underneath us
		fresh, ferr := s.Store.UploadByID(r.Context(), up.ID)
		if ferr == nil {
			w.Header().Set("Upload-Offset", strconv.FormatInt(fresh.Received, 10))
		}
		WriteError(w, E(http.StatusConflict, "offset_mismatch", "That piece does not follow on from what has arrived."))
		return
	}
	up.Received = end
	w.Header().Set("Upload-Offset", strconv.FormatInt(end, 10))
	WriteJSON(w, http.StatusOK, uploadView(up))
}

func (s *Server) handleUploadFinish(w http.ResponseWriter, r *http.Request) {
	up, me := s.upload(w, r)
	if up == nil {
		return
	}
	if up.Received != up.Size {
		WriteError(w, E(http.StatusBadRequest, "incomplete", "Some of the file has not arrived yet."))
		return
	}
	b, err := s.Media.FinishSpool(r.Context(), up.ID, me.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	_ = s.Store.DeleteUpload(r.Context(), up.ID)
	WriteJSON(w, http.StatusCreated, map[string]any{"blob_id": b.ID, "size": b.Size})
}

func (s *Server) handleUploadCancel(w http.ResponseWriter, r *http.Request) {
	up, _ := s.upload(w, r)
	if up == nil {
		return
	}
	s.Media.DiscardSpool(up.ID)
	_ = s.Store.DeleteUpload(r.Context(), up.ID)
	w.WriteHeader(http.StatusNoContent)
}
