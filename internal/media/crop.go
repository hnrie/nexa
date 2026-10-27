package media

import (
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"io"
	"math"
	"sort"

	"golang.org/x/image/draw"
	"golang.org/x/image/webp"
)

// Cropping on the server. A picture someone frames in the app (an avatar, a
// banner, an icon, a server tag's badge, a widget's picture) is sent whole,
// with the part they framed, and cut here: whatever the app did, what is kept
// is that part and no larger than the place it goes. A still picture already
// in the shape asked for and no larger than asked is kept byte for byte.
// Otherwise a moving picture stays moving. Every frame of a GIF, an APNG or
// an animated WebP is put together on its canvas the way a browser would draw
// it, cut the same way and scaled, and the frames are kept as a GIF with
// their timing and how often they loop; a still picture is kept as a PNG.

// CropSpec says what to cut and how large the result may be.
type CropSpec struct {
	// The part of the picture to keep, in its own pixels. Empty keeps the
	// largest part in the middle with the shape MaxW:MaxH.
	Rect image.Rectangle
	// The most the result may measure; it keeps the shape of Rect.
	MaxW, MaxH int
}

const (
	// how many frames, and how many pixels across all of them, a moving
	// picture may bring: a badge or a widget loops a few seconds at most
	maxCropFrames = 600
	maxCropPixels = 150 << 20
)

// ErrTooManyFrames refuses an animation too long to cut.
var ErrTooManyFrames = errors.New("animation too long")

// sink takes each frame as it is put together on its canvas, with how long
// it shows in hundredths of a second, and keeps what it needs of it: frames
// are never all held at full size at once.
type sink func(canvas *image.NRGBA, delay int) error

// Crop cuts data as spec says. It returns the new picture and its type. A
// still picture already in the shape asked for and no larger than asked is
// kept byte for byte: no needless re-encode. A moving picture is always cut
// frame by frame, so too-long animations are still refused.
func Crop(data []byte, spec CropSpec) ([]byte, string, error) {
	mime, animated, ok := Sniff(data)
	if !ok || (mime != "image/png" && mime != "image/jpeg" && mime != "image/gif" && mime != "image/webp") {
		return nil, "", ErrUnsupported
	}
	if spec.MaxW <= 0 || spec.MaxH <= 0 {
		return nil, "", ErrBadDimensions
	}
	if !animated {
		if w, h, err := ImageDims(bytes.NewReader(data)); err == nil {
			bounds := image.Rect(0, 0, w, h)
			rect := cropRect(bounds, spec)
			if outW, outH := fitWithin(rect.Dx(), rect.Dy(), spec.MaxW, spec.MaxH); rect.Min == bounds.Min && rect.Max == bounds.Max && outW == w && outH == h {
				return data, mime, nil
			}
		}
	}
	var out []*image.NRGBA
	var delays []int
	var rect image.Rectangle
	var w, h int
	keep := func(canvas *image.NRGBA, delay int) error {
		if out == nil {
			rect = cropRect(canvas.Bounds(), spec)
			if rect.Empty() {
				return ErrBadDimensions
			}
			w, h = fitWithin(rect.Dx(), rect.Dy(), spec.MaxW, spec.MaxH)
		}
		dst := image.NewNRGBA(image.Rect(0, 0, w, h))
		if rect.Dx() == w && rect.Dy() == h {
			draw.Draw(dst, dst.Bounds(), canvas, rect.Min, draw.Src)
		} else {
			draw.CatmullRom.Scale(dst, dst.Bounds(), canvas, rect, draw.Src, nil)
		}
		out = append(out, dst)
		delays = append(delays, delay)
		return nil
	}
	loops := 0
	var err error
	if animated {
		switch mime {
		case "image/gif":
			loops, err = gifFrames(data, keep)
		case "image/png":
			loops, err = apngFrames(data, keep)
		case "image/webp":
			loops, err = webpFrames(data, keep)
		}
		if err != nil {
			return nil, "", err
		}
	}
	if len(out) == 0 {
		img, err := decodeStill(data, mime)
		if err != nil {
			return nil, "", err
		}
		if err := keep(img, 0); err != nil {
			return nil, "", err
		}
	}
	var buf bytes.Buffer
	if len(out) == 1 {
		if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&buf, out[0]); err != nil {
			return nil, "", err
		}
		return buf.Bytes(), "image/png", nil
	}
	if err := encodeGIF(&buf, out, delays, loops); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), "image/gif", nil
}

