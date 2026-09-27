package e2ee

import (
	"crypto/hkdf"
	"crypto/sha256"
	"errors"
	"slices"
	"sync"
)

// ErrNoKey means a KeyRing holds no root for that conversation and epoch.
var ErrNoKey = errors.New("e2ee: no key for this conversation and epoch")

// NewRootKey is a fresh conversation root key for a new epoch.
func NewRootKey() ([]byte, error) { return randomBytes(KeyLen) }

// ChannelKey is the message key of a channel under one epoch's root:
// HKDF-SHA256(root, no salt, "chan:"+channelID). The epoch picks the root; it
// is not part of the derivation (it is bound into each message's AAD instead).
func ChannelKey(root []byte, channelID string) ([]byte, error) {
	return hkdf.Key(sha256.New, root, nil, "chan:"+channelID, KeyLen)
}

// VoiceFrameKey is the key a channel's call frames are sealed with, derived
// apart from the message key: HKDF-SHA256(root, no salt, "voice:"+channelID).
func VoiceFrameKey(root []byte, channelID string) ([]byte, error) {
	return hkdf.Key(sha256.New, root, nil, "voice:"+channelID, KeyLen)
}

// KeyRing holds conversation root keys by conversation and epoch, like the
// web client's KeyRing. It is safe for concurrent use, and the zero value is
// an empty ring. It copies roots in and out, and Clear overwrites them.
type KeyRing struct {
	mu    sync.RWMutex
	rings map[string]map[int][]byte
}

// Set stores the root of one epoch of a conversation.
func (k *KeyRing) Set(conv string, epoch int, root []byte) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.rings == nil {
		k.rings = map[string]map[int][]byte{}
	}
	epochs := k.rings[conv]
	if epochs == nil {
		epochs = map[int][]byte{}
		k.rings[conv] = epochs
	}
	if old := epochs[epoch]; old != nil {
		clear(old)
	}
	epochs[epoch] = slices.Clone(root)
}

// Get is the root of one epoch of a conversation.
func (k *KeyRing) Get(conv string, epoch int) ([]byte, bool) {
	k.mu.RLock()
	defer k.mu.RUnlock()
	root, ok := k.rings[conv][epoch]
	return slices.Clone(root), ok
}

// Latest is the newest epoch held for a conversation and its root.
func (k *KeyRing) Latest(conv string) (epoch int, root []byte, ok bool) {
	k.mu.RLock()
	defer k.mu.RUnlock()
	for e, r := range k.rings[conv] {
		if !ok || e > epoch {
			epoch, root, ok = e, r, true
		}
	}
	return epoch, slices.Clone(root), ok
}

// Has reports whether any epoch of a conversation is held.
func (k *KeyRing) Has(conv string) bool {
	k.mu.RLock()
	defer k.mu.RUnlock()
	return len(k.rings[conv]) > 0
}

// Convs lists the conversations held, sorted.
func (k *KeyRing) Convs() []string {
	k.mu.RLock()
	defer k.mu.RUnlock()
	out := make([]string, 0, len(k.rings))
	for c, epochs := range k.rings {
		if len(epochs) > 0 {
			out = append(out, c)
		}
	}
	slices.Sort(out)
	return out
}

// Epochs lists the epochs held for a conversation, oldest first.
func (k *KeyRing) Epochs(conv string) []int {
	k.mu.RLock()
	defer k.mu.RUnlock()
	out := make([]int, 0, len(k.rings[conv]))
	for e := range k.rings[conv] {
		out = append(out, e)
	}
	slices.Sort(out)
	return out
}

// ChannelKey is the message key of a channel whose messages are sealed under
// the given conversation and epoch (a message's key_conv_id and key_epoch).
// It fails with ErrNoKey when that root is not held.
func (k *KeyRing) ChannelKey(conv string, epoch int, channelID string) ([]byte, error) {
	k.mu.RLock()
	root, ok := k.rings[conv][epoch]
	var key []byte
	var err error
	if ok {
		key, err = ChannelKey(root, channelID)
	}
	k.mu.RUnlock()
	if !ok {
		return nil, ErrNoKey
	}
	return key, err
}

// Clear overwrites every root with zeros and forgets them.
func (k *KeyRing) Clear() {
	k.mu.Lock()
	defer k.mu.Unlock()
	for _, epochs := range k.rings {
		for _, root := range epochs {
			clear(root)
		}
	}
	k.rings = nil
}
