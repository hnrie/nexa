package media

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"io"
	"math"
	"os"
	"path/filepath"
)

// Photos and videos carry details nobody sees until they go looking: where a
// picture was taken, the phone or camera that took it and its serial number,
// when, what edited it, comments, XMP and IPTC. The files this server keeps
// readable (profile pictures, banners, icons, emoji, stickers, a webhook's
// files, a bug report's screenshots and recordings) have them taken out here,
// before their hash is worked out. Encrypted attachments can only be cleaned
// on the sender's device, which web/src/lib/scrubMetadata.ts does by the same
// rules; both are checked against the files in testdata/scrub.
//
// Nothing is re-encoded. Whole segments, chunks and boxes are left out or
// blanked, and what a picture needs to be shown as it was stays: a JPEG's
// orientation, colour profile and Adobe marker, and a PNG's colour chunks.
// A file this does not recognise (HEIC among them), or cannot follow as far
// as it has to, is left exactly as it came.

// scrubWindow is how much of a file is read at a time while its structure is
// followed.
const scrubWindow = 256 << 10

// scrubSource reads a file a window at a time.
type scrubSource struct {
	r    io.ReaderAt
	size int64
	buf  []byte
	base int64
	err  error
}

// at returns the n bytes at off, or nil when the file ends before them. The
// slice stays valid after later reads.
func (s *scrubSource) at(off, n int64) []byte {
	if off < 0 || n < 0 || n > s.size || off > s.size-n || s.err != nil {
		return nil
	}
	if off >= s.base && off-s.base <= int64(len(s.buf))-n {
		return s.buf[off-s.base : off-s.base+n]
	}
	buf := make([]byte, min(max(n, scrubWindow), s.size-off))
	if got, err := s.r.ReadAt(buf, off); got < len(buf) {
		if err == nil {
			err = io.ErrUnexpectedEOF
		}
		s.err = err
		return nil
	}
	s.buf, s.base = buf, off
	return buf[:n]
}

// maxScrubParts bounds how many pieces a cleaned file is made of. A real
// photo or video comes to a handful; only a file built to cost memory, with
// metadata between every other chunk, gets near it, and it is left as it is.
const maxScrubParts = 1 << 16

// scrubPart is a stretch of a cleaned file: bytes [off, off+n) of the
// original, new bytes (lit), or n zero bytes (zero).
type scrubPart struct {
	off, n int64
	lit    []byte
	zero   bool
}

// scrubPlan is a cleaned file, in order.
type scrubPlan []scrubPart

func (p *scrubPlan) keep(off, n int64) {
	if n <= 0 {
		return
	}
	if l := len(*p); l > 0 {
		if last := &(*p)[l-1]; last.lit == nil && !last.zero && last.off+last.n == off {
			last.n += n
			return
		}
	}
	*p = append(*p, scrubPart{off: off, n: n})
}

func (p *scrubPlan) add(b []byte) {
	if len(b) > 0 {
		*p = append(*p, scrubPart{n: int64(len(b)), lit: b})
	}
}

func (p *scrubPlan) zeros(n int64) {
	if n > 0 {
		*p = append(*p, scrubPart{n: n, zero: true})
	}
}

// inPlace reports whether every byte the plan keeps stays where it was, so
// the file can be written over rather than copied.
func (p scrubPlan) inPlace(size int64) bool {
	var at int64
	for _, part := range p {
		if part.lit == nil && !part.zero && part.off != at {
			return false
		}
		at += part.n
	}
	return at == size
}

// planScrub works out how to write src without its metadata, or returns nil
// to leave it as it is. The format is told by the first bytes alone.
func planScrub(src *scrubSource) scrubPlan {
	h := src.at(0, min(src.size, 12))
	switch {
	case len(h) >= 3 && h[0] == 0xff && h[1] == 0xd8 && h[2] == 0xff:
		return planJPEG(src)
	case len(h) >= 8 && string(h[:8]) == "\x89PNG\r\n\x1a\n":
		return planPNG(src)
	case len(h) >= 12 && string(h[:4]) == "RIFF" && string(h[8:12]) == "WEBP":
		return planWebP(src)
	case len(h) >= 6 && (string(h[:6]) == "GIF87a" || string(h[:6]) == "GIF89a"):
		return planGIF(src)
	case len(h) >= 8 && string(h[4:8]) == "ftyp":
		return planMP4(src)
	}
	return nil
}

