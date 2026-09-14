// Command netsim is a bad network in a box, for testing calls. It relays UDP
// between a browser and the far end (Cloudflare's SFU, in tools/call_quality.py)
// through legs, and applies a profile to each direction of each client: random
// or bursty loss, delay with jitter and spikes, a bandwidth cap with a queue,
// and outages. Every leg of a client shares that client's two directions, the
// way every connection on a phone shares its radio link.
//
// An HTTP API on -ctrl makes legs, changes profiles while a call runs and
// reports counters:
//
//	POST /legs     {"client":"alice","upstream":"1.2.3.4:3478"} -> {"port":51234}
//	PUT  /profile  {"client":"alice","dir":"up"|"down"|"both","profile":{...}}
//	GET  /stats    -> {"alice":{"up":{...},"down":{...}}}
//	POST /reset    clears the counters
//	PUT  /tcp      {"name":"alice","mode":"ok"|"stall"|"reset"}
//
// -tcp name=listen>target relays TCP (a page's HTTP and gateway WebSocket) for
// one client, so signalling can stall or drop on its own while media flows.
package main

import (
	"container/heap"
	"encoding/json"
	"flag"
	"log"
	"math/rand"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Profile is how one direction of a client's link behaves.
type Profile struct {
	// Loss is the chance each packet is lost.
	Loss float64 `json:"loss"`
	// Gilbert-Elliott bursts: each packet may start a burst (BurstEnter) or end
	// one (BurstExit); inside a burst a packet is lost with BurstLoss (1 when 0).
	BurstEnter float64 `json:"burst_enter"`
	BurstExit  float64 `json:"burst_exit"`
	BurstLoss  float64 `json:"burst_loss"`
	// DelayMs is added to every packet, JitterMs spreads it evenly either side,
	// and with SpikeChance a packet waits SpikeMs more (Wi-Fi retries, radio
	// handovers). Unless Reorder, a delayed packet holds back the ones behind it.
	DelayMs     float64 `json:"delay_ms"`
	JitterMs    float64 `json:"jitter_ms"`
	SpikeChance float64 `json:"spike_chance"`
	SpikeMs     float64 `json:"spike_ms"`
	Reorder     bool    `json:"reorder"`
	// RateKbps caps the link (0: no cap); packets queue behind it and are dropped
	// once the queue holds more than QueueMs of waiting (300 when 0).
	RateKbps float64 `json:"rate_kbps"`
	QueueMs  float64 `json:"queue_ms"`
	// Every OutageEveryMs the link goes dark for OutageForMs; Down keeps it dark.
	OutageEveryMs float64 `json:"outage_every_ms"`
	OutageForMs   float64 `json:"outage_for_ms"`
	Down          bool    `json:"down"`
}

// Stats counts what a direction did with its packets.
type Stats struct {
	Packets    int64 `json:"packets"`
	Bytes      int64 `json:"bytes"`
	Delivered  int64 `json:"delivered"`
	LostRandom int64 `json:"lost_random"`
	LostBurst  int64 `json:"lost_burst"`
	LostQueue  int64 `json:"lost_queue"`
	LostOutage int64 `json:"lost_outage"`
	// DelaySumMs over Delivered is the average time a packet spent in here.
	DelaySumMs float64 `json:"delay_sum_ms"`
}

type item struct {
	at   time.Time
	in   time.Time
	seq  uint64
	data []byte
	send func([]byte)
}

type queue []item

func (q queue) Len() int { return len(q) }
func (q queue) Less(i, j int) bool {
	if q[i].at.Equal(q[j].at) {
		return q[i].seq < q[j].seq
	}
	return q[i].at.Before(q[j].at)
}
func (q queue) Swap(i, j int) { q[i], q[j] = q[j], q[i] }
func (q *queue) Push(x any)   { *q = append(*q, x.(item)) }
func (q *queue) Pop() any {
	old := *q
	it := old[len(old)-1]
	*q = old[:len(old)-1]
	return it
}

type direction struct {
	mu          sync.Mutex
	profile     Profile
	rng         *rand.Rand
	inBurst     bool
	txFreeAt    time.Time
	lastArrival time.Time
	since       time.Time
	seq         uint64
	q           queue
	wake        chan struct{}
	stats       Stats
}

func newDirection(seed int64) *direction {
	d := &direction{rng: rand.New(rand.NewSource(seed)), wake: make(chan struct{}, 1), since: time.Now()}
	go d.loop()
	return d
}

func ms(v float64) time.Duration { return time.Duration(v * float64(time.Millisecond)) }

func (d *direction) setProfile(p Profile) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.profile = p
	d.inBurst = false
	d.since = time.Now()
}

