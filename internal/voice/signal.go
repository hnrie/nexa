package voice

import (
	"bytes"
	"encoding/json"
	"math"
	"strconv"
)

// signalNumbers are the numbers a voice_signal can carry from one participant
// to another, with the largest each may be: a listener's loss report through
// the SFU (web/src/voice/sfu.ts), the share of a voice lost and concealed and
// how long it is held for playback, in milliseconds, over a stretch of time.
// The server passes a signal on without reading it otherwise; these are held
// to their range on the way, so no client is handed an absurd number.
var signalNumbers = map[string]float64{
	"voice_loss":    1,
	"voice_conceal": 1,
	"voice_delay":   60_000,
	"voice_span":    60_000,
}

// CleanSignal returns a voice_signal payload fit to relay: each number above
// held between 0 and its most, and dropped when it is not a number at all.
// Anything else in it, and a payload that is not a JSON object, is passed on
// as it came.
func CleanSignal(raw json.RawMessage) json.RawMessage {
	// an escaped key can spell one of the names too, so either sends it through the check
	if !bytes.Contains(raw, []byte("voice_")) && !bytes.Contains(raw, []byte(`\u`)) {
		return raw
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return raw
	}
	changed := false
	for name, most := range signalNumbers {
		v, ok := m[name]
		if !ok {
			continue
		}
		var f float64
		if bytes.Equal(bytes.TrimSpace(v), []byte("null")) || json.Unmarshal(v, &f) != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			delete(m, name)
			changed = true
			continue
		}
		if held := min(most, max(0, f)); held != f {
			m[name] = json.RawMessage(strconv.FormatFloat(held, 'f', -1, 64))
			changed = true
		}
	}
	if !changed {
		return raw
	}
	out, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return out
}
