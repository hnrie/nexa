// Package e2ee is the web client's end-to-end encryption (web/src/crypto)
// written again in Go, byte for byte: identity keys and sealed boxes,
// conversation and channel keys, message envelopes, attachment encryption,
// and the bot identity that is wrapped under a bot's token.
//
// People's keys never reach the server. The package exists so that the server
// can act for a bot whose identity it unwraps with the bot's token (design 1
// in docs/bots/design.md); nothing calls it yet. docs/bots/crypto.md describes
// every format. The test vectors in testdata/ are written by the TypeScript
// code and the ones in web/src/crypto/testdata/ by this package, and each side
// checks the other's, so the two implementations cannot drift apart.
package e2ee

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
)

// KeyLen is the length of every key here: x25519 keys, conversation roots,
// channel keys and file keys.
const KeyLen = 32

const (
	ivLen  = 12 // AES-GCM nonce
	tagLen = 16 // AES-GCM tag
)

// ErrDecrypt is what every failure to open something matches (errors.Is),
// whether it failed to authenticate or was malformed, like the web client's
// DecryptError. Callers should not tell those cases apart.
var ErrDecrypt = errors.New("e2ee: decryption failed")

type decryptError string

func (e decryptError) Error() string        { return "e2ee: " + string(e) }
func (e decryptError) Is(target error) bool { return target == ErrDecrypt }

// random supplies every random byte the package uses. Tests swap it to replay
// the random bytes recorded in a vector.
var random io.Reader = rand.Reader

func randomBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	if _, err := io.ReadFull(random, b); err != nil {
		return nil, fmt.Errorf("e2ee: reading random bytes: %w", err)
	}
	return b, nil
}

// newGCM is AES-256-GCM with a 12-byte nonce and a 16-byte tag, as WebCrypto
// uses it. Keys are always 32 bytes here.
func newGCM(key []byte) (cipher.AEAD, error) {
	if len(key) != KeyLen {
		return nil, fmt.Errorf("e2ee: an AES-256 key is %d bytes, not %d", KeyLen, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func gcmSeal(key, iv, plaintext, aad []byte) ([]byte, error) {
	g, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	if len(iv) != ivLen {
		return nil, errors.New("e2ee: an AES-GCM iv is 12 bytes")
	}
	return g.Seal(nil, iv, plaintext, aad), nil
}

// gcmOpen fails with a plain error; callers turn it into their own
// decryptError so that every failure reads the same.
func gcmOpen(key, iv, ciphertext, aad []byte) ([]byte, error) {
	g, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	if len(iv) != ivLen {
		return nil, errors.New("e2ee: an AES-GCM iv is 12 bytes")
	}
	return g.Open(nil, iv, ciphertext, aad)
}

// b64 is standard base64 with padding, as bytes.ts writes it.
func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

// unb64 reads base64 exactly as bytes.ts's b64.dec does: the standard
// alphabet with its padding and nothing else. Go's decoder alone would also
// skip line breaks.
func unb64(s string) ([]byte, error) {
	if strings.ContainsAny(s, "\r\n") {
		return nil, errors.New("e2ee: invalid base64")
	}
	return base64.StdEncoding.DecodeString(s)
}

func concat(parts ...[]byte) []byte {
	n := 0
	for _, p := range parts {
		n += len(p)
	}
	out := make([]byte, 0, n)
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}
