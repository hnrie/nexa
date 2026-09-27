package e2ee

import (
	"errors"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// The payload members this package writes are written as the browser's
// JSON.stringify writes them, so a payload built here is the same bytes a web
// client would have encrypted for the same object. encoding/json differs: it
// escapes <, >, &, U+2028 and U+2029 and formats some numbers another way.

// maxSafeInteger is JavaScript's Number.MAX_SAFE_INTEGER.
const maxSafeInteger = 1<<53 - 1

const hexDigits = "0123456789abcdef"

// appendJSString appends s quoted as JSON.stringify quotes it. Bytes that are
// not UTF-8 become U+FFFD, as TextEncoder would have written them.
func appendJSString(b []byte, s string) []byte {
	b = append(b, '"')
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			switch c {
			case '"':
				b = append(b, '\\', '"')
			case '\\':
				b = append(b, '\\', '\\')
			case '\b':
				b = append(b, '\\', 'b')
			case '\f':
				b = append(b, '\\', 'f')
			case '\n':
				b = append(b, '\\', 'n')
			case '\r':
				b = append(b, '\\', 'r')
			case '\t':
				b = append(b, '\\', 't')
			default:
				if c < 0x20 {
					b = append(b, '\\', 'u', '0', '0', hexDigits[c>>4], hexDigits[c&0xf])
				} else {
					b = append(b, c)
				}
			}
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			b = append(b, "�"...)
		} else {
			b = append(b, s[i:i+size]...)
		}
		i += size
	}
	return append(b, '"')
}

// appendJSNumber appends f as JavaScript's Number.prototype.toString writes
// it: the shortest digits that round-trip, plain notation from 1e-6 up to
// 1e21 and exponent notation ("1e+21", "1.5e-7") outside it.
func appendJSNumber(b []byte, f float64) ([]byte, error) {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return nil, errors.New("e2ee: a number in a payload must be finite")
	}
	if f == 0 {
		return append(b, '0'), nil // -0 too
	}
	if f < 0 {
		b = append(b, '-')
		f = -f
	}
	e := strconv.FormatFloat(f, 'e', -1, 64) // "d.ddde±XX"
	at := strings.IndexByte(e, 'e')
	digits := strings.Replace(e[:at], ".", "", 1)
	exp, err := strconv.Atoi(e[at+1:])
	if err != nil {
		return nil, err
	}
	k, n := len(digits), exp+1 // the value is 0.digits × 10^n
	switch {
	case k <= n && n <= 21:
		b = append(b, digits...)
		for range n - k {
			b = append(b, '0')
		}
	case 0 < n && n <= 21:
		b = append(append(append(b, digits[:n]...), '.'), digits[n:]...)
	case -6 < n && n <= 0:
		b = append(b, '0', '.')
		for range -n {
			b = append(b, '0')
		}
		b = append(b, digits...)
	default:
		b = append(b, digits[0])
		if k > 1 {
			b = append(append(b, '.'), digits[1:]...)
		}
		b = append(b, 'e')
		if n-1 >= 0 {
			b = append(b, '+')
		}
		b = strconv.AppendInt(b, int64(n-1), 10)
	}
	return b, nil
}

// jsObject writes one JSON object member by member, in the order they are
// added, the way JSON.stringify writes an object literal.
type jsObject struct {
	b   []byte
	err error
}

func (o *jsObject) key(k string) {
	if o.b == nil {
		o.b = append(o.b, '{')
	} else {
		o.b = append(o.b, ',')
	}
	o.b = append(appendJSString(o.b, k), ':')
}

func (o *jsObject) str(k, v string) {
	o.key(k)
	o.b = appendJSString(o.b, v)
}

func (o *jsObject) num(k string, v float64) {
	o.key(k)
	b, err := appendJSNumber(o.b, v)
	if err != nil {
		o.err = err
		return
	}
	o.b = b
}

func (o *jsObject) boolean(k string, v bool) {
	o.key(k)
	o.b = strconv.AppendBool(o.b, v)
}

func (o *jsObject) optStr(k string, v *string) {
	if v != nil {
		o.str(k, *v)
	}
}

func (o *jsObject) optNum(k string, v *float64) {
	if v != nil {
		o.num(k, *v)
	}
}

func (o *jsObject) optBool(k string, v *bool) {
	if v != nil {
		o.boolean(k, *v)
	}
}

func (o *jsObject) done() ([]byte, error) {
	if o.err != nil {
		return nil, o.err
	}
	if o.b == nil {
		return []byte("{}"), nil
	}
	return append(o.b, '}'), nil
}
