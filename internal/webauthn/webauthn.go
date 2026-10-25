// Package webauthn checks what a passkey says, as the server's half of
// signing in with one (api/passkey_handlers.go). It covers what Nexa asks of
// a passkey and nothing more: attestation "none" (the key is taken as the
// authenticator gives it, as with every synced passkey), user verification
// required, and the three algorithms authenticators use (ES256, EdDSA, RS256).
package webauthn

import (
	"bytes"
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math/big"
)

// COSE algorithm numbers, as the creation options list them.
const (
	AlgES256 = -7
	AlgEdDSA = -8
	AlgRS256 = -257
)

// Algs are the algorithms Nexa offers, in the order it prefers them.
var Algs = []int64{AlgES256, AlgEdDSA, AlgRS256}

const (
	flagUP = 0x01 // the person was present
	flagUV = 0x04 // and verified (a fingerprint, a face, the device's PIN)
	flagAT = 0x40 // a new credential follows
)

var ErrInvalid = errors.New("webauthn: the passkey's answer does not check out")

// ClientData is what the browser or the platform signed over: what was asked,
// with which challenge, from where.
type ClientData struct {
	Type      string `json:"type"`
	Challenge string `json:"challenge"`
	Origin    string `json:"origin"`
}

// CheckClientData reads clientDataJSON and checks its type and challenge,
// returning the origin it names for the caller to check.
func CheckClientData(raw []byte, typ string, challenge []byte) (string, error) {
	var cd ClientData
	if err := json.Unmarshal(raw, &cd); err != nil || cd.Type != typ {
		return "", ErrInvalid
	}
	got, err := base64.RawURLEncoding.DecodeString(cd.Challenge)
	if err != nil || len(challenge) == 0 || subtle.ConstantTimeCompare(got, challenge) != 1 {
		return "", ErrInvalid
	}
	return cd.Origin, nil
}

// AuthData is the authenticator's own part of an answer.
type AuthData struct {
	RPIDHash  [32]byte
	Flags     byte
	SignCount uint32
	// only on registration
	CredentialID []byte
	PublicKey    crypto.PublicKey
	Alg          int64
}

// ParseAuthData reads authenticator data, and the credential that follows it
// when there is one, checking it was made for rpID with the person present and
// verified.
func ParseAuthData(raw []byte, rpID string) (*AuthData, error) {
	if len(raw) < 37 {
		return nil, ErrInvalid
	}
	a := &AuthData{Flags: raw[32], SignCount: binary.BigEndian.Uint32(raw[33:37])}
	copy(a.RPIDHash[:], raw[:32])
	want := sha256.Sum256([]byte(rpID))
	if subtle.ConstantTimeCompare(a.RPIDHash[:], want[:]) != 1 || a.Flags&flagUP == 0 || a.Flags&flagUV == 0 {
		return nil, ErrInvalid
	}
	if a.Flags&flagAT == 0 {
		return a, nil
	}
	rest := raw[37:]
	if len(rest) < 18 {
		return nil, ErrInvalid
	}
	n := int(binary.BigEndian.Uint16(rest[16:18]))
	rest = rest[18:]
	if n == 0 || n > 1023 || len(rest) < n {
		return nil, ErrInvalid
	}
	a.CredentialID = rest[:n]
	key, _, err := decodeCBOR(rest[n:], 0)
	if err != nil {
		return nil, ErrInvalid
	}
	m, ok := key.(map[any]any)
	if !ok {
		return nil, ErrInvalid
	}
	if a.PublicKey, a.Alg, err = coseKey(m); err != nil {
		return nil, err
	}
	return a, nil
}

// AuthDataFromAttestation pulls the authenticator data out of an attestation
// object. Its statement is not checked: Nexa asks for none.
func AuthDataFromAttestation(raw []byte) ([]byte, error) {
	v, _, err := decodeCBOR(raw, 0)
	if err != nil {
		return nil, ErrInvalid
	}
	m, ok := v.(map[any]any)
	if !ok {
		return nil, ErrInvalid
	}
	ad, ok := m["authData"].([]byte)
	if !ok {
		return nil, ErrInvalid
	}
	return ad, nil
}

