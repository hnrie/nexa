// Package botproto holds what Nexa needs to speak the bot protocol of the
// libraries made for Discord (discord.py, discord.js, JDA, discordgo and the
// rest): how ids look to them, intents, the gateway's opcodes and close
// codes, and the gateway's encodings and compression. It knows nothing of the
// store; internal/api builds the objects and runs the connections.
package botproto

import (
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"evilion.xyz/chat/internal/ids"
)

// DiscordEpoch is the start of the ids bot libraries expect, 2015-01-01 UTC,
// in Unix milliseconds.
const DiscordEpoch int64 = 1420070400000

// Offset is what turns a Nexa id into the id bots see. A Nexa id and a bot
// library's snowflake have the same layout, milliseconds above 22 bits of
// node and sequence, and differ only in the moment they count from. Adding
// the difference between the two moments keeps every id unique and in
// order, and gives the libraries the right time when they read one out of it
// (when a message was sent, how old an account is, where a page of history
// starts).
const Offset int64 = (ids.Epoch - DiscordEpoch) << 22

// Out is the id bots see for a Nexa id. Zero stays zero.
func Out(id ids.ID) int64 {
	if id == 0 {
		return 0
	}
	return int64(id) + Offset
}

// OutString is Out as the decimal string the protocol writes ids as.
func OutString(id ids.ID) string { return strconv.FormatInt(Out(id), 10) }

// ErrBadID is an id that is not a snowflake at all.
var ErrBadID = errors.New("botproto: not a snowflake")

// clock is the time In compares against; tests replace it.
var clock = time.Now

// In reads an id a bot sent. Ids at or above Offset are in the bots' form
// and lose it. Below that a number is taken as a Nexa id, as one pasted from
// Nexa's own links and copied ids is, as long as it names a moment that has
// already come; one naming a later moment cannot be a Nexa id and is a bots'
// id from before Nexa's epoch, which reads as negative: before everything
// for a page of history, and nothing at all for a lookup.
//
// The two ranges meet in 2037, when Nexa's own ids reach Offset. From then on
// a number at or above Offset is read as a bots' id, which every id a bot was
// given is; only a Nexa id pasted by hand would be misread.
func In(n int64) int64 {
	switch {
	case n <= 0:
		return n
	case n >= Offset:
		return n - Offset
	case ids.ID(n).Time().Before(clock().Add(24 * time.Hour)):
		// a Nexa id's moment has come (a day's leeway for clocks)
		return n
	default:
		return n - Offset
	}
}

// Parse reads an id a bot wrote as a string (or a bare number) into a Nexa
// id. A negative result (see In) is returned as is; callers that look
// something up find nothing, and pagination treats it as the start.
func Parse(s string) (int64, error) {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		// snowflakes past int64 are unsigned in Discord's own range; nothing
		// Nexa made is that large
		if u, uerr := strconv.ParseUint(s, 10, 64); uerr == nil && u > 0 {
			return -1, nil
		}
		return 0, ErrBadID
	}
	if n < 0 {
		return 0, ErrBadID
	}
	return In(n), nil
}

// ParseID is Parse for a lookup: an id that cannot name anything Nexa holds
// is ErrBadID.
func ParseID(s string) (ids.ID, error) {
	n, err := Parse(s)
	if err != nil {
		return 0, err
	}
	if n <= 0 {
		return 0, ErrBadID
	}
	return ids.ID(n), nil
}

// Snow is a Nexa id as bots see it: it writes itself in their form and reads
// either form back.
type Snow ids.ID

// S is a Snow for id.
func S(id ids.ID) Snow { return Snow(id) }

// SP is a *Snow for an optional id; nil stays nil, so it writes as null.
func SP(id *ids.ID) *Snow {
	if id == nil {
		return nil
	}
	s := Snow(*id)
	return &s
}

// ID is the Nexa id.
func (s Snow) ID() ids.ID { return ids.ID(s) }

// String is the id in the bots' form.
func (s Snow) String() string { return OutString(ids.ID(s)) }

// MarshalJSON writes the id as a string in the bots' form.
func (s Snow) MarshalJSON() ([]byte, error) {
	return []byte(`"` + OutString(ids.ID(s)) + `"`), nil
}

// UnmarshalJSON reads a string or a bare number in either form. An id that
// names nothing Nexa could hold reads as zero.
func (s *Snow) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		*s = 0
		return nil
	}
	var str string
	if len(b) > 0 && b[0] == '"' {
		if err := json.Unmarshal(b, &str); err != nil {
			return err
		}
	} else {
		str = string(b)
	}
	n, err := Parse(str)
	if err != nil {
		return err
	}
	if n < 0 {
		n = 0
	}
	*s = Snow(n)
	return nil
}

// Snows writes a list of Nexa ids in the bots' form, never as null.
func Snows(list []ids.ID) []Snow {
	out := make([]Snow, len(list))
	for i, id := range list {
		out[i] = Snow(id)
	}
	return out
}

// IDs reads a list of Snows back into Nexa ids, leaving out zeros.
func IDs(list []Snow) []ids.ID {
	out := make([]ids.ID, 0, len(list))
	for _, s := range list {
		if s != 0 {
			out = append(out, ids.ID(s))
		}
	}
	return out
}

// Timestamp writes Unix milliseconds the way the protocol writes times:
// ISO 8601 in UTC with microseconds and an explicit offset.
func Timestamp(ms int64) string {
	return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000000+00:00")
}

// TimestampP is Timestamp for an optional time; nil writes as null.
func TimestampP(ms *int64) *string {
	if ms == nil {
		return nil
	}
	t := Timestamp(*ms)
	return &t
}

// ParseTimestamp reads an ISO 8601 time as a bot writes one, into Unix
// milliseconds.
func ParseTimestamp(s string) (int64, bool) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.999999999", "2006-01-02T15:04:05", "2006-01-02 15:04:05.999999999Z07:00", "2006-01-02 15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UnixMilli(), true
		}
	}
	return 0, false
}
