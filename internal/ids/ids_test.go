package ids

import (
	"encoding/json"
	"sync"
	"testing"
	"time"
)

func TestNewIsMonotonicAndUnique(t *testing.T) {
	seen := make(map[ID]bool, 20000)
	var last ID
	for i := 0; i < 20000; i++ {
		id := New()
		if id <= last {
			t.Fatalf("not increasing at %d: %d <= %d", i, id, last)
		}
		if seen[id] {
			t.Fatal("duplicate id")
		}
		seen[id] = true
		last = id
	}
}

func TestConcurrentUnique(t *testing.T) {
	var wg sync.WaitGroup
	var mu sync.Mutex
	seen := map[ID]bool{}
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 5000; i++ {
				id := New()
				mu.Lock()
				if seen[id] {
					t.Error("duplicate under concurrency")
				}
				seen[id] = true
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
}

func TestTimeRoundTrip(t *testing.T) {
	before := time.Now().Add(-time.Millisecond)
	id := New()
	if id.Time().Before(before) || id.Time().After(time.Now().Add(time.Second)) {
		t.Errorf("time %v out of range", id.Time())
	}
	if FromTime(id.Time()) > id {
		t.Error("FromTime should be <= id generated in the same ms")
	}
	if FromTime(time.UnixMilli(Epoch-5000)) != 0 {
		t.Error("times before the epoch clamp to zero")
	}
}

func TestClockBackwards(t *testing.T) {
	mu.Lock()
	saved := now
	base := time.Now().UnixMilli()
	cur := base
	now = func() int64 { return cur }
	mu.Unlock()
	defer func() { mu.Lock(); now = saved; mu.Unlock() }()
	a := New()
	cur = base - 10
	b := New()
	if b <= a {
		t.Errorf("ids must keep increasing when the clock goes back: %d <= %d", b, a)
	}
}

func TestJSON(t *testing.T) {
	id := ID(123456789012345678)
	b, err := json.Marshal(struct {
		ID ID  `json:"id"`
		P  *ID `json:"p"`
	}{id, nil})
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"id":"123456789012345678","p":null}` {
		t.Errorf("got %s", b)
	}
	var out struct {
		ID ID `json:"id"`
	}
	if err := json.Unmarshal([]byte(`{"id":"42"}`), &out); err != nil || out.ID != 42 {
		t.Errorf("string unmarshal: %v %d", err, out.ID)
	}
	if err := json.Unmarshal([]byte(`{"id":42}`), &out); err != nil || out.ID != 42 {
		t.Errorf("number unmarshal: %v", err)
	}
	if err := json.Unmarshal([]byte(`{"id":"x"}`), &out); err == nil {
		t.Error("expected error for non-numeric string")
	}
	if err := json.Unmarshal([]byte(`{"id":"-5"}`), &out); err == nil {
		t.Error("expected error for negative")
	}
	if _, err := Parse("-1"); err == nil {
		t.Error("negative should fail")
	}
	if v, err := Parse("7"); err != nil || v != 7 || v.String() != "7" {
		t.Error("parse/string round trip")
	}
}

// Two chatd processes behind one database must not both issue the same first
// id of a millisecond.
func TestNodeIDSeparatesProcesses(t *testing.T) {
	mu.Lock()
	savedNode, savedLast, savedSeq := node, lastMs, seq
	mu.Unlock()
	defer func() { mu.Lock(); node, lastMs, seq = savedNode, savedLast, savedSeq; mu.Unlock() }()

	if err := SetNode(MaxNode + 1); err == nil {
		t.Error("a node id past the ten bits must be refused")
	}
	if err := SetNode(-1); err == nil {
		t.Error("a negative node id must be refused")
	}
	if err := SetNode(0); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	lastMs, seq = 0, 0
	mu.Unlock()
	a := New()
	if err := SetNode(3); err != nil {
		t.Fatal(err)
	}
	// the same millisecond and the same sequence, a different process
	mu.Lock()
	lastMs, seq = 0, 0
	mu.Unlock()
	b := New()
	if a == b {
		t.Fatal("two nodes issued the same id")
	}
	if a>>timeShift == b>>timeShift && (a>>seqBits)&((1<<nodeBits)-1) == (b>>seqBits)&((1<<nodeBits)-1) {
		t.Errorf("the node id is not in the id: %d vs %d", a, b)
	}
}

// A sequence spent in a millisecond that will not advance must still return.
func TestExhaustedSequenceDoesNotSpinForever(t *testing.T) {
	mu.Lock()
	savedNow, savedLast, savedSeq := now, lastMs, seq
	frozen := time.Now().UnixMilli()
	now = func() int64 { return frozen }
	lastMs, seq = frozen, seqMask
	mu.Unlock()
	defer func() { mu.Lock(); now, lastMs, seq = savedNow, savedLast, savedSeq; mu.Unlock() }()

	done := make(chan ID, 1)
	go func() { done <- New() }()
	select {
	case id := <-done:
		if id.Time().UnixMilli() <= frozen-1 {
			t.Errorf("id came from before the stuck millisecond: %v", id.Time())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("New never returned with the clock standing still")
	}
}
