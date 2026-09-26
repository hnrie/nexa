package media

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"image"
	"io"
	"os"

	"golang.org/x/image/draw"
	"golang.org/x/image/webp"
)

// stillable are the moving formats whose first frame can be drawn here.
// Lottie (.tgs) and video are drawn by the browser.
var stillable = map[string]bool{"image/gif": true, "image/png": true, "image/webp": true}

// maxStillSource bounds how much of an animated WebP is read to find its
// first frame. Stickers are a few megabytes at most.
const maxStillSource = 32 << 20

// decodeFirstFrame decodes the picture at path, or the first frame of an
// animation: the image package already stops after a GIF's first frame and
// reads an APNG's default image, but the webp package knows nothing of
// animation, so an animated WebP has its first frame taken out by hand.
func decodeFirstFrame(path, mime string) (image.Image, error) {
	src, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer src.Close()
	if mime != "image/webp" {
		img, _, err := image.Decode(bufio.NewReader(src))
		return img, err
	}
	data, err := io.ReadAll(io.LimitReader(src, maxStillSource))
	if err != nil {
		return nil, err
	}
	if img, err := webp.Decode(bytes.NewReader(data)); err == nil {
		return img, nil
	}
	return firstWebPFrame(data)
}

// firstWebPFrame decodes the first frame of an animated WebP. A frame (an
// ANMF chunk) holds the same chunks a still WebP does, so it is handed to the
// webp package as a file of its own, then placed on the animation's canvas
// where the frame says it goes.
func firstWebPFrame(data []byte) (image.Image, error) {
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return nil, ErrUnsupported
	}
	canvasW, canvasH := 0, 0
	for p := 12; p+8 <= len(data); {
		id := string(data[p : p+4])
		n := int(binary.LittleEndian.Uint32(data[p+4 : p+8]))
		body := p + 8
		if n < 0 || n > len(data)-body {
			return nil, ErrUnsupported
		}
		chunk := data[body : body+n]
		switch id {
		case "VP8X":
			if n >= 10 {
				canvasW, canvasH = 1+uint24(chunk[4:]), 1+uint24(chunk[7:])
			}
		case "ANMF":
			if n < 16 {
				return nil, ErrUnsupported
			}
			x, y := 2*uint24(chunk[0:]), 2*uint24(chunk[3:])
			w, h := 1+uint24(chunk[6:]), 1+uint24(chunk[9:])
			frame, err := webp.Decode(bytes.NewReader(frameFile(chunk[16:], w, h)))
			if err != nil {
				return nil, err
			}
			if canvasW <= 0 || canvasH <= 0 || (x == 0 && y == 0 && w == canvasW && h == canvasH) {
				return frame, nil
			}
			out := image.NewNRGBA(image.Rect(0, 0, canvasW, canvasH))
			draw.Draw(out, image.Rect(x, y, x+w, y+h), frame, frame.Bounds().Min, draw.Src)
			return out, nil
		}
		p = body + n + n&1
	}
	return nil, ErrUnsupported
}

// frameFile wraps a frame's chunks (an optional ALPH, then VP8 or VP8L) as a
// WebP file. Lossy data with its own alpha chunk needs the extended header
// that says there is alpha; lossless data carries its alpha inside.
func frameFile(chunks []byte, w, h int) []byte {
	var body bytes.Buffer
	body.WriteString("WEBP")
	if hasChunk(chunks, "ALPH") {
		head := make([]byte, 10)
		head[0] = 1 << 4
		putUint24(head[4:], w-1)
		putUint24(head[7:], h-1)
		body.WriteString("VP8X")
		_ = binary.Write(&body, binary.LittleEndian, uint32(len(head)))
		body.Write(head)
	}
	body.Write(chunks)
	out := make([]byte, 0, body.Len()+8)
	out = append(out, "RIFF"...)
	out = binary.LittleEndian.AppendUint32(out, uint32(body.Len()))
	return append(out, body.Bytes()...)
}

func hasChunk(chunks []byte, want string) bool {
	for p := 0; p+8 <= len(chunks); {
		n := int(binary.LittleEndian.Uint32(chunks[p+4 : p+8]))
		if string(chunks[p:p+4]) == want {
			return true
		}
		if n < 0 || n > len(chunks)-p-8 {
			return false
		}
		p += 8 + n + n&1
	}
	return false
}

func uint24(b []byte) int {
	return int(b[0]) | int(b[1])<<8 | int(b[2])<<16
}

func putUint24(b []byte, v int) {
	b[0], b[1], b[2] = byte(v), byte(v>>8), byte(v>>16)
}
