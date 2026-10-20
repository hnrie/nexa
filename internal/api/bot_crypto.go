package api

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"sync"

	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/store"
)

// A bot reads what people write the way their apps do (web/src/crypto),
// except that the server does it for the bot: it holds the bot's X25519
// identity, sealed with the server secret. What it can open is what the
// bot's people gave it: copies their apps sealed to the bot's key for the
// messages addressed to it (bot_copies), and, for a bot whose application has
// the Message Content intent, the root keys of the servers it is in, wrapped
// to its key like anyone's. Nothing is ever encrypted here: what a bot says
// it says in the clear, like a webhook.

var errBotCannotRead = errors.New("bot: cannot open this")

// newBotIdentity makes a bot's X25519 key pair.
func newBotIdentity() (pub, priv []byte, err error) {
	k, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	return k.PublicKey().Bytes(), k.Bytes(), nil
}

func (s *Server) botSeal() (cipher.AEAD, error) {
	block, err := aes.NewCipher(s.derivedKey("bot-key-v1"))
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// sealBotSecret keeps a private key (a bot's identity, an application's
// signing key) so only this server can open it.
func (s *Server) sealBotSecret(plain []byte) ([]byte, error) {
	gcm, err := s.botSeal()
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plain, nil), nil
}

func (s *Server) openBotSecret(sealed []byte) ([]byte, error) {
	gcm, err := s.botSeal()
	if err != nil {
		return nil, err
	}
	if len(sealed) < gcm.NonceSize() {
		return nil, errors.New("bot: sealed key is truncated")
	}
	return gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], nil)
}

// openSealedBox opens a sealed box addressed to a key pair: the ephemeral
// public key (32), the iv (12), then AES-256-GCM over the data with the
// ephemeral key as additional data (web/src/crypto/keys.ts seal).
func openSealedBox(priv, pub, box []byte) ([]byte, error) {
	if len(box) < 32+12+16 {
		return nil, errBotCannotRead
	}
	ephPub := box[:32]
	iv := box[32:44]
	ct := box[44:]
	k, err := ecdh.X25519().NewPrivateKey(priv)
	if err != nil {
		return nil, err
	}
	peer, err := ecdh.X25519().NewPublicKey(ephPub)
	if err != nil {
		return nil, errBotCannotRead
	}
	shared, err := k.ECDH(peer)
	if err != nil {
		return nil, errBotCannotRead
	}
	info := append(append([]byte("evilion-chat/seal/v1"), ephPub...), pub...)
	key, err := hkdf.Key(sha256.New, shared, nil, string(info), 32)
	if err != nil {
		return nil, err
	}
	gcm, err := gcmFor(key)
	if err != nil {
		return nil, err
	}
	out, err := gcm.Open(nil, iv, ct, ephPub)
	if err != nil {
		return nil, errBotCannotRead
	}
	return out, nil
}