// cropRect is the part of bounds to keep: the one asked for, inside the
// picture, or the largest one in the middle with the result's shape.
func cropRect(bounds image.Rectangle, spec CropSpec) image.Rectangle {
	if !spec.Rect.Empty() {
		// the part asked for, inside the picture, trimmed evenly to the
		// result's shape: a frame a pixel off square still comes out square
		return fitShape(spec.Rect.Add(bounds.Min).Intersect(bounds), spec.MaxW, spec.MaxH)
	}
	return fitShape(bounds, spec.MaxW, spec.MaxH)
}

// fitShape is the largest part of r in the middle with the shape w:h.
func fitShape(r image.Rectangle, shapeW, shapeH int) image.Rectangle {
	if r.Empty() {
		return r
	}
	bw, bh := r.Dx(), r.Dy()
	// as wide as the shape allows, else as tall
	w, h := bw, int(math.Round(float64(bw)*float64(shapeH)/float64(shapeW)))
	if h > bh {
		h = bh
		w = int(math.Round(float64(bh) * float64(shapeW) / float64(shapeH)))
	}
	x := r.Min.X + (bw-w)/2
	y := r.Min.Y + (bh-h)/2
	return image.Rect(x, y, x+max(1, w), y+max(1, h))
}

// fitWithin scales w×h down, keeping its shape, until it fits in maxW×maxH.
// A smaller picture keeps its size: it is never blown up.
func fitWithin(w, h, maxW, maxH int) (int, int) {
	if w <= maxW && h <= maxH {
		return w, h
	}
	k := math.Min(float64(maxW)/float64(w), float64(maxH)/float64(h))
	return max(1, int(math.Round(float64(w)*k))), max(1, int(math.Round(float64(h)*k)))
}

func decodeStill(data []byte, mime string) (*image.NRGBA, error) {
	var img image.Image
	var err error
	if mime == "image/webp" {
		img, err = webp.Decode(bytes.NewReader(data))
		if err != nil {
			img, err = firstWebPFrame(data)
		}
	} else {
		img, _, err = image.Decode(bytes.NewReader(data))
	}
	if err != nil {
		return nil, ErrUnsupported
	}
	return toNRGBA(img), nil
}

func toNRGBA(img image.Image) *image.NRGBA {
	if n, ok := img.(*image.NRGBA); ok && n.Bounds().Min == (image.Point{}) {
		return n
	}
	b := img.Bounds()
	out := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(out, out.Bounds(), img, b.Min, draw.Src)
	return out
}

// budget refuses an animation whose frames would take too long to cut.
func budget(frames, w, h int) error {
	if frames > maxCropFrames || int64(frames)*int64(w)*int64(h) > maxCropPixels {
		return ErrTooManyFrames
	}
	return nil
}

// --- GIF -------------------------------------------------------------------

// gifFrames puts each frame of a GIF together on its canvas: drawn over what
// the frame before left, then cleared or put back as that frame says.
func gifFrames(data []byte, emit sink) (int, error) {
	if err := checkGIFWork(bytes.NewReader(data), maxCropFrames, maxCropPixels); err != nil {
		return 0, err
	}
	g, err := gif.DecodeAll(bytes.NewReader(data))
	if err != nil || len(g.Image) == 0 {
		return 0, ErrUnsupported
	}
	w, h := g.Config.Width, g.Config.Height
	if w <= 0 || h <= 0 {
		b := g.Image[0].Bounds()
		w, h = b.Max.X, b.Max.Y
	}
	if err := budget(len(g.Image), w, h); err != nil {
		return 0, err
	}
	canvas := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i, pal := range g.Image {
		var before *image.NRGBA
		disposal := byte(0)
		if i < len(g.Disposal) {
			disposal = g.Disposal[i]
		}
		if disposal == gif.DisposalPrevious {
			before = image.NewNRGBA(canvas.Bounds())
			copy(before.Pix, canvas.Pix)
		}
		draw.Draw(canvas, pal.Bounds(), pal, pal.Bounds().Min, draw.Over)
		delay := 10
		if i < len(g.Delay) {
			delay = g.Delay[i]
		}
		if err := emit(canvas, delay); err != nil {
			return 0, err
		}
		switch disposal {
		case gif.DisposalBackground:
			draw.Draw(canvas, pal.Bounds(), image.Transparent, image.Point{}, draw.Src)
		case gif.DisposalPrevious:
			copy(canvas.Pix, before.Pix)
		}
	}
	return g.LoopCount, nil
}

