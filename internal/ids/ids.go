// Package ids generates snowflake identifiers: 41 bits of milliseconds since
// Epoch, 10 bits of node id and a 12-bit per-millisecond sequence. They sort by
// creation time and serialise as decimal strings in JSON so JavaScript never
// loses precision.
//
// The node id is 0 unless SetNode says otherwise, which is right for one
// process. Two chatd processes sharing a Postgres both issue
// (ms-Epoch)<<22 | 0 for the first id of a millisecond — the same value — and
// whichever insert lands second fails on the primary key, so each process
// behind a shared database needs a node id of its own.
package ids

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"
)

// Epoch is 2026-01-01T00:00:00Z in Unix milliseconds.
const Epoch int64 = 1767225600000

const (
	seqBits   = 12
	nodeBits  = 10
	seqMask   = (1 << seqBits) - 1
	timeShift = seqBits + nodeBits
)

// ID is a snowflake identifier.
type ID int64

// MaxNode is the largest node id the ten bits hold.
const MaxNode = (1 << nodeBits) - 1

var (
	mu     sync.Mutex
	lastMs int64
	seq    int64
	node   int64
	// started pins the wall clock to a monotonic reading taken once. Asking
	// time.Now().UnixMilli() each time meant a wall clock that stepped
	// backwards — an NTP correction after a suspend, someone running date —
	// could leave the loop below spinning at full speed, holding this mutex,
	// until the clock caught up: an hour's jump is an hour in which nothing on
	// Nexa can create anything at all.
	started   = time.Now()
	startedNs = started.UnixNano()
	now       = func() int64 { return (startedNs + int64(time.Since(started))) / int64(time.Millisecond) }
)

// SetNode fixes which of several chatd processes this one is, so their ids
// cannot collide. It must be called before any id is generated.
func SetNode(n int) error {
	if n < 0 || n > MaxNode {
		return fmt.Errorf("node id %d is outside 0–%d", n, MaxNode)
	}
	mu.Lock()
	defer mu.Unlock()
	node = int64(n)
	return nil
}

// New returns a fresh, strictly increasing ID.
func New() ID {
	mu.Lock()
	defer mu.Unlock()
	ms := now()
	if ms < lastMs { // clock went backwards: keep issuing from the last millisecond
		ms = lastMs
	}
	if ms == lastMs {
		seq = (seq + 1) & seqMask
		if seq == 0 {
			// The sequence is spent for this millisecond, so wait for the next
			// one. The wait is bounded: with a monotonic reading this is at
			// most a millisecond, and if it somehow is not, issuing from the
			// next millisecond is better than never returning.
			for i := 0; ms <= lastMs; i++ {
				if i > spinLimit {
					ms = lastMs + 1
					break
				}
				ms = now()
			}
		}
	} else {
		seq = 0
	}
	lastMs = ms
	return ID((ms-Epoch)<<timeShift | node<<seqBits | seq)
}

// spinLimit is how many times New re-reads the clock before deciding it is not
// going to move and stepping the millisecond itself.
const spinLimit = 1 << 20

// FromTime returns the lowest ID that could have been generated at t.
func FromTime(t time.Time) ID {
	ms := t.UnixMilli() - Epoch
	if ms < 0 {
		ms = 0
	}
	return ID(ms << timeShift)
}

// Time returns when the ID was generated.
func (id ID) Time() time.Time {
	return time.UnixMilli(int64(id)>>timeShift + Epoch)
}

// IsZero reports whether the ID is unset.
func (id ID) IsZero() bool { return id == 0 }

// String returns the decimal representation.
func (id ID) String() string { return strconv.FormatInt(int64(id), 10) }

// Parse converts a decimal string into an ID.
func Parse(s string) (ID, error) {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid id %q", s)
	}
	if n < 0 {
		return 0, errors.New("invalid id: negative")
	}
	return ID(n), nil
}

// MarshalJSON encodes the ID as a JSON string.
func (id ID) MarshalJSON() ([]byte, error) {
	return []byte(`"` + id.String() + `"`), nil
}

// UnmarshalJSON accepts either a JSON string or a bare number.
func (id *ID) UnmarshalJSON(b []byte) error {
	if len(b) == 0 {
		return errors.New("invalid id: empty")
	}
	if b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		v, err := Parse(s)
		if err != nil {
			return err
		}
		*id = v
		return nil
	}
	var n int64
	if err := json.Unmarshal(b, &n); err != nil {
		return fmt.Errorf("invalid id: %w", err)
	}
	if n < 0 {
		return errors.New("invalid id: negative")
	}
	*id = ID(n)
	return nil
}
