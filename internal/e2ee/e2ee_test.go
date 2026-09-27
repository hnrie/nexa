package e2ee

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"slices"
	"strings"
	"sync"
	"testing"
	"testing/iotest"
)

// noPanic runs fn and fails the test if it panics.
func noPanic(t *testing.T, what string, fn func() error) error {
	t.Helper()
	var err error
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("%s: panicked: %v", what, r)
			}
		}()
		err = fn()
	}()
	return err
}

// mustFail runs fn, which must fail with ErrDecrypt and must not panic.
func mustFail(t *testing.T, what string, fn func() error) {
	t.Helper()
	if err := noPanic(t, what, fn); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("%s: got %v, want ErrDecrypt", what, err)
	}
}

// eachTamper calls fn with every truncation of b, every single-bit flip, and
// b with a byte added.
func eachTamper(b []byte, fn func(what string, tampered []byte)) {
	for n := range len(b) {
		fn(fmt.Sprintf("cut to %d bytes", n), slices.Clone(b[:n]))
	}
	for i := range len(b) * 8 {
		c := slices.Clone(b)
		c[i/8] ^= 1 << (i % 8)
		fn(fmt.Sprintf("bit %d flipped", i), c)
	}
	fn("a byte added", append(slices.Clone(b), 0))
}

func newIdentity(t *testing.T) Identity {
	t.Helper()
	id, err := GenerateIdentity()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func unhex(s string) []byte {
	b, err := hex.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}

func TestX25519KnownAnswer(t *testing.T) {
	// RFC 7748, section 6.1
	alicePriv := unhex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a")
	bobPriv := unhex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb")
	alicePub := must(PublicKeyOf(alicePriv))
	bobPub := must(PublicKeyOf(bobPriv))
	if hex.EncodeToString(alicePub) != "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a" ||
		hex.EncodeToString(bobPub) != "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f" {
		t.Fatal("public keys differ from RFC 7748")
	}
	if got := must(x25519(alicePriv, bobPub)); hex.EncodeToString(got) != "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742" {
		t.Fatal("shared secret differs from RFC 7748")
	}
	if _, err := PublicKeyOf(alicePriv[:31]); err == nil {
		t.Fatal("a 31-byte private key was taken")
	}
}

func TestSealRoundTrip(t *testing.T) {
	bob := newIdentity(t)
	for _, n := range []int{0, 1, 32, 1000} {
		data := bytes.Repeat([]byte{byte(n)}, n)
		blob, err := Seal(bob.PublicKey, data)
		if err != nil {
			t.Fatal(err)
		}
		if len(blob) != KeyLen+ivLen+n+tagLen {
			t.Fatalf("%d bytes sealed into %d", n, len(blob))
		}
		got, err := Open(bob.PrivateKey, bob.PublicKey, blob)
		if err != nil || !bytes.Equal(got, data) {
			t.Fatalf("%d bytes: %v", n, err)
		}
	}
	a := must(Seal(bob.PublicKey, []byte("x")))
	b := must(Seal(bob.PublicKey, []byte("x")))
	if bytes.Equal(a[:KeyLen], b[:KeyLen]) || bytes.Equal(a[KeyLen:KeyLen+ivLen], b[KeyLen:KeyLen+ivLen]) {
		t.Fatal("two boxes share an ephemeral key or an iv")
	}
	root := bytes.Repeat([]byte{9}, 32)
	if got, err := UnwrapGrant(bob.PrivateKey, bob.PublicKey, must(WrapGrant(bob.PublicKey, root))); err != nil || !bytes.Equal(got, root) {
		t.Fatalf("grant: %v", err)
	}
}

func TestOpenRefusesTampering(t *testing.T) {
	bob, eve := newIdentity(t), newIdentity(t)
	blob := must(Seal(bob.PublicKey, []byte("a conversation root, say")))
	eachTamper(blob, func(what string, b []byte) {
		mustFail(t, what, func() error { _, err := Open(bob.PrivateKey, bob.PublicKey, b); return err })
	})
	mustFail(t, "wrong private key", func() error { _, err := Open(eve.PrivateKey, bob.PublicKey, blob); return err })
	mustFail(t, "wrong public key", func() error { _, err := Open(bob.PrivateKey, eve.PublicKey, blob); return err })
	mustFail(t, "short private key", func() error { _, err := Open(bob.PrivateKey[:31], bob.PublicKey, blob); return err })
	mustFail(t, "nothing at all", func() error { _, err := Open(nil, nil, nil); return err })
	for i, u := range lowOrderPoints() {
		// would open if the all-zero secret of a low-order key were accepted
		b := sealByHand(t, u, make([]byte, 32), bob.PublicKey, make([]byte, ivLen), []byte("low order"))
		mustFail(t, fmt.Sprintf("low-order ephemeral key %d", i), func() error { _, err := Open(bob.PrivateKey, bob.PublicKey, b); return err })
		if _, err := Seal(u, []byte("x")); err == nil || errors.Is(err, ErrDecrypt) {
			t.Errorf("sealing to low-order key %d: %v", i, err)
		}
	}
	if _, err := Seal(bob.PublicKey[:31], nil); err == nil {
		t.Error("sealed to a 31-byte key")
	}
}

func TestChannelKeys(t *testing.T) {
	root := bytes.Repeat([]byte{1}, 32)
	a := must(ChannelKey(root, "1"))
	if !bytes.Equal(a, must(ChannelKey(root, "1"))) || len(a) != KeyLen {
		t.Fatal("channel key is not a stable 32 bytes")
	}
	for _, other := range [][]byte{must(ChannelKey(root, "2")), must(VoiceFrameKey(root, "1")), must(ChannelKey(bytes.Repeat([]byte{2}, 32), "1"))} {
		if bytes.Equal(a, other) {
			t.Fatal("two different keys came out the same")
		}
	}
}

func TestKeyRing(t *testing.T) {
	var k KeyRing
	if k.Has("c") || len(k.Convs()) != 0 || len(k.Epochs("c")) != 0 {
		t.Fatal("an empty ring holds something")
	}
	if _, _, ok := k.Latest("c"); ok {
		t.Fatal("an empty ring has a latest epoch")
	}
	if _, err := k.ChannelKey("c", 0, "ch"); !errors.Is(err, ErrNoKey) {
		t.Fatalf("got %v, want ErrNoKey", err)
	}
	r0, r1, r5 := bytes.Repeat([]byte{1}, 32), bytes.Repeat([]byte{2}, 32), bytes.Repeat([]byte{3}, 32)
	k.Set("c", 1, r1)
	k.Set("c", 0, r0)
	k.Set("c", 5, r5)
	k.Set("d", 0, r0)
	if e, r, ok := k.Latest("c"); !ok || e != 5 || !bytes.Equal(r, r5) {
		t.Fatalf("latest is %d", e)
	}
	if !slices.Equal(k.Epochs("c"), []int{0, 1, 5}) || !slices.Equal(k.Convs(), []string{"c", "d"}) {
		t.Fatalf("epochs %v, convs %v", k.Epochs("c"), k.Convs())
	}
	r1[0] = 0xee // the ring keeps its own copy
	got, _ := k.Get("c", 1)
	got[1] = 0xee // and hands out copies
	if again, ok := k.Get("c", 1); !ok || !bytes.Equal(again, bytes.Repeat([]byte{2}, 32)) {
		t.Fatal("a stored root changed from outside the ring")
	}
	key, err := k.ChannelKey("c", 1, "ch")
	if err != nil || !bytes.Equal(key, must(ChannelKey(bytes.Repeat([]byte{2}, 32), "ch"))) {
		t.Fatalf("ring channel key: %v", err)
	}
	var wg sync.WaitGroup
	for i := range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range 100 {
				k.Set("e", j%5, r0)
				k.Get("e", i)
				k.Latest("e")
				_, _ = k.ChannelKey("e", 0, "ch")
			}
		}()
	}
	wg.Wait()
	k.Clear()
	if k.Has("c") || len(k.Convs()) != 0 {
		t.Fatal("Clear left keys behind")
	}
}

