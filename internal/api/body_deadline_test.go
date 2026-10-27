package api

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAStalledBodyReleasesItsHandler(t *testing.T) {
	for _, contentType := range []string{"application/json", "application/octet-stream"} {
		t.Run(contentType, func(t *testing.T) {
			done := make(chan error, 1)
			server := httptest.NewServer(bodyReadDeadline(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, err := io.Copy(io.Discard, r.Body)
				done <- err
				w.WriteHeader(http.StatusRequestTimeout)
			}), 30*time.Millisecond, 30*time.Millisecond))
			defer server.Close()
			conn, err := net.Dial("tcp", server.Listener.Addr().String())
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			_, err = io.WriteString(conn, "POST / HTTP/1.1\r\nHost: audit.test\r\nContent-Type: "+contentType+"\r\nContent-Length: 100\r\n\r\nx")
			if err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("truncated stalled body was accepted")
				}
			case <-time.After(2 * time.Second):
				t.Fatal("handler still waiting on a stalled body")
			}
			_ = conn.SetReadDeadline(time.Now().Add(time.Second))
			res, err := http.ReadResponse(bufio.NewReader(conn), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			if res.StatusCode != http.StatusRequestTimeout {
				t.Fatalf("status %d", res.StatusCode)
			}
		})
	}
}
