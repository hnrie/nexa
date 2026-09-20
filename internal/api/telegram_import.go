package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"evilion.xyz/chat/internal/auth"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/store"
	"evilion.xyz/chat/internal/telegram"
)

func (s *Server) telegramEnabled() bool { return s.Cfg.TelegramBotToken != "" }

// telegramLimits are Telegram's own file caps, applied to an import instead
// of this server's sticker limits: Telegram is stricter than any sane local
// setting (512 KiB static, 64 KiB animated, 256 KiB video, 512 px a side), so
// its files are whitelisted from the local bounds and judged by its own.
func telegramLimits(ts telegram.Sticker) media.Limits {
	maxBytes := int64(512 << 10)
	if ts.IsVideo {
		maxBytes = 256 << 10
	} else if ts.IsAnim {
		maxBytes = 64 << 10
	}
	return media.Limits{MaxBytes: maxBytes, MaxW: 512, MaxH: 512}
}

// handleTelegramImport builds a sticker pack on the caller's account out of a
// Telegram sticker set. The set's title becomes the pack name and each
// sticker's emoji becomes its name and tags, so nothing about the set is lost.
// Static pictures, animated (.tgs) and video stickers all come over; one bad
// file never stops the rest, and the counts say what happened to every
// sticker.
func (s *Server) handleTelegramImport(w http.ResponseWriter, r *http.Request) {
	me := auth.UserFrom(r.Context())
	if !s.telegramEnabled() {
		WriteError(w, E(http.StatusNotImplemented, "telegram_disabled", "Telegram imports are not set up on this server."))
		return
	}
	var req struct {
		URL string `json:"url"`
	}
	if err := ReadJSON(w, r, &req, 2<<10); err != nil {
		WriteError(w, err)
		return
	}
	name, err := telegram.ParseSetName(req.URL)
	if err != nil {
		WriteError(w, E(http.StatusBadRequest, "invalid_pack_link", err.Error()))
		return
	}
	ctx := r.Context()
	client := telegram.NewClient(s.Cfg.TelegramBotToken)
	set, err := client.GetStickerSet(ctx, name)
	if err != nil {
		if terr, ok := err.(*telegram.Error); ok {
			WriteError(w, E(http.StatusBadGateway, "telegram_unavailable", "Telegram said: "+terr.Message))
			return
		}
		WriteError(w, E(http.StatusBadGateway, "telegram_unavailable", "Telegram could not be reached right now."))
		return
	}
	if len(set.Stickers) == 0 {
		WriteError(w, E(http.StatusBadRequest, "empty_pack", "That Telegram set has no stickers in it."))
		return
	}
	packName, _, apiErr := cleanPackFields(set.Title, "")
	if apiErr != nil {
		packName = name
	}
	uid := me.ID
	p := &store.StickerPack{
		Name:        packName,
		Description: "Imported from Telegram: t.me/addstickers/" + set.Name,
		Kind:        "sticker",
		OwnerUserID: &uid,
	}
	if err := s.Store.CreatePack(ctx, p); err != nil {
		WriteError(w, err)
		return
	}
	// From here on the pack exists, so every exit reports what landed in it
	// rather than leaving a half-built pack behind unexplained.
	total := len(set.Stickers)
	if total > telegram.MaxStickers {
		total = telegram.MaxStickers
	}
	// Downloads run several at a time: a hundred stickers one by one takes
	// the better part of a minute, uncomfortably close to how long a proxy
	// waits for an answer. Storing stays sequential below, in set order, so
	// positions match the original set and the database never sees
	// concurrent writes from one import.
	bodies := fetchTelegramFiles(ctx, client, set.Stickers[:total])
	imported, skipped, failed := 0, 0, 0
	for i := 0; i < total; i++ {
		ts := set.Stickers[i]
		stickerName := strings.TrimSpace(ts.Emoji)
		if stickerName == "" {
			stickerName = fmt.Sprintf("Sticker %d", i+1)
		}
		body, err := bodies[i].body, bodies[i].err
		if err != nil {
			if err == errTelegramSkipped {
				skipped++
			} else {
				failed++
				s.Log.Warn("telegram import file", "pack", p.ID.String(), "file", ts.FileID, "err", err)
			}
			continue
		}
		if err := s.importTelegramStickerBody(ctx, p, me.ID, stickerName, ts.Emoji, telegramLimits(ts), body); err != nil {
			if err == errTelegramSkipped {
				skipped++
			} else {
				failed++
				s.Log.Warn("telegram import file", "pack", p.ID.String(), "file", ts.FileID, "err", err)
			}
			continue
		}
		imported++
	}
	if imported == 0 {
		_ = s.Store.DeletePack(ctx, p.ID)
		if skipped > 0 && failed == 0 {
			WriteError(w, E(http.StatusBadRequest, "unsupported_pack", "Nothing in that set is a sticker this site accepts."))
			return
		}
		WriteError(w, E(http.StatusBadGateway, "telegram_unavailable", "Nothing in that set could be downloaded right now."))
		return
	}
	updated, err := s.Store.PackByID(ctx, p.ID)
	if err != nil {
		WriteError(w, err)
		return
	}
	s.notifyPack(ctx, updated, false)
	WriteJSON(w, http.StatusCreated, map[string]any{
		"pack":     updated,
		"imported": imported,
		"skipped":  skipped,
		"failed":   failed,
		"total":    len(set.Stickers),
	})
}

