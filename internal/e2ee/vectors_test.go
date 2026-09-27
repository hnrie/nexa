package e2ee

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"
)

// Cross-language vectors. testdata/ts-vectors.json is written by
// web/src/crypto/vectors.test.ts: each randomized call comes with the random
// bytes it took, so replaying them here must give the same bytes, and
// everything in it must open. go-vectors.json in web/src/crypto/testdata is
// written here the same way (WRITE_VECTORS=1 go test ./internal/e2ee) and
// checked by that vitest. A normal run regenerates it and compares.

const (
	tsVectorsPath = "testdata/ts-vectors.json"
	goVectorsPath = "../../web/src/crypto/testdata/go-vectors.json"
)

type identityVector struct {
	Priv []byte `json:"priv"`
	Pub  []byte `json:"pub"`
}

type sealedVector struct {
	Name          string `json:"name"`
	Random        []byte `json:"random"` // empty when the box was built by hand
	RecipientPriv []byte `json:"recipientPriv"`
	RecipientPub  []byte `json:"recipientPub"`
	Data          []byte `json:"data"`
	Blob          []byte `json:"blob"`
}

type badSealedVector struct {
	Name          string `json:"name"`
	RecipientPriv []byte `json:"recipientPriv"`
	RecipientPub  []byte `json:"recipientPub"`
	Blob          []byte `json:"blob"`
}

type channelKeyVector struct {
	Root      []byte `json:"root"`
	Epoch     int    `json:"epoch"`
	ChannelID string `json:"channelId"`
	ChanKey   []byte `json:"chanKey"`
	VoiceKey  []byte `json:"voiceKey"`
}

type aadVector struct {
	Conv      string `json:"conv"`
	Epoch     int    `json:"epoch"`
	ChannelID string `json:"channelId"`
	AuthorID  string `json:"authorId"`
}

type messageVector struct {
	Name      string          `json:"name"`
	Random    []byte          `json:"random"`
	Root      []byte          `json:"root"`
	AAD       aadVector       `json:"aad"`
	Plaintext []byte          `json:"plaintext"`
	Envelope  Envelope        `json:"envelope"`
	Decrypted json.RawMessage `json:"decrypted"`
	Error     bool            `json:"error"`
	Rebuild   bool            `json:"rebuild"`
}

type fileVector struct {
	Name         string `json:"name"`
	Size         int64  `json:"size"`
	Random       []byte `json:"random"`
	Key          []byte `json:"key"`
	BaseIV       []byte `json:"baseIv"`
	CipherSHA256 string `json:"cipherSha256"`
	Cipher       []byte `json:"cipher,omitempty"`
}

type sizeVector struct {
	Size      int64 `json:"size"`
	Encrypted int64 `json:"encrypted"`
}

type tokenVector struct {
	Token string `json:"token"`
	Valid bool   `json:"valid"`
}

type wrapVector struct {
	Random    []byte `json:"random"`
	Token     string `json:"token"`
	TokenHash []byte `json:"tokenHash"`
	Priv      []byte `json:"priv"`
	Pub       []byte `json:"pub"`
	Wrapped   []byte `json:"wrapped"`
}

type escrowVector struct {
	Random    []byte `json:"random"`
	OwnerPriv []byte `json:"ownerPriv"`
	OwnerPub  []byte `json:"ownerPub"`
	BotPriv   []byte `json:"botPriv"`
	BotPub    []byte `json:"botPub"`
	Escrow    []byte `json:"escrow"`
}

type createdVector struct {
	OwnerPriv    []byte `json:"ownerPriv"`
	OwnerPub     []byte `json:"ownerPub"`
	Token        string `json:"token"`
	TokenHash    []byte `json:"tokenHash"`
	BotPriv      []byte `json:"botPriv"`
	BotPub       []byte `json:"botPub"`
	Wrapped      []byte `json:"wrapped"`
	Escrow       []byte `json:"escrow"`
	NewToken     string `json:"newToken"`
	NewTokenHash []byte `json:"newTokenHash"`
	Rewrapped    []byte `json:"rewrapped"`
}

