// Package ids generates snowflake identifiers: 41 bits of milliseconds since
// Epoch, 10 bits of node id (always 0 for this single-process server) and a
// 12-bit per-millisecond sequence. They sort by creation time and serialise as
// decimal strings in JSON so JavaScript never loses precision.
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

var (
	mu     sync.Mutex
	lastMs int64
	seq    int64
	now    = func() int64 { return time.Now().UnixMilli() }
)

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
		if seq == 0 { // sequence exhausted for this millisecond: wait for the next one
			for ms <= lastMs {
				ms = now()
			}
		}
	} else {
		seq = 0
	}
	lastMs = ms
	return ID((ms-Epoch)<<timeShift | seq)
}

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