// jpegHeadMax bounds how far into a JPEG its picture data is looked for: what
// comes before it is a handful of segments of at most 64 KB each.
const jpegHeadMax = 16 << 20

// planJPEG leaves out the segments before a JPEG's picture data that describe
// it rather than draw it: Exif and XMP (APP1), IPTC (APP13), comments, and
// every other application segment but the three a picture is drawn with
// (JFIF, an ICC colour profile, Adobe's colour transform). An orientation
// other than upright comes back as an Exif segment holding nothing else, so
// the photo still shows the right way up. Everything from the picture data
// on is kept as it is.
func planJPEG(src *scrubSource) scrubPlan {
	type segment struct {
		b    []byte
		app0 bool
	}
	var kept []segment
	orient, order, exifSeen := 0, "", false
	pos := int64(2)
	for {
		m := src.at(pos, 2)
		if m == nil || m[0] != 0xff {
			return nil
		}
		for m[1] == 0xff { // fill bytes before a marker
			if pos++; pos > jpegHeadMax {
				return nil
			}
			if m = src.at(pos, 2); m == nil {
				return nil
			}
		}
		marker := m[1]
		if marker == 0xda { // start of scan: the picture data
			break
		}
		if marker == 0x00 || marker == 0xd8 || marker == 0xd9 {
			return nil
		}
		if marker == 0x01 || marker >= 0xd0 && marker <= 0xd7 { // no length
			if kept = append(kept, segment{b: m}); len(kept) > maxScrubParts {
				return nil
			}
			pos += 2
			continue
		}
		l := src.at(pos+2, 2)
		if l == nil {
			return nil
		}
		n := int64(binary.BigEndian.Uint16(l)) + 2
		seg := src.at(pos, n)
		if n < 4 || seg == nil {
			return nil
		}
		body, keep := seg[4:], true
		switch {
		case marker == 0xe0:
			keep = bytes.HasPrefix(body, []byte("JFIF\x00"))
		case marker == 0xe1:
			keep = false
			if !exifSeen && bytes.HasPrefix(body, []byte("Exif\x00\x00")) {
				// browsers turn a photo by the first Exif segment
				exifSeen = true
				orient, order = exifOrientation(body[6:])
			}
		case marker == 0xe2:
			keep = bytes.HasPrefix(body, []byte("ICC_PROFILE\x00"))
		case marker == 0xee:
			keep = bytes.HasPrefix(body, []byte("Adobe"))
		case marker >= 0xe3 && marker <= 0xef, marker == 0xfe:
			keep = false
		}
		if keep {
			kept = append(kept, segment{b: seg, app0: marker == 0xe0})
		}
		if pos += n; pos > jpegHeadMax || len(kept) > maxScrubParts {
			return nil
		}
	}
	head := []byte{0xff, 0xd8}
	i := 0
	for ; i < len(kept) && kept[i].app0; i++ {
		head = append(head, kept[i].b...)
	}
	if orient > 1 {
		head = append(head, exifOrientationOnly(orient, order)...)
	}
	for ; i < len(kept); i++ {
		head = append(head, kept[i].b...)
	}
	if int64(len(head)) == pos && bytes.Equal(head, src.at(0, pos)) {
		return nil
	}
	var plan scrubPlan
	plan.add(head)
	plan.keep(pos, src.size-pos)
	return plan
}