// --- APNG ------------------------------------------------------------------

// apngFrames puts each frame of an animated PNG together. A frame's data is
// handed to the png package as a PNG of its own, with the picture's header
// at the frame's size and its palette, then placed on the canvas and
// blended, disposed of or put back as its frame control says.
func apngFrames(data []byte, emit sink) (int, error) {
	const sig = "\x89PNG\r\n\x1a\n"
	if len(data) < 8 || string(data[:8]) != sig {
		return 0, ErrUnsupported
	}
	type control struct {
		w, h, x, y     int
		delay          int
		dispose, blend byte
		parts          [][]byte
		isDefault      bool
	}
	var ihdr []byte
	var shared [][]byte // PLTE, tRNS and the like, which every frame's PNG needs
	var frames []*control
	var cur *control
	plays := 0
	for p := 8; p+8 <= len(data); {
		n := int(binary.BigEndian.Uint32(data[p : p+4]))
		typ := string(data[p+4 : p+8])
		if n < 0 || p+12+n > len(data) {
			return 0, ErrUnsupported
		}
		body := data[p+8 : p+8+n]
		switch typ {
		case "IHDR":
			ihdr = body
		case "PLTE", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT":
			if len(frames) == 0 {
				shared = append(shared, data[p:p+12+n])
			}
		case "acTL":
			if n >= 8 {
				plays = int(binary.BigEndian.Uint32(body[4:8]))
			}
		case "fcTL":
			if n < 26 {
				return 0, ErrUnsupported
			}
			num, den := int(binary.BigEndian.Uint16(body[20:22])), int(binary.BigEndian.Uint16(body[22:24]))
			if den == 0 {
				den = 100
			}
			cur = &control{
				w: int(binary.BigEndian.Uint32(body[4:8])), h: int(binary.BigEndian.Uint32(body[8:12])),
				x: int(binary.BigEndian.Uint32(body[12:16])), y: int(binary.BigEndian.Uint32(body[16:20])),
				delay: int(math.Round(float64(num) * 100 / float64(den))), dispose: body[24], blend: body[25],
			}
			frames = append(frames, cur)
		case "IDAT":
			// the default image is the first frame when a frame control comes before it
			if cur != nil {
				cur.isDefault = true
				cur.parts = append(cur.parts, body)
			}
		case "fdAT":
			if cur != nil && n >= 4 {
				cur.parts = append(cur.parts, body[4:])
			}
		case "IEND":
			p = len(data)
			continue
		}
		p += 12 + n
	}
	if ihdr == nil || len(ihdr) < 13 || len(frames) == 0 {
		return 0, ErrUnsupported
	}
	w, h := int(binary.BigEndian.Uint32(ihdr[0:4])), int(binary.BigEndian.Uint32(ihdr[4:8]))
	if err := budget(len(frames), w, h); err != nil {
		return 0, err
	}
	canvas := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i, f := range frames {
		if len(f.parts) == 0 || f.w <= 0 || f.h <= 0 || f.x+f.w > w || f.y+f.h > h {
			return 0, ErrUnsupported
		}
		img, err := png.Decode(bytes.NewReader(pngOf(ihdr, f.w, f.h, shared, f.parts)))
		if err != nil {
			return 0, ErrUnsupported
		}
		area := image.Rect(f.x, f.y, f.x+f.w, f.y+f.h)
		var before *image.NRGBA
		// the first frame cannot be put back to anything before it, so it is cleared instead
		dispose := f.dispose
		if dispose == 2 && i == 0 {
			dispose = 1
		}
		if dispose == 2 {
			before = image.NewNRGBA(canvas.Bounds())
			copy(before.Pix, canvas.Pix)
		}
		op := draw.Over
		if f.blend == 0 {
			op = draw.Src
		}
		draw.Draw(canvas, area, img, img.Bounds().Min, op)
		if err := emit(canvas, f.delay); err != nil {
			return 0, err
		}
		switch dispose {
		case 1:
			draw.Draw(canvas, area, image.Transparent, image.Point{}, draw.Src)
		case 2:
			copy(canvas.Pix, before.Pix)
		}
	}
	return gifLoops(plays), nil
}