func testChannel(t *testing.T) ([]byte, AAD) {
	t.Helper()
	return must(ChannelKey(bytes.Repeat([]byte{7}, 32), "ch")), AAD{Conv: "c", Epoch: 2, ChannelID: "ch", AuthorID: "me"}
}

func TestMessageRoundTrip(t *testing.T) {
	key, aad := testChannel(t)
	p := NewPayload()
	p.SetText("a secret")
	env, err := EncryptMessage(key, aad, p)
	if err != nil {
		t.Fatal(err)
	}
	if env.V != 1 || env.Conv != "c" || env.Epoch != 2 {
		t.Fatalf("envelope %+v", env)
	}
	raw, _ := json.Marshal(env)
	var back Envelope
	if err := json.Unmarshal(raw, &back); err != nil || back != env {
		t.Fatalf("envelope JSON %s: %v", raw, err)
	}
	got, err := DecryptMessage(key, back, aad)
	if err != nil {
		t.Fatal(err)
	}
	if s, ok := got.Text(); !ok || s != "a secret" {
		t.Fatalf("text %q", s)
	}
	if _, err := EncryptMessage(key, aad, nil); err == nil {
		t.Fatal("encrypted a nil payload")
	}
	if _, err := EncryptMessage(key[:16], aad, p); err == nil {
		t.Fatal("encrypted under a 16-byte key")
	}
}

