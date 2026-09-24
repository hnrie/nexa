// Package auth implements credential hashing, bearer tokens and the request
// middleware that turns a token into a user.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"runtime"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Server-side Argon2id parameters (applied to the client's already-stretched
// auth key, so they can stay modest).
const (
	argonTime    = 2
	argonMemory  = 19456 // KiB
	argonThreads = 1
	argonKeyLen  = 32
	argonSaltLen = 16
)

// AuthKeyLen is the length of every auth key a client derives, from a
// password or a recovery key alike.
const AuthKeyLen = 32

// hashSlots bounds how many Argon2 computations run at once. Each one holds
// argonMemory of RAM for as long as it runs, so without a bound a burst of
// password checks — a login storm, or one account hammering a route that asks
// for its password — takes the machine's memory with it. With one, the burst
// queues and the machine stays up.
var hashSlots = make(chan struct{}, max(2, runtime.NumCPU()))

func argonKey(key, salt []byte, t, m uint32, p uint8, n uint32) []byte {
	hashSlots <- struct{}{}
	defer func() { <-hashSlots }()
	return argon2.IDKey(key, salt, t, m, p, n)
}

// HashAuthKey returns a PHC-formatted Argon2id hash of authKey.
func HashAuthKey(authKey []byte) (string, error) {
	if len(authKey) == 0 {
		return "", errors.New("empty auth key")
	}
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argonKey(authKey, salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}

// VerifyAuthKey checks authKey against a PHC string in constant time. A key
// of the wrong length is simply wrong, and costs no hash to say so.
func VerifyAuthKey(authKey []byte, phc string) (bool, error) {
	if len(authKey) != AuthKeyLen {
		return false, nil
	}
	parts := strings.Split(phc, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false, errors.New("malformed hash")
	}
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false, errors.New("malformed hash parameters")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, errors.New("malformed hash salt")
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, errors.New("malformed hash digest")
	}
	if m == 0 || t == 0 || p == 0 || m > 1<<20 || len(want) == 0 {
		return false, errors.New("unsafe hash parameters")
	}
	got := argonKey(authKey, salt, t, m, p, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}
