// Package unfurl fetches link previews with SSRF protection: only public
// addresses are ever dialed, redirects are re-validated, and bodies are capped.
package unfurl

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"
)

var (
	ErrBlocked     = errors.New("unfurl: address not allowed")
	ErrUnsupported = errors.New("unfurl: nothing to embed")
	ErrTooLarge    = errors.New("unfurl: response too large")
)

var blockedNets []*net.IPNet

var nat64Prefix = net.ParseIP("64:ff9b::")[:12]

func init() {
	for _, cidr := range []string{
		"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
		"192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
		"224.0.0.0/4", "240.0.0.0/4", "255.255.255.255/32",
		"::/128", "::1/128", "fc00::/7", "fe80::/10", "ff00::/8", "2001:db8::/32",
		// IPv4-compatible addresses, local-use translation, and Teredo must
		// not turn a public-looking IPv6 address into an internal IPv4 hop.
		"::/96", "64:ff9b:1::/48", "2001::/32",
	} {
		_, n, err := net.ParseCIDR(cidr)
		if err != nil {
			panic(err)
		}
		blockedNets = append(blockedNets, n)
	}
}

// IsPublicIP reports whether ip is a globally routable unicast address.
func IsPublicIP(ip net.IP) bool {
	if ip == nil || (len(ip) != net.IPv4len && len(ip) != net.IPv6len) {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4 // an IPv4-mapped IPv6 address is judged by its IPv4 rules
	}
	if len(ip) == net.IPv6len {
		if bytes.Equal(ip[:12], nat64Prefix) && !IsPublicIP(ip[12:]) {
			return false
		}
		// 6to4 routes through the IPv4 address in its second and third words.
		if ip[0] == 0x20 && ip[1] == 0x02 && !IsPublicIP(ip[2:6]) {
			return false
		}
	}
	if ip.IsUnspecified() || ip.IsLoopback() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsPrivate() || ip.IsInterfaceLocalMulticast() {
		return false
	}
	for _, n := range blockedNets {
		if n.Contains(ip) {
			return false
		}
	}
	return true
}

// Resolver is the subset of net.Resolver the guard needs.
type Resolver interface {
	LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error)
}

// checkURL validates scheme, userinfo and host syntax without touching DNS.
func checkURL(u *url.URL) error {
	if u == nil {
		return ErrBlocked
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ErrBlocked
	}
	if u.User != nil {
		return ErrBlocked
	}
	// Preview/proxy fetching is a web fetcher, not a public-port scanner.
	// Apply this before DNS and again to every redirect.
	if port := u.Port(); port != "" && !((u.Scheme == "http" && port == "80") || (u.Scheme == "https" && port == "443")) {
		return ErrBlocked
	}
	host := strings.ToLower(u.Hostname())
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return ErrBlocked
	}
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil && !IsPublicIP(ip) {
		return ErrBlocked
	}
	return nil
}

// resolvePublic resolves host and returns its addresses, or ErrBlocked when
// any of them is not public (a host must be safe under every answer).
func (f *Fetcher) resolvePublic(ctx context.Context, host string) ([]net.IP, error) {
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil {
		if !IsPublicIP(ip) {
			return nil, ErrBlocked
		}
		return []net.IP{ip}, nil
	}
	r := f.Resolver
	if r == nil {
		r = net.DefaultResolver
	}
	addrs, err := r.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("unfurl: resolve %s: %w", host, err)
	}
	if len(addrs) == 0 {
		return nil, ErrBlocked
	}
	ips := make([]net.IP, 0, len(addrs))
	for _, a := range addrs {
		if !IsPublicIP(a.IP) {
			return nil, ErrBlocked
		}
		ips = append(ips, a.IP)
	}
	return ips, nil
}

// guardedDial resolves addr's host, refuses non-public answers and dials the
// first public address. Used as the transport's DialContext so DNS rebinding
// cannot slip a private address past the pre-check.
func (f *Fetcher) guardedDial(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil || (port != "80" && port != "443") {
		return nil, ErrBlocked
	}
	ips, err := f.resolvePublic(ctx, host)
	if err != nil {
		return nil, err
	}
	dial := (&net.Dialer{Timeout: 5 * time.Second}).DialContext
	if f.Dial != nil {
		dial = f.Dial
	}
	var lastErr error
	for _, ip := range ips {
		conn, err := dial(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}
