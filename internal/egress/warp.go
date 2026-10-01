package egress

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// DefaultWarpPort is where WARP's proxy listens unless told otherwise.
const DefaultWarpPort = 40000

// ErrNoWarp means warp-cli is not installed. deploy/warp-proxy.sh installs it.
var ErrNoWarp = errors.New("egress: warp-cli is not installed (run deploy/warp-proxy.sh)")

// warpPaths are where the WARP client puts warp-cli when it is not on PATH:
// the macOS app bundle, and the usual bin directories a service's PATH can miss.
var warpPaths = []string{
	"/usr/bin/warp-cli",
	"/usr/local/bin/warp-cli",
	"/opt/homebrew/bin/warp-cli",
	"/Applications/Cloudflare WARP.app/Contents/Resources/warp-cli",
}

// FindWarpCLI is the path of warp-cli, or "" when it is not installed.
func FindWarpCLI() string {
	if p, err := exec.LookPath("warp-cli"); err == nil {
		return p
	}
	for _, p := range warpPaths {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// Warp keeps Cloudflare WARP running as a local SOCKS5 proxy (its "proxy"
// mode) instead of a tunnel for the whole machine, and connected.
type Warp struct {
	CLI  string
	Port int
	Log  *slog.Logger
}

// Proxy is the SOCKS5 proxy WARP serves on its port.
func (w *Warp) Proxy() (*Proxy, error) {
	return Parse("socks5://127.0.0.1:" + strconv.Itoa(w.port()))
}

func (w *Warp) port() int {
	if w.Port > 0 {
		return w.Port
	}
	return DefaultWarpPort
}

func (w *Warp) run(ctx context.Context, args ...string) (string, error) {
	if w.CLI == "" {
		return "", ErrNoWarp
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, w.CLI, append([]string{"--accept-tos"}, args...)...).CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		return text, fmt.Errorf("warp-cli %s: %w: %s", strings.Join(args, " "), err, text)
	}
	return text, nil
}

// Ensure puts WARP in proxy mode on its port and connects it, registering this
// machine first when it never has been. It changes only what is not already
// so, then waits for the proxy to take connections.
func (w *Warp) Ensure(ctx context.Context) error {
	if w.CLI == "" {
		return ErrNoWarp
	}
	status, _ := w.run(ctx, "status")
	if strings.Contains(strings.ToLower(status), "registration missing") {
		if _, err := w.run(ctx, "registration", "new"); err != nil {
			return err
		}
	}
	settings, err := w.run(ctx, "settings")
	if err != nil {
		return err
	}
	if !proxyModeOn(settings, w.port()) {
		// the port first: switching mode starts the proxy on whatever port is set
		if _, err := w.run(ctx, "proxy", "port", strconv.Itoa(w.port())); err != nil {
			return err
		}
		if _, err := w.run(ctx, "mode", "proxy"); err != nil {
			return err
		}
	}
	if status, _ = w.run(ctx, "status"); !strings.Contains(status, "Connected") || strings.Contains(status, "Disconnected") {
		if _, err := w.run(ctx, "connect"); err != nil {
			return err
		}
	}
	p, err := w.Proxy()
	if err != nil {
		return err
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		err = p.Check(ctx)
		if err == nil || time.Now().After(deadline) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// proxyModeOn reports whether warp-cli's settings say it is a proxy on port.
// They read "Mode: WarpProxy on port 40000" in proxy mode.
func proxyModeOn(settings string, port int) bool {
	for _, line := range strings.Split(settings, "\n") {
		if i := strings.Index(line, "Mode:"); i >= 0 && !strings.Contains(line, "Protocol") {
			mode := strings.TrimSpace(line[i+len("Mode:"):])
			if strings.HasPrefix(strings.ToLower(mode), "warpproxy") || strings.HasPrefix(strings.ToLower(mode), "proxy") {
				return strings.Contains(mode, strconv.Itoa(port))
			}
		}
	}
	return false
}

// Keep checks the proxy every interval until ctx ends, and sets WARP up again
// whenever it stops answering (after a reboot of the daemon, or a disconnect).
func (w *Warp) Keep(ctx context.Context, interval time.Duration) {
	p, err := w.Proxy()
	if err != nil {
		return
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	down := false
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		if p.Check(ctx) == nil {
			if down && w.Log != nil {
				w.Log.Info("warp proxy is back", "addr", p.Addr)
			}
			down = false
			continue
		}
		if err := w.Ensure(ctx); err != nil {
			if !down && w.Log != nil {
				w.Log.Error("warp proxy is down; link previews and the media proxy are refused until it is back", "err", err)
			}
			down = true
			continue
		}
		if down && w.Log != nil {
			w.Log.Info("warp proxy is back", "addr", p.Addr)
		}
		down = false
	}
}