// submit decides a packet's fate and, if it survives, when it arrives.
func (d *direction) submit(data []byte, send func([]byte)) {
	d.mu.Lock()
	defer d.mu.Unlock()
	now := time.Now()
	p := d.profile
	d.stats.Packets++
	d.stats.Bytes += int64(len(data))
	if p.Down || (p.OutageEveryMs > 0 && p.OutageForMs > 0 && now.Sub(d.since)%ms(p.OutageEveryMs) < ms(p.OutageForMs)) {
		d.stats.LostOutage++
		return
	}
	if p.BurstEnter > 0 {
		if d.inBurst {
			if d.rng.Float64() < p.BurstExit {
				d.inBurst = false
			}
		} else if d.rng.Float64() < p.BurstEnter {
			d.inBurst = true
		}
		burstLoss := p.BurstLoss
		if burstLoss == 0 {
			burstLoss = 1
		}
		if d.inBurst && d.rng.Float64() < burstLoss {
			d.stats.LostBurst++
			return
		}
	}
	if p.Loss > 0 && d.rng.Float64() < p.Loss {
		d.stats.LostRandom++
		return
	}
	depart := now
	if p.RateKbps > 0 {
		if d.txFreeAt.Before(now) {
			d.txFreeAt = now
		}
		maxQueue := p.QueueMs
		if maxQueue == 0 {
			maxQueue = 300
		}
		if d.txFreeAt.Sub(now) > ms(maxQueue) {
			d.stats.LostQueue++
			return
		}
		d.txFreeAt = d.txFreeAt.Add(time.Duration(float64(len(data)*8) / (p.RateKbps * 1000) * float64(time.Second)))
		depart = d.txFreeAt
	}
	delay := ms(p.DelayMs)
	if p.JitterMs > 0 {
		delay += ms((d.rng.Float64()*2 - 1) * p.JitterMs)
	}
	if p.SpikeChance > 0 && d.rng.Float64() < p.SpikeChance {
		delay += ms(p.SpikeMs)
	}
	if delay < 0 {
		delay = 0
	}
	at := depart.Add(delay)
	if !p.Reorder && at.Before(d.lastArrival) {
		at = d.lastArrival
	}
	d.lastArrival = at
	d.seq++
	heap.Push(&d.q, item{at: at, in: now, seq: d.seq, data: data, send: send})
	select {
	case d.wake <- struct{}{}:
	default:
	}
}

// loop delivers packets in arrival order, each at its time.
func (d *direction) loop() {
	timer := time.NewTimer(time.Hour)
	for {
		d.mu.Lock()
		if d.q.Len() == 0 {
			d.mu.Unlock()
			<-d.wake
			continue
		}
		next := d.q[0]
		if wait := time.Until(next.at); wait > 0 {
			d.mu.Unlock()
			timer.Reset(wait)
			select {
			case <-timer.C:
			case <-d.wake:
				// since Go 1.23 a stopped timer has nothing left to drain
				timer.Stop()
			}
			continue
		}
		heap.Pop(&d.q)
		d.stats.Delivered++
		d.stats.DelaySumMs += float64(time.Since(next.in)) / float64(time.Millisecond)
		d.mu.Unlock()
		next.send(next.data)
	}
}

type client struct{ up, down *direction }

type leg struct {
	c        *client
	local    *net.UDPConn
	remote   *net.UDPConn
	upstream *net.UDPAddr
	browser  atomic.Pointer[net.UDPAddr]
}

func (l *leg) run() {
	go func() {
		buf := make([]byte, 65536)
		for {
			n, from, err := l.local.ReadFromUDP(buf)
			if err != nil {
				return
			}
			l.browser.Store(from)
			data := append([]byte(nil), buf[:n]...)
			l.c.up.submit(data, func(b []byte) { _, _ = l.remote.WriteToUDP(b, l.upstream) })
		}
	}()
	go func() {
		buf := make([]byte, 65536)
		for {
			n, _, err := l.remote.ReadFromUDP(buf)
			if err != nil {
				return
			}
			to := l.browser.Load()
			if to == nil {
				continue
			}
			data := append([]byte(nil), buf[:n]...)
			l.c.down.submit(data, func(b []byte) { _, _ = l.local.WriteToUDP(b, to) })
		}
	}()
}

type sim struct {
	mu      sync.Mutex
	clients map[string]*client
	legs    map[string]*leg
	seed    int64
}

func (s *sim) client(name string) *client {
	c := s.clients[name]
	if c == nil {
		s.seed++
		c = &client{up: newDirection(s.seed * 7919), down: newDirection(s.seed * 104729)}
		s.clients[name] = c
	}
	return c
}

// tcpRelay forwards one client's TCP connections to the server. Stalled, it
// stops moving bytes both ways (a dead zone: connections stay open, nothing
// arrives); reset closes every open connection at once.
type tcpRelay struct {
	target string
	stall  atomic.Bool
	mu     sync.Mutex
	conns  map[net.Conn]struct{}
}

func (t *tcpRelay) serve(ln net.Listener) {
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		go t.handle(c)
	}
}

