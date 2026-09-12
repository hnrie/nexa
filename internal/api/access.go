package api

import (
	"net/http"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// Access needs, passed to ChannelAccess for server channels.
const (
	NeedView    = "view"
	NeedSend    = "send"
	NeedManage  = "manage"
	NeedHistory = "history"
	NeedReact   = "react"
	NeedAttach  = "attach"
	NeedPin     = "pin"
)

// channel loads the channel from the path and checks the caller may act in it.
// It writes the error response itself and returns nil on failure.
func (s *Server) channel(w http.ResponseWriter, r *http.Request, need string) (*store.Channel, *store.User) {
	u := auth.UserFrom(r.Context())
	id, err := ids.Parse(r.PathValue("id"))
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, nil
	}
	ch, err := s.Store.ChannelByID(r.Context(), id)
	if err != nil {
		WriteError(w, ErrNotFound)
		return nil, nil
	}
	ok, err := s.canAccess(r, u, ch, need)
	if err != nil {
		WriteError(w, err)
		return nil, nil
	}
	if !ok {
		WriteError(w, ErrNotFound) // hide existence
		return nil, nil
	}
	return ch, u
}

// canAccess resolves access for any channel type.
func (s *Server) canAccess(r *http.Request, u *store.User, ch *store.Channel, need string) (bool, error) {
	if ch.Type == "dm" || ch.Type == "group_dm" {
		for _, id := range ch.Recipients {
			if id == u.ID {
				return true, nil
			}
		}
		return false, nil
	}
	if s.ChannelAccess != nil {
		return s.ChannelAccess(r.Context(), u, ch, need)
	}
	return false, nil
}

func (s *Server) isDM(ch *store.Channel) bool { return ch.Type == "dm" || ch.Type == "group_dm" }
