// Package fake is a software passkey for tests: it makes attestation objects
// and signs assertions as an authenticator would, with the person present and
// verified.
package fake

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
)

// Authenticator holds one credential.
type Authenticator struct {
	ID    []byte
	Alg   int64
	Count uint32
	ec    *ecdsa.PrivateKey
	ed    ed25519.PrivateKey
}

// New makes a credential for alg (-7 ES256 or -8 EdDSA).
func New(alg int64) *Authenticator {
	a := &Authenticator{ID: make([]byte, 32), Alg: alg}
	_, _ = rand.Read(a.ID)
	if alg == -8 {
		_, a.ed, _ = ed25519.GenerateKey(rand.Reader)
	} else {
		a.ec, _ = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	}
	return a
}

func authData(rpID string, flags byte, count uint32) []byte {
	h := sha256.Sum256([]byte(rpID))
	out := append(h[:], flags)
	return binary.BigEndian.AppendUint32(out, count)
}

// Create is the attestation object (format "none") for rpID.
func (a *Authenticator) Create(rpID string) []byte {
	ad := authData(rpID, 0x01|0x04|0x40, a.Count)
	ad = append(ad, make([]byte, 16)...) // AAGUID
	ad = binary.BigEndian.AppendUint16(ad, uint16(len(a.ID)))
	ad = append(ad, a.ID...)
	if a.ed != nil {
		ad = append(ad, mapHead(4)...)
		ad = append(ad, uint8Int(1, 1)...)
		ad = append(ad, uint8Int(3, -8)...)
		ad = append(ad, uint8Int(-1, 6)...)
		ad = append(ad, negKey(-2)...)
		ad = append(ad, byteStr(a.ed.Public().(ed25519.PublicKey))...)
	} else {
		pt, _ := a.ec.PublicKey.Bytes()
		ad = append(ad, mapHead(5)...)
		ad = append(ad, uint8Int(1, 2)...)
		ad = append(ad, uint8Int(3, -7)...)
		ad = append(ad, uint8Int(-1, 1)...)
		ad = append(ad, negKey(-2)...)
		ad = append(ad, byteStr(pt[1:33])...)
		ad = append(ad, negKey(-3)...)
		ad = append(ad, byteStr(pt[33:])...)
	}
	out := mapHead(3)
	out = append(out, textStr("fmt")...)
	out = append(out, textStr("none")...)
	out = append(out, textStr("attStmt")...)
	out = append(out, mapHead(0)...)
	out = append(out, textStr("authData")...)
	return append(out, byteStr(ad)...)
}

// Get signs an assertion over clientDataJSON, returning the authenticator
// data and the signature. Count moves on only when it is not zero, as synced
// passkeys keep none.
func (a *Authenticator) Get(rpID string, clientDataJSON []byte) ([]byte, []byte) {
	if a.Count > 0 {
		a.Count++
	}
	ad := authData(rpID, 0x01|0x04, a.Count)
	h := sha256.Sum256(clientDataJSON)
	signed := append(append([]byte{}, ad...), h[:]...)
	if a.ed != nil {
		return ad, ed25519.Sign(a.ed, signed)
	}
	d := sha256.Sum256(signed)
	sig, _ := ecdsa.SignASN1(rand.Reader, a.ec, d[:])
	return ad, sig
}

func head(major byte, n int) []byte {
	switch {
	case n < 24:
		return []byte{major<<5 | byte(n)}
	case n < 256:
		return []byte{major<<5 | 24, byte(n)}
	default:
		return []byte{major<<5 | 25, byte(n >> 8), byte(n)}
	}
}

func mapHead(n int) []byte    { return head(5, n) }
func byteStr(b []byte) []byte { return append(head(2, len(b)), b...) }
func textStr(s string) []byte { return append(head(3, len(s)), s...) }

func intItem(v int) []byte {
	if v < 0 {
		return head(1, -1-v)
	}
	return head(0, v)
}

func uint8Int(k, v int) []byte { return append(intItem(k), intItem(v)...) }
func negKey(k int) []byte      { return intItem(k) }
