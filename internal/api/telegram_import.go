package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

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
// telegramImportTimeout bounds an import once its pack exists: long enough
// for the largest set over a slow link, short enough that one stuck on
// Telegram's side gives up.
const telegramImportTimeout = 10 * time.Minute

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
	// every import has this server fetch a whole set from Telegram, under a
	// bot whose limits everyone here shares: a script must not run through them
	if !s.requireCaptcha(w, r, "sticker_import") {
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
	// From here on the pack exists and the answer is 201 with a
	// newline-delimited body: a line per sticker while the import runs, then
	// the pack as the last line, so the client can fill a progress bar.
	// Everything that can fail before the pack exists stays a plain JSON
	// error above. If the client goes away mid-stream the import still
	// finishes: the pack arrives separately over the gateway anyway.
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusCreated)
	enc := json.NewEncoder(w)
	flushed := func() {
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
	alive := true
	var sendMu sync.Mutex
	send := func(v any) {
		sendMu.Lock()
		defer sendMu.Unlock()
		if !alive {
			return
		}
		if err := enc.Encode(v); err != nil {
			alive = false
			return
		}
		flushed()
	}
	// From here the import runs to the end whether or not anyone is still
	// listening: a phone that drops its connection must not leave an empty
	// pack behind, or a half-filled one its other devices never hear about.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), telegramImportTimeout)
	defer cancel()
	total := len(set.Stickers)
	if total > telegram.MaxStickers {
		total = telegram.MaxStickers
	}
	// Downloads run several at a time: a hundred stickers one by one takes
	// the better part of a minute, uncomfortably close to how long a proxy
	// waits for an answer. Storing stays sequential below, in set order, so
	// positions match the original set and the database never sees
	// concurrent writes from one import.
	bodies := fetchTelegramFiles(ctx, client, set.Stickers[:total], func(done int) {
		send(map[string]any{"phase": "fetch", "done": done, "total": total})
	})
	imported, skipped, failed := 0, 0, 0
	tally := func(err error, fileID string) {
		if err == nil {
			imported++
			return
		}
		if err == errTelegramSkipped {
			skipped++
			return
		}
		failed++
		s.Log.Warn("telegram import file", "pack", p.ID.String(), "file", fileID, "err", err)
	}
	for i := 0; i < total; i++ {
		ts := set.Stickers[i]
		stickerName := strings.TrimSpace(ts.Emoji)
		if stickerName == "" {
			stickerName = fmt.Sprintf("Sticker %d", i+1)
		}
		if err := bodies[i].err; err != nil {
			tally(err, ts.FileID)
		} else if err := s.importTelegramStickerBody(ctx, p, me.ID, stickerName, ts.Emoji, telegramLimits(ts), bodies[i].body); err != nil {
			tally(err, ts.FileID)
		} else {
			tally(nil, ts.FileID)
		}
		send(map[string]any{"phase": "store", "done": i + 1, "total": total, "imported": imported, "skipped": skipped, "failed": failed})
	}
	if imported == 0 {
		_ = s.Store.DeletePack(ctx, p.ID)
		if skipped > 0 && failed == 0 {
			send(map[string]any{"error": map[string]any{"code": "unsupported_pack", "message": "Nothing in that set is a sticker this site accepts."}})
			return
		}
		send(map[string]any{"error": map[string]any{"code": "telegram_unavailable", "message": "Nothing in that set could be downloaded right now."}})
		return
	}
	updated, err := s.Store.PackByID(ctx, p.ID)
	if err != nil {
		send(map[string]any{"error": map[string]any{"code": "internal", "message": "Something went wrong on the server."}})
		return
	}
	s.notifyPack(ctx, updated, false)
	send(map[string]any{"done": true, "pack": updated, "imported": imported, "skipped": skipped, "failed": failed, "total": len(set.Stickers)})
}

// errTelegramSkipped marks a file that is not a sticker at all (too big for
// Telegram's own caps, corrupt, or an unrecognised shape), as opposed to one
// that failed to arrive.
var errTelegramSkipped = errors.New("not a usable sticker file")

// fetchTelegramFiles downloads every sticker file, a few at a time, keeping
// set order: results[i] answers set[i]. progress hears each completion in
// arrival order. A file that is empty or a shape this site never stores is
// marked skipped up front, so junk never reaches the store; anything else
// that goes wrong is an error for the caller to count.
func fetchTelegramFiles(ctx context.Context, client *telegram.Client, stickers []telegram.Sticker, progress func(done int)) []struct {
	body []byte
	err  error
} {
	const concurrent = 6
	out := make([]struct {
		body []byte
		err  error
	}, len(stickers))
	var wg sync.WaitGroup
	var done atomic.Int64
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
				progress(int(done.Add(1)))
				return
			}
			ts := stickers[i]
			bf, err := client.GetFile(ctx, ts.FileID)
			if err != nil {
				out[i].err = err
				progress(int(done.Add(1)))
				return
			}
			lim := telegramLimits(ts)
			body, err := client.DownloadFile(ctx, client.FileURL(bf.FilePath), lim.MaxBytes+1)
			if err != nil {
				out[i].err = err
				progress(int(done.Add(1)))
				return
			}
			head := body
			if len(head) > 1<<20 {
				head = head[:1<<20]
			}
			if len(head) == 0 {
				out[i].err = errTelegramSkipped
				progress(int(done.Add(1)))
				return
			}
			if _, _, ok := media.Sniff(head); !ok {
				out[i].err = errTelegramSkipped
				progress(int(done.Add(1)))
				return
			}
			out[i].body = body
			progress(int(done.Add(1)))
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
