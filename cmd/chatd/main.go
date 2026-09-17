// Command chatd is the Nexa server: REST API, WebSocket gateway, media
// storage and the built web app, in one process.
package main

import (
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/coder/websocket"

	"evilion.xyz/chat/internal/api"
	"evilion.xyz/chat/internal/cache"
	"evilion.xyz/chat/internal/config"
	"evilion.xyz/chat/internal/db"
	"evilion.xyz/chat/internal/gateway"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/store"
	"evilion.xyz/chat/internal/unfurl"
)

// version is set at build time: -ldflags "-X main.version=…".
var version = "dev"

func main() {
	envFile := flag.String("env", "chatd.env", "path to an optional KEY=VALUE env file")
	flag.Parse()

	fileEnv, err := config.LoadEnvFile(*envFile)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		slog.Error("env file", "path", *envFile, "err", err)
		os.Exit(2)
	}
	getenv := func(k string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return fileEnv[k]
	}
	cfg, err := config.Load(getenv)
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(2)
	}
	log := setupLogging(cfg.LogLevel)

	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		log.Error("data dir", "err", err)
		os.Exit(1)
	}
	dbAddr := cfg.DatabaseURL
	if dbAddr == "" {
		dbAddr = filepath.Join(cfg.DataDir, "chat.db")
	}
	database, err := db.OpenURL(dbAddr)
	if err != nil {
		log.Error("open database", "err", err)
		os.Exit(1)
	}
	if err := database.Migrate(context.Background()); err != nil {
		log.Error("migrate", "err", err)
		os.Exit(1)
	}
	st := store.New(database)
	mediaStore, err := media.New(filepath.Join(cfg.DataDir, "media"), st)
	if err != nil {
		log.Error("media dir", "err", err)
		os.Exit(1)
	}
	secret, err := loadOrCreateSecret(filepath.Join(cfg.DataDir, "server.secret"))
	if err != nil {
		log.Error("server secret", "err", err)
		os.Exit(1)
	}

	shared, err := cache.Open(cfg.RedisURL)
	if err != nil {
		log.Error("open redis", "err", err)
		os.Exit(1)
	}
	defer shared.Close()

	srv := api.NewServer(cfg, st, log, nil)
	srv.Version = version
	// With a Redis behind it every process counts against one allowance; with
	// none, each keeps its own, which is right while there is only one.
	if cfg.RedisURL != "" {
		srv.ShareLimiters(shared)
	}
	srv.Secret = secret
	srv.Media = mediaStore
	srv.Unfurl = unfurl.NewService()
	// Twitch's player refuses to open unless it is told which page holds it.
	if u, err := url.Parse(cfg.PublicURL); err == nil {
		srv.Unfurl.Fetcher.ParentHost = u.Hostname()
	}
	hub := gateway.New(st, srv.Auth, log, cfg.PublicURL)
	srv.Bcast = hub
	srv.WireServers(hub)
	srv.WireVoice(hub)
	srv.WireActivities(hub)
	srv.Extra = append(srv.Extra, func(mux *http.ServeMux) { mux.Handle("GET /gateway", hub) })

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)
	srv.StartLimiters(ctx)
	srv.StartGuests(ctx)
	if srv.Meter != nil {
		go srv.Meter.Run(ctx, time.Minute, func(err error) { log.Warn("realtime usage", "err", err) })
	}
	go maintenance(ctx, log, st, mediaStore, cfg.SessionTTL)

	httpSrv := &http.Server{Addr: cfg.Listen, Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	errc := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.Listen, "public_url", cfg.PublicURL, "version", version, "web_dist", cfg.WebDist, "captcha", cfg.TurnstileSecretKey != "", "sfu", srv.Realtime != nil, "database", string(database.Dialect), "redis", cfg.RedisURL != "")
		errc <- httpSrv.ListenAndServe()
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	select {
	case sig := <-stop:
		log.Info("shutting down", "signal", sig.String())
	case err := <-errc:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("serve", "err", err)
			os.Exit(1)
		}
	}
	cancel()
	hub.CloseAll(websocket.StatusGoingAway, "server restarting")
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Warn("http shutdown", "err", err)
	}
	if err := database.Close(); err != nil {
		log.Warn("database close", "err", err)
	}
	log.Info("stopped")
}