func gcmFor(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// channelKeyOf is a channel's message key under a conversation root
// (web/src/crypto/conv.ts channelKey).
func channelKeyOf(root []byte, channelID ids.ID) ([]byte, error) {
	return hkdf.Key(sha256.New, root, nil, "chan:"+channelID.String(), 32)
}

// botPayload is a message's sealed content (web/src/crypto/message.ts
// MessagePayload), as far as a bot is shown it.
type botPayload struct {
	T       *string          `json:"t"`
	Att     []botAttachMeta  `json:"att"`
	Sticker *botStickerRef   `json:"sticker"`
	Embeds  []map[string]any `json:"embeds"`
	Flags   *int64           `json:"flags"`
	Poll    *botPollPayload  `json:"poll"`
}

type botAttachMeta struct {
	BlobID   string   `json:"blob_id"`
	Name     string   `json:"name"`
	Type     string   `json:"type"`
	Size     int64    `json:"size"`
	W        *float64 `json:"w"`
	H        *float64 `json:"h"`
	Key      string   `json:"key"`
	Spoiler  bool     `json:"spoiler"`
	Duration *float64 `json:"duration"`
	Alt      string   `json:"alt"`
}

type botStickerRef struct {
	ID     string `json:"id"`
	Blob   string `json:"blob"`
	Name   string `json:"name"`
	Format string `json:"format"`
}

type botPollPayload struct {
	Question string `json:"question"`
	Answers  []struct {
		Text  string `json:"text"`
		Emoji *struct {
			Name     string `json:"name"`
			ID       string `json:"id"`
			Animated bool   `json:"animated"`
		} `json:"emoji"`
	} `json:"answers"`
	Hours       int  `json:"hours"`
	Multiselect bool `json:"multiselect"`
}

// botKeys opens what a bot is given: its own identity, and the roots granted
// to it, kept in memory once opened.
type botKeys struct {
	mu    sync.Mutex
	priv  map[ids.ID][]byte
	roots map[string][]byte
}

func newBotKeys() *botKeys {
	return &botKeys{priv: map[ids.ID][]byte{}, roots: map[string][]byte{}}
}

// identity is a bot's private key, opened once.
func (s *Server) botIdentity(ctx context.Context, botID ids.ID) ([]byte, error) {
	s.botKeys.mu.Lock()
	priv, ok := s.botKeys.priv[botID]
	s.botKeys.mu.Unlock()
	if ok {
		return priv, nil
	}
	app, err := s.Store.ApplicationByID(ctx, botID)
	if err != nil {
		return nil, err
	}
	priv, err = s.openBotSecret(app.BotKeySealed)
	if err != nil {
		return nil, err
	}
	s.botKeys.mu.Lock()
	s.botKeys.priv[botID] = priv
	s.botKeys.mu.Unlock()
	return priv, nil
}

// forgetBot drops what was opened for a bot (its application went, or it
// stopped reading every message).
func (s *Server) forgetBot(botID ids.ID) {
	s.botKeys.mu.Lock()
	defer s.botKeys.mu.Unlock()
	delete(s.botKeys.priv, botID)
	prefix := botID.String() + ":"
	for k := range s.botKeys.roots {
		if len(k) > len(prefix) && k[:len(prefix)] == prefix {
			delete(s.botKeys.roots, k)
		}
	}
}

// botRoot is a conversation epoch's root key as granted to a bot.
func (s *Server) botRoot(ctx context.Context, bot *store.User, conv ids.ID, epoch int) ([]byte, error) {
	key := bot.ID.String() + ":" + conv.String() + ":" + strconv.Itoa(epoch)
	s.botKeys.mu.Lock()
	root, ok := s.botKeys.roots[key]
	s.botKeys.mu.Unlock()
	if ok {
		return root, nil
	}
	g, err := s.Store.Grant(ctx, conv, epoch, bot.ID)
	if err != nil {
		return nil, errBotCannotRead
	}
	priv, err := s.botIdentity(ctx, bot.ID)
	if err != nil {
		return nil, err
	}
	root, err = openSealedBox(priv, bot.PublicKey, g.WrappedKey)
	if err != nil {
		return nil, err
	}
	s.botKeys.mu.Lock()
	s.botKeys.roots[key] = root
	s.botKeys.mu.Unlock()
	return root, nil
}

// decryptForBot opens an encrypted message for a bot: from the copy its
// sender's app sealed to the bot, or, for a bot that reads every message it
// can see, with the conversation's key granted to it. copy is the sealed
// copy, when one was looked up already (nil to look for one).
func (s *Server) decryptForBot(ctx context.Context, bot *store.User, m *store.Message, copy []byte) (*botPayload, error) {
	if copy == nil {
		if copies, err := s.Store.BotCopies(ctx, bot.ID, []ids.ID{m.ID}); err == nil {
			copy = copies[m.ID]
		}
	}
	var plain []byte
	if copy != nil {
		priv, err := s.botIdentity(ctx, bot.ID)
		if err != nil {
			return nil, err
		}
		if plain, err = openSealedBox(priv, bot.PublicKey, copy); err != nil {
			return nil, err
		}
	} else {
		if bot.Flags&store.FlagBotReadsAll == 0 || m.KeyConvID == nil || m.KeyEpoch == nil {
			return nil, errBotCannotRead
		}
		var env envelope
		if err := json.Unmarshal(m.Ciphertext, &env); err != nil {
			return nil, errBotCannotRead
		}
		root, err := s.botRoot(ctx, bot, *m.KeyConvID, *m.KeyEpoch)
		if err != nil {
			return nil, err
		}
		key, err := channelKeyOf(root, m.ChannelID)
		if err != nil {
			return nil, err
		}
		iv, err := base64.StdEncoding.DecodeString(env.IV)
		if err != nil || len(iv) != 12 {
			return nil, errBotCannotRead
		}
		ct, err := base64.StdEncoding.DecodeString(env.CT)
		if err != nil {
			return nil, errBotCannotRead
		}
		gcm, err := gcmFor(key)
		if err != nil {
			return nil, err
		}
		aad := m.KeyConvID.String() + "|" + strconv.Itoa(*m.KeyEpoch) + "|" + m.ChannelID.String() + "|" + m.AuthorID.String()
		if plain, err = gcm.Open(nil, iv, ct, []byte(aad)); err != nil {
			return nil, errBotCannotRead
		}
	}
	var p botPayload
	if err := json.Unmarshal(plain, &p); err != nil {
		return nil, errBotCannotRead
	}
	return &p, nil
}

// --- files -------------------------------------------------------------------------------

const (
	fileChunk     = 4 * 1024 * 1024
	fileHeaderLen = 4 + 8
	fileTagLen    = 16
)

var fileMagic = []byte("ECF1")

// decryptFileTo streams an encrypted attachment (web/src/crypto/fileChunks.ts:
// "ECF1", a base iv, then length-prefixed chunks, chunk i sealed under the
// base iv and i) into w, checking every chunk.
func decryptFileTo(w io.Writer, r io.Reader, key []byte) error {
	gcm, err := gcmFor(key)
	if err != nil {
		return err
	}
	header := make([]byte, fileHeaderLen)
	if _, err := io.ReadFull(r, header); err != nil {
		return errBotCannotRead
	}
	if string(header[:4]) != string(fileMagic) {
		return errBotCannotRead
	}
	iv := make([]byte, 12)
	copy(iv, header[4:12])
	lenBuf := make([]byte, 4)
	buf := make([]byte, 0, fileChunk+fileTagLen)
	for i := uint32(0); ; i++ {
		if _, err := io.ReadFull(r, lenBuf); err != nil {
			if err == io.EOF && i > 0 {
				return nil
			}
			return errBotCannotRead
		}
		n := binary.BigEndian.Uint32(lenBuf)
		if n < fileTagLen || n > fileChunk+fileTagLen {
			return errBotCannotRead
		}
		buf = buf[:n]
		if _, err := io.ReadFull(r, buf); err != nil {
			return errBotCannotRead
		}
		binary.BigEndian.PutUint32(iv[8:], i)
		plain, err := gcm.Open(buf[:0], iv, buf, []byte("file/v1"))
		if err != nil {
			return errBotCannotRead
		}
		if _, err := w.Write(plain); err != nil {
			return err
		}
	}
}
