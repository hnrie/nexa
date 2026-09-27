package e2ee

import (
	"bytes"
	"crypto/hkdf"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"slices"
)

// A bot's identity is an ordinary x25519 key pair that the browser creating
// the bot generates, together with the bot's token. The server keeps the
// public key, the private key wrapped under a key derived from the token, an
// escrow copy sealed to the owner, and the token's SHA-256; never the token.
// docs/bots/crypto.md has the whole scheme; web/src/crypto/botIdentity.ts is
// the browser's side.

// BotTokenBytes is how many random bytes a new bot token carries.
const BotTokenBytes = 32

const (
	botTokenMinLen = 43 // 32 bytes in unpadded base64url
	botTokenMaxLen = 256

	botWrapSalt    = "nexa/bot-identity/v1"
	botWrapInfo    = "nexa/bot-identity/v1/wrap"
	botWrapVersion = 1
	botWrappedLen  = 1 + ivLen + KeyLen + tagLen

	botEscrowLabel = "nexa/bot-escrow/v1"
)

// NewBotToken is a fresh bot token: 32 random bytes in URL-safe base64
// without padding, 43 characters.
func NewBotToken() (string, error) {
	b, err := randomBytes(BotTokenBytes)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// ValidBotToken reports whether s has the shape of a bot token: 43 to 256
// characters of the URL-safe base64 alphabet. It does not say whether any bot
// has that token.
func ValidBotToken(s string) bool {
	if len(s) < botTokenMinLen || len(s) > botTokenMaxLen {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !('A' <= c && c <= 'Z' || 'a' <= c && c <= 'z' || '0' <= c && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

// BotTokenHash is the SHA-256 of the token's characters: all the server keeps
// of a token, and how it finds the bot a token belongs to.
func BotTokenHash(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

// botTokenKey is HKDF-SHA256(token, salt "nexa/bot-identity/v1",
// info "nexa/bot-identity/v1/wrap"). The token carries 256 random bits, so
// no password stretching is needed.
func botTokenKey(token string) ([]byte, error) {
	if !ValidBotToken(token) {
		return nil, errors.New("e2ee: not a bot token")
	}
	return hkdf.Key(sha256.New, []byte(token), []byte(botWrapSalt), botWrapInfo, KeyLen)
}

func checkIdentity(id Identity) error {
	pub, err := PublicKeyOf(id.PrivateKey)
	if err != nil || !bytes.Equal(pub, id.PublicKey) {
		return errors.New("e2ee: the private key is not the public key's")
	}
	return nil
}

// WrapBotIdentity wraps a bot's private key under its token:
//
//	version 0x01 | iv (12) | AES-256-GCM(botTokenKey(token), iv, private key, AAD = public key)
//
// 61 bytes in all. The browser does this when it creates the bot or resets
// its token; the server only ever unwraps.
func WrapBotIdentity(id Identity, token string) ([]byte, error) {
	if err := checkIdentity(id); err != nil {
		return nil, err
	}
	key, err := botTokenKey(token)
	if err != nil {
		return nil, err
	}
	iv, err := randomBytes(ivLen)
	if err != nil {
		return nil, err
	}
	ct, err := gcmSeal(key, iv, id.PrivateKey, id.PublicKey)
	if err != nil {
		return nil, err
	}
	return concat([]byte{botWrapVersion}, iv, ct), nil
}

// UnwrapBotIdentity opens a wrapped bot identity with the bot's token and
// checks that the private key belongs to publicKey. Every failure, a wrong
// token included, matches ErrDecrypt.
func UnwrapBotIdentity(wrapped []byte, token string, publicKey []byte) (Identity, error) {
	if len(wrapped) != botWrappedLen || wrapped[0] != botWrapVersion || len(publicKey) != KeyLen {
		return Identity{}, decryptError("wrapped bot identity is malformed")
	}
	key, err := botTokenKey(token)
	if err != nil {
		return Identity{}, decryptError("not a bot token")
	}
	priv, err := gcmOpen(key, wrapped[1:1+ivLen], wrapped[1+ivLen:], publicKey)
	if err != nil {
		return Identity{}, decryptError("wrapped bot identity failed to decrypt")
	}
	pub, err := PublicKeyOf(priv)
	if err != nil || subtle.ConstantTimeCompare(pub, publicKey) != 1 {
		return Identity{}, decryptError("bot identity does not match its public key")
	}
	return Identity{PublicKey: slices.Clone(publicKey), PrivateKey: priv}, nil
}

// SealBotEscrow seals a copy of a bot's identity to its owner's identity key
// with Seal, so that the owner's browser can wrap the same identity under a
// new token. The sealed plaintext is
//
//	"nexa/bot-escrow/v1" (18) | public key (32) | private key (32)
//
// whose label keeps an escrow and a conversation grant (a bare 32-byte root)
// from being taken for one another.
func SealBotEscrow(ownerPub []byte, id Identity) ([]byte, error) {
	if err := checkIdentity(id); err != nil {
		return nil, err
	}
	return Seal(ownerPub, concat([]byte(botEscrowLabel), id.PublicKey, id.PrivateKey))
}

// OpenBotEscrow opens an escrow with the owner's key pair and checks that it
// holds the identity whose public key is botPub. Only the owner's browser can
// do this; the server never holds an owner's private key, so here it serves
// tools and tests.
func OpenBotEscrow(ownerPriv, ownerPub, escrow, botPub []byte) (Identity, error) {
	plain, err := Open(ownerPriv, ownerPub, escrow)
	if err != nil {
		return Identity{}, err
	}
	n := len(botEscrowLabel)
	if len(plain) != n+2*KeyLen || string(plain[:n]) != botEscrowLabel {
		return Identity{}, decryptError("not a bot identity escrow")
	}
	pub, priv := plain[n:n+KeyLen], plain[n+KeyLen:]
	got, err := PublicKeyOf(priv)
	if err != nil || !bytes.Equal(got, pub) || !bytes.Equal(pub, botPub) {
		return Identity{}, decryptError("escrow does not hold this bot's identity")
	}
	return Identity{PublicKey: slices.Clone(pub), PrivateKey: slices.Clone(priv)}, nil
}