type vectors struct {
	Comment        string             `json:"comment"`
	Identities     []identityVector   `json:"identities"`
	Sealed         []sealedVector     `json:"sealed"`
	SealedBad      []badSealedVector  `json:"sealedBad"`
	Grants         []sealedVector     `json:"grants"`
	ChannelKeys    []channelKeyVector `json:"channelKeys"`
	Messages       []messageVector    `json:"messages"`
	Files          []fileVector       `json:"files"`
	EncryptedSizes []sizeVector       `json:"encryptedSizes"`
	BotTokens      []tokenVector      `json:"botTokens"`
	BotWraps       []wrapVector       `json:"botWraps"`
	BotEscrows     []escrowVector     `json:"botEscrows"`
	BotCreated     createdVector      `json:"botCreated"`
}

// stream is SHA-256 in counter mode over a seed, the vectors' random source
// (the same construction as the vitest's).
type stream struct {
	seed    string
	counter uint32
	pool    []byte
}

func (s *stream) Read(p []byte) (int, error) {
	for len(s.pool) < len(p) {
		c := s.counter
		h := sha256.Sum256(append([]byte(s.seed), byte(c>>24), byte(c>>16), byte(c>>8), byte(c)))
		s.counter++
		s.pool = append(s.pool, h[:]...)
	}
	n := copy(p, s.pool)
	s.pool = s.pool[n:]
	return n, nil
}

func (s *stream) take(n int) []byte {
	b := make([]byte, n)
	_, _ = s.Read(b)
	return b
}

type tee struct {
	r   io.Reader
	got []byte
}

func (t *tee) Read(p []byte) (int, error) {
	n, err := t.r.Read(p)
	t.got = append(t.got, p[:n]...)
	return n, err
}

// record runs fn with the package's randomness drawn from s and returns the
// bytes it took.
func record(s *stream, fn func()) []byte {
	t := &tee{r: s}
	old := random
	random = t
	defer func() { random = old }()
	fn()
	return append([]byte{}, t.got...)
}

// replay runs fn with the package's randomness read from recorded bytes,
// which it must use up exactly.
func replay(t *testing.T, what string, recorded []byte, fn func()) {
	t.Helper()
	r := bytes.NewReader(recorded)
	old := random
	random = r
	defer func() { random = old }()
	fn()
	if r.Len() != 0 {
		t.Errorf("%s: %d recorded random bytes were not used", what, r.Len())
	}
}

// pattern is the plaintext of every file vector, as in the vitest.
func pattern(n int64) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte((i*7 + 3) % 251)
	}
	return b
}

func sha256Hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// must is for setup steps that cannot fail unless the test itself is wrong.
func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}