// gifLoops turns a count of plays (0 for forever, as APNG and WebP write it)
// into a GIF's LoopCount: 0 for forever, -1 for once, else the repeats.
func gifLoops(plays int) int {
	switch {
	case plays <= 0:
		return 0
	case plays == 1:
		return -1
	}
	return plays - 1
}

// pngOf is a PNG of one frame: the picture's header at the frame's size,
// the chunks every frame shares, and the frame's data.
func pngOf(ihdr []byte, w, h int, shared [][]byte, parts [][]byte) []byte {
	var b bytes.Buffer
	b.WriteString("\x89PNG\r\n\x1a\n")
	head := append([]byte(nil), ihdr...)
	binary.BigEndian.PutUint32(head[0:4], uint32(w))
	binary.BigEndian.PutUint32(head[4:8], uint32(h))
	writeChunk(&b, "IHDR", head)
	for _, c := range shared {
		b.Write(c)
	}
	for _, d := range parts {
		writeChunk(&b, "IDAT", d)
	}
	writeChunk(&b, "IEND", nil)
	return b.Bytes()
}

func writeChunk(w io.Writer, typ string, body []byte) {
	var n [4]byte
	binary.BigEndian.PutUint32(n[:], uint32(len(body)))
	_, _ = w.Write(n[:])
	crc := crc32.NewIEEE()
	_, _ = io.WriteString(crc, typ)
	_, _ = crc.Write(body)
	_, _ = io.WriteString(w, typ)
	_, _ = w.Write(body)
	binary.BigEndian.PutUint32(n[:], crc.Sum32())
	_, _ = w.Write(n[:])
}

// --- animated WebP -----------------------------------------------------------

// webpFrames puts each frame of an animated WebP together: each one handed to
// the webp package as a file of its own (frameFile, stills.go), placed where
// it says, blended or not, and cleared after it shows if it asks to be.
func webpFrames(data []byte, emit sink) (int, error) {
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return 0, ErrUnsupported
	}
	canvasW, canvasH, loops, count := 0, 0, 0, 0
	var canvas *image.NRGBA
	for p := 12; p+8 <= len(data); {
		id := string(data[p : p+4])
		n := int(binary.LittleEndian.Uint32(data[p+4 : p+8]))
		body := p + 8
		if n < 0 || n > len(data)-body {
			return 0, ErrUnsupported
		}
		chunk := data[body : body+n]
		switch id {
		case "VP8X":
			if n >= 10 {
				canvasW, canvasH = 1+uint24(chunk[4:]), 1+uint24(chunk[7:])
			}
		case "ANIM":
			if n >= 6 {
				loops = gifLoops(int(binary.LittleEndian.Uint16(chunk[4:6])))
			}
		case "ANMF":
			if n < 16 || canvasW <= 0 || canvasH <= 0 {
				return 0, ErrUnsupported
			}
			if canvas == nil {
				canvas = image.NewNRGBA(image.Rect(0, 0, canvasW, canvasH))
			}
			count++
			if err := budget(count, canvasW, canvasH); err != nil {
				return 0, err
			}
			x, y := 2*uint24(chunk[0:]), 2*uint24(chunk[3:])
			w, h := 1+uint24(chunk[6:]), 1+uint24(chunk[9:])
			duration := uint24(chunk[12:])
			flags := chunk[15]
			img, err := webp.Decode(bytes.NewReader(frameFile(chunk[16:], w, h)))
			if err != nil {
				return 0, ErrUnsupported
			}
			area := image.Rect(x, y, x+w, y+h).Intersect(canvas.Bounds())
			op := draw.Over
			if flags&0x02 != 0 {
				op = draw.Src
			}
			draw.Draw(canvas, area, img, img.Bounds().Min, op)
			if err := emit(canvas, max(1, (duration+5)/10)); err != nil {
				return 0, err
			}
			if flags&0x01 != 0 {
				draw.Draw(canvas, area, image.Transparent, image.Point{}, draw.Src)
			}
		}
		p = body + n + n&1
	}
	if count == 0 {
		return 0, ErrUnsupported
	}
	return loops, nil
}

