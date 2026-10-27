package unfurl

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// fakeResolver maps hostnames to literal addresses so tests never touch DNS.
type fakeResolver map[string][]string

func (r fakeResolver) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	addrs, ok := r[strings.ToLower(host)]
	if !ok {
		return nil, &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
	}
	out := make([]net.IPAddr, 0, len(addrs))
	for _, a := range addrs {
		ip := net.ParseIP(a)
		if ip == nil {
			panic("fakeResolver: bad ip " + a)
		}
		out = append(out, net.IPAddr{IP: ip})
	}
	return out, nil
}

func TestIsPublicIP(t *testing.T) {
	cases := []struct {
		ip   string
		want bool
	}{
		{"127.0.0.1", false},
		{"10.0.0.1", false},
		{"172.16.5.5", false},
		{"172.32.0.1", true},
		{"192.168.1.1", false},
		{"169.254.1.1", false},
		{"100.64.0.1", false},
		{"100.128.0.1", true},
		{"224.0.0.1", false},
		{"255.255.255.255", false},
		{"0.0.0.0", false},
		{"240.0.0.1", false},
		{"8.8.8.8", true},
		{"1.1.1.1", true},
		{"::1", false},
		{"fe80::1", false},
		{"fc00::1", false},
		{"fd12::1", false},
		{"::ffff:127.0.0.1", false},
		{"::ffff:8.8.8.8", true},
		{"64:ff9b::127.0.0.1", false},
		{"64:ff9b::169.254.169.254", false},
		{"64:ff9b::10.0.0.1", false},
		{"64:ff9b::8.8.8.8", true},
		{"64:ff9b:1::a00:1", false},
		{"2002:7f00:1::", false},
		{"2002:a00:1::", false},
		{"2002:808:808::", true},
		{"2001:0:4136:e378:8000:63bf:3fff:fdd2", false},
		{"::127.0.0.1", false},
		{"2001:db8::1", false},
		{"2606:4700::1111", true},
		{"192.0.2.1", false},
		{"198.51.100.1", false},
		{"203.0.113.1", false},
		{"::", false},
		{"ff02::1", false},
		{"172.31.255.255", false},
		{"172.15.0.1", true},
	}
	for _, tc := range cases {
		ip := net.ParseIP(tc.ip)
		if ip == nil {
			t.Fatalf("ParseIP(%q) failed", tc.ip)
		}
		if got := IsPublicIP(ip); got != tc.want {
			t.Errorf("IsPublicIP(%s) = %v, want %v", tc.ip, got, tc.want)
		}
	}
}

func TestIsPublicIPMalformed(t *testing.T) {
	if IsPublicIP(nil) {
		t.Error("IsPublicIP(nil) = true, want false")
	}
	if IsPublicIP(net.IP{1, 2, 3}) {
		t.Error("IsPublicIP(3-byte) = true, want false")
	}
}

func TestFetchBlockedURLs(t *testing.T) {
	f := &Fetcher{Resolver: fakeResolver{
		"private.test": {"127.0.0.1"},
		"mixed.test":   {"8.8.8.8", "10.0.0.1"},
		"empty.test":   {},
	}}
	cases := []struct {
		name string
		url  string
	}{
		{"loopback", "http://private.test/x"},
		{"mixed public and private", "http://mixed.test/x"},
		{"no addresses", "http://empty.test/x"},
		{"localhost", "http://localhost/x"},
		{"localhost subdomain", "http://foo.localhost/x"},
		{"non-http scheme", "ftp://a.b"},
		{"file scheme", "file:///etc/passwd"},
		{"userinfo", "http://user:pw@example.com"},
		{"public ssh port", "http://8.8.8.8:22/"},
		{"public alternate http port", "http://example.test:8080/"},
		{"public alternate https port", "https://example.test:8443/"},
		{"wrong scheme default", "https://example.test:80/"},
		{"empty host", "http:///x"},
		{"ip literal loopback", "http://127.0.0.1/x"},
		{"ip literal private", "http://10.1.2.3/x"},
		{"ip literal v6 loopback", "http://[::1]/x"},
		{"ip literal v4-mapped loopback", "http://[::ffff:127.0.0.1]/x"},
		{"garbage", "://nope"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, err := f.Fetch(context.Background(), tc.url)
			if !errors.Is(err, ErrBlocked) {
				t.Fatalf("Fetch(%q) err = %v, want ErrBlocked", tc.url, err)
			}
			if res != nil {
				t.Errorf("Fetch(%q) res = %+v, want nil", tc.url, res)
			}
		})
	}
}

// The guard must reject before any packet leaves: a host resolving to the test
// server's own loopback address must not reach the handler.
func TestFetchBlockedBeforeRequest(t *testing.T) {
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<html><head><title>nope</title></head></html>"))
	}))
	defer srv.Close()

	host, port, err := net.SplitHostPort(srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	f := &Fetcher{Resolver: fakeResolver{"rebind.test": {host}}}
	if _, err := f.Fetch(context.Background(), "http://rebind.test:"+port+"/page"); !errors.Is(err, ErrBlocked) {
		t.Fatalf("err = %v, want ErrBlocked", err)
	}
	if n := hits.Load(); n != 0 {
		t.Fatalf("server saw %d requests, want 0", n)
	}
}

// Even when DNS reports a public address, the dialer re-resolves and must reject
// a host whose second answer is private.
func TestGuardedDialRejectsPrivateAnswer(t *testing.T) {
	f := &Fetcher{Resolver: fakeResolver{"rebind.test": {"8.8.8.8", "127.0.0.1"}}}
	_, err := f.guardedDial(context.Background(), "tcp", "rebind.test:80")
	if !errors.Is(err, ErrBlocked) {
		t.Fatalf("guardedDial err = %v, want ErrBlocked", err)
	}
}

func TestGuardedDialRejectsEmptyAnswer(t *testing.T) {
	f := &Fetcher{Resolver: fakeResolver{"void.test": {}}}
	if _, err := f.guardedDial(context.Background(), "tcp", "void.test:80"); !errors.Is(err, ErrBlocked) {
		t.Fatalf("guardedDial err = %v, want ErrBlocked", err)
	}
}

func TestGuardedDialRejectsPublicNonWebPorts(t *testing.T) {
	f := &Fetcher{Resolver: fakeResolver{"public.test": {"8.8.8.8"}}, Dial: func(context.Context, string, string) (net.Conn, error) {
		t.Fatal("non-web port reached the dialer")
		return nil, nil
	}}
	if _, err := f.guardedDial(context.Background(), "tcp", "public.test:6379"); !errors.Is(err, ErrBlocked) {
		t.Fatalf("guardedDial err = %v, want ErrBlocked", err)
	}
}