// exifOrientation reads the orientation out of Exif's TIFF data the way
// browsers do (a single SHORT in the first directory), with the byte order
// the data is written in, "II" or "MM". It returns 0 when there is none.
func exifOrientation(t []byte) (int, string) {
	if len(t) < 8 {
		return 0, ""
	}
	var bo binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 0, ""
	}
	if bo.Uint16(t[2:]) != 42 {
		return 0, ""
	}
	ifd := int64(bo.Uint32(t[4:]))
	if ifd < 8 || ifd > int64(len(t))-2 {
		return 0, ""
	}
	for i, n := int64(0), int64(bo.Uint16(t[ifd:])); i < n; i++ {
		e := ifd + 2 + 12*i
		if e+12 > int64(len(t)) {
			break
		}
		if bo.Uint16(t[e:]) != 0x0112 {
			continue
		}
		if bo.Uint16(t[e+2:]) != 3 || bo.Uint32(t[e+4:]) != 1 {
			break
		}
		if v := int(bo.Uint16(t[e+8:])); v >= 1 && v <= 8 {
			return v, string(t[:2])
		}
		break
	}
	return 0, ""
}

// exifOrientationOnly is an Exif segment that says nothing but which way up a
// photo goes: a TIFF header in the byte order the original used, then a first
// directory with that one entry and no directory after it.
func exifOrientationOnly(v int, order string) []byte {
	var bo binary.ByteOrder = binary.BigEndian
	if order == "II" {
		bo = binary.LittleEndian
	}
	seg := make([]byte, 36)
	copy(seg, "\xff\xe1\x00\x22Exif\x00\x00")
	t := seg[10:]
	copy(t, order)
	bo.PutUint16(t[2:], 42)
	bo.PutUint32(t[4:], 8)          // the first directory, right after the header
	bo.PutUint16(t[8:], 1)          // one entry
	bo.PutUint16(t[10:], 0x0112)    // Orientation
	bo.PutUint16(t[12:], 3)         // SHORT
	bo.PutUint32(t[14:], 1)         // one of them
	bo.PutUint16(t[18:], uint16(v)) // then two bytes of padding and no next directory
	return seg
}

// pngKept are the ancillary PNG chunks a picture is drawn with: transparency,
// colour, size and the frames of an animation. Every other ancillary chunk
// (text, time, Exif and whatever else a program added) is left out; critical
// chunks all stay, known or not.
var pngKept = map[string]bool{
	"tRNS": true, "cHRM": true, "gAMA": true, "iCCP": true, "sBIT": true, "sRGB": true, "cICP": true, "mDCv": true,
	"cLLi": true, "bKGD": true, "hIST": true, "pHYs": true, "sPLT": true, "acTL": true, "fcTL": true, "fdAT": true,
}

// planPNG keeps a PNG's critical chunks and the ancillary ones in pngKept,
// each with the checksum it came with, and nothing after the end.
func planPNG(src *scrubSource) scrubPlan {
	var plan scrubPlan
	plan.keep(0, 8)
	changed := false
	for pos := int64(8); ; {
		c := src.at(pos, 8)
		if c == nil {
			return nil
		}
		n := int64(binary.BigEndian.Uint32(c))
		typ := string(c[4:8])
		if n > math.MaxInt32 || n > src.size-pos-12 || !letters(c[4:8]) {
			return nil
		}
		if c[4]&0x20 == 0 || pngKept[typ] {
			if plan.keep(pos, n+12); len(plan) > maxScrubParts {
				return nil
			}
		} else {
			changed = true
		}
		pos += n + 12
		if typ == "IEND" {
			// what follows the end is not drawn; a cropped screenshot can
			// carry the rest of the uncropped one there
			changed = changed || pos < src.size
			break
		}
	}
	if !changed {
		return nil
	}
	return plan
}

func letters(b []byte) bool {
	for _, c := range b {
		if (c < 'A' || c > 'Z') && (c < 'a' || c > 'z') {
			return false
		}
	}
	return true
}

