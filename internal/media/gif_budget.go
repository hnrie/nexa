package media

import (
	"encoding/binary"
	"io"
)

// checkGIFWork walks the compressed blocks before gif.DecodeAll allocates
// every frame. A limit checked on the decoded GIF is too late to stop a small
// compressed upload from exhausting memory. Canvas work also bounds the
// compositing that follows; a frame-count cap bounds per-frame overhead.
func checkGIFWork(r io.Reader, maxFrames int, maxPixels int64) error {
	var head [13]byte
	if _, err := io.ReadFull(r, head[:]); err != nil {
		return ErrUnsupported
	}
	if string(head[:6]) != "GIF87a" && string(head[:6]) != "GIF89a" {
		return ErrUnsupported
	}
	w, h := int64(binary.LittleEndian.Uint16(head[6:8])), int64(binary.LittleEndian.Uint16(head[8:10]))
	if w == 0 || h == 0 {
		return ErrUnsupported
	}
	skip := func(n int64) error { _, err := io.CopyN(io.Discard, r, n); return err }
	palette := func(packed byte) error {
		if packed&0x80 != 0 {
			return skip(3 * (1 << ((packed & 7) + 1)))
		}
		return nil
	}
	if err := palette(head[10]); err != nil {
		return ErrUnsupported
	}
	var one [1]byte
	blocks := func() error {
		for {
			if _, err := io.ReadFull(r, one[:]); err != nil {
				return err
			}
			if one[0] == 0 {
				return nil
			}
			if err := skip(int64(one[0])); err != nil {
				return err
			}
		}
	}
	frames := 0
	for {
		if _, err := io.ReadFull(r, one[:]); err != nil {
			return ErrUnsupported
		}
		switch one[0] {
		case 0x3b: // trailer
			if frames == 0 {
				return ErrUnsupported
			}
			return nil
		case 0x21: // extension label followed by data sub-blocks
			if _, err := io.ReadFull(r, one[:]); err != nil {
				return ErrUnsupported
			}
			if err := blocks(); err != nil {
				return ErrUnsupported
			}
		case 0x2c: // image descriptor, local palette, LZW code size, data
			var image [9]byte
			if _, err := io.ReadFull(r, image[:]); err != nil {
				return ErrUnsupported
			}
			fw, fh := int64(binary.LittleEndian.Uint16(image[4:6])), int64(binary.LittleEndian.Uint16(image[6:8]))
			if fw == 0 || fh == 0 || int64(binary.LittleEndian.Uint16(image[:2]))+fw > w || int64(binary.LittleEndian.Uint16(image[2:4]))+fh > h {
				return ErrUnsupported
			}
			frames++
			if frames > maxFrames || int64(frames)*w*h > maxPixels {
				return ErrTooManyFrames
			}
			if err := palette(image[8]); err != nil {
				return ErrUnsupported
			}
			if _, err := io.ReadFull(r, one[:]); err != nil {
				return ErrUnsupported
			}
			if err := blocks(); err != nil {
				return ErrUnsupported
			}
		default:
			return ErrUnsupported
		}
	}
}
