package media

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func readCropFile(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "crop", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// Every moving format comes out a GIF with all its frames, their timing and
// its looping, cut to the shape asked for and no bigger than asked.
func TestCropKeepsAnimationsMoving(t *testing.T) {
	for _, name := range []string{"anim.gif", "anim.png", "anim.webp"} {
		t.Run(name, func(t *testing.T) {
			out, mime, err := Crop(readCropFile(t, name), CropSpec{MaxW: 32, MaxH: 32})
			if err != nil || mime != "image/gif" {
				t.Fatalf("crop: %v %s", err, mime)
			}
			g, err := gif.DecodeAll(bytes.NewReader(out))
			if err != nil {
				t.Fatal(err)
			}
			if len(g.Image) != 6 {
				t.Errorf("frames: %d, want 6", len(g.Image))
			}
			if g.Config.Width != 32 || g.Config.Height != 32 {
				t.Errorf("size: %dx%d", g.Config.Width, g.Config.Height)
			}
			if g.LoopCount != 0 {
				t.Errorf("loops: %d, want forever", g.LoopCount)
			}
			for i, d := range g.Delay {
				if d < 9 || d > 11 {
					t.Errorf("frame %d delay %d, want a tenth of a second", i, d)
				}
			}
		})
	}
}

// The part asked for is the part kept: the right half of a picture whose
// left half is red and right half blue comes out blue.
func TestCropCutsThePartAskedFor(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 200, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 200; x++ {
			c := color.NRGBA{255, 0, 0, 255}
			if x >= 100 {
				c = color.NRGBA{0, 0, 255, 255}
			}
			src.SetNRGBA(x, y, c)
		}
	}
	var in bytes.Buffer
	if err := png.Encode(&in, src); err != nil {
		t.Fatal(err)
	}
	out, mime, err := Crop(in.Bytes(), CropSpec{Rect: image.Rect(100, 0, 200, 100), MaxW: 64, MaxH: 64})
	if err != nil || mime != "image/png" {
		t.Fatalf("crop: %v %s", err, mime)
	}
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 64 || b.Dy() != 64 {
		t.Errorf("size %v", b)
	}
	if r, _, b, _ := img.At(32, 32).RGBA(); r > 0x1000 || b < 0xf000 {
		t.Errorf("middle is %v, want blue", img.At(32, 32))
	}
}

// With no part chosen, the middle is kept in the shape of the result, and a
// picture already small enough keeps its size rather than being blown up.
func TestCropTakesTheMiddleAndNeverEnlarges(t *testing.T) {
	out, _, err := Crop(readCropFile(t, "still.png"), CropSpec{MaxW: 600, MaxH: 250})
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	// 300×200 in the shape 600:250 is 300×125, smaller than the most allowed
	if cfg.Width != 300 || cfg.Height != 125 {
		t.Errorf("size %dx%d, want 300x125", cfg.Width, cfg.Height)
	}
}

func TestCropRefusesWhatItCannot(t *testing.T) {
	if _, _, err := Crop([]byte("not a picture at all"), CropSpec{MaxW: 10, MaxH: 10}); !errors.Is(err, ErrUnsupported) {
		t.Errorf("text: %v", err)
	}
	// an animation too long to be a badge
	g := &gif.GIF{}
	for i := 0; i < maxCropFrames+1; i++ {
		g.Image = append(g.Image, image.NewPaletted(image.Rect(0, 0, 2, 2), color.Palette{color.Black, color.White}))
		g.Delay = append(g.Delay, 2)
	}
	var b bytes.Buffer
	if err := gif.EncodeAll(&b, g); err != nil {
		t.Fatal(err)
	}
	if _, _, err := Crop(b.Bytes(), CropSpec{MaxW: 10, MaxH: 10}); !errors.Is(err, ErrTooManyFrames) {
		t.Errorf("long animation: %v", err)
	}
}

// What is see-through stays see-through, frame after frame.
func TestCropKeepsTransparency(t *testing.T) {
	pal := color.Palette{color.Transparent, color.NRGBA{255, 0, 0, 255}}
	g := &gif.GIF{LoopCount: 0}
	for i := 0; i < 3; i++ {
		p := image.NewPaletted(image.Rect(0, 0, 40, 40), pal)
		for y := 0; y < 40; y++ {
			for x := 0; x < 20; x++ {
				p.SetColorIndex(x, y, 1)
			}
		}
		g.Image = append(g.Image, p)
		g.Delay = append(g.Delay, 5)
		g.Disposal = append(g.Disposal, gif.DisposalBackground)
	}
	var b bytes.Buffer
	if err := gif.EncodeAll(&b, g); err != nil {
		t.Fatal(err)
	}
	out, _, err := Crop(b.Bytes(), CropSpec{MaxW: 40, MaxH: 40})
	if err != nil {
		t.Fatal(err)
	}
	got, err := gif.DecodeAll(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	for i, f := range got.Image {
		if _, _, _, a := f.At(30, 20).RGBA(); a != 0 {
			t.Errorf("frame %d: right half not see-through", i)
		}
		if r, _, _, a := f.At(5, 20).RGBA(); a == 0 || r < 0xf000 {
			t.Errorf("frame %d: left half not red", i)
		}
	}
}
