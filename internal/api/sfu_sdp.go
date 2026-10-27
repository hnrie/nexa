package api

import (
	"strings"

	"evilion.xyz/chat/internal/realtime"
)

// sfuMediaTypes reads only SDP's media section/mid association. It is not an
// SDP negotiator: the provider still validates the full description. Ambiguous
// or duplicated mids must be refused here rather than interpreted differently
// by the permission check and the provider.
func sfuMediaTypes(sdp string) (map[string]string, bool) {
	if strings.ContainsAny(sdp, "\x00") || len(sdp) > maxSDPBytes {
		return nil, false
	}
	media := map[string]string{}
	kind, mid := "", ""
	sections := 0
	finish := func() bool {
		if kind == "" {
			return true
		}
		if mid == "" || media[mid] != "" {
			return false
		}
		media[mid] = kind
		return true
	}
	for _, raw := range strings.Split(sdp, "\n") {
		line := strings.TrimSuffix(raw, "\r")
		if strings.ContainsRune(line, '\r') {
			return nil, false
		}
		if strings.HasPrefix(line, "m=") {
			if !finish() {
				return nil, false
			}
			fields := strings.Fields(strings.TrimPrefix(line, "m="))
			if len(fields) < 4 || sections >= 128 {
				return nil, false
			}
			kind, mid = fields[0], ""
			sections++
		} else if strings.HasPrefix(line, "a=mid:") {
			value := strings.TrimPrefix(line, "a=mid:")
			if kind == "" || mid != "" || value == "" || len(value) > 16 || strings.ContainsAny(value, " \t") {
				return nil, false
			}
			mid = value
		}
	}
	return media, finish() && sections > 0
}

func sfuMediaMatches(media map[string]string, mid, kind string) bool {
	want := "video"
	if kind == realtime.KindAudio || kind == realtime.KindScreenAudio {
		want = "audio"
	}
	return media[mid] == want
}