// maintenance runs periodic cleanups: unreferenced blobs and expired sessions.
func maintenance(ctx context.Context, log *slog.Logger, st *store.Store, m *media.Store, sessionTTL time.Duration) {
	run := func() {
		if n, err := m.GC(ctx, time.Now().Add(-24*time.Hour).UnixMilli()); err != nil {
			log.Warn("blob gc", "err", err)
		} else if n > 0 {
			log.Info("blob gc", "removed", n)
		}
		if n, err := st.DeleteExpiredSessions(ctx, time.Now().Add(-sessionTTL).UnixMilli()); err != nil {
			log.Warn("session sweep", "err", err)
		} else if n > 0 {
			log.Info("session sweep", "removed", n)
		}
		// transfers nobody came back to finish, and the bytes they left behind
		if stale, err := st.StaleUploads(ctx, time.Now().Add(-24*time.Hour).UnixMilli()); err == nil && len(stale) > 0 {
			for _, id := range stale {
				m.DiscardSpool(id)
				_ = st.DeleteUpload(ctx, id)
			}
			log.Info("upload sweep", "removed", len(stale))
		}
		if n := sweepTemp(ctx, st, m.Dir, time.Now()); n > 0 {
			log.Info("temp sweep", "removed", n)
		}
	}
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return
	case <-time.After(time.Minute):
		run()
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}

// sweepTemp removes the temp files that requests cut short by a restart or
// crash leave in the media directory, since only the request that made them
// would have deleted them. Files still being written keep a fresh modification
// time, so only ones idle for an hour go; a resumable spool also needs its
// upload row to be gone, and gets the day a client has to come back for it.
func sweepTemp(ctx context.Context, st *store.Store, dir string, now time.Time) int {
	removed := 0
	remove := func(path string) {
		if os.Remove(path) == nil {
			removed++
		}
	}
	idle := func(path string, d time.Duration) bool {
		info, err := os.Lstat(path)
		return err == nil && info.Mode().IsRegular() && info.ModTime().Before(now.Add(-d))
	}
	entries, _ := os.ReadDir(filepath.Join(dir, "tmp"))
	for _, e := range entries {
		path := filepath.Join(dir, "tmp", e.Name())
		switch {
		case strings.HasPrefix(e.Name(), "upload-"):
			if idle(path, time.Hour) {
				remove(path)
			}
		case strings.HasPrefix(e.Name(), "resume-"):
			id, err := ids.Parse(strings.TrimPrefix(e.Name(), "resume-"))
			if err != nil || !idle(path, 24*time.Hour) {
				continue
			}
			if _, err := st.UploadByID(ctx, id); errors.Is(err, store.ErrNotFound) {
				remove(path)
			}
		}
	}
	variants, _ := filepath.Glob(filepath.Join(dir, "variants", "*", ".variant-*"))
	for _, path := range variants {
		if idle(path, time.Hour) {
			remove(path)
		}
	}
	return removed
}

// loadOrCreateSecret returns a stable random secret persisted at path. The
// secret seals every two-factor seed, so a file that exists but cannot be read
// or is too short stops startup instead of being replaced: a new secret would
// lock every 2FA user out and destroy the one that still works.
func loadOrCreateSecret(path string) ([]byte, error) {
	b, err := os.ReadFile(path)
	if err == nil {
		if len(b) < 32 {
			return nil, fmt.Errorf("%s is shorter than 32 bytes; refusing to replace it", path)
		}
		return b, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	b = make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	// Written beside the real path and renamed into place, so a crash half way
	// never leaves a truncated secret behind.
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return nil, err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return nil, err
	}
	if err := f.Close(); err != nil {
		return nil, err
	}
	if err := os.Rename(tmp, path); err != nil {
		return nil, err
	}
	return b, nil
}

func setupLogging(level string) *slog.Logger {
	var lv slog.Level
	switch level {
	case "debug":
		lv = slog.LevelDebug
	case "warn":
		lv = slog.LevelWarn
	case "error":
		lv = slog.LevelError
	default:
		lv = slog.LevelInfo
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lv}))
	slog.SetDefault(log)
	return log
}
