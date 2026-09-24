package api

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strconv"
	"time"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/store"
)

const (
	// MaxChunkBytes is the size of one piece of a resumable upload: how much has
	// to be sent again after a dropped connection, and how much the sender has
	// to hold in memory at once.
	MaxChunkBytes = 32 << 20
	// SingleUploadBytes is the largest file clients are told to send in one
	// request; anything bigger goes up in resumable pieces of MaxChunkBytes.
	// It is one piece on purpose. Bigger requests would save a round trip or
	// two per file, and cost the sender that much more memory (a piece is
	// encrypted whole before it goes) and, when a connection drops, a restart
	// from nothing rather than from the last piece that arrived.
	SingleUploadBytes = MaxChunkBytes
	// MaxSingleUploadBytes is the most one request may carry, which clients
	// from before SingleUploadBytes still use. Cloudflare's free plan refuses
	// a body over 100 MB, so this sits just under that.
	MaxSingleUploadBytes = 90 << 20
	// uploadIdleLife is how long an untouched transfer is kept before its
	// bytes are swept up.
	uploadIdleLife = 24 * time.Hour
	// diskHeadroom is what must remain free after a transfer finishes.
	diskHeadroom = 2 << 30
	// maxOpenUploads is how many unfinished transfers one account may have.
	maxOpenUploads = 12
	// pendingAllowance is what one account may hold in files not sent yet,
	// beyond the largest single file: room for a few files on their way
	// while the big one finishes.
	pendingAllowance = 4 << 30
)

var errNoSpace = E(http.StatusInsufficientStorage, "no_space", "This server does not have room for a file that size right now.")

// roomForUpload decides whether an account may start putting size more bytes
// on the server. The disk has to hold them on top of what every unfinished
// transfer still has to bring, with headroom left over for the database —
// without that, transfers started together all pass a free-space check made
// before any of their bytes arrive. And no one account may hold more than a
// file of the largest size plus a working allowance in files it has not sent,
// so one account cannot fill the disk for everyone. session says a resumable
// transfer is being opened, which counts against the open-transfer cap.
func (s *Server) roomForUpload(ctx context.Context, uid ids.ID, size int64, session bool) error {
	room, err := s.Store.UploadRoomFor(ctx, uid)
	if err != nil {
		return err
	}
	if session && room.UserOpen >= maxOpenUploads {
		return E(http.StatusTooManyRequests, "too_many_uploads", "You have too many uploads going at once. Let some finish first.")
	}
	if room.UserPending+size > s.Cfg.MaxUploadBytes+pendingAllowance {
		return E(http.StatusInsufficientStorage, "upload_quota", "You have too much uploaded that has not been sent yet. Send or cancel some of it first.")
	}
	if free, err := freeSpace(s.Media.Dir); err == nil && free-room.AllRemaining < size+diskHeadroom {
		return errNoSpace
	}
	return nil
}

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
	if ok, retry := s.limUpload.Allow("up:" + me.ID.String()); !ok {
		w.Header().Set("Retry-After", retryAfter(retry))
		WriteError(w, ErrRateLimited)
		return
	}
	if err := s.roomForUpload(r.Context(), me.ID, req.Size, true); err != nil {
		WriteError(w, err)
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
	if up.BlobID != nil {
		WriteError(w, ErrNotFound) // finished: nothing left to resume
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
	// what this piece brings was set aside when the transfer began, but the
	// disk is shared with everything else the server writes
	if free, err := freeSpace(s.Media.Dir); err == nil && free < limit+diskHeadroom/2 {
		WriteError(w, errNoSpace)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit+1)
	// The body lands in a file of its own first: a request stuck on its body
	// must not be able to touch the spool once a retry has taken over.
	piece, _, err := s.Media.StagePiece(r.Body, limit)
	if err != nil {
		if errors.Is(err, media.ErrTooLarge) {
			WriteError(w, E(http.StatusRequestEntityTooLarge, "chunk_too_large", "That piece is larger than this server takes at once."))
			return
		}
		WriteError(w, err)
		return
	}
	defer os.Remove(piece)
	unlock := s.Media.LockUpload(up.ID)
	defer unlock()
	// another request may have landed this piece while the body was arriving
	fresh, err := s.Store.UploadByID(r.Context(), up.ID)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	if fresh.Received != offset || fresh.BlobID != nil {
		w.Header().Set("Upload-Offset", strconv.FormatInt(fresh.Received, 10))
		WriteError(w, E(http.StatusConflict, "offset_mismatch", "That piece does not follow on from what has arrived."))
		return
	}
	end, err := s.Media.AppendSpool(up.ID, offset, piece)
	if err != nil {
		if errors.Is(err, media.ErrBadOffset) {
			w.Header().Set("Upload-Offset", strconv.FormatInt(end, 10))
			WriteError(w, E(http.StatusConflict, "offset_mismatch", "That piece does not follow on from what has arrived."))
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
	unlock := s.Media.LockUpload(up.ID)
	defer unlock()
	up, err := s.Store.UploadByID(r.Context(), up.ID)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	if up.BlobID != nil {
		// finished already and the reply went missing: give the same answer again
		b, err := s.Store.BlobByID(r.Context(), *up.BlobID)
		if err != nil {
			WriteError(w, ErrNotFound)
			return
		}
		WriteJSON(w, http.StatusCreated, map[string]any{"blob_id": b.ID, "size": b.Size})
		return
	}
	if up.Received != up.Size {
		WriteError(w, E(http.StatusBadRequest, "incomplete", "Some of the file has not arrived yet."))
		return
	}
	b, err := s.Media.FinishSpool(r.Context(), up.ID, me.ID, up.Size)
	if err != nil {
		if errors.Is(err, media.ErrBadOffset) {
			_ = s.Store.DeleteUpload(r.Context(), up.ID)
			WriteError(w, E(http.StatusConflict, "upload_damaged", "The file did not arrive intact. Send it again."))
			return
		}
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusCreated, map[string]any{"blob_id": b.ID, "size": b.Size})
}

func (s *Server) handleUploadCancel(w http.ResponseWriter, r *http.Request) {
	up, _ := s.upload(w, r)
	if up == nil {
		return
	}
	unlock := s.Media.LockUpload(up.ID)
	defer unlock()
	s.Media.DiscardSpool(up.ID)
	_ = s.Store.DeleteUpload(r.Context(), up.ID)
	w.WriteHeader(http.StatusNoContent)
}
