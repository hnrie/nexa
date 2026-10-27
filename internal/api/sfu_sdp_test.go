package api

import (
	"strings"
	"testing"
)

func TestSFUMediaIdentityCannotBeRelabeled(t *testing.T) {
	sdp := offerSDP["sdp"].(string)
	media, ok := sfuMediaTypes(sdp)
	if !ok || !sfuMediaMatches(media, "0", "audio") || !sfuMediaMatches(media, "1", "screen") {
		t.Fatal("ordinary media sections were refused")
	}
	if sfuMediaMatches(media, "1", "audio") || sfuMediaMatches(media, "0", "video") || sfuMediaMatches(media, "2", "screen_audio") {
		t.Fatal("media type spoofing was accepted")
	}
	for _, bad := range []string{
		strings.ReplaceAll(sdp, "a=mid:1", "a=mid:0"),
		strings.ReplaceAll(sdp, "a=mid:1", "a=mid:1\r\na=mid:2"),
		strings.ReplaceAll(sdp, "a=mid:1", ""),
		sdp + "\x00", sdp + "a=mid:1\rbroken", "a=mid:0\r\n" + sdp,
	} {
		if _, ok := sfuMediaTypes(bad); ok {
			t.Fatalf("accepted ambiguous SDP %q", bad)
		}
	}
}