// coseKey turns a COSE key into Go's own, for the algorithms Nexa offers.
func coseKey(m map[any]any) (crypto.PublicKey, int64, error) {
	num := func(k int64) (int64, bool) { v, ok := m[k].(int64); return v, ok }
	byts := func(k int64) []byte { v, _ := m[k].([]byte); return v }
	kty, _ := num(1)
	alg, _ := num(3)
	switch {
	case kty == 2 && alg == AlgES256:
		if crv, _ := num(-1); crv != 1 {
			return nil, 0, ErrInvalid
		}
		x, y := byts(-2), byts(-3)
		if len(x) != 32 || len(y) != 32 {
			return nil, 0, ErrInvalid
		}
		// through the uncompressed form, which checks the point is on the curve
		pt := append([]byte{4}, append(append([]byte{}, x...), y...)...)
		k, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), pt)
		if err != nil {
			return nil, 0, ErrInvalid
		}
		return k, alg, nil
	case kty == 1 && alg == AlgEdDSA:
		if crv, _ := num(-1); crv != 6 {
			return nil, 0, ErrInvalid
		}
		x := byts(-2)
		if len(x) != ed25519.PublicKeySize {
			return nil, 0, ErrInvalid
		}
		return ed25519.PublicKey(x), alg, nil
	case kty == 3 && alg == AlgRS256:
		n, e := byts(-1), byts(-2)
		if len(n) < 256 || len(e) == 0 || len(e) > 4 {
			return nil, 0, ErrInvalid
		}
		return &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}, alg, nil
	}
	return nil, 0, ErrInvalid
}

// MarshalKey is the key as stored: SubjectPublicKeyInfo DER.
func MarshalKey(k crypto.PublicKey) ([]byte, error) { return x509.MarshalPKIXPublicKey(k) }

// VerifySignature checks an assertion's signature, made over the
// authenticator data and the hash of the client data, with a stored key.
func VerifySignature(spki []byte, alg int64, authData, clientDataJSON, sig []byte) error {
	k, err := x509.ParsePKIXPublicKey(spki)
	if err != nil {
		return ErrInvalid
	}
	h := sha256.Sum256(clientDataJSON)
	signed := append(append([]byte{}, authData...), h[:]...)
	digest := sha256.Sum256(signed)
	ok := false
	switch key := k.(type) {
	case *ecdsa.PublicKey:
		ok = alg == AlgES256 && ecdsa.VerifyASN1(key, digest[:], sig)
	case ed25519.PublicKey:
		ok = alg == AlgEdDSA && ed25519.Verify(key, signed, sig)
	case *rsa.PublicKey:
		ok = alg == AlgRS256 && rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], sig) == nil
	}
	if !ok {
		return ErrInvalid
	}
	return nil
}

// SameCredential reports whether two credential ids are the same.
func SameCredential(a, b []byte) bool { return len(a) > 0 && bytes.Equal(a, b) }

// decodeCBOR reads one CBOR item: enough of the format for attestation
// objects and COSE keys (definite lengths only, no tags or floats).
func decodeCBOR(b []byte, depth int) (any, []byte, error) {
	if len(b) == 0 || depth > 8 {
		return nil, nil, ErrInvalid
	}
	major, info := b[0]>>5, b[0]&0x1f
	b = b[1:]
	var n uint64
	switch {
	case info < 24:
		n = uint64(info)
	case info == 24 && len(b) >= 1:
		n, b = uint64(b[0]), b[1:]
	case info == 25 && len(b) >= 2:
		n, b = uint64(binary.BigEndian.Uint16(b)), b[2:]
	case info == 26 && len(b) >= 4:
		n, b = uint64(binary.BigEndian.Uint32(b)), b[4:]
	case info == 27 && len(b) >= 8:
		n, b = binary.BigEndian.Uint64(b), b[8:]
	default:
		return nil, nil, ErrInvalid
	}
	switch major {
	case 0:
		if n > 1<<62 {
			return nil, nil, ErrInvalid
		}
		return int64(n), b, nil
	case 1:
		if n > 1<<62 {
			return nil, nil, ErrInvalid
		}
		return -1 - int64(n), b, nil
	case 2, 3:
		if uint64(len(b)) < n {
			return nil, nil, ErrInvalid
		}
		if major == 2 {
			return b[:n], b[n:], nil
		}
		return string(b[:n]), b[n:], nil
	case 4:
		if n > 64 {
			return nil, nil, ErrInvalid
		}
		out := make([]any, 0, n)
		for i := uint64(0); i < n; i++ {
			v, rest, err := decodeCBOR(b, depth+1)
			if err != nil {
				return nil, nil, err
			}
			out, b = append(out, v), rest
		}
		return out, b, nil
	case 5:
		if n > 64 {
			return nil, nil, ErrInvalid
		}
		out := make(map[any]any, n)
		for i := uint64(0); i < n; i++ {
			k, rest, err := decodeCBOR(b, depth+1)
			if err != nil {
				return nil, nil, err
			}
			switch k.(type) {
			case int64, string:
			default:
				return nil, nil, ErrInvalid
			}
			v, rest2, err := decodeCBOR(rest, depth+1)
			if err != nil {
				return nil, nil, err
			}
			out[k], b = v, rest2
		}
		return out, b, nil
	case 7:
		switch info {
		case 20:
			return false, b, nil
		case 21:
			return true, b, nil
		case 22:
			return nil, b, nil
		}
	}
	return nil, nil, ErrInvalid
}