// planWebP leaves out a WebP's EXIF and XMP chunks and clears the flags that
// said they were there. Everything else, an animation's frames included, is
// kept as it was.
func planWebP(src *scrubSource) scrubPlan {
	h := src.at(0, 12)
	end := 8 + int64(binary.LittleEndian.Uint32(h[4:8]))
	if end < 12 || end > src.size {
		return nil
	}
	type chunk struct{ off, n int64 }
	var kept []chunk
	size, vp8x := int64(4), int64(-1)
	changed := end < src.size // bytes after the RIFF's end, which nothing reads
	for pos := int64(12); pos < end; {
		c := src.at(pos, 8)
		if c == nil || end-pos < 8 {
			return nil
		}
		n := int64(binary.LittleEndian.Uint32(c[4:]))
		next := pos + 8 + n + n&1
		if next > end {
			return nil
		}
		switch id := string(c[:4]); id {
		case "EXIF", "XMP ":
			changed = true
		default:
			if id == "VP8X" && vp8x < 0 {
				if n < 10 {
					return nil
				}
				vp8x = pos
			}
			if kept = append(kept, chunk{pos, next - pos}); len(kept) > maxScrubParts {
				return nil
			}
			size += next - pos
		}
		pos = next
	}
	var x []byte
	if vp8x >= 0 {
		x = bytes.Clone(src.at(vp8x, 9))
		if x[8]&0x0c != 0 { // EXIF (0x08) and XMP (0x04)
			x[8] &^= 0x0c
			changed = true
		}
	}
	if !changed {
		return nil
	}
	riff := []byte("RIFF\x00\x00\x00\x00WEBP")
	binary.LittleEndian.PutUint32(riff[4:], uint32(size))
	var plan scrubPlan
	plan.add(riff)
	for _, c := range kept {
		if c.off == vp8x {
			plan.add(x)
			plan.keep(c.off+9, c.n-9)
		} else {
			plan.keep(c.off, c.n)
		}
	}
	return plan
}

// planGIF leaves out a GIF's comments and its XMP. The frames, the loop count
// and every other extension stay as they were.
func planGIF(src *scrubSource) scrubPlan {
	h := src.at(0, 13)
	if h == nil {
		return nil
	}
	pos := int64(13)
	if h[10]&0x80 != 0 { // global colour table
		pos += 3 << (h[10]&7 + 1)
	}
	var plan scrubPlan
	plan.keep(0, pos)
	changed := false
	for {
		b := src.at(pos, 1)
		if b == nil {
			return nil
		}
		switch b[0] {
		case 0x3b: // the trailer; whatever follows is not part of the picture
			plan.keep(pos, 1)
			if !changed && pos+1 == src.size {
				return nil
			}
			return plan
		case 0x2c: // a frame
			d := src.at(pos, 10)
			if d == nil {
				return nil
			}
			p := pos + 10
			if d[9]&0x80 != 0 { // local colour table
				p += 3 << (d[9]&7 + 1)
			}
			if p = gifSkipBlocks(src, p+1); p < 0 { // past the LZW code size
				return nil
			}
			if plan.keep(pos, p-pos); len(plan) > maxScrubParts {
				return nil
			}
			pos = p
		case 0x21: // an extension
			e := src.at(pos, 2)
			if e == nil {
				return nil
			}
			p := gifSkipBlocks(src, pos+2)
			if p < 0 {
				return nil
			}
			drop := e[1] == 0xfe // a comment
			if e[1] == 0xff {
				a := src.at(pos+2, 12)
				drop = a != nil && a[0] == 11 && string(a[1:]) == "XMP DataXMP"
			}
			if drop {
				changed = true
			} else if plan.keep(pos, p-pos); len(plan) > maxScrubParts {
				return nil
			}
			pos = p
		default:
			return nil
		}
	}
}

// gifSkipBlocks returns where the data sub-blocks starting at p end, past
// their empty terminator, or -1 when the file ends first.
func gifSkipBlocks(src *scrubSource, p int64) int64 {
	for {
		b := src.at(p, 1)
		if b == nil {
			return -1
		}
		p += 1 + int64(b[0])
		if b[0] == 0 {
			return p
		}
	}
}