func TestDecryptMessageRefuses(t *testing.T) {
	key, aad := testChannel(t)
	p := NewPayload()
	p.SetText("a secret")
	env := must(EncryptMessage(key, aad, p))
	open := func(e Envelope, a AAD) func() error {
		return func() error { _, err := DecryptMessage(key, e, a); return err }
	}
	for name, other := range map[string]AAD{
		"another conversation": {Conv: "d", Epoch: 2, ChannelID: "ch", AuthorID: "me"},
		"another epoch":        {Conv: "c", Epoch: 3, ChannelID: "ch", AuthorID: "me"},
		"another channel":      {Conv: "c", Epoch: 2, ChannelID: "ci", AuthorID: "me"},
		"another author":       {Conv: "c", Epoch: 2, ChannelID: "ch", AuthorID: "you"},
		"no AAD":               {},
	} {
		mustFail(t, name, open(env, other))
	}
	mustFail(t, "wrong key", func() error { _, err := DecryptMessage(make([]byte, 32), env, aad); return err })
	mustFail(t, "short key", func() error { _, err := DecryptMessage(key[:16], env, aad); return err })
	mustFail(t, "no key", func() error { _, err := DecryptMessage(nil, env, aad); return err })

	ct := must(base64.StdEncoding.DecodeString(env.CT))
	eachTamper(ct, func(what string, b []byte) {
		e := env
		e.CT = b64(b)
		mustFail(t, "ciphertext "+what, open(e, aad))
	})
	iv := must(base64.StdEncoding.DecodeString(env.IV))
	eachTamper(iv, func(what string, b []byte) {
		e := env
		e.IV = b64(b)
		mustFail(t, "iv "+what, open(e, aad))
	})
	for name, change := range map[string]func(e *Envelope){
		"version 0":           func(e *Envelope) { e.V = 0 },
		"version 2":           func(e *Envelope) { e.V = 2 },
		"line break in iv":    func(e *Envelope) { e.IV = e.IV[:8] + "\n" + e.IV[8:] },
		"line break in ct":    func(e *Envelope) { e.CT = e.CT[:4] + "\r\n" + e.CT[4:] },
		"url-safe base64":     func(e *Envelope) { e.CT = strings.NewReplacer("+", "-", "/", "_").Replace(e.CT) + "-_" },
		"padding dropped":     func(e *Envelope) { e.CT = strings.TrimRight(e.CT, "=") + "A" },
		"empty iv":            func(e *Envelope) { e.IV = "" },
		"16-byte iv":          func(e *Envelope) { e.IV = b64(make([]byte, 16)) },
		"empty ciphertext":    func(e *Envelope) { e.CT = "" },
		"not base64 at all":   func(e *Envelope) { e.CT = "*" },
		"space in ciphertext": func(e *Envelope) { e.CT = " " + e.CT },
	} {
		e := env
		change(&e)
		mustFail(t, name, open(e, aad))
	}

	// plaintexts the web client does not take as a message
	for _, pt := range []string{
		`[1]`, `"s"`, `null`, `5`, ``, `{`, `{"t":"a"} {}`, `{"t":"a"}x`, `{"t":"a",}`, "\xef\xbb",
		`{"t":5}`, `{"t":null}`, `{"att":[]}`, `{"att":[{"blob_id":"1"}]}`, `{"sticker":{}}`, `{"sticker":{"id":1}}`,
		`{"embeds":[{"url":"javascript:alert(1)"}]}`, `{"embeds":"x"}`, `{"t":1,"flags":1,"zz":1}`,
	} {
		e := must(encryptRaw(key, aad, []byte(pt)))
		mustFail(t, fmt.Sprintf("plaintext %q", pt), open(e, aad))
	}
	// and ones it does
	for pt, text := range map[string]string{
		`{}`:                              "",
		`{"zz":1,"flags":"x"}`:            "",
		"\xef\xbb\xbf{\"t\":\"bom\"}":     "bom",
		" \n{ \"t\" : \"spaced\" }\r\n\t": "spaced",
		`{"t":"a","x":1,"t":"b"}`:         "b",
		`{"att":"x","t":""}`:              "",
		`{"sticker":{"id":"1"}}`:          "",
		`{"embeds":[{"url":"/x"}]}`:       "",
	} {
		e := must(encryptRaw(key, aad, []byte(pt)))
		got, err := DecryptMessage(key, e, aad)
		if err != nil {
			t.Errorf("plaintext %q: %v", pt, err)
			continue
		}
		if s, _ := got.Text(); s != text {
			t.Errorf("plaintext %q: text %q, want %q", pt, s, text)
		}
	}
}

