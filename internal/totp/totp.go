// Package totp implements the time-based one-time passwords of RFC 6238: the
// six digits an authenticator app shows and rolls over every thirty seconds.
package totp

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	// Digits is the length of a generated code.
	Digits = 6
	// PeriodSeconds is how long one code lasts.
	PeriodSeconds = 30
	// SecretBytes is the size of a new shared secret (160 bits, as RFC 4226 asks for).
	SecretBytes = 20
	// CodeSkew is how many steps either side of now still count, covering clock drift.
	CodeSkew = 1
)

// ErrBadSecret means the shared secret is not valid base32.
var ErrBadSecret = errors.New("totp: malformed secret")

var enc = base32.StdEncoding.WithPadding(base32.NoPadding)

// NewSecret returns a fresh base32 shared secret.
func NewSecret() (string, error) {
	buf := make([]byte, SecretBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return enc.EncodeToString(buf), nil
}

// Normalize accepts the spaced, lower-case forms people copy out of an app.
func Normalize(secret string) string {
	return strings.ToUpper(strings.NewReplacer(" ", "", "-", "", "\t", "").Replace(strings.TrimSpace(secret)))
}

func decode(secret string) ([]byte, error) {
	key, err := enc.DecodeString(Normalize(secret))
	if err != nil || len(key) == 0 {
		return nil, ErrBadSecret
	}
	return key, nil
}

// Step is the counter value covering t.
func Step(t time.Time) int64 { return t.Unix() / PeriodSeconds }

// digitsOf is the HOTP truncation of RFC 4226.
func digitsOf(key []byte, counter int64) string {
	var ctr [8]byte
	binary.BigEndian.PutUint64(ctr[:], uint64(counter))
	mac := hmac.New(sha1.New, key)
	mac.Write(ctr[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	trunc := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	code := strconv.FormatUint(uint64(trunc%1_000_000), 10)
	if len(code) < Digits {
		code = strings.Repeat("0", Digits-len(code)) + code
	}
	return code
}

// CodeAt returns the code for a specific counter step.
func CodeAt(secret string, step int64) (string, error) {
	key, err := decode(secret)
	if err != nil {
		return "", err
	}
	return digitsOf(key, step), nil
}

// Code returns the code an app would show at t.
func Code(secret string, t time.Time) (string, error) { return CodeAt(secret, Step(t)) }

// Verify checks code against the steps around t and returns the step it
// matched, so the caller can refuse to accept the same code twice.
func Verify(secret, code string, t time.Time, skew int) (int64, bool) {
	code = strings.TrimSpace(code)
	if len(code) != Digits {
		return 0, false
	}
	key, err := decode(secret)
	if err != nil {
		return 0, false
	}
	if skew < 0 {
		skew = 0
	}
	now := Step(t)
	match := false
	var at int64
	// Every candidate is compared, so a match late in the window costs the same
	// as one at the start.
	for i := -skew; i <= skew; i++ {
		step := now + int64(i)
		if subtle.ConstantTimeCompare([]byte(digitsOf(key, step)), []byte(code)) == 1 {
			match = true
			at = step
		}
	}
	return at, match
}

// URI builds the otpauth:// string an authenticator scans.
func URI(issuer, account, secret string) string {
	label := url.PathEscape(issuer + ":" + account)
	q := url.Values{}
	q.Set("secret", Normalize(secret))
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", strconv.Itoa(Digits))
	q.Set("period", strconv.Itoa(PeriodSeconds))
	return "otpauth://totp/" + label + "?" + q.Encode()
}

// Pretty groups a secret into readable blocks for the "can't scan?" case.
func Pretty(secret string) string {
	s := Normalize(secret)
	var b strings.Builder
	for i, r := range s {
		if i > 0 && i%4 == 0 {
			b.WriteByte(' ')
		}
		b.WriteRune(r)
	}
	return b.String()
}
