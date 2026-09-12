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
)

func (s *Server) keyRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/keys/grants", s.authed(s.handleKeyGrants))
	mux.Handle("GET /api/v1/keys/needs", s.authed(s.handleKeyNeeds))
	mux.Handle("POST /api/v1/keys/grants", s.authed(s.handleKeyGrantsPut))
	mux.Handle("POST /api/v1/keys/epochs", s.authed(s.handleKeyEpochCreate))
	mux.Handle("GET /api/v1/keys/epochs", s.authed(s.handleKeyEpochs))
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
		key := [2]int64{int64(g.ConvID), int64(g.Epoch)}
		holds, seen := holdCache[key]
		if g.UserID == me.ID {
			// a self-grant only affects the caller (e.g. a key received through an invite link)
			if _, err := s.Store.Epoch(ctx, g.ConvID, g.Epoch); err != nil {
				WriteError(w, ErrNotFound)
				return
			}
			holds, seen = true, true
			holdCache[key] = true
		}
		if !seen {
			// A holder is someone with a grant, or the epoch's creator bootstrapping the first grants.
			if _, err := s.Store.Grant(ctx, g.ConvID, g.Epoch, me.ID); err == nil {
				holds = true
			} else if e, err := s.Store.Epoch(ctx, g.ConvID, g.Epoch); err == nil && e.CreatedBy == me.ID {
				holds = true
			}
			holdCache[key] = holds
		}
		if !holds {
			WriteError(w, E(http.StatusForbidden, "not_holder", "You do not hold that key, so you cannot share it."))
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
	for attempt := 0; attempt < 3; attempt++ {
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
		if err := s.Store.CreateEpoch(ctx, e); err == nil {
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