// sanitizedView is the payload as the web client's decryptMessage returns
// it: only the members it knows, read with its rules.
func sanitizedView(t *testing.T, p *Payload) json.RawMessage {
	t.Helper()
	m := map[string]any{}
	if s, ok := p.Text(); ok {
		m["t"] = s
	}
	if a := p.Attachments(); len(a) > 0 {
		m["att"] = a
	}
	if s, ok := p.Sticker(); ok {
		m["sticker"] = s
	}
	if e := p.Embeds(); len(e) > 0 {
		m["embeds"] = e
	}
	if f, ok := p.Flags(); ok {
		m["flags"] = f
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(m); err != nil {
		t.Fatal(err)
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n"))
}

func sameJSON(t *testing.T, a, b []byte) bool {
	t.Helper()
	var x, y any
	if err := json.Unmarshal(a, &x); err != nil {
		t.Fatalf("%s: %v", a, err)
	}
	if err := json.Unmarshal(b, &y); err != nil {
		t.Fatalf("%s: %v", b, err)
	}
	return reflect.DeepEqual(x, y)
}

// rebuild writes a payload again through the typed getters and setters only.
func rebuild(p *Payload) (*Payload, error) {
	q := NewPayload()
	for _, k := range p.Keys() {
		var err error
		switch k {
		case "t":
			s, ok := p.Text()
			if !ok {
				return nil, errors.New("t is not a string")
			}
			q.SetText(s)
		case "att":
			err = q.SetAttachments(p.Attachments())
		case "sticker":
			s, ok := p.Sticker()
			if !ok {
				return nil, errors.New("sticker is not usable")
			}
			err = q.SetSticker(s)
		case "embeds":
			err = q.SetEmbeds(p.Embeds())
		case "flags":
			f, ok := p.Flags()
			if !ok {
				return nil, errors.New("flags is not a number")
			}
			err = q.SetFlags(f)
		default:
			return nil, fmt.Errorf("no setter for %q", k)
		}
		if err != nil {
			return nil, err
		}
	}
	return q, nil
}

// encryptRaw is EncryptMessage for any plaintext, including ones that are
// not a payload, as the vitest can write them.
func encryptRaw(key []byte, aad AAD, plaintext []byte) (Envelope, error) {
	iv, err := randomBytes(ivLen)
	if err != nil {
		return Envelope{}, err
	}
	ct, err := gcmSeal(key, iv, plaintext, aad.Bytes())
	if err != nil {
		return Envelope{}, err
	}
	return Envelope{V: 1, Conv: aad.Conv, Epoch: aad.Epoch, IV: b64(iv), CT: b64(ct)}, nil
}

func verifyVectors(t *testing.T, v *vectors) {
	t.Run("identities", func(t *testing.T) {
		for i, id := range v.Identities {
			if got := must(PublicKeyOf(id.Priv)); !bytes.Equal(got, id.Pub) {
				t.Errorf("identity %d: public key differs", i)
			}
		}
	})

	t.Run("sealed boxes and grants", func(t *testing.T) {
		for _, s := range slices.Concat(v.Sealed, v.Grants) {
			got, err := UnwrapGrant(s.RecipientPriv, s.RecipientPub, s.Blob)
			if err != nil || !bytes.Equal(got, s.Data) {
				t.Errorf("%s: open: %v", s.Name, err)
			}
			if len(s.Random) == 0 {
				continue
			}
			var blob []byte
			replay(t, s.Name, s.Random, func() { blob, err = Seal(s.RecipientPub, s.Data) })
			if err != nil || !bytes.Equal(blob, s.Blob) {
				t.Errorf("%s: sealing again gave other bytes (%v)", s.Name, err)
			}
		}
		for _, s := range v.SealedBad {
			if _, err := Open(s.RecipientPriv, s.RecipientPub, s.Blob); !errors.Is(err, ErrDecrypt) {
				t.Errorf("%s: opened, or failed the wrong way: %v", s.Name, err)
			}
		}
	})

	t.Run("channel keys", func(t *testing.T) {
		for _, c := range v.ChannelKeys {
			if got := must(ChannelKey(c.Root, c.ChannelID)); !bytes.Equal(got, c.ChanKey) {
				t.Errorf("epoch %d channel %q: channel key differs", c.Epoch, c.ChannelID)
			}
			if got := must(VoiceFrameKey(c.Root, c.ChannelID)); !bytes.Equal(got, c.VoiceKey) {
				t.Errorf("epoch %d channel %q: voice key differs", c.Epoch, c.ChannelID)
			}
		}
	})

	t.Run("messages", func(t *testing.T) {
		for _, m := range v.Messages {
			aad := AAD(m.AAD)
			key := must(ChannelKey(m.Root, aad.ChannelID))

			var env Envelope
			var err error
			replay(t, m.Name, m.Random, func() { env, err = encryptRaw(key, aad, m.Plaintext) })
			if err != nil || env != m.Envelope {
				t.Errorf("%s: encrypting the plaintext again gave %+v (%v), want %+v", m.Name, env, err, m.Envelope)
			}

			parsed, perr := ParsePayload(m.Plaintext)
			if perr == nil {
				if out := must(parsed.MarshalJSON()); !bytes.Equal(out, m.Plaintext) {
					t.Errorf("%s: payload marshals as %s, want %s", m.Name, out, m.Plaintext)
				}
				replay(t, m.Name, m.Random, func() { env, err = EncryptMessage(key, aad, parsed) })
				if err != nil || env != m.Envelope {
					t.Errorf("%s: EncryptMessage gave %+v (%v)", m.Name, env, err)
				}
			} else if !m.Error {
				t.Errorf("%s: payload does not parse: %v", m.Name, perr)
			}

			p, err := DecryptMessage(key, m.Envelope, aad)
			if m.Error {
				if !errors.Is(err, ErrDecrypt) {
					t.Errorf("%s: want ErrDecrypt, got %v", m.Name, err)
				}
				continue
			}
			if err != nil {
				t.Errorf("%s: %v", m.Name, err)
				continue
			}
			if got := sanitizedView(t, p); !sameJSON(t, got, m.Decrypted) {
				t.Errorf("%s: read as %s, the web client reads %s", m.Name, got, m.Decrypted)
			}
			if out := must(p.MarshalJSON()); !bytes.Equal(out, m.Plaintext) {
				t.Errorf("%s: decrypted payload marshals as %s", m.Name, out)
			}
			if m.Rebuild {
				q, err := rebuild(p)
				if err != nil {
					t.Errorf("%s: rebuild: %v", m.Name, err)
				} else if out := must(q.MarshalJSON()); !bytes.Equal(out, m.Plaintext) {
					t.Errorf("%s: setters wrote\n%s\nJSON.stringify wrote\n%s", m.Name, out, m.Plaintext)
				}
			}
		}
	})

	t.Run("files", func(t *testing.T) {
		for _, f := range v.Files {
			plain := pattern(f.Size)
			var key, ct []byte
			var err error
			replay(t, f.Name, f.Random, func() { key, ct, err = EncryptFile(plain) })
			if err != nil {
				t.Fatalf("%s: %v", f.Name, err)
			}
			if !bytes.Equal(key, f.Key) || !bytes.Equal(ct[4:12], f.BaseIV) || sha256Hex(ct) != f.CipherSHA256 {
				t.Errorf("%s: encrypting again gave other bytes", f.Name)
			}
			if f.Cipher != nil && !bytes.Equal(ct, f.Cipher) {
				t.Errorf("%s: ciphertext differs", f.Name)
			}
			theirs := ct // the same bytes as theirs, the hash says
			if f.Cipher != nil {
				theirs = f.Cipher
			}
			if got, err := DecryptFile(f.Key, theirs, f.Size); err != nil || !bytes.Equal(got, plain) {
				t.Errorf("%s: decrypt: %v", f.Name, err)
			}
		}
		for _, s := range v.EncryptedSizes {
			if got := EncryptedSize(s.Size); got != s.Encrypted {
				t.Errorf("EncryptedSize(%d) = %d, want %d", s.Size, got, s.Encrypted)
			}
		}
	})

	t.Run("bot identities", func(t *testing.T) {
		for _, tv := range v.BotTokens {
			if ValidBotToken(tv.Token) != tv.Valid {
				t.Errorf("ValidBotToken(%q) = %v", tv.Token, !tv.Valid)
			}
		}
		for _, w := range v.BotWraps {
			if !bytes.Equal(BotTokenHash(w.Token), w.TokenHash) {
				t.Errorf("token hash of %q differs", w.Token)
			}
			id, err := UnwrapBotIdentity(w.Wrapped, w.Token, w.Pub)
			if err != nil || !bytes.Equal(id.PrivateKey, w.Priv) {
				t.Errorf("unwrap with %q: %v", w.Token, err)
			}
			var again []byte
			replay(t, "wrap", w.Random, func() { again, err = WrapBotIdentity(Identity{PublicKey: w.Pub, PrivateKey: w.Priv}, w.Token) })
			if err != nil || !bytes.Equal(again, w.Wrapped) {
				t.Errorf("wrapping again under %q gave other bytes (%v)", w.Token, err)
			}
		}
		for _, e := range v.BotEscrows {
			id, err := OpenBotEscrow(e.OwnerPriv, e.OwnerPub, e.Escrow, e.BotPub)
			if err != nil || !bytes.Equal(id.PrivateKey, e.BotPriv) {
				t.Errorf("open escrow: %v", err)
			}
			var again []byte
			replay(t, "escrow", e.Random, func() {
				again, err = SealBotEscrow(e.OwnerPub, Identity{PublicKey: e.BotPub, PrivateKey: e.BotPriv})
			})
			if err != nil || !bytes.Equal(again, e.Escrow) {
				t.Errorf("sealing the escrow again gave other bytes (%v)", err)
			}
		}
		c := v.BotCreated
		if !bytes.Equal(BotTokenHash(c.Token), c.TokenHash) || !bytes.Equal(BotTokenHash(c.NewToken), c.NewTokenHash) {
			t.Error("created bot: token hashes differ")
		}
		if id, err := UnwrapBotIdentity(c.Wrapped, c.Token, c.BotPub); err != nil || !bytes.Equal(id.PrivateKey, c.BotPriv) {
			t.Errorf("created bot: unwrap: %v", err)
		}
		if id, err := OpenBotEscrow(c.OwnerPriv, c.OwnerPub, c.Escrow, c.BotPub); err != nil || !bytes.Equal(id.PrivateKey, c.BotPriv) {
			t.Errorf("created bot: escrow: %v", err)
		}
		if id, err := UnwrapBotIdentity(c.Rewrapped, c.NewToken, c.BotPub); err != nil || !bytes.Equal(id.PrivateKey, c.BotPriv) {
			t.Errorf("reset token: unwrap: %v", err)
		}
		if _, err := UnwrapBotIdentity(c.Rewrapped, c.Token, c.BotPub); !errors.Is(err, ErrDecrypt) {
			t.Errorf("reset token: the old token still opens it (%v)", err)
		}
		if _, err := UnwrapBotIdentity(c.Wrapped, c.NewToken, c.BotPub); !errors.Is(err, ErrDecrypt) {
			t.Errorf("reset token: the new token opens the old wrap (%v)", err)
		}
	})
}

func readVectors(t *testing.T, path string) *vectors {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (see the comment at the top of vectors_test.go)", err)
	}
	var v vectors
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	if len(v.Messages) == 0 || len(v.Files) == 0 || len(v.BotWraps) == 0 {
		t.Fatalf("%s: some vectors are missing", path)
	}
	return &v
}

func TestTypeScriptVectors(t *testing.T) {
	verifyVectors(t, readVectors(t, tsVectorsPath))
}

// TestGoVectors checks that the vectors checked in for the vitest are still
// what this package writes (and that they pass the checks run on the
// TypeScript ones); WRITE_VECTORS=1 rewrites them.
func TestGoVectors(t *testing.T) {
	v := generateGoVectors(t)
	verifyVectors(t, v)
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("WRITE_VECTORS") == "1" {
		if err := os.WriteFile(goVectorsPath, buf.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	onDisk, err := os.ReadFile(goVectorsPath)
	if err != nil {
		t.Fatalf("%v (WRITE_VECTORS=1 go test ./internal/e2ee writes it)", err)
	}
	if !bytes.Equal(onDisk, buf.Bytes()) {
		t.Fatalf("%s is not what this package writes now; rerun with WRITE_VECTORS=1 and check the vitest", goVectorsPath)
	}
}

// lowOrderPoints are x25519 u-coordinates of small order, with which any
// clamped scalar gives an all-zero shared secret.
func lowOrderPoints() [][]byte {
	p := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 255), big.NewInt(19))
	n := func(s string) *big.Int { v, _ := new(big.Int).SetString(s, 10); return v }
	top := new(big.Int).Lsh(big.NewInt(1), 255)
	vals := []*big.Int{
		big.NewInt(0), big.NewInt(1),
		n("325606250916557431795983626356110631294008115727848805560023387167927233504"),
		n("39382357235489614581723060781553021112529911719440698176882885853963445705823"),
		new(big.Int).Sub(p, big.NewInt(1)), p, new(big.Int).Add(p, big.NewInt(1)),
		top, new(big.Int).Add(top, big.NewInt(1)),
	}
	var out [][]byte
	for _, v := range vals {
		be := v.FillBytes(make([]byte, 32))
		slices.Reverse(be)
		out = append(out, be)
	}
	return out
}

// sealByHand builds a sealed box around any ephemeral key and shared secret.
func sealByHand(t *testing.T, ephPub, shared, recipientPub, iv, data []byte) []byte {
	t.Helper()
	key := must(sealKey(ephPub, recipientPub, shared))
	return concat(ephPub, iv, must(gcmSeal(key, iv, data, ephPub)))
}

func generateGoVectors(t *testing.T) *vectors {
	s := &stream{seed: "nexa/e2ee/go-vectors"}
	rec := func(fn func()) []byte { return record(s, fn) }
	newID := func() Identity {
		var id Identity
		var err error
		rec(func() { id, err = GenerateIdentity() })
		return must(id, err)
	}
	v := &vectors{Comment: "Written by internal/e2ee (WRITE_VECTORS=1 go test ./internal/e2ee); checked by web/src/crypto/vectors.test.ts. Do not edit."}

	alice, bob := newID(), newID()
	for _, id := range []Identity{alice, bob, newID()} {
		v.Identities = append(v.Identities, identityVector{Priv: id.PrivateKey, Pub: id.PublicKey})
	}
	for _, priv := range [][]byte{make([]byte, 32), bytes.Repeat([]byte{0xff}, 32)} {
		v.Identities = append(v.Identities, identityVector{Priv: priv, Pub: must(PublicKeyOf(priv))})
	}

	for _, c := range []struct {
		name string
		data []byte
	}{{"empty", []byte{}}, {"short", []byte("hi")}, {"32 bytes", s.take(32)}, {"1 KiB", s.take(1024)}} {
		var blob []byte
		var err error
		random := rec(func() { blob, err = Seal(bob.PublicKey, c.data) })
		v.Sealed = append(v.Sealed, sealedVector{Name: c.name, Random: random, RecipientPriv: bob.PrivateKey, RecipientPub: bob.PublicKey, Data: c.data, Blob: must(blob, err)})
	}
	{
		eph := newID()
		ephPub := slices.Clone(eph.PublicKey)
		ephPub[31] |= 0x80
		data := []byte("high bit")
		blob := sealByHand(t, ephPub, must(x25519(eph.PrivateKey, bob.PublicKey)), bob.PublicKey, s.take(12), data)
		v.Sealed = append(v.Sealed, sealedVector{Name: "ephemeral key with the top bit set", Random: []byte{}, RecipientPriv: bob.PrivateKey, RecipientPub: bob.PublicKey, Data: data, Blob: blob})
	}
	bad := func(name string, blob []byte) {
		v.SealedBad = append(v.SealedBad, badSealedVector{Name: name, RecipientPriv: bob.PrivateKey, RecipientPub: bob.PublicKey, Blob: blob})
	}
	for i, u := range lowOrderPoints() {
		bad(fmt.Sprintf("low-order ephemeral key %d", i), sealByHand(t, u, make([]byte, 32), bob.PublicKey, s.take(12), []byte("low order")))
	}
	var good []byte
	rec(func() { good = must(Seal(bob.PublicKey, []byte("tamper"))) })
	flipped := slices.Clone(good)
	flipped[len(flipped)-1] ^= 1
	bad("flipped tag bit", flipped)
	bad("one byte short", good[:len(good)-1])
	bad("shorter than a box", good[:59])
	var other []byte
	rec(func() { other = must(Seal(alice.PublicKey, []byte("not for bob"))) })
	bad("sealed to someone else", other)

	for _, name := range []string{"root 1", "root 2"} {
		root := s.take(32)
		var blob []byte
		var err error
		random := rec(func() { blob, err = WrapGrant(alice.PublicKey, root) })
		v.Grants = append(v.Grants, sealedVector{Name: name, Random: random, RecipientPriv: alice.PrivateKey, RecipientPub: alice.PublicKey, Data: root, Blob: must(blob, err)})
	}

	for _, epoch := range []int{0, 1, 2, 7} {
		root := s.take(32)
		for _, ch := range []string{"1000000000000000002", "chan-1", "Ünïcödé 🔑", ""} {
			v.ChannelKeys = append(v.ChannelKeys, channelKeyVector{Root: root, Epoch: epoch, ChannelID: ch,
				ChanKey: must(ChannelKey(root, ch)), VoiceKey: must(VoiceFrameKey(root, ch))})
		}
	}

	root := s.take(32)
	fileKey1, fileKey2 := b64(s.take(32)), b64(s.take(32))
	aad := func(epoch int, author string) AAD {
		return AAD{Conv: "1000000000000000001", Epoch: epoch, ChannelID: "1000000000000000002", AuthorID: author}
	}
	author := "1000000000000000003"
	f := func(x float64) *float64 { return &x }
	str := func(x string) *string { return &x }
	yes := true
	photo := Attachment{BlobID: "1100000000000000001", Name: "Ünïcode photo 📷.png", Type: "image/png", Size: 5368709120,
		W: f(1920), H: f(1080), Key: fileKey1, Spoiler: &yes, Duration: f(3.7066666666666666)}
	notes := Attachment{BlobID: "1100000000000000002", Name: "notes.txt", Type: "", Size: 0, Key: fileKey2}
	embed := Embed{"url": "https://example.com/a?b=c&d=<e>", "type": "link", "title": "Example «quoted» 日本語",
		"description": "Line one\nline two", "site_name": "Example", "image": "/api/v1/media/proxy?u=1",
		"video_id": "dQw4w9WgXcQ", "mime": "text/html", "color": "#5865f2", "invite_code": "abc123",
		"image_w": 1200.0, "image_h": 630.0, "member_count": 42.0, "online_count": 7.0}
	sticker := Sticker{ID: "1200000000000000001", Blob: str("1200000000000000002"), Name: str("wave"), W: f(160), H: f(160), Animated: &yes, Format: str("apng")}
	build := func(fn func(p *Payload) error) *Payload {
		p := NewPayload()
		if err := fn(p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	raw := func(members ...string) func(p *Payload) error {
		return func(p *Payload) error {
			for i := 0; i < len(members); i += 2 {
				if err := p.SetRaw(members[i], json.RawMessage(members[i+1])); err != nil {
					return err
				}
			}
			return nil
		}
	}
	cases := []struct {
		name    string
		aad     AAD
		payload *Payload
		rebuild bool
	}{
		{"ascii text", aad(0, author), build(func(p *Payload) error { p.SetText("hello world"); return nil }), true},
		{"non-ascii text", aad(3, author), build(func(p *Payload) error {
			p.SetText("héllo wörld 👋 日本語 <b>&amp;</b> \u2028\u2029 \"q\" \\ /\n\r\t\b\f \u0001\u001f\u007f\u0085\ufeff")
			return nil
		}), true},
		{"empty text", aad(1, "1000000000000000004"), build(func(p *Payload) error { p.SetText(""); return nil }), true},
		{"attachments, sticker, embeds and flags", aad(2, author), build(func(p *Payload) error {
			p.SetText("look")
			return errors.Join(p.SetAttachments([]Attachment{photo, notes}), p.SetSticker(sticker), p.SetEmbeds([]Embed{embed}), p.SetFlags(4))
		}), true},
		{"numbers", aad(2, author), build(func(p *Payload) error {
			p.SetText("n")
			return errors.Join(
				p.SetAttachments([]Attachment{{BlobID: "9", Name: "n.bin", Size: maxSafeInteger, W: f(0.1), H: f(1e21), Key: fileKey2, Duration: f(1.5e-7)}}),
				p.SetFlags(-1.23456e-8))
		}), true},
		{"sticker only", aad(0, author), build(func(p *Payload) error { return p.SetSticker(sticker) }), true},
		{"text and an unknown member", aad(5, author), build(func(p *Payload) error {
			p.SetText("x")
			return p.SetRaw("zz_future", json.RawMessage(`{"nested": [1, "two", null, {"deep": true}]}`))
		}), false},
		{"only an unknown member", aad(0, author), build(raw("zz_future", "true")), false},
		{"empty object", aad(0, author), NewPayload(), false},
		{"text of the wrong type", aad(0, author), build(raw("t", "5")), false},
		{"null text", aad(0, author), build(raw("t", "null")), false},
		{"empty attachment list", aad(0, author), build(raw("att", "[]")), false},
		{"only an unusable embed", aad(0, author), build(raw("embeds", `[{"url":"javascript:alert(1)"}]`)), false},
		{"sticker without an id", aad(0, author), build(raw("sticker", `{"name":"x"}`)), false},
	}
	for _, c := range cases {
		key := must(ChannelKey(root, c.aad.ChannelID))
		var env Envelope
		var err error
		random := rec(func() { env, err = EncryptMessage(key, c.aad, c.payload) })
		must(env, err)
		mv := messageVector{Name: c.name, Random: random, Root: root, AAD: aadVector(c.aad),
			Plaintext: must(c.payload.MarshalJSON()), Envelope: env, Rebuild: c.rebuild}
		if p, err := DecryptMessage(key, env, c.aad); err != nil {
			mv.Error = true
			mv.Decrypted = json.RawMessage("null")
		} else {
			mv.Decrypted = sanitizedView(t, p)
		}
		v.Messages = append(v.Messages, mv)
	}

	for _, c := range []struct {
		name string
		size int64
	}{{"empty", 0}, {"one byte", 1}, {"small", 1000}, {"one full chunk", FileChunk}, {"across a chunk boundary", FileChunk + 1000}} {
		var key, ct []byte
		var err error
		random := rec(func() { key, ct, err = EncryptFile(pattern(c.size)) })
		must(ct, err)
		fv := fileVector{Name: c.name, Size: c.size, Random: random, Key: key, BaseIV: ct[4:12], CipherSHA256: sha256Hex(ct)}
		if c.size < FileChunk {
			fv.Cipher = ct
		}
		v.Files = append(v.Files, fv)
	}
	for _, size := range []int64{0, 1, FileChunk - 1, FileChunk, FileChunk + 1, 3*FileChunk + 5, 5 << 30} {
		v.EncryptedSizes = append(v.EncryptedSizes, sizeVector{Size: size, Encrypted: EncryptedSize(size)})
	}

	bot := newID()
	var token string
	rec(func() { token = must(NewBotToken()) })
	longToken := strings.TrimRight(b64url(s.take(48)), "=")
	v.BotTokens = []tokenVector{
		{token, true}, {longToken, true}, {strings.Repeat("A", 42), false}, {strings.Repeat("A", 43), true},
		{strings.Repeat("-_", 128), true}, {strings.Repeat("A", 257), false}, {token[:42] + "+", false},
		{token[:42] + "/", false}, {token + "=", false}, {" " + token, false}, {token + "\n", false},
		{strings.Repeat("é", 43), false}, {"", false},
	}
	for _, tok := range []string{token, longToken} {
		var wrapped []byte
		var err error
		random := rec(func() { wrapped, err = WrapBotIdentity(bot, tok) })
		v.BotWraps = append(v.BotWraps, wrapVector{Random: random, Token: tok, TokenHash: BotTokenHash(tok), Priv: bot.PrivateKey, Pub: bot.PublicKey, Wrapped: must(wrapped, err)})
	}
	var escrow []byte
	var err error
	random := rec(func() { escrow, err = SealBotEscrow(alice.PublicKey, bot) })
	v.BotEscrows = []escrowVector{{Random: random, OwnerPriv: alice.PrivateKey, OwnerPub: alice.PublicKey, BotPriv: bot.PrivateKey, BotPub: bot.PublicKey, Escrow: must(escrow, err)}}

	// what the browser's createBotIdentity and rewrapBotIdentity do, in their order
	created := newID()
	var c createdVector
	rec(func() {
		c.Token = must(NewBotToken())
		c.Wrapped = must(WrapBotIdentity(created, c.Token))
		c.Escrow = must(SealBotEscrow(alice.PublicKey, created))
		opened := must(OpenBotEscrow(alice.PrivateKey, alice.PublicKey, c.Escrow, created.PublicKey))
		c.NewToken = must(NewBotToken())
		c.Rewrapped = must(WrapBotIdentity(opened, c.NewToken))
	})
	c.OwnerPriv, c.OwnerPub = alice.PrivateKey, alice.PublicKey
	c.BotPriv, c.BotPub = created.PrivateKey, created.PublicKey
	c.TokenHash, c.NewTokenHash = BotTokenHash(c.Token), BotTokenHash(c.NewToken)
	v.BotCreated = c
	return v
}

func b64url(b []byte) string {
	return strings.NewReplacer("+", "-", "/", "_").Replace(b64(b))
}
