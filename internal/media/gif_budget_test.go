package media

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"testing"
)

// A structurally complete GIF whose compressed pixels are deliberately
// invalid: the work budget must be checked without attempting LZW decoding.
func oversizedGIF(frames, w, h int) []byte {
	out := append([]byte("GIF89a"), make([]byte, 7)...)
	binary.LittleEndian.PutUint16(out[6:8], uint16(w))
	binary.LittleEndian.PutUint16(out[8:10], uint16(h))
	out[10] = 0x80
	out = append(out, make([]byte, 6)...)
	for i := 0; i < frames; i++ {
		desc := make([]byte, 10)
		desc[0] = 0x2c
		binary.LittleEndian.PutUint16(desc[5:7], uint16(w))
		binary.LittleEndian.PutUint16(desc[7:9], uint16(h))
		out = append(out, desc...)
		out = append(out, 2, 1, 0xff, 0)
	}
	return append(out, 0x3b)
}

func TestGIFBudgetIsCheckedBeforeDecodingFrames(t *testing.T) {
	for _, data := range [][]byte{oversizedGIF(10, 4096, 4096), oversizedGIF(maxCropFrames+1, 1, 1)} {
		if len(data) > 10<<10 {
			t.Fatal("the reproducer must stay small")
		}
		_, err := gifFrames(data, func(*image.NRGBA, int) error {
			t.Fatal("oversized GIF reached the frame renderer")
			return nil
		})
		if !errors.Is(err, ErrTooManyFrames) {
			t.Fatalf("work budget did not stop decoding: %v", err)
		}
	}
}

func TestGIFWorkRejectsTruncatedAndOutOfBoundsDescriptors(t *testing.T) {
	data := oversizedGIF(1, 2, 2)
	for i := 0; i < len(data); i++ {
		if err := checkGIFWork(bytes.NewReader(data[:i]), 10, 100); err == nil {
			t.Fatalf("accepted truncated GIF at byte %d", i)
		}
	}
	// This check is structural; the decoder still validates the LZW payload.
	if err := checkGIFWork(bytes.NewReader(data), 10, 100); err != nil {
		t.Fatal(err)
	}
	data[20] = 2 // left edge outside the logical canvas
	if err := checkGIFWork(bytes.NewReader(data), 10, 100); err == nil {
		t.Fatal("accepted frame extending outside the canvas")
	}
}