// xmpUUID is the extended type of an MP4 box that holds XMP.
const xmpUUID = "\xbe\x7a\xcf\xcb\x97\xa9\x42\xe8\x9c\x71\x99\x94\x91\xe3\xaf\xac"

// notVideoBrands are ftyp brands of files made of the same boxes as MP4 that
// are not video: pictures (HEIF, HEIC, AVIF, Canon's raw CR3), whose boxes
// hold the picture itself, and sound, whose tags are what a listener wants.
var notVideoBrands = map[string]bool{
	"heic": true, "heix": true, "hevc": true, "hevx": true, "heim": true, "heis": true, "hevm": true, "hevs": true,
	"mif1": true, "mif2": true, "msf1": true, "miaf": true, "MiHA": true, "MiHB": true, "MiHE": true, "MiPr": true,
	"avif": true, "avis": true, "avio": true, "avci": true, "avcs": true, "jpeg": true, "jpgs": true, "crx ": true,
	"M4A ": true, "M4B ": true, "M4P ": true, "F4A ": true, "F4B ": true,
}

// planMP4 blanks an MP4's or a QuickTime movie's metadata where it lies:
// udta and meta boxes in the movie and in each track, a meta box at the top,
// and XMP boxes become free boxes of the same size with nothing in them, and
// the times the movie, its tracks and their media were made are zeroed. No
// byte moves, so the offsets the movie's index holds stay right.
func planMP4(src *scrubSource) scrubPlan {
	h := src.at(0, 8)
	n := int64(binary.BigEndian.Uint32(h))
	if n < 16 || n > 4096 {
		return nil
	}
	ftyp := src.at(0, n)
	if ftyp == nil {
		return nil
	}
	for i := int64(8); i+4 <= n; i += 4 {
		if i != 12 && notVideoBrands[string(ftyp[i:i+4])] { // 12 is the minor version
			return nil
		}
	}
	w := mp4Walker{src: src}
	if !w.walk(0, src.size, "") || !w.moov || len(w.edits) == 0 || len(w.edits) > maxScrubParts {
		return nil
	}
	var plan scrubPlan
	at := int64(0)
	for _, e := range w.edits {
		plan.keep(at, e.off-at)
		if e.lit != nil {
			plan.add(e.lit)
		} else {
			plan.zeros(e.n)
		}
		at = e.off + e.n
	}
	plan.keep(at, src.size-at)
	return plan
}

// mp4Edit writes lit, or n zero bytes, at off.
type mp4Edit struct {
	off, n int64
	lit    []byte
}

type mp4Walker struct {
	src   *scrubSource
	edits []mp4Edit // in order, none overlapping
	moov  bool
}

// walk goes through the boxes in [start, end): the file itself when in is
// "", or the contents of a box of that type.
func (w *mp4Walker) walk(start, end int64, in string) bool {
	for pos := start; pos < end; {
		h := w.src.at(pos, 8)
		if h == nil || end-pos < 8 {
			// a few zero bytes may pad out the end
			rest := w.src.at(pos, end-pos)
			return rest != nil && end-pos < 8 && allZero(rest)
		}
		size, hdr := int64(binary.BigEndian.Uint32(h)), int64(8)
		typ := string(h[4:8])
		switch size {
		case 1: // the size follows, in 64 bits
			l := w.src.at(pos+8, 8)
			if l == nil || end-pos < 16 {
				return false
			}
			u := binary.BigEndian.Uint64(l)
			if u > math.MaxInt64 {
				return false
			}
			size, hdr = int64(u), 16
		case 0: // the last box, to the end of the file
			if in != "" {
				return false
			}
			size = end - pos
		}
		if size < hdr || size > end-pos || len(w.edits) > maxScrubParts {
			return false
		}
		switch {
		case in == "" && typ == "moov":
			w.moov = true
			if !w.walk(pos+hdr, pos+size, "moov") {
				return false
			}
		case in == "moov" && typ == "trak", in == "trak" && typ == "mdia":
			if !w.walk(pos+hdr, pos+size, typ) {
				return false
			}
		case (in == "moov" || in == "trak") && (typ == "udta" || typ == "meta"), in == "" && typ == "meta":
			w.blank(pos, size, hdr)
		case in != "mdia" && typ == "uuid":
			if u := w.src.at(pos+hdr, 16); u != nil && size-hdr >= 16 && string(u) == xmpUUID {
				w.blank(pos, size, hdr)
			}
		case in == "moov" && typ == "mvhd", in == "trak" && typ == "tkhd", in == "mdia" && typ == "mdhd":
			w.clearTimes(pos, size, hdr)
		}
		pos += size
	}
	return true
}

