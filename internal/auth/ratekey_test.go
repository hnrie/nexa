package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRateKeyCountsAnIPv6ClientByItsSlash64(t *testing.T) {
	req := func(remote, cf string) *http.Request {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = remote
		if cf != "" {
			r.Header.Set("CF-Connecting-IP", cf)
		}
		return r
	}
	if got := RateKey(req("203.0.113.9:5555", "")); got != "203.0.113.9" {
		t.Errorf("IPv4: %q", got)
	}
	a := RateKey(req("127.0.0.1:1", "2001:db8:1:2:aaaa::1"))
	b := RateKey(req("127.0.0.1:1", "2001:db8:1:2:ffff:ffff:ffff:ffff"))
	c := RateKey(req("127.0.0.1:1", "2001:db8:1:3::1"))
	if a != b || a == c || a != "2001:db8:1:2::/64" {
		t.Errorf("IPv6: %q %q %q", a, b, c)
	}
	if got := RateKey(req("[::ffff:198.51.100.7]:80", "")); got != "::ffff:198.51.100.7" && got != "198.51.100.7" {
		t.Errorf("mapped IPv4: %q", got)
	}
}
