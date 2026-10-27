package api

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestBotAndAccountGatewaysShareUnauthenticatedConnectionLimit(t *testing.T) {
	srv, ts := newTestServer(t)
	srv.hub.SetLimits(32, 256, 2, 32)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	base := "ws" + strings.TrimPrefix(ts.URL, "http")
	first, _, err := websocket.Dial(ctx, base+"/bot-gateway?v=10", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer first.CloseNow()
	second, _, err := websocket.Dial(ctx, base+"/bot-gateway?v=10", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.CloseNow()
	for _, path := range []string{"/bot-gateway?v=10", "/gateway"} {
		conn, res, err := websocket.Dial(ctx, base+path, nil)
		if conn != nil {
			conn.CloseNow()
		}
		if err == nil || res == nil || res.StatusCode != http.StatusServiceUnavailable {
			t.Fatalf("%s bypassed the shared connection limit: %v, %v", path, res, err)
		}
	}
	first.CloseNow()
	// Closing a waiting bot must give the place back to either gateway.
	deadline := time.Now().Add(time.Second)
	for {
		conn, _, err := websocket.Dial(ctx, base+"/gateway", nil)
		if err == nil {
			conn.CloseNow()
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("closing the bot socket did not release its place")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
