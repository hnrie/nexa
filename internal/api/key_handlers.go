package api

import (
	"net/http"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

const (
	maxGrantBytes  = 512
	maxGrantsBatch = 200
	// rotationReason is what clients send when answering key_rotation_needed.
	rotationReason = "membership change"
)

func (s *Server) keyRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/keys/grants", s.authed(s.handleKeyGrants))
	mux.Handle("GET /api/v1/keys/needs", s.authed(s.handleKeyNeeds))
	mux.Handle("POST /api/v1/keys/grants", s.authed(s.handleKeyGrantsPut))
	mux.Handle("POST /api/v1/keys/epochs", s.authed(s.handleKeyEpochCreate))
	mux.Handle("GET /api/v1/keys/epochs", s.authed(s.handleKeyEpochs))
	mux.Handle("POST /api/v1/keys/request", s.authed(s.handleKeyRequest))
}

// handleKeyRequest is a device still waiting for a conversation's keys asking
// for them again: the online members holding them are told who lacks them,
// as they were when that person came in. The first ask can be missed (nobody
// holding the key was online, or their app had not heard of the newcomer
// yet), and nothing else asked again until a holder next connected.
func (s *Server) handleKeyRequest(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	var req struct {
		ConvID        ids.ID `json:"conv_id"`
		BadEpoch      *int   `json:"bad_epoch"`
		BadWrappedKey []byte `json:"bad_wrapped_key"`
	}
	if err := ReadJSON(w, r, &req, 8<<10); err != nil {
		WriteError(w, err)
		return
	}
	set, err := s.entitledSet(r, req.ConvID)
	if err != nil || !set[me.ID] {
		WriteError(w, ErrNotFound)
		return
	}
	if ok, retry := s.limKeyAsk.Allow("keyask:" + me.ID.String() + ":" + req.ConvID.String()); !ok {
		w.Header().Set("Retry-After", retryAfter(retry))
		WriteError(w, ErrRateLimited)
		return
	}
	if req.BadEpoch != nil {
		if *req.BadEpoch < 0 || len(req.BadWrappedKey) == 0 || len(req.BadWrappedKey) > 4096 {
			WriteError(w, ErrBadJSON)
			return
		}
		if err := s.Store.RejectGrant(r.Context(), req.ConvID, *req.BadEpoch, me.ID, req.BadWrappedKey); err != nil {
			WriteError(w, err)
			return
		}
	}
	s.Bcast.KeysMaybeNeeded(req.ConvID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleKeyGrants(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.GrantsForUser(r.Context(), auth.UserFrom(r.Context()).ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, list)
}

func (s *Server) handleKeyNeeds(w http.ResponseWriter, r *http.Request) {
	needs, err := s.Store.Needs(r.Context(), auth.UserFrom(r.Context()).ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, needs)
}

func (s *Server) entitledSet(r *http.Request, conv ids.ID) (map[ids.ID]bool, error) {
	list, err := s.Store.Entitled(r.Context(), conv)
	if err != nil {
		return nil, err
	}
	set := make(map[ids.ID]bool, len(list))
	for _, id := range list {
		set[id] = true
	}
	return set, nil
}

func (s *Server) handleKeyGrantsPut(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	var req []struct {
		ConvID     ids.ID `json:"conv_id"`
		Epoch      int    `json:"epoch"`
		UserID     ids.ID `json:"user_id"`
		WrappedKey []byte `json:"wrapped_key"`
	}
	if err := ReadJSON(w, r, &req, 512<<10); err != nil {
		WriteError(w, err)
		return
	}
	if len(req) == 0 || len(req) > maxGrantsBatch {
		WriteError(w, E(http.StatusBadRequest, "bad_batch", "Send 1–200 grants."))
		return
	}
	ctx := r.Context()
	entitledCache := map[ids.ID]map[ids.ID]bool{}
	holdCache := map[[2]int64]bool{}
	var grants []store.KeyGrant
	for _, g := range req {
		if len(g.WrappedKey) == 0 || len(g.WrappedKey) > maxGrantBytes || g.Epoch < 0 || g.ConvID.IsZero() || g.UserID.IsZero() {
			WriteError(w, E(http.StatusBadRequest, "bad_grant", "A grant is malformed."))
			return
		}
		set, ok := entitledCache[g.ConvID]
		if !ok {
			var err error
			if set, err = s.entitledSet(r, g.ConvID); err != nil {
				WriteError(w, err)
				return
			}
			entitledCache[g.ConvID] = set
		}
		// someone who left or was removed keeps their old grants but has no
		// business handing keys to the people still in the conversation
		if !set[me.ID] {
			WriteError(w, E(http.StatusForbidden, "not_entitled", "You are not part of that conversation."))
			return
		}
		key := [2]int64{int64(g.ConvID), int64(g.Epoch)}
		var holds bool
		if g.UserID == me.ID {
			// A self-grant only affects the caller (e.g. a key received through
			// an invite link). It says nothing about whether the caller really
			// holds the key, so it does not make them a holder for the rest of
			// the batch.
			if _, err := s.Store.Epoch(ctx, g.ConvID, g.Epoch); err != nil {
				WriteError(w, ErrNotFound)
				return
			}
			holds = true
		} else if cached, seen := holdCache[key]; seen {
			holds = cached
		} else {
			// A holder is someone another member granted the key to, or the
			// epoch's creator bootstrapping the first grants. A grant the caller
			// wrapped for themselves does not count: anyone can plant one, and
			// junk shared from it would block the real key, since the first
			// grant stored wins.
			if e, err := s.Store.Epoch(ctx, g.ConvID, g.Epoch); err == nil && e.CreatedBy == me.ID {
				holds = true
			} else if own, err := s.Store.Grant(ctx, g.ConvID, g.Epoch, me.ID); err == nil && own.WrappedBy != me.ID {
				holds = true
			}
			holdCache[key] = holds
		}
		if !holds {
			WriteError(w, E(http.StatusForbidden, "not_holder", "You do not hold that key, so you cannot share it."))
			return
		}
		if !set[g.UserID] {
			WriteError(w, E(http.StatusForbidden, "not_entitled", "That user is not part of the conversation."))
			return
		}
		grants = append(grants, store.KeyGrant{ConvID: g.ConvID, Epoch: g.Epoch, UserID: g.UserID, WrappedKey: g.WrappedKey, WrappedBy: me.ID})
	}
	inserted, err := s.Store.PutGrants(ctx, grants)
	if err != nil {
		WriteError(w, err)
		return
	}
	for _, g := range grants {
		if stored, err := s.Store.Grant(ctx, g.ConvID, g.Epoch, g.UserID); err == nil && stored.WrappedBy == me.ID {
			s.Bcast.EmitUsers([]ids.ID{g.UserID}, "key_grant", stored)
		}
	}
	WriteJSON(w, http.StatusOK, map[string]any{"inserted": inserted})
}

func (s *Server) handleKeyEpochCreate(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	var req struct {
		ConvID ids.ID `json:"conv_id"`
		Reason string `json:"reason"`
	}
	if err := ReadJSON(w, r, &req, 4<<10); err != nil {
		WriteError(w, err)
		return
	}
	ctx := r.Context()
	entitled, err := s.Store.Entitled(ctx, req.ConvID)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	isMember := false
	for _, id := range entitled {
		if id == me.ID {
			isMember = true
		}
	}
	if !isMember {
		WriteError(w, ErrNotFound)
		return
	}
	if s.CanRotate != nil {
		if ok, err := s.CanRotate(ctx, me, req.ConvID); err != nil || !ok {
			WriteError(w, ErrForbidden)
			return
		}
	}
	reason, _ := CleanText(req.Reason, 64)
	var epoch *store.KeyEpoch
	create, attempts := s.Store.CreateEpoch, 3
	if reason == rotationReason {
		// Every online device that holds the key answers key_rotation_needed.
		// One new epoch is enough, so this only goes through while the
		// rotation is still pending, and a lost race is not retried.
		create, attempts = s.Store.CreatePendingEpoch, 1
	}
	for attempt := 0; attempt < attempts; attempt++ {
		latest, exists, err := s.Store.LatestEpoch(ctx, req.ConvID)
		if err != nil {
			WriteError(w, err)
			return
		}
		next := 0
		if exists {
			next = latest + 1
		}
		e := &store.KeyEpoch{ConvID: req.ConvID, Epoch: next, CreatedBy: me.ID, Reason: reason}
		if err := create(ctx, e); err == nil {
			epoch = e
			break
		} else if err != store.ErrConflict {
			WriteError(w, err)
			return
		}
	}
	if epoch == nil {
		WriteError(w, E(http.StatusConflict, "epoch_race", "Someone else just rotated this key; reload."))
		return
	}
	if epoch.Epoch == 0 {
		// a server channel that just got its own first epoch now encrypts under
		// itself; viewers must learn the new key_conv_id before they send
		if ch, err := s.Store.ChannelByID(ctx, epoch.ConvID); err == nil && ch.ServerID != nil {
			s.Bcast.EmitChannel(ch.ID, "channel_update", ch)
		}
	}
	WriteJSON(w, http.StatusCreated, map[string]any{"conv_id": epoch.ConvID, "epoch": epoch.Epoch, "user_ids": entitled})
}

func (s *Server) handleKeyEpochs(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	conv, err := ids.Parse(r.URL.Query().Get("conv_id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	entitled, err := s.Store.Entitled(r.Context(), conv)
	if err != nil {
		WriteError(w, ErrNotFound)
		return
	}
	member := false
	for _, id := range entitled {
		if id == me.ID {
			member = true
		}
	}
	if !member {
		WriteError(w, ErrNotFound)
		return
	}
	epochs, err := s.Store.Epochs(r.Context(), conv)
	if err != nil {
		WriteError(w, err)
		return
	}
	flags, err := s.Store.KeyFlags(r.Context(), conv)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"epochs": epochs, "flags": flags, "entitled": entitled})
}
