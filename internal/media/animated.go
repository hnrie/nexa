package media

import (
	"bufio"
	"context"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"os"
	"path/filepath"

	"golang.org/x/image/draw"

	"evilion.xyz/chat/internal/store"
)

// A moving GIF asked for at a size is shrunk frame by frame and keeps moving.
// It used to be served as its first frame once it was wider or taller than
// maxAnimatedSide, which froze every animated banner: banners are wide, and
// the apps always ask for them at a size.

// maxAnimatedWork bounds the pixels decoded across all of a GIF's frames
// (width × height × frames) before shrinking is not worth it; past it the GIF
// is served as uploaded, still moving. About 300 frames of 1280×720.
const maxAnimatedWork = 280_000_000

var errTooMuchAnimation = errors.New("animation too large to shrink")

// animatedVariant returns the copy of an animated GIF at size, every frame
// shrunk, making it if it does not exist yet.
func (m *Store) animatedVariant(ctx context.Context, b *store.Blob, size int) (string, error) {
	sha := shaOf(b)
	dst := m.variantPath(sha, size, "gif")
	if fileExists(dst) {
		return dst, nil
	}
	select {
	case variantWork <- struct{}{}:
		defer func() { <-variantWork }()
	case <-ctx.Done():
		return "", ctx.Err()
	}
	if fileExists(dst) {
		return dst, nil
	}
	src, err := os.Open(m.Path(sha))
	if err != nil {
		return "", err
	}
	g, err := gif.DecodeAll(bufio.NewReader(src))
	src.Close()
	if err != nil {
		return "", err
	}
	small, err := shrinkGIF(g, size)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".variant-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	err = gif.EncodeAll(tmp, small)
	// served as immutable once it exists, so never a truncated one
	if err == nil {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return "", err
	}
	if err := os.Rename(tmp.Name(), dst); err != nil {
		return "", err
	}
	return dst, nil
}

// shrinkGIF scales every frame of g to fit within size×size. A GIF's frames
// are often only the part of the picture that changed, laid over what came
// before according to each frame's disposal, so each one is first composed on
// a canvas the way a browser shows it, and the whole picture is scaled. The
// copy's frames are whole pictures, each drawn in its own frame's colours
// (no dithering, which would shimmer from one frame to the next), with the
// delays and the loop count kept.
func shrinkGIF(g *gif.GIF, size int) (*gif.GIF, error) {
	if len(g.Image) == 0 {
		return nil, errors.New("no frames")
	}
	cw, ch := g.Config.Width, g.Config.Height
	if cw == 0 || ch == 0 {
		b := g.Image[0].Bounds()
		cw, ch = b.Max.X, b.Max.Y
	}
	if cw <= 0 || ch <= 0 {
		return nil, errors.New("empty canvas")
	}
	if cw*ch*len(g.Image) > maxAnimatedWork {
		return nil, errTooMuchAnimation
	}
	w, h := cw, ch
	if w > size || h > size {
		if w >= h {
			h, w = max(1, h*size/w), size
		} else {
			w, h = max(1, w*size/h), size
		}
	}
	canvas := image.NewNRGBA(image.Rect(0, 0, cw, ch))
	scaled := image.NewNRGBA(image.Rect(0, 0, w, h))
	out := &gif.GIF{LoopCount: g.LoopCount, Config: image.Config{Width: w, Height: h}}
	for i, frame := range g.Image {
		var disposal byte
		if i < len(g.Disposal) {
			disposal = g.Disposal[i]
		}
		// "restore to previous" puts back what was under this frame once it has been shown
		var saved *image.NRGBA
		if disposal == gif.DisposalPrevious {
			saved = image.NewNRGBA(canvas.Bounds())
			copy(saved.Pix, canvas.Pix)
		}
		draw.Draw(canvas, frame.Bounds(), frame, frame.Bounds().Min, draw.Over)

		draw.CatmullRom.Scale(scaled, scaled.Bounds(), canvas, canvas.Bounds(), draw.Src, nil)
		out.Image = append(out.Image, toPaletted(scaled, frame.Palette))
		delay := 0
		if i < len(g.Delay) {
			delay = g.Delay[i]
		}
		out.Delay = append(out.Delay, delay)
		// every frame of the copy is a whole picture, so nothing needs disposing
		out.Disposal = append(out.Disposal, gif.DisposalNone)

		switch disposal {
		case gif.DisposalBackground:
			// browsers clear the frame's area to transparent, not to the background colour
			draw.Draw(canvas, frame.Bounds(), image.Transparent, image.Point{}, draw.Src)
		case gif.DisposalPrevious:
			canvas = saved
		}
	}
	return out, nil
}

// toPaletted draws img in pal, nearest colour for each pixel. Pixels that are
// mostly see-through become the palette's transparent entry, which is added
// (or takes the last slot of a full palette) when the picture has any.
func toPaletted(img *image.NRGBA, pal color.Palette) *image.Paletted {
	b := img.Bounds()
	clear := -1
	hasClear := false
	for i := 3; i < len(img.Pix); i += 4 {
		if img.Pix[i] < 128 {
			hasClear = true
			break
		}
	}
	p := make(color.Palette, 0, 256)
	for _, c := range pal {
		if _, _, _, a := c.RGBA(); a == 0 {
			if clear < 0 {
				clear = len(p)
				p = append(p, color.RGBA{})
			}
			continue
		}
		p = append(p, c)
	}
	if len(p) == 0 {
		p = append(p, color.RGBA{A: 255})
	}
	if hasClear && clear < 0 {
		if len(p) < 256 {
			clear = len(p)
			p = append(p, color.RGBA{})
		} else {
			clear = 255
			p[255] = color.RGBA{}
		}
	}
	// nearest colour among the opaque entries only, so nothing visible turns see-through
	opaque := make(color.Palette, 0, len(p))
	index := make([]uint8, 0, len(p))
	for i, c := range p {
		if i != clear {
			opaque = append(opaque, c)
			index = append(index, uint8(i))
		}
	}
	out := image.NewPaletted(b, p)
	cache := map[uint32]uint8{}
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			o := y*img.Stride + x*4
			px := img.Pix[o : o+4 : o+4]
			if px[3] < 128 && clear >= 0 {
				out.Pix[y*out.Stride+x] = uint8(clear)
				continue
			}
			key := uint32(px[0])<<16 | uint32(px[1])<<8 | uint32(px[2])
			idx, ok := cache[key]
			if !ok {
				idx = index[opaque.Index(color.RGBA{px[0], px[1], px[2], 255})]
				cache[key] = idx
			}
			out.Pix[y*out.Stride+x] = idx
		}
	}
	return out
}
