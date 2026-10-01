// Package egress sends the requests a person can point this server at (link
// previews, the media proxy, social posts, the YouTube player) out through a
// SOCKS5 proxy, normally Cloudflare WARP's local one, so the sites they name
// see Cloudflare's address and never this server's. Everything else (the
// tunnel, Discord's gateway, Cloudflare Realtime) goes out directly as before.
//
// It fails closed: with the proxy down, these requests fail rather than going
// out directly, which would hand the address to whoever asked for them.
package egress

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/proxy"
)

// dnsServer answers the lookups made through the proxy: a person who names a
// host on a nameserver they run would otherwise see this server's resolver ask.
const dnsServer = "1.1.1.1:53"

// Proxy is a SOCKS5 proxy the server's outbound requests go through.
type Proxy struct {
	// Addr is the proxy's host:port.
	Addr   string
	dialer proxy.ContextDialer
}

// Parse reads a proxy address: "socks5://host:port", or a bare "host:port".
func Parse(raw string) (*Proxy, error) {
	raw = strings.TrimSpace(raw)
	if !strings.Contains(raw, "://") {
		raw = "socks5://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("egress: %q is not a proxy address", raw)
	}
	if u.Scheme != "socks5" && u.Scheme != "socks5h" {
		return nil, fmt.Errorf("egress: only SOCKS5 proxies are supported, not %q", u.Scheme)
	}
	if _, _, err := net.SplitHostPort(u.Host); err != nil {
		return nil, fmt.Errorf("egress: %q needs a port", raw)
	}
	var auth *proxy.Auth
	if u.User != nil {
		pw, _ := u.User.Password()
		auth = &proxy.Auth{User: u.User.Username(), Password: pw}
	}
	d, err := proxy.SOCKS5("tcp", u.Host, auth, &net.Dialer{Timeout: 5 * time.Second})
	if err != nil {
		return nil, err
	}
	cd, ok := d.(proxy.ContextDialer)
	if !ok {
		return nil, errors.New("egress: the SOCKS5 dialer cannot take a context")
	}
	return &Proxy{Addr: u.Host, dialer: cd}, nil
}

// DialContext connects to addr through the proxy. A host name in addr is
// resolved by the proxy's side, not here.
func (p *Proxy) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	switch network {
	case "tcp", "tcp4", "tcp6":
	default:
		return nil, fmt.Errorf("egress: %s cannot go through a SOCKS5 proxy", network)
	}
	conn, err := p.dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("egress: through %s: %w", p.Addr, err)
	}
	return conn, nil
}

// Resolver looks names up over TCP through the proxy, so the nameserver of a
// host a person named sees Cloudflare's resolver ask, not this server's.
func (p *Proxy) Resolver() *net.Resolver {
	return &net.Resolver{
		PreferGo: true,
		// a stream connection makes the Go resolver speak DNS over TCP
		Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return p.DialContext(ctx, "tcp", dnsServer)
		},
	}
}

// Transport is an http.Transport whose every connection goes through the
// proxy, for clients that talk to one fixed service.
func (p *Proxy) Transport() *http.Transport {
	return &http.Transport{
		Proxy:                 nil,
		DialContext:           p.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          32,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   8 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
}

// Check reports whether the proxy is taking connections and can reach the
// internet, by opening one to Cloudflare's resolver through it.
func (p *Proxy) Check(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	conn, err := p.DialContext(ctx, "tcp", dnsServer)
	if err != nil {
		return err
	}
	return conn.Close()
}