// --- writing a GIF ------------------------------------------------------------

// encodeGIF writes frames as a GIF that loops as the original did. They
// share one palette made from their own colours (most used first, see
// buildPalette), with its first entry for transparency, and every frame
// replaces the one before it whole, so what was see-through stays so.
func encodeGIF(w io.Writer, frames []*image.NRGBA, delays []int, loops int) error {
	pal := buildPalette(frames)
	g := &gif.GIF{LoopCount: loops}
	cache := map[color.NRGBA]uint8{}
	for i, f := range frames {
		b := f.Bounds()
		p := image.NewPaletted(b, pal)
		for y := b.Min.Y; y < b.Max.Y; y++ {
			for x := b.Min.X; x < b.Max.X; x++ {
				c := f.NRGBAAt(x, y)
				if c.A < 128 {
					p.SetColorIndex(x, y, 0)
					continue
				}
				c.A = 0xff
				idx, ok := cache[c]
				if !ok {
					idx = uint8(nearest(pal, c))
					cache[c] = idx
				}
				p.SetColorIndex(x, y, idx)
			}
		}
		g.Image = append(g.Image, p)
		g.Delay = append(g.Delay, max(2, delays[i]))
		g.Disposal = append(g.Disposal, gif.DisposalBackground)
	}
	return gif.EncodeAll(w, g)
}

// buildPalette picks up to 255 colours for frames: the most used ones, after
// rounding each to 5 bits a channel, each the average of the colours it
// stands for. Entry 0 is transparent.
func buildPalette(frames []*image.NRGBA) color.Palette {
	type bin struct {
		n       int
		r, g, b int
	}
	bins := map[uint16]*bin{}
	for _, f := range frames {
		for i := 0; i+3 < len(f.Pix); i += 4 {
			if f.Pix[i+3] < 128 {
				continue
			}
			r, g, b := int(f.Pix[i]), int(f.Pix[i+1]), int(f.Pix[i+2])
			key := uint16(r>>3)<<10 | uint16(g>>3)<<5 | uint16(b>>3)
			e := bins[key]
			if e == nil {
				e = &bin{}
				bins[key] = e
			}
			e.n++
			e.r += r
			e.g += g
			e.b += b
		}
	}
	list := make([]*bin, 0, len(bins))
	for _, e := range bins {
		list = append(list, e)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].n > list[j].n })
	pal := color.Palette{color.NRGBA{}}
	for _, e := range list {
		if len(pal) == 256 {
			break
		}
		pal = append(pal, color.NRGBA{uint8(e.r / e.n), uint8(e.g / e.n), uint8(e.b / e.n), 0xff})
	}
	// a palette of one transparent entry cannot hold a picture that is all transparent's opposite
	if len(pal) == 1 {
		pal = append(pal, color.NRGBA{0, 0, 0, 0xff})
	}
	return pal
}

// nearest is the opaque palette entry closest to c.
func nearest(pal color.Palette, c color.NRGBA) int {
	best, bestD := 1, math.MaxInt
	for i := 1; i < len(pal); i++ {
		p := pal[i].(color.NRGBA)
		dr, dg, db := int(p.R)-int(c.R), int(p.G)-int(c.G), int(p.B)-int(c.B)
		// green counts for more and blue for less, as eyes weigh them
		d := 3*dr*dr + 4*dg*dg + 2*db*db
		if d < bestD {
			best, bestD = i, d
		}
	}
	return best
}