func TestPayloadKeepsWhatItDoesNotKnow(t *testing.T) {
	in := `{"t":"hi","poll":{"question":"q?","answers":[{"text":"a"},{"text":"b"}]},"x":[1,2.50,"é",1e2],"t2":"<&>"}`
	p := must(ParsePayload([]byte(in)))
	if !slices.Equal(p.Keys(), []string{"t", "poll", "x", "t2"}) {
		t.Fatalf("keys %v", p.Keys())
	}
	if out := must(p.MarshalJSON()); string(out) != in {
		t.Fatalf("round trip changed the payload:\n%s", out)
	}
	p.SetText("edited <b>")
	want := strings.Replace(in, `"t":"hi"`, `"t":"edited <b>"`, 1)
	if out := must(p.MarshalJSON()); string(out) != want {
		t.Fatalf("got  %s\nwant %s", out, want)
	}
	p.Delete("x")
	p.Delete("missing")
	if err := p.SetRaw("y", json.RawMessage(`{ "a" : [ 1 , 2 ] }`)); err != nil {
		t.Fatal(err)
	}
	if err := p.SetRaw("z", json.RawMessage(`{"a":`)); err == nil {
		t.Fatal("SetRaw took broken JSON")
	}
	if raw, ok := p.Raw("y"); !ok || string(raw) != `{"a":[1,2]}` {
		t.Fatalf("raw y %s", raw)
	}
	if out := must(p.MarshalJSON()); string(out) != `{"t":"edited <b>","poll":{"question":"q?","answers":[{"text":"a"},{"text":"b"}]},"t2":"<&>","y":{"a":[1,2]}}` {
		t.Fatalf("got %s", out)
	}
	var q Payload // usable as a zero value, and through encoding/json
	if err := json.Unmarshal([]byte(`{"t":"z"}`), &q); err != nil {
		t.Fatal(err)
	}
	if s, _ := q.Text(); s != "z" {
		t.Fatal("UnmarshalJSON lost the text")
	}
	if err := json.Unmarshal([]byte(`[]`), &q); err == nil {
		t.Fatal("UnmarshalJSON took an array")
	}
}

func TestPayloadGetters(t *testing.T) {
	p := must(ParsePayload([]byte(`{
		"t": "x",
		"att": [
			{"blob_id":"1","name":"a","type":"t","size":1e3,"key":"k","w":-1.5,"h":0,"spoiler":false,"duration":1e400},
			{"blob_id":"2","name":"b","type":"t","size":9007199254740992,"key":"k"},
			{"blob_id":"3","name":"c","type":"t","size":-0,"key":"k","plain":true,"alt":"x"}
		],
		"sticker": {"id":"s","blob":5,"w":"1","animated":true},
		"embeds": [{"url":"https://a.example/","image":"javascript:x","image_w":10,"member_count":"5"}, {"url":"HTTP://B.example/"}],
		"flags": 1e400
	}`)))
	att := p.Attachments()
	if len(att) != 2 || att[0].Size != 1000 || *att[0].W != -1.5 || *att[0].H != 0 || *att[0].Spoiler || att[0].Duration != nil || att[1].BlobID != "3" || att[1].Size != 0 {
		t.Fatalf("attachments %+v", att)
	}
	if b := must(att[1].MarshalJSON()); string(b) != `{"blob_id":"3","name":"c","type":"t","size":0,"key":"k"}` {
		t.Fatalf("webhook fields survived: %s", b)
	}
	if s, ok := p.Sticker(); !ok || s.ID != "s" || s.Blob != nil || s.W != nil || !*s.Animated {
		t.Fatalf("sticker %+v", s)
	}
	emb := p.Embeds()
	if len(emb) != 2 || len(emb[0]) != 2 || emb[0]["image_w"] != 10.0 || emb[1]["url"] != "HTTP://B.example/" {
		t.Fatalf("embeds %v", emb)
	}
	if _, ok := p.Flags(); ok {
		t.Fatal("an infinite number was taken as flags")
	}
	if _, err := (Attachment{Size: 1 << 53}).MarshalJSON(); err == nil {
		t.Fatal("wrote a size JavaScript cannot hold")
	}
	if err := NewPayload().SetEmbeds([]Embed{{"url": "javascript:x"}}); err == nil {
		t.Fatal("wrote an embed the web client drops")
	}
	if _, err := (Embed{"url": "/x", "extra": "y"}).MarshalJSON(); err == nil {
		t.Fatal("wrote an embed member the web client does not know")
	}
	if _, err := (Embed{"url": "/x", "image_w": 1}).MarshalJSON(); err == nil {
		t.Fatal("wrote an int where the web client reads a number (float64 wanted)")
	}
	if err := NewPayload().SetFlags(math.NaN()); err == nil {
		t.Fatal("wrote NaN")
	}
	good := Attachment{Key: b64(make([]byte, 32))}
	if k, err := good.FileKey(); err != nil || len(k) != 32 {
		t.Fatalf("file key: %v", err)
	}
	mustFail(t, "short file key", func() error { _, err := (Attachment{Key: b64(make([]byte, 16))}).FileKey(); return err })
}

