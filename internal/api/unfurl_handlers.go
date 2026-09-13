package api

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/unfurl"
)

func (s *Server) unfurlRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/unfurl", s.authed(s.handleUnfurl))
}

// handleUnfurl fetches a link preview on behalf of the sender. Anything that
// cannot be embedded (including blocked addresses) is a 204 so the client
// simply shows no preview.
func (s *Server) handleUnfurl(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	if ok, retry := s.limUnfurl.Allow("unfurl:" + me.ID.String()); !ok {
		w.Header().Set("Retry-After", retryAfter(retry))
		WriteError(w, ErrRateLimited)
		return
	}
	raw := strings.TrimSpace(r.URL.Query().Get("url"))
	if raw == "" || len(raw) > 2048 {
		WriteError(w, E(http.StatusBadRequest, "bad_url", "url is required and must be under 2048 characters."))
		return
	}
	// An invite to this instance is answered from our own records: no fetch,
	// and the reader gets a card they can join from.
	if res := s.inviteUnfurl(r, raw); res != nil {
		WriteJSON(w, http.StatusOK, res)
		return
	}
	if s.Unfurl == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	res, err := s.Unfurl.Lookup(r.Context(), raw)
	if err != nil {
		if errors.Is(err, unfurl.ErrUnsupported) || errors.Is(err, unfurl.ErrBlocked) || errors.Is(err, unfurl.ErrTooLarge) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		WriteError(w, E(http.StatusBadGateway, "fetch_failed", "That link could not be fetched."))
		return
	}
	// every remote image the client loads goes through our proxy, so opening a
	// chat never hands the reader's address to whoever hosts the picture
	out := *res
	if out.Image == "" && (out.Type == "image" || out.Type == "gif" || out.Type == "video") {
		out.Image = out.URL
	}
	out.Image = s.ProxyURL(out.Image)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	WriteJSON(w, http.StatusOK, &out)
}

// inviteCodeOf returns the code when raw is an invite link to this instance.
func (s *Server) inviteCodeOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	base, err := url.Parse(s.Cfg.PublicURL)
	if err != nil || !strings.EqualFold(u.Host, base.Host) {
		return ""
	}
	code, ok := strings.CutPrefix(u.Path, "/invite/")
	if !ok || code == "" || strings.Contains(code, "/") {
		return ""
	}
	return code
}

// inviteUnfurl builds the preview card for one of our own invite links.
func (s *Server) inviteUnfurl(r *http.Request, raw string) *unfurl.Result {
	code := s.inviteCodeOf(raw)
	if code == "" {
		return nil
	}
	ctx := r.Context()
	in, err := s.Store.InviteByCode(ctx, code)
	if err != nil {
		return nil
	}
	out := &unfurl.Result{URL: raw, Type: "invite", InviteCode: in.Code, SiteName: s.issuer()}
	if in.ServerID == nil {
		if in.ChannelID == nil {
			return nil
		}
		ch, err := s.Store.ChannelByID(ctx, *in.ChannelID)
		if err != nil {
			return nil
		}
		out.Title = ch.Name
		if out.Title == "" {
			out.Title = "Group chat"
		}
		out.Description = "You have been invited to a group chat."
		out.MemberCount = len(ch.Recipients)
		if ch.IconID != nil {
			out.Image = s.Cfg.PublicURL + "/media/icon/" + ch.IconID.String()
		}
		return out
	}
	srv, err := s.Store.ServerByID(ctx, *in.ServerID)
	if err != nil {
		return nil
	}
	count, _ := s.Store.MemberCount(ctx, srv.ID)
	out.Title = srv.Name
	out.Description = srv.Description
	if out.Description == "" {
		out.Description = "You have been invited to join this server."
	}
	out.MemberCount = count
	if h, ok := s.Bcast.(interface{ Online(ids.ID) bool }); ok {
		members, _ := s.Store.MemberIDs(ctx, srv.ID)
		for _, id := range members {
			if h.Online(id) {
				out.OnlineCount++
			}
		}
	}
	if srv.IconID != nil {
		out.Image = s.Cfg.PublicURL + "/media/icon/" + srv.IconID.String()
	}
	return out
}
