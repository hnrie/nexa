package media

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
)

func TestPhotoOrientation(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 3; x++ {
			src.SetNRGBA(x, y, color.NRGBA{R: uint8(1 + y*3 + x), A: 255})
		}
	}
	want := [][]uint8{{1, 2, 3, 4, 5, 6}, {3, 2, 1, 6, 5, 4}, {6, 5, 4, 3, 2, 1}, {4, 5, 6, 1, 2, 3}, {1, 4, 2, 5, 3, 6}, {4, 1, 5, 2, 6, 3}, {6, 3, 5, 2, 4, 1}, {3, 6, 2, 5, 1, 4}}
	var jpg bytes.Buffer
	if err := jpeg.Encode(&jpg, src, nil); err != nil {
		t.Fatal(err)
	}
	for orientation := 1; orientation <= 8; orientation++ {
		got := orientImage(src, orientation)
		var pixels []uint8
		for y := 0; y < got.Bounds().Dy(); y++ {
			for x := 0; x < got.Bounds().Dx(); x++ {
				r, _, _, _ := got.At(x, y).RGBA()
				pixels = append(pixels, uint8(r>>8))
			}
		}
		if !bytes.Equal(pixels, want[orientation-1]) {
			t.Fatalf("orientation %d: %v", orientation, pixels)
		}
		data := append([]byte{}, jpg.Bytes()[:2]...)
		data = append(data, exifOrientationOnly(orientation, "MM")...)
		data = append(data, jpg.Bytes()[2:]...)
		if o := jpegOrientation(data); o != orientation {
			t.Fatalf("read %d, want %d", o, orientation)
		}
		path := filepath.Join(t.TempDir(), "photo.jpg")
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
		small, err := decodeFirstFrame(path, "image/jpeg")
		if err != nil {
			t.Fatal(err)
		}
		if small.Bounds() != got.Bounds() {
			t.Fatalf("variant orientation %d: %v", orientation, small.Bounds())
		}
		// The crop rectangle is in the displayed photo's coordinates, including swapped sides.
		cropped, _, err := Crop(data, CropSpec{Rect: got.Bounds(), MaxW: got.Bounds().Dx(), MaxH: got.Bounds().Dy()})
		if err != nil {
			t.Fatal(err)
		}
		cfg, _, err := image.DecodeConfig(bytes.NewReader(cropped))
		if err != nil || cfg.Width != got.Bounds().Dx() || cfg.Height != got.Bounds().Dy() {
			t.Fatalf("crop %d: %v %v", orientation, cfg, err)
		}
		le := append([]byte{0xff, 0xd8}, jpegSeg(0xe1, []byte("Exif\x00\x00"), exifTIFF(binary.LittleEndian, uint16(orientation)))...)
		if jpegOrientation(le) != orientation {
			t.Fatal("little endian orientation")
		}
	}
}