func (t *tcpRelay) handle(c net.Conn) {
	up, err := net.Dial("tcp", t.target)
	if err != nil {
		c.Close()
		return
	}
	t.mu.Lock()
	t.conns[c] = struct{}{}
	t.conns[up] = struct{}{}
	t.mu.Unlock()
	pipe := func(dst, src net.Conn) {
		buf := make([]byte, 32*1024)
		for {
			for t.stall.Load() {
				time.Sleep(20 * time.Millisecond)
			}
			n, err := src.Read(buf)
			if n > 0 {
				for t.stall.Load() {
					time.Sleep(20 * time.Millisecond)
				}
				if _, werr := dst.Write(buf[:n]); werr != nil {
					break
				}
			}
			if err != nil {
				break
			}
		}
		dst.Close()
		src.Close()
		t.mu.Lock()
		delete(t.conns, dst)
		delete(t.conns, src)
		t.mu.Unlock()
	}
	go pipe(up, c)
	go pipe(c, up)
}

func (t *tcpRelay) reset() {
	t.mu.Lock()
	defer t.mu.Unlock()
	for c := range t.conns {
		c.Close()
	}
	t.conns = map[net.Conn]struct{}{}
}

type tcpFlags []string

func (f *tcpFlags) String() string     { return strings.Join(*f, ",") }
func (f *tcpFlags) Set(v string) error { *f = append(*f, v); return nil }

func cors(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h(w, r)
	}
}

func main() {
	ctrl := flag.String("ctrl", "127.0.0.1:18790", "address of the control API")
	bind := flag.String("bind", "127.0.0.1", "address legs listen on for the browser")
	var tcps tcpFlags
	flag.Var(&tcps, "tcp", "name=listen>target: relay a client's TCP (repeatable)")
	flag.Parse()
	s := &sim{clients: map[string]*client{}, legs: map[string]*leg{}}
	relays := map[string]*tcpRelay{}
	for _, spec := range tcps {
		name, rest, ok1 := strings.Cut(spec, "=")
		listen, target, ok2 := strings.Cut(rest, ">")
		if !ok1 || !ok2 {
			log.Fatalf("-tcp %q: want name=listen>target", spec)
		}
		ln, err := net.Listen("tcp", listen)
		if err != nil {
			log.Fatal(err)
		}
		r := &tcpRelay{target: target, conns: map[net.Conn]struct{}{}}
		relays[name] = r
		go r.serve(ln)
		log.Printf("tcp %s: %s -> %s", name, listen, target)
	}

	http.HandleFunc("/tcp", cors(func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Name, Mode string }
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || relays[req.Name] == nil {
			http.Error(w, "name and mode", http.StatusBadRequest)
			return
		}
		rl := relays[req.Name]
		switch req.Mode {
		case "stall":
			rl.stall.Store(true)
		case "reset":
			rl.reset()
		default:
			rl.stall.Store(false)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	http.HandleFunc("/legs", cors(func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Client, Upstream string }
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Client == "" {
			http.Error(w, "client and upstream", http.StatusBadRequest)
			return
		}
		up, err := net.ResolveUDPAddr("udp", req.Upstream)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		key := req.Client + "|" + up.String()
		l := s.legs[key]
		if l == nil {
			local, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP(*bind)})
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			remote, err := net.ListenUDP("udp", nil)
			if err != nil {
				local.Close()
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			l = &leg{c: s.client(req.Client), local: local, remote: remote, upstream: up}
			s.legs[key] = l
			l.run()
			log.Printf("leg %s -> %s on %s", req.Client, up, local.LocalAddr())
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"port": l.local.LocalAddr().(*net.UDPAddr).Port})
	}))

	http.HandleFunc("/profile", cors(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Client  string
			Dir     string
			Profile Profile
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Client == "" {
			http.Error(w, "client, dir and profile", http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		c := s.client(req.Client)
		s.mu.Unlock()
		if req.Dir == "up" || req.Dir == "both" {
			c.up.setProfile(req.Profile)
		}
		if req.Dir == "down" || req.Dir == "both" {
			c.down.setProfile(req.Profile)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	http.HandleFunc("/stats", cors(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		out := map[string]map[string]Stats{}
		for name, c := range s.clients {
			c.up.mu.Lock()
			c.down.mu.Lock()
			out[name] = map[string]Stats{"up": c.up.stats, "down": c.down.stats}
			c.down.mu.Unlock()
			c.up.mu.Unlock()
		}
		s.mu.Unlock()
		_ = json.NewEncoder(w).Encode(out)
	}))

	http.HandleFunc("/reset", cors(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		for _, c := range s.clients {
			for _, d := range []*direction{c.up, c.down} {
				d.mu.Lock()
				d.stats = Stats{}
				d.mu.Unlock()
			}
		}
		s.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))

	log.Printf("netsim control on http://%s", *ctrl)
	log.Fatal(http.ListenAndServe(*ctrl, nil))
}