func TestWebLink(t *testing.T) {
	for v, want := range map[string]bool{
		"https://a.example/": true, "http://a": true, "HtTpS://a": true, "/local": true, "/": true,
		"//other.example": false, "javascript:alert(1)": false, "data:text/html,x": false, "ftp://a": false,
		"https://a b": false, "https://a\tb": false, "https://a\\b": false, "https://a\x7f": false, "https://a\x00": false,
		"https://a\u00a0b": false, "https://a\u2003b": false, "https://a\u2028b": false, "https://a\u3000b": false, "https://a\ufeffb": false,
		"https://a\u0085b": true, // not \s in JavaScript
		"https://a\u200bb": true, // zero-width space is not \s either
		"httpſ://a":        false, "": false, "https:/a": false,
	} {
		if WebLink(v) != want {
			t.Errorf("WebLink(%q) = %v", v, !want)
		}
	}
}

func TestJSONStringifyEncoding(t *testing.T) {
	for in, want := range map[string]string{
		"":                    `""`,
		"plain":               `"plain"`,
		"<a href=\"x\">&</a>": `"<a href=\"x\">&</a>"`,
		"\u2028\u2029":        "\"\u2028\u2029\"",
		"\x00\x01\x1f\x7f":    `"\u0000\u0001\u001f` + "\x7f\"",
		"\b\f\n\r\t\\/":       `"\b\f\n\r\t\\/"`,
		"é👋":                  "\"é👋\"",
		"a\xffb":              "\"a�b\"",
	} {
		if got := string(appendJSString(nil, in)); got != want {
			t.Errorf("appendJSString(%q) = %s, want %s", in, got, want)
		}
	}
	for in, want := range map[float64]string{
		0: "0", math.Copysign(0, -1): "0", 1: "1", -1: "-1", 100: "100", 0.1: "0.1", 1234.5678: "1234.5678",
		1e21: "1e+21", 1e20: "100000000000000000000", 123456789012345680000: "123456789012345680000",
		1e-6: "0.000001", 1e-7: "1e-7", 1.5e-7: "1.5e-7", -1.23456e-8: "-1.23456e-8", 1.23e-18: "1.23e-18",
		9007199254740992: "9007199254740992", 5e-324: "5e-324", math.MaxFloat64: "1.7976931348623157e+308",
		2.5e22: "2.5e+22", 0.000123: "0.000123",
	} {
		if got, err := appendJSNumber(nil, in); err != nil || string(got) != want {
			t.Errorf("appendJSNumber(%v) = %s (%v), want %s", in, got, err, want)
		}
	}
	for _, bad := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if _, err := appendJSNumber(nil, bad); err == nil {
			t.Errorf("appendJSNumber(%v) did not fail", bad)
		}
	}
}

func TestParseEnvelope(t *testing.T) {
	good := `{"v":1,"conv":"c","epoch":3,"iv":"aXY=","ct":"Y3Q="}`
	if e, err := ParseEnvelope([]byte(good)); err != nil || e != (Envelope{V: 1, Conv: "c", Epoch: 3, IV: "aXY=", CT: "Y3Q="}) {
		t.Fatalf("%+v %v", e, err)
	}
	if e, err := ParseEnvelope([]byte(`{"v":1.0,"conv":"c","epoch":3e0,"iv":"","ct":"","extra":1}`)); err != nil || e.Epoch != 3 {
		t.Fatalf("integral numbers written otherwise: %+v %v", e, err)
	}
	for _, bad := range []string{
		`{"v":2,"conv":"c","epoch":3,"iv":"","ct":""}`, `{"v":"1","conv":"c","epoch":3,"iv":"","ct":""}`,
		`{"v":1,"conv":"c","epoch":1.5,"iv":"","ct":""}`, `{"v":1,"conv":"c","epoch":"3","iv":"","ct":""}`,
		`{"v":1,"conv":"c","iv":"","ct":""}`, `{"v":1,"conv":5,"epoch":3,"iv":"","ct":""}`,
		`{"v":1,"conv":"c","epoch":3,"ct":""}`, `{"V":1,"Conv":"c","Epoch":3,"IV":"","CT":""}`,
		`{"v":1,"conv":"c","epoch":1e300,"iv":"","ct":""}`, `[]`, `null`, ``, `{`,
	} {
		if err := noPanic(t, bad, func() error { _, err := ParseEnvelope([]byte(bad)); return err }); err == nil {
			t.Errorf("ParseEnvelope took %s", bad)
		}
		var e Envelope
		if json.Unmarshal([]byte(bad), &e) == nil {
			t.Errorf("json.Unmarshal took %s", bad)
		}
	}
}

