// Command chatd is the Evilion Chat server: REST API, WebSocket gateway, media
// storage and the built web app, in one process.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"evilion.xyz/chat/internal/config"
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
	setupLogging(cfg.LogLevel)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "version": version})
	})

	srv := &http.Server{Addr: cfg.Listen, Handler: mux, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	errc := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", cfg.Listen, "version", version)
		errc <- srv.ListenAndServe()
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	select {
	case sig := <-stop:
		slog.Info("shutting down", "signal", sig.String())
	case err := <-errc:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("serve", "err", err)
			os.Exit(1)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		slog.Warn("shutdown", "err", err)
	}
}

func setupLogging(level string) {
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
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lv})))
}
