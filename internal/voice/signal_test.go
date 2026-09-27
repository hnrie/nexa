package voice

import (
	"encoding/json"
	"testing"
)

func decode(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("relayed payload is not JSON: %v (%s)", err, raw)
	}
	return m
}

func TestCleanSignalPassesOrdinarySignalsUntouched(t *testing.T) {
	for _, in := range []string{
		`{"description":{"type":"offer","sdp":"v=0\r\n"},"streams":{"audio":"a","video":"b"}}`,
		`{"candidate":null}`,
		`{"voice_loss":0.05,"voice_conceal":0.02,"voice_delay":180,"voice_span":6000}`,
		`{"guest_keys":"x"}`,
		`[1,2,3]`,
		`null`,
		`"text"`,
	} {
		if got := CleanSignal(json.RawMessage(in)); string(got) != in {
			t.Errorf("CleanSignal(%s) = %s, want it unchanged", in, got)
		}
	}
}

func TestCleanSignalHoldsNumbersToTheirRange(t *testing.T) {
	got := decode(t, CleanSignal(json.RawMessage(`{"voice_loss":1e300,"voice_conceal":-4,"voice_delay":1e308,"voice_span":123456789,"description":{"sdp":"v=0"}}`)))
	want := map[string]float64{"voice_loss": 1, "voice_conceal": 0, "voice_delay": 60_000, "voice_span": 60_000}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %v, want %v", k, got[k], v)
		}
	}
	if d, ok := got["description"].(map[string]any); !ok || d["sdp"] != "v=0" {
		t.Errorf("the rest of the signal was not kept: %v", got)
	}
}

func TestCleanSignalDropsWhatIsNotANumber(t *testing.T) {
	got := decode(t, CleanSignal(json.RawMessage(`{"voice_loss":"0.5","voice_conceal":null,"voice_delay":{"a":1},"voice_span":1e999,"other":2}`)))
	for _, k := range []string{"voice_loss", "voice_conceal", "voice_delay", "voice_span"} {
		if _, ok := got[k]; ok {
			t.Errorf("%s was relayed: %v", k, got[k])
		}
	}
	if got["other"] != float64(2) {
		t.Errorf("other = %v, want 2", got["other"])
	}
}

func TestCleanSignalSeesThroughEscapedNames(t *testing.T) {
	got := decode(t, CleanSignal(json.RawMessage(`{"voice_loss":5e10}`)))
	if got["voice_loss"] != float64(1) {
		t.Errorf("voice_loss = %v, want 1", got["voice_loss"])
	}
}