// errTelegramSkipped marks a file that is not a sticker at all (too big for
// Telegram's own caps, corrupt, or an unrecognised shape), as opposed to one
// that failed to arrive.
var errTelegramSkipped = errors.New("not a usable sticker file")

// fetchTelegramFiles downloads every sticker file, a few at a time, keeping
// set order: results[i] answers set[i]. A file that is empty or a shape this
// site never stores is marked skipped up front, so junk never reaches the
// store; anything else that goes wrong is an error for the caller to count.
func fetchTelegramFiles(ctx context.Context, client *telegram.Client, stickers []telegram.Sticker) []struct {
	body []byte
	err  error
} {
	const concurrent = 6
	out := make([]struct {
		body []byte
		err  error
	}, len(stickers))
	var wg sync.WaitGroup
	sem := make(chan struct{}, concurrent)
	for i := range stickers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				out[i].err = ctx.Err()
				return
			}
			ts := stickers[i]
			bf, err := client.GetFile(ctx, ts.FileID)
			if err != nil {
				out[i].err = err
				return
			}
			lim := telegramLimits(ts)
			body, err := client.DownloadFile(ctx, client.FileURL(bf.FilePath), lim.MaxBytes+1)
			if err != nil {
				out[i].err = err
				return
			}
			head := body
			if len(head) > 1<<20 {
				head = head[:1<<20]
			}
			if len(head) == 0 {
				out[i].err = errTelegramSkipped
				return
			}
			if _, _, ok := media.Sniff(head); !ok {
				out[i].err = errTelegramSkipped
				return
			}
			out[i].body = body
		}(i)
	}
	wg.Wait()
	return out
}

// importTelegramStickerBody stores one downloaded file as a sticker of pack
// p, exactly as if the caller had uploaded the picture themselves, except
// the bounds are Telegram's own: its files answer to its caps, not to this
// server's sticker limits.
func (s *Server) importTelegramStickerBody(ctx context.Context, p *store.StickerPack, owner ids.ID, name, tags string, lim media.Limits, body []byte) error {
	b, err := s.Media.PutPublic(ctx, "sticker", bytes.NewReader(body), lim, owner)
	if err != nil {
		return err
	}
	format := stickerFormat(b.Mime, b.Animated)
	if format == "" {
		s.releaseBlob(ctx, b.ID)
		return errTelegramSkipped
	}
	cleanName, ok := CleanText(name, maxStickerName)
	if !ok || cleanName == "" {
		s.releaseBlob(ctx, b.ID)
		return errTelegramSkipped
	}
	cleanTags, ok := CleanText(tags, maxStickerTags)
	if !ok {
		cleanTags = ""
	}
	st := &store.Sticker{PackID: p.ID, Name: cleanName, Tags: cleanTags, BlobID: b.ID, Format: format, CreatorID: owner, Width: b.Width, Height: b.Height, Animated: b.Animated}
	if err := s.Store.AddSticker(ctx, st); err != nil {
		s.releaseBlob(ctx, b.ID)
		return err
	}
	if p.CoverStickerID == nil {
		ptr := &st.ID
		_ = s.Store.UpdatePack(ctx, p.ID, store.StickerPackPatch{CoverStickerID: &ptr})
		p.CoverStickerID = ptr
	}
	return nil
}
