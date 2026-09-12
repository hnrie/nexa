package totp

import (
	"strings"
	"testing"
	"time"
)

// The RFC 6238 reference secret, "12345678901234567890" in base32.
const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

func TestRFC6238Vectors(t *testing.T) {
	// The RFC prints eight digits; the last six are what a normal app shows.
	cases := []struct {
		unix int64
		want string
	}{
		{59, "287082"},
		{1111111109, "081804"},
		{1111111111, "050471"},
		{1234567890, "005924"},
		{2000000000, "279037"},
		{20000000000, "353130"},
	}
	for _, c := range cases {
		got, err := Code(rfcSecret, time.Unix(c.unix, 0))
		if err != nil || got != c.want {
			t.Errorf("Code(%d) = %q, %v; want %q", c.unix, got, err, c.want)
		}
	}
}

func TestVerifyWindowAndStep(t *testing.T) {
	now := time.Unix(1111111109, 0)
	code, _ := Code(rfcSecret, now)
	step, ok := Verify(rfcSecret, code, now, CodeSkew)
	if !ok || step != Step(now) {
		t.Fatalf("current code: step=%d ok=%v", step, ok)
	}
	// One step either side is accepted; two is not.
	prev, _ := CodeAt(rfcSecret, Step(now)-1)
	if step, ok := Verify(rfcSecret, prev, now, CodeSkew); !ok || step != Step(now)-1 {
		t.Errorf("previous code should pass: step=%d ok=%v", step, ok)
	}
	next, _ := CodeAt(rfcSecret, Step(now)+1)
	if _, ok := Verify(rfcSecret, next, now, CodeSkew); !ok {
		t.Error("next code should pass")
	}
	old, _ := CodeAt(rfcSecret, Step(now)-2)
	if _, ok := Verify(rfcSecret, old, now, CodeSkew); ok {
		t.Error("a code two steps old must not pass")
	}
	if _, ok := Verify(rfcSecret, code, now, 0); !ok {
		t.Error("zero skew must still accept the current code")
	}
}

func TestVerifyRejectsJunk(t *testing.T) {
	now := time.Now()
	for _, bad := range []string{"", "12345", "1234567", "abcdef", "  "} {
		if _, ok := Verify(rfcSecret, bad, now, CodeSkew); ok {
			t.Errorf("%q should not verify", bad)
		}
	}
	if _, ok := Verify("not base32 at all!", "123456", now, CodeSkew); ok {
		t.Error("a malformed secret must not verify")
	}
}

func TestCodeIsSixDigitsIncludingLeadingZeros(t *testing.T) {
	secret, err := NewSecret()
	if err != nil {
		t.Fatal(err)
	}
	if len(Normalize(secret)) != 32 {
		t.Fatalf("secret %q should be 32 base32 characters", secret)
	}
	for step := int64(0); step < 3000; step++ {
		code, err := CodeAt(secret, step)
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != Digits || strings.Trim(code, "0123456789") != "" {
			t.Fatalf("step %d gave %q", step, code)
		}
	}
}

func TestNormalizeAndURI(t *testing.T) {
	if got := Normalize(" gezd gnbv-gy3t qojq "); got != "GEZDGNBVGY3TQOJQ" {
		t.Errorf("Normalize = %q", got)
	}
	uri := URI("chat.evilion.xyz", "alice", rfcSecret)
	for _, want := range []string{"otpauth://totp/chat.evilion.xyz:alice?", "secret=" + rfcSecret, "issuer=chat.evilion.xyz", "digits=6", "period=30", "algorithm=SHA1"} {
		if !strings.Contains(uri, want) {
			t.Errorf("URI %q missing %q", uri, want)
		}
	}
	if got := Pretty("GEZDGNBVGY3TQOJQ"); got != "GEZD GNBV GY3T QOJQ" {
		t.Errorf("Pretty = %q", got)
	}
}
