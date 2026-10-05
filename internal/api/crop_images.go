package api

import (
	"bytes"
	"io"
	"net/http"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/store"
)

// Avatar-like pictures are framed in the app and cut here, so what is kept is
// the part framed and no larger than where it goes. A moving picture stays
// moving. New clients send ?x=&y=&w=&h= for the part framed; old ones send
// nothing and keep what they sent when it already fits, so a picture the
// staff took down still matches by hash and every existing picture stays as
// it was.
const (
	avatarSide        = 1024
	userBannerW       = 1920
	userBannerH       = 768 // 600:240, as ProfilePage crops it
	serverBannerW     = 1280
	serverBannerH     = 720 // 16:9, as ServerOverviewPage crops it
	roleIconSide      = 128
	webhookAvatarSide = 512
)

// cropUpload reads a whole image body (at most the kind's bytes), checks it
// is an image within the kind's bounds, cuts the part framed to at most
// maxW×maxH, and stores it under kind. It answers for itself on bad input.
func (s *Server) cropUpload(w http.ResponseWriter, r *http.Request, kind string, maxW, maxH int, owner ids.ID) *store.Blob {
	lim := s.limitsFor(kind)
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, lim.MaxBytes+1))
	if err != nil || int64(len(data)) > lim.MaxBytes {
		WriteError(w, media.ErrTooLarge)
		return nil
	}
	width, height, err := media.ImageDims(bytes.NewReader(data))
	if err != nil {
		WriteError(w, media.ErrUnsupported)
		return nil
	} else if err := lim.Check(width, height); err != nil {
		WriteError(w, err)
		return nil
	}
	out := data
	if rect := cropFromQuery(r); !rect.Empty() || width > maxW || height > maxH {
		var err error
		out, _, err = media.Crop(data, media.CropSpec{Rect: rect, MaxW: maxW, MaxH: maxH})
		if err != nil {
			WriteError(w, cropError(err))
			return nil
		}
	}
	b, err := s.Media.PutPublic(r.Context(), kind, bytes.NewReader(out), media.Limits{MaxBytes: int64(len(out)) + 1, MaxW: maxW, MaxH: maxH}, owner)
	if err != nil {
		WriteError(w, err)
		return nil
	}
	return b
}
