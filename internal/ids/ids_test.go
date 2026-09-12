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
