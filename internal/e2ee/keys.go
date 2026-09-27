package e2ee

import (
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"fmt"
)

// infoSeal starts the HKDF info of a sealed box's key (web/src/crypto/keys.ts).
const infoSeal = "evilion-chat/seal/v1"

// Identity is a long-lived x25519 key pair.
type Identity struct {
	PublicKey  []byte
	PrivateKey []byte
}

// GenerateIdentity makes a key pair from 32 random bytes, as the web client
// does (the private key is clamped when it is used, not when it is made).
func GenerateIdentity() (Identity, error) {
	priv, err := randomBytes(KeyLen)
	if err != nil {
		return Identity{}, err
	}
	pub, err := PublicKeyOf(priv)
	if err != nil {
		return Identity{}, err
	}
	return Identity{PublicKey: pub, PrivateKey: priv}, nil
}

// PublicKeyOf is the x25519 public key of a 32-byte private key.
func PublicKeyOf(priv []byte) ([]byte, error) {
	k, err := ecdh.X25519().NewPrivateKey(priv)
	if err != nil {
		return nil, fmt.Errorf("e2ee: %w", err)
	}
	return k.PublicKey().Bytes(), nil
}

// x25519 is the shared secret of priv and pub. Like noble's getSharedSecret it
// masks the top bit of pub, reduces it modulo p, and refuses a low-order pub
// (one that makes the result all zeros).
func x25519(priv, pub []byte) ([]byte, error) {
	k, err := ecdh.X25519().NewPrivateKey(priv)
	if err != nil {
		return nil, err
	}
	p, err := ecdh.X25519().NewPublicKey(pub)
	if err != nil {
		return nil, err
	}
	return k.ECDH(p)
}

func sealKey(ephPub, recipientPub, shared []byte) ([]byte, error) {
	info := string(concat([]byte(infoSeal), ephPub, recipientPub))
	return hkdf.Key(sha256.New, shared, nil, info, KeyLen)
}

// Seal seals data to recipientPub with an ephemeral x25519 key.
// Layout: ephemeral public key (32) | iv (12) | AES-256-GCM ciphertext and tag,
// with the ephemeral public key as the additional data and the key
// HKDF-SHA256(shared, no salt, "evilion-chat/seal/v1" | ephPub | recipientPub).
func Seal(recipientPub, data []byte) ([]byte, error) {
	eph, err := GenerateIdentity()
	if err != nil {
		return nil, err
	}
	shared, err := x25519(eph.PrivateKey, recipientPub)
	if err != nil {
		return nil, fmt.Errorf("e2ee: cannot seal to this key: %w", err)
	}
	key, err := sealKey(eph.PublicKey, recipientPub, shared)
	if err != nil {
		return nil, err
	}
	iv, err := randomBytes(ivLen)
	if err != nil {
		return nil, err
	}
	ct, err := gcmSeal(key, iv, data, eph.PublicKey)
	if err != nil {
		return nil, err
	}
	return concat(eph.PublicKey, iv, ct), nil
}

// Open opens a sealed box addressed to the key pair recipientPriv and
// recipientPub. Every failure matches ErrDecrypt.
func Open(recipientPriv, recipientPub, blob []byte) ([]byte, error) {
	if len(blob) < KeyLen+ivLen+tagLen {
		return nil, decryptError("sealed box is too short")
	}
	ephPub := blob[:KeyLen]
	iv := blob[KeyLen : KeyLen+ivLen]
	ct := blob[KeyLen+ivLen:]
	shared, err := x25519(recipientPriv, ephPub)
	if err != nil {
		return nil, decryptError("sealed box failed to decrypt")
	}
	key, err := sealKey(ephPub, recipientPub, shared)
	if err != nil {
		return nil, decryptError("sealed box failed to decrypt")
	}
	data, err := gcmOpen(key, iv, ct, ephPub)
	if err != nil {
		return nil, decryptError("sealed box failed to decrypt")
	}
	return data, nil
}

// WrapGrant seals a conversation root key to a member's identity key.
func WrapGrant(recipientPub, root []byte) ([]byte, error) { return Seal(recipientPub, root) }

// UnwrapGrant opens a grant made by WrapGrant (or the web client's wrapGrant).
func UnwrapGrant(priv, pub, wrapped []byte) ([]byte, error) { return Open(priv, pub, wrapped) }
