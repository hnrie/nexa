package e2ee

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
)

// An encrypted file (web/src/crypto/fileChunks.ts) is
//
//	"ECF1" (4) | base iv (8) | repeated [ciphertext length (u32be)][ciphertext]
//
// Chunk i holds plaintext bytes [i*FileChunk, (i+1)*FileChunk), sealed with
// AES-256-GCM under the file key with iv = base iv | u32be(i) and additional
// data "file/v1". Every chunk but the last is full, and an empty file still
// has one (empty) chunk.

// FileChunk is how much plaintext one chunk of an encrypted file holds.
const FileChunk = 4 << 20

const (
	fileBaseIVLen = ivLen - 4
	fileHeaderLen = 4 + fileBaseIVLen
	fileLenPrefix = 4
	fileMaxChunks = 1 << 32 // the chunk index is a u32 in the iv
	maxFileSize   = fileMaxChunks * FileChunk
)

var (
	fileMagic = []byte("ECF1")
	fileAAD   = []byte("file/v1")
)

// ChunkCount is how many chunks a file of plainSize bytes is cut into.
func ChunkCount(plainSize int64) int64 {
	n := plainSize / FileChunk
	if plainSize%FileChunk != 0 {
		n++
	}
	return max(1, n)
}

// EncryptedSize is the exact size of the encrypted file for plainSize bytes.
func EncryptedSize(plainSize int64) int64 {
	return fileHeaderLen + ChunkCount(plainSize)*(fileLenPrefix+tagLen) + plainSize
}

// NewFileKey is a fresh random file key.
func NewFileKey() ([]byte, error) { return randomBytes(KeyLen) }

// EncryptFile encrypts a whole file under a fresh key with a fresh base iv,
// as encryptFile in file.ts does, and returns the key and the ciphertext.
func EncryptFile(plaintext []byte) (key, ciphertext []byte, err error) {
	key, err = NewFileKey()
	if err != nil {
		return nil, nil, err
	}
	var buf bytes.Buffer
	buf.Grow(int(EncryptedSize(int64(len(plaintext)))))
	if _, err := EncryptFileStream(&buf, bytes.NewReader(plaintext), key); err != nil {
		return nil, nil, err
	}
	return key, buf.Bytes(), nil
}

// EncryptFileStream encrypts everything src holds into dst under key, with a
// fresh base iv, holding one chunk at a time. It returns the plaintext size,
// which the message's attachment records.
func EncryptFileStream(dst io.Writer, src io.Reader, key []byte) (int64, error) {
	g, err := newGCM(key)
	if err != nil {
		return 0, err
	}
	baseIV, err := randomBytes(fileBaseIVLen)
	if err != nil {
		return 0, err
	}
	if _, err := dst.Write(concat(fileMagic, baseIV)); err != nil {
		return 0, err
	}
	iv := make([]byte, ivLen)
	copy(iv, baseIV)
	buf := make([]byte, fileLenPrefix+FileChunk+tagLen)
	chunk := buf[fileLenPrefix : fileLenPrefix+FileChunk]
	var total int64
	for i := int64(0); ; i++ {
		n, err := io.ReadFull(src, chunk)
		if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
			return total, err
		}
		if n == 0 && i > 0 {
			return total, nil // the size was a whole number of chunks
		}
		if i >= fileMaxChunks {
			return total, errors.New("e2ee: the file is too large to encrypt")
		}
		binary.BigEndian.PutUint32(iv[fileBaseIVLen:], uint32(i))
		ct := g.Seal(chunk[:0], iv, chunk[:n], fileAAD)
		binary.BigEndian.PutUint32(buf[:fileLenPrefix], uint32(len(ct)))
		if _, err := dst.Write(buf[:fileLenPrefix+len(ct)]); err != nil {
			return total, err
		}
		total += int64(n)
		if n < FileChunk {
			return total, nil
		}
	}
}

// DecryptFile decrypts a whole encrypted file whose plaintext is size bytes
// long, the size its message records. See DecryptFileStream.
func DecryptFile(key, ciphertext []byte, size int64) ([]byte, error) {
	if size < 0 || size > maxFileSize || int64(len(ciphertext)) != EncryptedSize(size) {
		return nil, decryptError("file: the file is not the size its message gives")
	}
	var out bytes.Buffer
	out.Grow(int(size))
	if err := DecryptFileStream(&out, bytes.NewReader(ciphertext), key, size); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// DecryptFileStream decrypts from src into dst an encrypted file whose
// plaintext is size bytes long, the size its message records, one chunk at a
// time. Like the web client's streaming download (streamDecrypt.ts) it wants
// every chunk to be the size that follows from the file's and src to end
// right after the last one, which catches a file cut short at a chunk
// boundary; decryptFile in file.ts would take one. Faults in the file match
// ErrDecrypt, while errors from src or dst come back as they are. dst may
// already hold the chunks before a failing one.
func DecryptFileStream(dst io.Writer, src io.Reader, key []byte, size int64) error {
	if size < 0 || size > maxFileSize {
		return decryptError("file: the size is not valid")
	}
	g, err := newGCM(key)
	if err != nil {
		return decryptError("file: the key is not usable")
	}
	header := make([]byte, fileHeaderLen)
	if _, err := io.ReadFull(src, header); err != nil {
		return cutShort(err, "file: truncated header")
	}
	if !bytes.Equal(header[:len(fileMagic)], fileMagic) {
		return decryptError("file: bad magic")
	}
	iv := make([]byte, ivLen)
	copy(iv, header[len(fileMagic):])
	buf := make([]byte, min(size, FileChunk)+tagLen)
	var prefix [fileLenPrefix]byte
	count := ChunkCount(size)
	for i := int64(0); i < count; i++ {
		plainLen := min(FileChunk, size-i*FileChunk)
		if _, err := io.ReadFull(src, prefix[:]); err != nil {
			return cutShort(err, "file: truncated chunk header")
		}
		if int64(binary.BigEndian.Uint32(prefix[:])) != plainLen+tagLen {
			return decryptError("file: a chunk is the wrong size")
		}
		ct := buf[:plainLen+tagLen]
		if _, err := io.ReadFull(src, ct); err != nil {
			return cutShort(err, "file: truncated chunk")
		}
		binary.BigEndian.PutUint32(iv[fileBaseIVLen:], uint32(i))
		plain, err := g.Open(ct[:0], iv, ct, fileAAD)
		if err != nil {
			return decryptError("file: chunk failed to authenticate")
		}
		if _, err := dst.Write(plain); err != nil {
			return err
		}
	}
	var extra [1]byte
	switch n, err := io.ReadFull(src, extra[:]); {
	case n > 0:
		return decryptError("file: the file is longer than it should be")
	case err != io.EOF:
		return err
	}
	return nil
}

// cutShort reports a source that ended early as a fault in the file, and any
// other read error as it is.
func cutShort(err error, msg string) error {
	if err == io.EOF || err == io.ErrUnexpectedEOF {
		return decryptError(msg)
	}
	return err
}
