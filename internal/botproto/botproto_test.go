package botproto

import (
	"bytes"
	"compress/zlib"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"evilion.xyz/chat/internal/ids"
)

func TestOutKeepsTheMoment(t *testing.T) {
	id := ids.New()
	out := Out(id)
	// what a bot library computes: (id >> 22) + Discord's epoch
	got := time.UnixMilli(out>>22 + DiscordEpoch)
	if d := got.Sub(id.Time()); d != 0 {
		t.Fatalf("library reads %v, Nexa wrote %v", got, id.Time())
	}
	if In(out) != int64(id) {
		t.Fatalf("In(Out(id)) = %d, want %d", In(out), id)
	}
}

func TestInReadsBothForms(t *testing.T) {
	id := ids.New()
	if In(int64(id)) != int64(id) {
		t.Fatal("a Nexa id pasted as it is should read as itself")
	}
	if In(Out(id)) != int64(id) {
		t.Fatal("a bot's id should read back")
	}
	// a bot paging from a moment before Nexa existed: before everything
	before := (time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli() - DiscordEpoch) << 22
	if In(before) >= 0 {
		t.Fatalf("a 2020 snowflake read as %d, want negative", In(before))
	}
	if In(0) != 0 {
		t.Fatal("zero stays zero")
	}
}