func TestFileRoundTrip(t *testing.T) {
	for _, n := range []int64{0, 1, 1000, FileChunk - 1, FileChunk, FileChunk + 1, 2*FileChunk + 5} {
		plain := pattern(n)
		key, ct, err := EncryptFile(plain)
		if err != nil {
			t.Fatal(err)
		}
		if int64(len(ct)) != EncryptedSize(n) || ChunkCount(n) != max(1, (n+FileChunk-1)/FileChunk) {
			t.Fatalf("%d bytes: %d encrypted, %d chunks", n, len(ct), ChunkCount(n))
		}
		if got, err := DecryptFile(key, ct, n); err != nil || !bytes.Equal(got, plain) {
			t.Fatalf("%d bytes: %v", n, err)
		}
		var out bytes.Buffer
		if err := DecryptFileStream(&out, iotest.HalfReader(bytes.NewReader(ct)), key, n); err != nil || !bytes.Equal(out.Bytes(), plain) {
			t.Fatalf("%d bytes, streamed: %v", n, err)
		}
		// a reader that hands out a little at a time gives the same ciphertext
		var src io.Reader = iotest.HalfReader(bytes.NewReader(plain))
		if n <= 1000 {
			src = iotest.OneByteReader(bytes.NewReader(plain))
		}
		var again bytes.Buffer
		var size int64
		replay(t, "stream", ct[4:12], func() { size, err = EncryptFileStream(&again, src, key) })
		if err != nil || size != n || !bytes.Equal(again.Bytes(), ct) {
			t.Fatalf("%d bytes: streaming encryption differs (%v)", n, err)
		}
	}
}

type failingWriter struct{ after int }

var errBoom = errors.New("boom")

func (w *failingWriter) Write(p []byte) (int, error) {
	if w.after <= 0 {
		return 0, errBoom
	}
	w.after--
	return len(p), nil
}

func TestDecryptFileRefuses(t *testing.T) {
	plain := pattern(100)
	key, ct := must2(EncryptFile(plain))
	eachTamper(ct, func(what string, b []byte) {
		mustFail(t, what, func() error { _, err := DecryptFile(key, b, 100); return err })
		mustFail(t, "streamed, "+what, func() error { return DecryptFileStream(io.Discard, bytes.NewReader(b), key, 100) })
	})
	for _, size := range []int64{99, 101, 0, -1, maxFileSize + 1, math.MaxInt64} {
		mustFail(t, fmt.Sprintf("size %d", size), func() error { _, err := DecryptFile(key, ct, size); return err })
		mustFail(t, fmt.Sprintf("streamed, size %d", size), func() error { return DecryptFileStream(io.Discard, bytes.NewReader(ct), key, size) })
	}
	mustFail(t, "wrong key", func() error { _, err := DecryptFile(make([]byte, 32), ct, 100); return err })
	mustFail(t, "short key", func() error { _, err := DecryptFile(key[:16], ct, 100); return err })
	mustFail(t, "nothing at all", func() error { _, err := DecryptFile(nil, nil, 0); return err })

	// errors of the source and the destination are not the file's fault
	if err := DecryptFileStream(io.Discard, iotest.ErrReader(errBoom), key, 100); !errors.Is(err, errBoom) {
		t.Fatalf("reader error came back as %v", err)
	}
	if err := DecryptFileStream(io.Discard, io.MultiReader(bytes.NewReader(ct[:20]), iotest.ErrReader(errBoom)), key, 100); !errors.Is(err, errBoom) {
		t.Fatalf("reader error mid-file came back as %v", err)
	}
	if err := DecryptFileStream(io.Discard, io.MultiReader(bytes.NewReader(ct), iotest.ErrReader(errBoom)), key, 100); !errors.Is(err, errBoom) {
		t.Fatalf("reader error after the file came back as %v", err)
	}
	if err := DecryptFileStream(&failingWriter{}, bytes.NewReader(ct), key, 100); !errors.Is(err, errBoom) {
		t.Fatalf("writer error came back as %v", err)
	}
	if _, err := EncryptFileStream(io.Discard, iotest.ErrReader(errBoom), key); !errors.Is(err, errBoom) {
		t.Fatalf("encrypt: reader error came back as %v", err)
	}
	for after := range 2 {
		if _, err := EncryptFileStream(&failingWriter{after: after}, bytes.NewReader(plain), key); !errors.Is(err, errBoom) {
			t.Fatalf("encrypt: writer error came back as %v", err)
		}
	}
	if _, err := EncryptFileStream(io.Discard, bytes.NewReader(plain), key[:16]); err == nil {
		t.Fatal("encrypted under a 16-byte key")
	}
}

