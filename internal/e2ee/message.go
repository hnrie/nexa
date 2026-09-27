package e2ee

import (
	"encoding/json"
	"errors"
	"math"
	"strconv"
)

// Envelope is what the server stores for a message: the conversation and
// epoch whose root the channel key comes from, and an AES-256-GCM ciphertext
// of the JSON payload. IV and CT are standard base64 with padding.
type Envelope struct {
	V     int    `json:"v"`
	Conv  string `json:"conv"`
	Epoch int    `json:"epoch"`
	IV    string `json:"iv"`
	CT    string `json:"ct"`
}

// AAD is what a message's ciphertext is bound to, so that it cannot be
// replayed into another channel or attributed to another author.
type AAD struct {
	Conv      string
	Epoch     int
	ChannelID string
	AuthorID  string
}

// Bytes is the additional data itself, "conv|epoch|channelId|authorId" in
// UTF-8 (aadBytes in message.ts).
func (a AAD) Bytes() []byte {
	return []byte(a.Conv + "|" + strconv.Itoa(a.Epoch) + "|" + a.ChannelID + "|" + a.AuthorID)
}

// EncryptMessage seals a payload under a channel key with a fresh random iv.
func EncryptMessage(chanKey []byte, aad AAD, p *Payload) (Envelope, error) {
	if p == nil {
		return Envelope{}, errors.New("e2ee: no payload to encrypt")
	}
	plaintext, err := p.MarshalJSON()
	if err != nil {
		return Envelope{}, err
	}
	iv, err := randomBytes(ivLen)
	if err != nil {
		return Envelope{}, err
	}
	ct, err := gcmSeal(chanKey, iv, plaintext, aad.Bytes())
	if err != nil {
		return Envelope{}, err
	}
	return Envelope{V: 1, Conv: aad.Conv, Epoch: aad.Epoch, IV: b64(iv), CT: b64(ct)}, nil
}

// DecryptMessage opens an envelope and reads its payload. It refuses what the
// web client's decryptMessage refuses, and every failure matches ErrDecrypt;
// but where the web client keeps only the members it knows, the payload
// returned here keeps them all. The one gap: it does not read "poll" yet, so a
// payload whose only content is an unusable poll opens here (see
// docs/bots/crypto.md).
func DecryptMessage(chanKey []byte, env Envelope, aad AAD) (*Payload, error) {
	if env.V != 1 {
		return nil, decryptError("unsupported envelope version")
	}
	iv, err1 := unb64(env.IV)
	ct, err2 := unb64(env.CT)
	if err1 != nil || err2 != nil || len(iv) != ivLen {
		return nil, decryptError("malformed envelope")
	}
	plaintext, err := gcmOpen(chanKey, iv, ct, aad.Bytes())
	if err != nil {
		return nil, decryptError("message failed to decrypt")
	}
	p, err := ParsePayload(plaintext)
	if err != nil {
		return nil, decryptError("malformed message payload")
	}
	if err := p.checkContent(); err != nil {
		return nil, err
	}
	return p, nil
}

var errNotEnvelope = errors.New("e2ee: not a message envelope")

// ParseEnvelope reads an envelope from JSON with the checks of isEnvelope in
// message.ts: v is 1, conv, iv and ct are strings and epoch is an integer
// (here also a safe one, as it must fit an int). Member names are matched
// exactly, unlike encoding/json's default.
func ParseEnvelope(data []byte) (Envelope, error) {
	var m map[string]json.RawMessage
	if json.Unmarshal(data, &m) != nil || m == nil {
		return Envelope{}, errNotEnvelope
	}
	v, okV := jsonNumber(m["v"])
	conv, okConv := jsonString(m["conv"])
	epoch, okEpoch := jsonNumber(m["epoch"])
	iv, okIV := jsonString(m["iv"])
	ct, okCT := jsonString(m["ct"])
	if !okV || v != 1 || !okConv || !okIV || !okCT || !okEpoch ||
		epoch != math.Trunc(epoch) || math.Abs(epoch) > maxSafeInteger {
		return Envelope{}, errNotEnvelope
	}
	return Envelope{V: 1, Conv: conv, Epoch: int(epoch), IV: iv, CT: ct}, nil
}

// UnmarshalJSON is ParseEnvelope, so a decoded envelope has passed its checks.
func (e *Envelope) UnmarshalJSON(data []byte) error {
	env, err := ParseEnvelope(data)
	if err != nil {
		return err
	}
	*e = env
	return nil
}
