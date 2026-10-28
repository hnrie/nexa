package media

import (
	"bytes"
	"encoding/binary"
	"image"
)

// jpegOrientation reads only the first Exif directory, just as the metadata scrubber does.
func jpegOrientation(data []byte) int {
	if len(data) < 2 || data[0] != 0xff || data[1] != 0xd8 {
		return 1
	}
	for p := 2; p+4 <= len(data); {
		if data[p] != 0xff {
			break
		}
		p++
		for p < len(data) && data[p] == 0xff {
			p++
		}
		if p >= len(data) {
			break
		}
		marker := data[p]
		p++
		if marker == 0xda || marker == 0xd9 {
			break
		}
		if marker == 0x01 || marker >= 0xd0 && marker <= 0xd7 {
			continue
		}
		if p+2 > len(data) {
			break
		}
		n := int(binary.BigEndian.Uint16(data[p:]))
		if n < 2 || n > len(data)-p {
			break
		}
		body := data[p+2 : p+n]
		if marker == 0xe1 && bytes.HasPrefix(body, []byte("Exif\x00\x00")) {
			o, _ := exifOrientation(body[6:])
			return o
		}
		p += n
	}
	return 1
}

// orientImage applies all eight Exif transforms before crop coordinates or resizing.
func orientImage(src image.Image, orientation int) image.Image {
	if orientation < 2 || orientation > 8 {
		return src
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	ow, oh := w, h
	if orientation >= 5 {
		ow, oh = h, w
	}
	dst := image.NewNRGBA(image.Rect(0, 0, ow, oh))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dx, dy := x, y
			switch orientation {
			case 2:
				dx = w - 1 - x
			case 3:
				dx, dy = w-1-x, h-1-y
			case 4:
				dy = h - 1 - y
			case 5:
				dx, dy = y, x
			case 6:
				dx, dy = h-1-y, x
			case 7:
				dx, dy = h-1-y, w-1-x
			case 8:
				dx, dy = y, w-1-x
			}
			dst.Set(dx, dy, src.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}