func TestDecryptFileRefusesTamperingAcrossChunks(t *testing.T) {
	size := int64(2*FileChunk + 5)
	plain := pattern(size)
	key, ct := must2(EncryptFile(plain))
	const frame = fileLenPrefix + FileChunk + tagLen
	open := func(b []byte, n int64) func() error {
		return func() error { _, err := DecryptFile(key, b, n); return err }
	}
	for _, at := range []int{0, 5, 12, 20, 12 + frame - 1, 12 + frame, 12 + frame + 100, 12 + 2*frame, len(ct) - 1} {
		b := slices.Clone(ct)
		b[at] ^= 0x10
		mustFail(t, fmt.Sprintf("byte %d changed", at), open(b, size))
	}
	swapped := slices.Concat(ct[:12], ct[12+frame:12+2*frame], ct[12:12+frame], ct[12+2*frame:])
	mustFail(t, "first two chunks swapped", open(swapped, size))
	cut := ct[:12+2*frame]
	mustFail(t, "last chunk dropped", open(cut, size))
	mustFail(t, "last chunk dropped, streamed", func() error { return DecryptFileStream(io.Discard, bytes.NewReader(cut), key, size) })
	mustFail(t, "a byte added, streamed", func() error {
		return DecryptFileStream(io.Discard, bytes.NewReader(append(slices.Clone(ct), 0)), key, size)
	})
	// ECF1 has no end-of-file marker: cut at a chunk boundary, a file still
	// opens under the shorter size. Only the size in the (authenticated)
	// message tells the two apart, which is why decrypting needs it.
	if got, err := DecryptFile(key, cut, 2*FileChunk); err != nil || !bytes.Equal(got, plain[:2*FileChunk]) {
		t.Fatalf("a file cut at a chunk boundary: %v", err)
	}
}

func must2[A, B any](a A, b B, err error) (A, B) {
	if err != nil {
		panic(err)
	}
	return a, b
}

func TestBotIdentity(t *testing.T) {
	bot, other := newIdentity(t), newIdentity(t)
	token := must(NewBotToken())
	if len(token) != 43 || !ValidBotToken(token) {
		t.Fatalf("token %q", token)
	}
	if raw, err := base64.RawURLEncoding.Strict().DecodeString(token); err != nil || len(raw) != BotTokenBytes {
		t.Fatalf("token does not decode to 32 bytes: %v", err)
	}
	if must(NewBotToken()) == token {
		t.Fatal("two tokens are the same")
	}
	if h := sha256.Sum256([]byte(token)); !bytes.Equal(BotTokenHash(token), h[:]) {
		t.Fatal("token hash is not SHA-256 of the token")
	}

	wrapped := must(WrapBotIdentity(bot, token))
	if len(wrapped) != 61 || wrapped[0] != 1 {
		t.Fatalf("wrapped is %d bytes, version %d", len(wrapped), wrapped[0])
	}
	got, err := UnwrapBotIdentity(wrapped, token, bot.PublicKey)
	if err != nil || !bytes.Equal(got.PrivateKey, bot.PrivateKey) || !bytes.Equal(got.PublicKey, bot.PublicKey) {
		t.Fatalf("unwrap: %v", err)
	}
	unwrap := func(w []byte, tok string, pub []byte) func() error {
		return func() error { _, err := UnwrapBotIdentity(w, tok, pub); return err }
	}
	mustFail(t, "another token", unwrap(wrapped, must(NewBotToken()), bot.PublicKey))
	mustFail(t, "not a token", unwrap(wrapped, "short", bot.PublicKey))
	mustFail(t, "the token with a character changed", unwrap(wrapped, token[:42]+string(token[42]^1), bot.PublicKey))
	mustFail(t, "another public key", unwrap(wrapped, token, other.PublicKey))
	mustFail(t, "short public key", unwrap(wrapped, token, bot.PublicKey[:31]))
	mustFail(t, "nothing at all", unwrap(nil, "", nil))
	eachTamper(wrapped, func(what string, w []byte) { mustFail(t, what, unwrap(w, token, bot.PublicKey)) })

	// a private key sealed under another public key's AAD decrypts, but is not that key's
	key := must(botTokenKey(token))
	iv := make([]byte, ivLen)
	crossed := concat([]byte{1}, iv, must(gcmSeal(key, iv, other.PrivateKey, bot.PublicKey)))
	mustFail(t, "someone else's private key", unwrap(crossed, token, bot.PublicKey))

	if _, err := WrapBotIdentity(Identity{PublicKey: bot.PublicKey, PrivateKey: other.PrivateKey}, token); err == nil {
		t.Fatal("wrapped a mismatched key pair")
	}
	if _, err := WrapBotIdentity(bot, "not a token"); err == nil {
		t.Fatal("wrapped under something that is not a token")
	}
}

