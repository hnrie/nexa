package egress

import (
	"context"
	"encoding/binary"
	"io"
	"net"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

// socksServer is a SOCKS5 proxy that only knows CONNECT without a password,
// counting what it is asked to reach.
type socksServer struct {
	ln    net.Listener
	asked atomic.Int64
	last  atomic.Value
}

func newSocks(t *testing.T) *socksServer {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &socksServer{ln: ln}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go s.serve(c)
		}
	}()
	return s
}

func (s *socksServer) serve(c net.Conn) {
	defer c.Close()
	head := make([]byte, 2)
	if _, err := io.ReadFull(c, head); err != nil {
		return
	}
	io.ReadFull(c, make([]byte, head[1]))
	c.Write([]byte{5, 0})
	req := make([]byte, 4)
	if _, err := io.ReadFull(c, req); err != nil {
		return
	}
	var host string
	switch req[3] {
	case 1:
		ip := make([]byte, 4)
		io.ReadFull(c, ip)
		host = net.IP(ip).String()
	case 3:
		n := make([]byte, 1)
		io.ReadFull(c, n)
		name := make([]byte, n[0])
		io.ReadFull(c, name)
		host = string(name)
	case 4:
		ip := make([]byte, 16)
		io.ReadFull(c, ip)
		host = net.IP(ip).String()
	}
	pb := make([]byte, 2)
	io.ReadFull(c, pb)
	target := net.JoinHostPort(host, strconv.Itoa(int(binary.BigEndian.Uint16(pb))))
	s.asked.Add(1)
	s.last.Store(target)
	up, err := net.DialTimeout("tcp", target, 2*time.Second)
	if err != nil {
		c.Write([]byte{5, 5, 0, 1, 0, 0, 0, 0, 0, 0})
		return
	}
	defer up.Close()
	c.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0})
	go io.Copy(up, c)
	io.Copy(c, up)
}

func echoServer(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() { defer c.Close(); io.Copy(c, c) }()
		}
	}()
	return ln.Addr().String()
}

func TestDialGoesThroughTheProxy(t *testing.T) {
	socks := newSocks(t)
	echo := echoServer(t)
	p, err := Parse("socks5://" + socks.ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := p.DialContext(ctx, "tcp", echo)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.Write([]byte("hello"))
	got := make([]byte, 5)
	if _, err := io.ReadFull(conn, got); err != nil || string(got) != "hello" {
		t.Fatalf("echo through the proxy: %q %v", got, err)
	}
	if socks.asked.Load() != 1 || socks.last.Load() != echo {
		t.Fatalf("the proxy was asked for %v (%d times), want %s once", socks.last.Load(), socks.asked.Load(), echo)
	}
}

func TestDownProxyFailsClosed(t *testing.T) {
	// a port nothing listens on: the dial must fail, never fall back to going direct
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	addr := ln.Addr().String()
	ln.Close()
	echo := echoServer(t)
	p, err := Parse(addr)
	if err != nil {
		t.Fatal(err)
	}
	if conn, err := p.DialContext(context.Background(), "tcp", echo); err == nil {
		conn.Close()
		t.Fatal("dialled with the proxy down")
	}
	if p.Check(context.Background()) == nil {
		t.Fatal("Check passed with the proxy down")
	}
}

func TestParse(t *testing.T) {
	for _, bad := range []string{"http://127.0.0.1:8080", "socks5://127.0.0.1", "socks5://", "::"} {
		if _, err := Parse(bad); err == nil {
			t.Errorf("Parse(%q) took it", bad)
		}
	}
	for _, good := range []string{"socks5://127.0.0.1:40000", "127.0.0.1:40000", "socks5h://user:pw@proxy.example:1080"} {
		if _, err := Parse(good); err != nil {
			t.Errorf("Parse(%q): %v", good, err)
		}
	}
}

func TestProxyModeOn(t *testing.T) {
	on := "(user set)\tMode: WarpProxy on port 40000\n(not set)\tMASQUE Protocol Settings: \n"
	if !proxyModeOn(on, 40000) {
		t.Error("proxy mode on 40000 not seen")
	}
	if proxyModeOn(on, 40001) {
		t.Error("proxy mode on another port taken for this one")
	}
	if proxyModeOn("(user set)\tMode: Warp\n(network policy)\tWARP tunnel protocol: MASQUE\n", 40000) {
		t.Error("the whole-machine tunnel taken for proxy mode")
	}
}
