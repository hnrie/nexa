package botproto

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
)

// Encoding is how a connection's frames are written.
type Encoding int

const (
	EncJSON Encoding = iota
	EncETF
)

// Compression is how a connection's frames are compressed on the way out.
type Compression int

const (
	// CompressNone sends JSON as text frames and ETF as binary ones.
	CompressNone Compression = iota
	// CompressZlibStream runs one deflate stream for the whole connection,
	// each frame ending in a sync flush (00 00 ff ff), sent as binary.
	CompressZlibStream
	// CompressPayload compresses each frame on its own, which a bot asks for
	// with "compress": true in its identify.
	CompressPayload
	// CompressZstdStream runs one Zstandard stream for the whole connection,
	// each frame a whole number of blocks, sent as binary (zstdStream).
	CompressZstdStream
)

// ParseEncoding reads the encoding query parameter; ok is false for one Nexa
// does not speak.
func ParseEncoding(s string) (Encoding, bool) {
	switch s {
	case "", "json":
		return EncJSON, true
	case "etf":
		return EncETF, true
	}
	return EncJSON, false
}

// ParseCompression reads the compress query parameter.
func ParseCompression(s string) Compression {
	switch s {
	case "zlib-stream":
		return CompressZlibStream
	case "zstd-stream":
		return CompressZstdStream
	}
	return CompressNone
}

// Transport reports whether a connection compresses its whole stream, which
// payload compression ("compress": true in an identify) does not then add to.
func (c Compression) Transport() bool {
	return c == CompressZlibStream || c == CompressZstdStream
}

// Codec writes and reads one connection's frames.
type Codec struct {
	Enc      Encoding
	Compress Compression
	zbuf     bytes.Buffer
	zw       *zlib.Writer
	zstd     zstdStream
}

// Encode writes a payload, and says whether it goes as a binary frame.
func (c *Codec) Encode(p *Payload) ([]byte, bool, error) {
	var raw []byte
	var err error
	if c.Enc == EncETF {
		raw, err = EncodeETF(p)
	} else {
		raw, err = json.Marshal(p)
	}
	if err != nil {
		return nil, false, err
	}
	switch c.Compress {
	case CompressZlibStream:
		if c.zw == nil {
			c.zw = zlib.NewWriter(&c.zbuf)
		}
		c.zbuf.Reset()
		if _, err := c.zw.Write(raw); err != nil {
			return nil, false, err
		}
		if err := c.zw.Flush(); err != nil {
			return nil, false, err
		}
		return bytes.Clone(c.zbuf.Bytes()), true, nil
	case CompressZstdStream:
		return c.zstd.frame(raw), true, nil
	case CompressPayload:
		var out bytes.Buffer
		w := zlib.NewWriter(&out)
		if _, err := w.Write(raw); err != nil {
			return nil, false, err
		}
		if err := w.Close(); err != nil {
			return nil, false, err
		}
		return out.Bytes(), true, nil
	}
	return raw, c.Enc == EncETF, nil
}

// ErrTooLarge is a frame over what a bot may send.
var ErrTooLarge = errors.New("botproto: frame too large")

// MaxInbound is the most a bot may send in one frame.
const MaxInbound = 4096 * 4

// Decode reads a frame a bot sent. Bots never compress what they send.
func (c *Codec) Decode(data []byte) (*Inbound, error) {
	if len(data) > MaxInbound {
		return nil, ErrTooLarge
	}
	if c.Enc == EncETF {
		v, err := DecodeETF(data)
		if err != nil {
			return nil, err
		}
		m, ok := v.(map[string]any)
		if !ok {
			return nil, errors.New("botproto: frame is not a map")
		}
		raw, err := json.Marshal(m["d"])
		if err != nil {
			return nil, err
		}
		in := &Inbound{D: raw}
		if op, ok := m["op"].(json.Number); ok {
			n, err := op.Int64()
			if err != nil {
				return nil, err
			}
			in.Op = int(n)
		} else {
			return nil, errors.New("botproto: no opcode")
		}
		return in, nil
	}
	var in Inbound
	dec := json.NewDecoder(bytes.NewReader(data))
	if err := dec.Decode(&in); err != nil {
		return nil, err
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, errors.New("botproto: trailing data")
	}
	return &in, nil
}

// zstdStream writes one Zstandard frame that lasts the whole connection,
// each payload as the frame's next blocks (RFC 8878). The blocks are raw,
// stored as they are: what matters to a library is that its streaming
// decompressor hands back each payload whole as its blocks arrive, which
// raw blocks give at no cost to the server, rather than how small they are.
type zstdStream struct {
	started bool
}

const (
	zstdMagic = 0xFD2FB528
	// zstdWindowLog sets the window to 128 KiB, the largest block size, so
	// every block may be as large as a block can be
	zstdWindowLog = 17
	zstdMaxBlock  = 1 << 17
)

// frame is a payload as the stream's next bytes: the frame header first,
// then raw blocks, none of them the last.
func (z *zstdStream) frame(raw []byte) []byte {
	out := make([]byte, 0, len(raw)+6+3*(len(raw)/zstdMaxBlock+1))
	if !z.started {
		z.started = true
		out = binary.LittleEndian.AppendUint32(out, zstdMagic)
		// no content size, not a single segment, no checksum, no dictionary
		out = append(out, 0x00)
		// the window: exponent windowLog-10, no mantissa
		out = append(out, byte((zstdWindowLog-10)<<3))
	}
	for len(raw) > 0 || len(out) == 0 {
		n := len(raw)
		if n > zstdMaxBlock {
			n = zstdMaxBlock
		}
		// block header, little endian: last block 0, type raw (0), size
		h := uint32(n) << 3
		out = append(out, byte(h), byte(h>>8), byte(h>>16))
		out = append(out, raw[:n]...)
		raw = raw[n:]
		if n == 0 {
			break
		}
	}
	return out
}