func TestBotEscrow(t *testing.T) {
	owner, stranger, bot, other := newIdentity(t), newIdentity(t), newIdentity(t), newIdentity(t)
	escrow := must(SealBotEscrow(owner.PublicKey, bot))
	got, err := OpenBotEscrow(owner.PrivateKey, owner.PublicKey, escrow, bot.PublicKey)
	if err != nil || !bytes.Equal(got.PrivateKey, bot.PrivateKey) {
		t.Fatalf("open: %v", err)
	}
	open := func(e []byte, as Identity, botPub []byte) func() error {
		return func() error { _, err := OpenBotEscrow(as.PrivateKey, as.PublicKey, e, botPub); return err }
	}
	mustFail(t, "someone else opens it", open(escrow, stranger, bot.PublicKey))
	mustFail(t, "for another bot", open(escrow, owner, other.PublicKey))
	eachTamper(escrow, func(what string, e []byte) { mustFail(t, what, open(e, owner, bot.PublicKey)) })

	// a conversation grant is a sealed box to the owner too, and must not pass for an escrow
	grant := must(WrapGrant(owner.PublicKey, bytes.Repeat([]byte{1}, 32)))
	mustFail(t, "a grant", open(grant, owner, bot.PublicKey))
	crossed := must(Seal(owner.PublicKey, concat([]byte(botEscrowLabel), bot.PublicKey, other.PrivateKey)))
	mustFail(t, "a mismatched pair", open(crossed, owner, bot.PublicKey))
	relabelled := must(Seal(owner.PublicKey, concat([]byte("nexa/bot-escrow/v2"), bot.PublicKey, bot.PrivateKey)))
	mustFail(t, "another label", open(relabelled, owner, bot.PublicKey))

	if _, err := SealBotEscrow(owner.PublicKey, Identity{PublicKey: bot.PublicKey, PrivateKey: other.PrivateKey}); err == nil {
		t.Fatal("sealed a mismatched key pair")
	}
}

func TestGarbageNeverPanics(t *testing.T) {
	inputs := [][]byte{nil, {}, {0}, bytes.Repeat([]byte{0xff}, 200), []byte("ECF1"), []byte(`{"v":1}`)}
	for _, in := range inputs {
		for name, fn := range map[string]func() error{
			"Open":        func() error { _, err := Open(in, in, in); return err },
			"UnwrapGrant": func() error { _, err := UnwrapGrant(in, in, in); return err },
			"DecryptMessage": func() error {
				_, err := DecryptMessage(in, Envelope{V: 1, IV: b64(in), CT: b64(in)}, AAD{})
				return err
			},
			"DecryptFile":       func() error { _, err := DecryptFile(in, in, int64(len(in))); return err },
			"UnwrapBotIdentity": func() error { _, err := UnwrapBotIdentity(in, string(in), in); return err },
			"OpenBotEscrow":     func() error { _, err := OpenBotEscrow(in, in, in, in); return err },
		} {
			mustFail(t, fmt.Sprintf("%s(%x)", name, in), fn)
		}
		_ = noPanic(t, fmt.Sprintf("ParsePayload(%x)", in), func() error { _, err := ParsePayload(in); return err })
		for name, fn := range map[string]func() error{
			"ParseEnvelope": func() error { _, err := ParseEnvelope(in); return err },
			"PublicKeyOf":   func() error { _, err := PublicKeyOf(in); return err },
			"Seal":          func() error { _, err := Seal(in, in); return err },
		} {
			if err := noPanic(t, fmt.Sprintf("%s(%x)", name, in), fn); err == nil {
				t.Errorf("%s(%x) did not fail", name, in)
			}
		}
	}
}

func FuzzParsePayload(f *testing.F) {
	for _, seed := range []string{`{}`, `{"t":"a","att":[{"blob_id":"1","name":"n","type":"","size":1,"key":"k"}]}`,
		`{"embeds":[{"url":"/x","image_w":1}],"sticker":{"id":"s"},"flags":2}`, "\xef\xbb\xbf{\"t\":1}", `[`, `{"t":"a","t":"b"}`} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, in []byte) {
		p, err := ParsePayload(in)
		if err != nil {
			return
		}
		p.Text()
		p.Attachments()
		p.Sticker()
		p.Embeds()
		p.Flags()
		_ = p.checkContent()
		out, err := p.MarshalJSON()
		if err != nil || !json.Valid(out) {
			t.Fatalf("%q marshals to invalid JSON %q (%v)", in, out, err)
		}
		again := must(ParsePayload(out))
		if out2 := must(again.MarshalJSON()); !bytes.Equal(out, out2) {
			t.Fatalf("not stable: %q then %q", out, out2)
		}
	})
}
