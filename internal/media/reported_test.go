package media

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"io"
	"testing"
)

func reportFixture(t *testing.T, plain, key []byte) []byte {
	t.Helper()
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	var out bytes.Buffer
	out.WriteString("ECF1")
	out.Write(make([]byte, 8))
	for i := int64(0); i < max(int64(1), (int64(len(plain))+reportChunk-1)/reportChunk); i++ {
		var nonce [12]byte
		binary.BigEndian.PutUint32(nonce[8:], uint32(i))
		chunk := plain[min(int64(len(plain)), i*reportChunk):min(int64(len(plain)), (i+1)*reportChunk)]
		ct := gcm.Seal(nil, nonce[:], chunk, []byte("file/v1"))
		_ = binary.Write(&out, binary.BigEndian, uint32(len(ct)))
		out.Write(ct)
	}
	return out.Bytes()
}
func TestReportedAttachmentChunksAndRanges(t *testing.T) {
	key := bytes.Repeat([]byte{0x35}, 32)
	plain := bytes.Repeat([]byte("private file bytes"), 300000)
	encrypted := reportFixture(t, plain, key)
	reader, err := newReportedReader(bytes.NewReader(encrypted), int64(len(encrypted)), int64(len(plain)), key)
	if err != nil {
		t.Fatal(err)
	}
	all, err := io.ReadAll(reader)
	if err != nil || !bytes.Equal(all, plain) {
		t.Fatal("full file changed", err)
	}
	start := reportChunk - 9
	_, _ = reader.Seek(start, io.SeekStart)
	part := make([]byte, 40)
	_, err = io.ReadFull(reader, part)
	if err != nil || !bytes.Equal(part, plain[start:start+40]) {
		t.Fatal("cross-chunk range changed", err)
	}
	_, _ = reader.Seek(-10, io.SeekEnd)
	tail, _ := io.ReadAll(reader)
	if !bytes.Equal(tail, plain[len(plain)-10:]) {
		t.Fatal("end range changed")
	}
	for _, sample := range [][]byte{encrypted[:len(encrypted)-1], append(append([]byte{}, encrypted...), 0)} {
		if _, err := newReportedReader(bytes.NewReader(sample), int64(len(sample)), int64(len(plain)), key); err == nil {
			t.Fatal("accepted truncated or extended file")
		}
	}
	if _, err := newReportedReader(bytes.NewReader(encrypted), int64(len(encrypted)), int64(len(plain)), bytes.Repeat([]byte{1}, 32)); err == nil {
		t.Fatal("accepted wrong file key")
	}
	encrypted[len(encrypted)-1] ^= 1
	reader, _ = newReportedReader(bytes.NewReader(encrypted), int64(len(encrypted)), int64(len(plain)), key)
	if _, err := io.ReadAll(reader); err == nil {
		t.Fatal("accepted corrupt final chunk")
	}
}
func TestReportedAttachmentEmpty(t *testing.T) {
	key := make([]byte, 32)
	encrypted := reportFixture(t, nil, key)
	reader, err := newReportedReader(bytes.NewReader(encrypted), int64(len(encrypted)), 0, key)
	if err != nil {
		t.Fatal(err)
	}
	all, err := io.ReadAll(reader)
	if err != nil || len(all) != 0 {
		t.Fatal("empty file")
	}
}

func TestReportedAttachmentDocumentTypesAreNeverActive(t *testing.T) {
	for _, mime := range []string{"text/html", "image/svg+xml", "image/SVG+XML", "application/xhtml+xml", "text/xml", "image/png\r\nx-unsafe:yes"} {
		if reportedType(mime) != "application/octet-stream" {
			t.Fatal("active document type", mime)
		}
	}
	for _, mime := range []string{"image/png", "video/mp4", "audio/ogg"} {
		if reportedType(mime) != mime {
			t.Fatal("safe media type", mime)
		}
	}
}