func TestSnowJSON(t *testing.T) {
	id := ids.New()
	b, err := json.Marshal(struct {
		ID  Snow  `json:"id"`
		Opt *Snow `json:"opt"`
	}{S(id), nil})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"id":"` + OutString(id) + `","opt":null}`
	if string(b) != want {
		t.Fatalf("got %s, want %s", b, want)
	}
	var back struct {
		ID Snow `json:"id"`
	}
	if err := json.Unmarshal(b, &back); err != nil || back.ID.ID() != id {
		t.Fatalf("read back %v, %v", back.ID, err)
	}
	if err := json.Unmarshal([]byte(`{"id":`+OutString(id)+`}`), &back); err != nil || back.ID.ID() != id {
		t.Fatalf("bare number: %v, %v", back.ID, err)
	}
}

func TestTextRewrite(t *testing.T) {
	u, r, c, e := ids.New(), ids.New(), ids.New(), ids.New()
	in := "hi <@" + u.String() + "> <@!" + u.String() + "> <@&" + r.String() + "> <#" + c.String() + "> <:wave:" + e.String() + "> <a:dance:" + e.String() + "> </ban user:" + c.String() + "> <t:1700000000:R>"
	out := OutText(in)
	want := "hi <@" + OutString(u) + "> <@!" + OutString(u) + "> <@&" + OutString(r) + "> <#" + OutString(c) + "> <:wave:" + OutString(e) + "> <a:dance:" + OutString(e) + "> </ban user:" + OutString(c) + "> <t:1700000000:R>"
	if out != want {
		t.Fatalf("out:\n got %s\nwant %s", out, want)
	}
	if back := InText(out); back != in {
		t.Fatalf("in:\n got %s\nwant %s", back, in)
	}
	// a Nexa id a bot pasted stays as it is
	if InText("<@"+u.String()+">") != "<@"+u.String()+">" {
		t.Fatal("pasted Nexa id changed")
	}
}

func TestETFRoundTrip(t *testing.T) {
	id := ids.New()
	type inner struct {
		Name  string  `json:"name"`
		Skip  string  `json:"skip,omitempty"`
		Count int     `json:"count"`
		Ratio float64 `json:"ratio"`
	}
	type outer struct {
		inner
		ID     Snow     `json:"id"`
		Parent *Snow    `json:"parent_id"`
		Tags   []string `json:"tags"`
		Empty  []int    `json:"empty"`
		On     bool     `json:"on"`
		Hidden string   `json:"-"`
		Extra  any      `json:"extra"`
	}
	v := outer{inner: inner{Name: "héllo", Count: 70000, Ratio: 1.5}, ID: S(id), Tags: []string{"a", "b"}, Empty: []int{}, On: true, Hidden: "x",
		Extra: map[string]any{"n": json.Number("12"), "nested": []any{nil, false}}}
	b, err := EncodeETF(v)
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecodeETF(b)
	if err != nil {
		t.Fatal(err)
	}
	m := got.(map[string]any)
	if m["name"] != "héllo" || m["count"] != json.Number("70000") || m["ratio"] != json.Number("1.5") || m["on"] != true {
		t.Fatalf("decoded %#v", m)
	}
	if m["id"] != json.Number(OutString(id)) {
		t.Fatalf("snowflake: %#v", m["id"])
	}
	if m["parent_id"] != nil {
		t.Fatalf("nil pointer: %#v", m["parent_id"])
	}
	if _, ok := m["skip"]; ok {
		t.Fatal("omitempty field written")
	}
	if _, ok := m["Hidden"]; ok {
		t.Fatal("json:\"-\" field written")
	}
	if l, ok := m["empty"].([]any); !ok || len(l) != 0 {
		t.Fatalf("empty list: %#v", m["empty"])
	}
	extra := m["extra"].(map[string]any)
	if extra["n"] != json.Number("12") {
		t.Fatalf("extra: %#v", extra)
	}
}

func TestZlibStream(t *testing.T) {
	c := &Codec{Compress: CompressZlibStream}
	var stream bytes.Buffer
	for i := 0; i < 3; i++ {
		s := uint64(i + 1)
		name := "MESSAGE_CREATE"
		b, binary, err := c.Encode(&Payload{Op: OpDispatch, S: &s, T: &name, D: map[string]any{"i": i}})
		if err != nil || !binary {
			t.Fatal(err, binary)
		}
		if !bytes.HasSuffix(b, []byte{0, 0, 0xff, 0xff}) {
			t.Fatalf("frame %d does not end in a sync flush", i)
		}
		stream.Write(b)
	}
	r, err := zlib.NewReader(&stream)
	if err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(io.LimitReader(r, 1<<20))
	for i := 0; i < 3; i++ {
		var p struct {
			S int            `json:"s"`
			D map[string]int `json:"d"`
		}
		if err := dec.Decode(&p); err != nil {
			t.Fatal(err)
		}
		if p.S != i+1 || p.D["i"] != i {
			t.Fatalf("frame %d: %+v", i, p)
		}
	}
}

func TestPrivileged(t *testing.T) {
	if Privileged(IntentGuilds|IntentGuildMessages, 0) != 0 {
		t.Fatal("ordinary intents need nothing")
	}
	if Privileged(IntentMessageContent|IntentGuildMembers, AppFlagGatewayGuildMembersLimited) != IntentMessageContent {
		t.Fatal("message content should be missing")
	}
}

// A zstd stream is one frame for the connection: its header once, then each
// payload as raw blocks, none of them the last.
func TestZstdStream(t *testing.T) {
	c := &Codec{Compress: CompressZstdStream}
	a, bin, err := c.Encode(&Payload{Op: 10, D: map[string]int{"heartbeat_interval": 41250}})
	if err != nil || !bin {
		t.Fatal(err, bin)
	}
	if !bytes.HasPrefix(a, []byte{0x28, 0xB5, 0x2F, 0xFD, 0x00, 0x38}) {
		t.Fatalf("header: % x", a[:6])
	}
	body := a[6:]
	h := uint32(body[0]) | uint32(body[1])<<8 | uint32(body[2])<<16
	if h&1 != 0 || (h>>1)&3 != 0 || int(h>>3) != len(body)-3 || string(body[3:]) != `{"op":10,"d":{"heartbeat_interval":41250},"s":null,"t":null}` {
		t.Fatalf("block: %d % x %q", h>>3, body[:3], body[3:])
	}
	big := strings.Repeat("x", 300000)
	b, _, _ := c.Encode(&Payload{Op: 0, D: big})
	if bytes.HasPrefix(b, []byte{0x28, 0xB5}) {
		t.Fatal("the header came twice")
	}
	n, blocks := 0, 0
	for len(b) > 0 {
		h := uint32(b[0]) | uint32(b[1])<<8 | uint32(b[2])<<16
		size := int(h >> 3)
		if size > 1<<17 || h&1 != 0 {
			t.Fatalf("block %d: size %d last %v", blocks, size, h&1 != 0)
		}
		n += size
		b = b[3+size:]
		blocks++
	}
	if blocks != 3 || n < 300000 {
		t.Fatalf("%d blocks holding %d bytes", blocks, n)
	}
}