// blank turns the box at pos into a free box of the same size, zeroed.
func (w *mp4Walker) blank(pos, size, hdr int64) {
	h := bytes.Clone(w.src.at(pos, hdr))
	copy(h[4:8], "free")
	w.edits = append(w.edits, mp4Edit{off: pos, n: hdr, lit: h}, mp4Edit{off: pos + hdr, n: size - hdr})
}

// clearTimes zeroes the creation and modification times of a movie, track or
// media header, which say when a video was recorded.
func (w *mp4Walker) clearTimes(pos, size, hdr int64) {
	v := w.src.at(pos+hdr, 1)
	if v == nil || v[0] > 1 {
		return
	}
	n := int64(8) // version 0: two 32-bit times; version 1: two 64-bit ones
	if v[0] == 1 {
		n = 16
	}
	if size-hdr < 4+n {
		return
	}
	if t := w.src.at(pos+hdr+4, n); t != nil && !allZero(t) {
		w.edits = append(w.edits, mp4Edit{off: pos + hdr + 4, n: n})
	}
}

func allZero(b []byte) bool {
	for _, c := range b {
		if c != 0 {
			return false
		}
	}
	return true
}

// scrubFile takes the metadata out of the file at path, which nothing else
// has open, and reports whether it changed anything. A video keeps every byte
// where it was and is written over; anything else is written out afresh
// beside it and put in its place.
func scrubFile(path string) (bool, error) {
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return false, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return false, err
	}
	src := &scrubSource{r: f, size: info.Size()}
	plan := planScrub(src)
	if src.err != nil {
		return false, src.err
	}
	if plan == nil {
		return false, nil
	}
	if plan.inPlace(src.size) {
		var at int64
		for _, p := range plan {
			if p.lit != nil {
				_, err = f.WriteAt(p.lit, at)
			} else if p.zero {
				err = writeZeros(f, at, p.n)
			}
			if err != nil {
				return false, err
			}
			at += p.n
		}
		return true, f.Sync()
	}
	out, err := os.CreateTemp(filepath.Dir(path), "clean-*")
	if err != nil {
		return false, err
	}
	err = writePlan(out, f, plan)
	if err == nil {
		err = out.Sync()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	f.Close()
	if err == nil {
		err = os.Rename(out.Name(), path)
	}
	if err != nil {
		os.Remove(out.Name())
		return false, err
	}
	return true, nil
}

func writePlan(w io.Writer, src io.ReaderAt, plan scrubPlan) error {
	var zero [64 << 10]byte
	for _, p := range plan {
		var err error
		switch {
		case p.lit != nil:
			_, err = w.Write(p.lit)
		case p.zero:
			for left := p.n; left > 0 && err == nil; left -= int64(len(zero)) {
				_, err = w.Write(zero[:min(left, int64(len(zero)))])
			}
		default:
			var n int64
			n, err = io.Copy(w, io.NewSectionReader(src, p.off, p.n))
			if err == nil && n != p.n {
				err = io.ErrUnexpectedEOF
			}
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func writeZeros(f *os.File, at, n int64) error {
	var zero [64 << 10]byte
	for n > 0 {
		k := min(n, int64(len(zero)))
		if _, err := f.WriteAt(zero[:k], at); err != nil {
			return err
		}
		at, n = at+k, n-k
	}
	return nil
}

// hashFile returns the SHA-256 and the length of the file at path.
func hashFile(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}
