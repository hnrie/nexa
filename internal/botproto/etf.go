package botproto

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"
)

// ETF is Erlang's External Term Format, which a bot may ask the gateway to
// speak instead of JSON (Nostrum does, for one). Maps are keyed by atoms,
// text is binaries, null and booleans are the atoms nil, true and false, and
// snowflakes are integers.

const (
	etfVersion   = 131
	etfNewFloat  = 70
	etfSmallInt  = 97
	etfInt       = 98
	etfAtom      = 100
	etfNil       = 106
	etfString    = 107
	etfList      = 108
	etfBinary    = 109
	etfSmallBig  = 110
	etfLargeBig  = 111
	etfMap       = 116
	etfAtomUTF8  = 118
	etfSmallAtom = 115
	etfSmallUTF8 = 119
	etfSmallTup  = 104
	etfLargeTup  = 105
)

// EncodeETF writes v as one ETF term.
func EncodeETF(v any) ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte(etfVersion)
	if err := etfValue(&b, reflect.ValueOf(v), 0); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

const etfMaxDepth = 64

var (
	snowType      = reflect.TypeOf(Snow(0))
	rawType       = reflect.TypeOf(json.RawMessage(nil))
	numberType    = reflect.TypeOf(json.Number(""))
	marshalerType = reflect.TypeOf((*json.Marshaler)(nil)).Elem()
)

func etfAtomBytes(b *bytes.Buffer, name string) {
	if len(name) < 256 {
		b.WriteByte(etfSmallUTF8)
		b.WriteByte(byte(len(name)))
	} else {
		b.WriteByte(etfAtomUTF8)
		_ = binary.Write(b, binary.BigEndian, uint16(len(name)))
	}
	b.WriteString(name)
}

func etfNilAtom(b *bytes.Buffer) { etfAtomBytes(b, "nil") }

func etfInteger(b *bytes.Buffer, n int64) {
	switch {
	case n >= 0 && n <= 255:
		b.WriteByte(etfSmallInt)
		b.WriteByte(byte(n))
	case n >= math.MinInt32 && n <= math.MaxInt32:
		b.WriteByte(etfInt)
		_ = binary.Write(b, binary.BigEndian, int32(n))
	default:
		etfBig(b, new(big.Int).SetInt64(n))
	}
}

func etfUnsigned(b *bytes.Buffer, n uint64) {
	if n <= math.MaxInt32 {
		etfInteger(b, int64(n))
		return
	}
	etfBig(b, new(big.Int).SetUint64(n))
}

func etfBig(b *bytes.Buffer, n *big.Int) {
	sign := byte(0)
	if n.Sign() < 0 {
		sign = 1
	}
	mag := new(big.Int).Abs(n).Bytes() // big-endian
	b.WriteByte(etfSmallBig)
	b.WriteByte(byte(len(mag)))
	b.WriteByte(sign)
	for i := len(mag) - 1; i >= 0; i-- {
		b.WriteByte(mag[i])
	}
}

func etfBinaryString(b *bytes.Buffer, s string) {
	b.WriteByte(etfBinary)
	_ = binary.Write(b, binary.BigEndian, uint32(len(s)))
	b.WriteString(s)
}

func etfFloat(b *bytes.Buffer, f float64) {
	if f == math.Trunc(f) && math.Abs(f) < 1<<53 {
		etfInteger(b, int64(f))
		return
	}
	b.WriteByte(etfNewFloat)
	_ = binary.Write(b, binary.BigEndian, math.Float64bits(f))
}

// etfJSON writes a JSON document as a term: what a value that knows only how
// to write itself as JSON becomes.
func etfJSON(b *bytes.Buffer, raw []byte, depth int) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return err
	}
	return etfValue(b, reflect.ValueOf(v), depth)
}

func etfValue(b *bytes.Buffer, v reflect.Value, depth int) error {
	if depth > etfMaxDepth {
		return errors.New("etf: too deep")
	}
	if !v.IsValid() {
		etfNilAtom(b)
		return nil
	}
	t := v.Type()
	switch {
	case t == snowType:
		etfInteger(b, Out(Snow(v.Int()).ID()))
		return nil
	case t == rawType:
		if v.Len() == 0 {
			etfNilAtom(b)
			return nil
		}
		return etfJSON(b, v.Bytes(), depth)
	case t == numberType:
		s := v.String()
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			etfInteger(b, n)
			return nil
		}
		if n, ok := new(big.Int).SetString(s, 10); ok {
			etfBig(b, n)
			return nil
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return err
		}
		etfFloat(b, f)
		return nil
	}
	switch v.Kind() {
	case reflect.Interface:
		if v.IsNil() {
			etfNilAtom(b)
			return nil
		}
		return etfValue(b, v.Elem(), depth+1)
	case reflect.Pointer:
		if v.IsNil() {
			etfNilAtom(b)
			return nil
		}
		// a type that writes its own JSON only through a pointer
		if t.Implements(marshalerType) && !t.Elem().Implements(marshalerType) {
			raw, err := v.Interface().(json.Marshaler).MarshalJSON()
			if err != nil {
				return err
			}
			return etfJSON(b, raw, depth)
		}
		return etfValue(b, v.Elem(), depth+1)
	}
	if t.Implements(marshalerType) {
		raw, err := v.Interface().(json.Marshaler).MarshalJSON()
		if err != nil {
			return err
		}
		return etfJSON(b, raw, depth)
	}
	switch v.Kind() {
	case reflect.Bool:
		if v.Bool() {
			etfAtomBytes(b, "true")
		} else {
			etfAtomBytes(b, "false")
		}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		etfInteger(b, v.Int())
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		etfUnsigned(b, v.Uint())
	case reflect.Float32, reflect.Float64:
		etfFloat(b, v.Float())
	case reflect.String:
		etfBinaryString(b, v.String())
	case reflect.Slice, reflect.Array:
		if v.Kind() == reflect.Slice && v.IsNil() {
			etfNilAtom(b)
			return nil
		}
		n := v.Len()
		if n == 0 {
			b.WriteByte(etfNil)
			return nil
		}
		b.WriteByte(etfList)
		_ = binary.Write(b, binary.BigEndian, uint32(n))
		for i := 0; i < n; i++ {
			if err := etfValue(b, v.Index(i), depth+1); err != nil {
				return err
			}
		}
		b.WriteByte(etfNil)
	case reflect.Map:
		if v.IsNil() {
			etfNilAtom(b)
			return nil
		}
		keys := v.MapKeys()
		names := make([]string, len(keys))
		for i, k := range keys {
			names[i] = mapKeyString(k)
		}
		order := make([]int, len(keys))
		for i := range order {
			order[i] = i
		}
		sort.Slice(order, func(i, j int) bool { return names[order[i]] < names[order[j]] })
		b.WriteByte(etfMap)
		_ = binary.Write(b, binary.BigEndian, uint32(len(keys)))
		for _, i := range order {
			etfAtomBytes(b, names[i])
			if err := etfValue(b, v.MapIndex(keys[i]), depth+1); err != nil {
				return err
			}
		}
	case reflect.Struct:
		fields := structFields(t)
		var kept []fieldInfo
		var vals []reflect.Value
		for _, f := range fields {
			fv, ok := fieldByIndex(v, f.index)
			if !ok {
				continue
			}
			if f.omitEmpty && isEmptyValue(fv) {
				continue
			}
			kept = append(kept, f)
			vals = append(vals, fv)
		}
		b.WriteByte(etfMap)
		_ = binary.Write(b, binary.BigEndian, uint32(len(kept)))
		for i, f := range kept {
			etfAtomBytes(b, f.name)
			if err := etfValue(b, vals[i], depth+1); err != nil {
				return err
			}
		}
	default:
		return fmt.Errorf("etf: cannot encode %s", t)
	}
	return nil
}

func mapKeyString(k reflect.Value) string {
	switch k.Kind() {
	case reflect.String:
		return k.String()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		if k.Type() == snowType {
			return OutString(Snow(k.Int()).ID())
		}
		return strconv.FormatInt(k.Int(), 10)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return strconv.FormatUint(k.Uint(), 10)
	}
	return fmt.Sprint(k.Interface())
}

type fieldInfo struct {
	name      string
	index     []int
	omitEmpty bool
}

var fieldCache sync.Map // reflect.Type -> []fieldInfo

// structFields lists a struct's fields as encoding/json would write them:
// tag names, "-" skipped, embedded structs' fields lifted into it.
func structFields(t reflect.Type) []fieldInfo {
	if cached, ok := fieldCache.Load(t); ok {
		return cached.([]fieldInfo)
	}
	var out []fieldInfo
	seen := map[string]bool{}
	var walk func(t reflect.Type, prefix []int)
	walk = func(t reflect.Type, prefix []int) {
		var embedded []reflect.StructField
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			tag := f.Tag.Get("json")
			if tag == "-" {
				continue
			}
			name, opts, _ := strings.Cut(tag, ",")
			if f.Anonymous && name == "" {
				ft := f.Type
				if ft.Kind() == reflect.Pointer {
					ft = ft.Elem()
				}
				if ft.Kind() == reflect.Struct {
					embedded = append(embedded, f)
					continue
				}
			}
			if !f.IsExported() {
				continue
			}
			if name == "" {
				name = f.Name
			}
			if seen[name] {
				continue
			}
			seen[name] = true
			idx := append(append([]int{}, prefix...), i)
			out = append(out, fieldInfo{name: name, index: idx, omitEmpty: strings.Contains(opts, "omitempty")})
		}
		// the outer struct's own fields win over those it embeds
		for _, f := range embedded {
			ft := f.Type
			if ft.Kind() == reflect.Pointer {
				ft = ft.Elem()
			}
			walk(ft, append(append([]int{}, prefix...), f.Index...))
		}
	}
	walk(t, nil)
	fieldCache.Store(t, out)
	return out
}

func fieldByIndex(v reflect.Value, index []int) (reflect.Value, bool) {
	for i, x := range index {
		if i > 0 && v.Kind() == reflect.Pointer {
			if v.IsNil() {
				return reflect.Value{}, false
			}
			v = v.Elem()
		}
		v = v.Field(x)
	}
	return v, true
}

func isEmptyValue(v reflect.Value) bool {
	switch v.Kind() {
	case reflect.Array, reflect.Map, reflect.Slice, reflect.String:
		return v.Len() == 0
	case reflect.Bool:
		return !v.Bool()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return v.Int() == 0
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return v.Uint() == 0
	case reflect.Float32, reflect.Float64:
		return v.Float() == 0
	case reflect.Interface, reflect.Pointer:
		return v.IsNil()
	}
	return false
}

// DecodeETF reads one ETF term into the values JSON decoding gives: maps
// keyed by strings, lists, strings, json.Numbers, booleans and nil.
func DecodeETF(data []byte) (any, error) {
	if len(data) == 0 || data[0] != etfVersion {
		return nil, errors.New("etf: no version byte")
	}
	d := &etfDecoder{b: data[1:]}
	v, err := d.term(0)
	if err != nil {
		return nil, err
	}
	return v, nil
}

type etfDecoder struct {
	b []byte
}

var errETFShort = errors.New("etf: truncated")

func (d *etfDecoder) take(n int) ([]byte, error) {
	if n < 0 || n > len(d.b) {
		return nil, errETFShort
	}
	out := d.b[:n]
	d.b = d.b[n:]
	return out, nil
}

func (d *etfDecoder) u8() (int, error) {
	b, err := d.take(1)
	if err != nil {
		return 0, err
	}
	return int(b[0]), nil
}

func (d *etfDecoder) u16() (int, error) {
	b, err := d.take(2)
	if err != nil {
		return 0, err
	}
	return int(binary.BigEndian.Uint16(b)), nil
}

func (d *etfDecoder) u32() (int, error) {
	b, err := d.take(4)
	if err != nil {
		return 0, err
	}
	n := binary.BigEndian.Uint32(b)
	if n > 1<<26 {
		return 0, errors.New("etf: too large")
	}
	return int(n), nil
}

func atomValue(name string) any {
	switch name {
	case "nil", "null":
		return nil
	case "true":
		return true
	case "false":
		return false
	}
	return name
}

func (d *etfDecoder) term(depth int) (any, error) {
	if depth > etfMaxDepth {
		return nil, errors.New("etf: too deep")
	}
	tag, err := d.u8()
	if err != nil {
		return nil, err
	}
	switch tag {
	case etfSmallInt:
		n, err := d.u8()
		return json.Number(strconv.Itoa(n)), err
	case etfInt:
		b, err := d.take(4)
		if err != nil {
			return nil, err
		}
		return json.Number(strconv.Itoa(int(int32(binary.BigEndian.Uint32(b))))), nil
	case etfNewFloat:
		b, err := d.take(8)
		if err != nil {
			return nil, err
		}
		f := math.Float64frombits(binary.BigEndian.Uint64(b))
		return json.Number(strconv.FormatFloat(f, 'g', -1, 64)), nil
	case etfSmallBig, etfLargeBig:
		var n int
		if tag == etfSmallBig {
			n, err = d.u8()
		} else {
			n, err = d.u32()
		}
		if err != nil {
			return nil, err
		}
		sign, err := d.u8()
		if err != nil {
			return nil, err
		}
		digits, err := d.take(n)
		if err != nil {
			return nil, err
		}
		be := make([]byte, n)
		for i := range digits {
			be[n-1-i] = digits[i]
		}
		v := new(big.Int).SetBytes(be)
		if sign == 1 {
			v.Neg(v)
		}
		return json.Number(v.String()), nil
	case etfAtom, etfAtomUTF8:
		n, err := d.u16()
		if err != nil {
			return nil, err
		}
		b, err := d.take(n)
		if err != nil {
			return nil, err
		}
		return atomValue(string(b)), nil
	case etfSmallAtom, etfSmallUTF8:
		n, err := d.u8()
		if err != nil {
			return nil, err
		}
		b, err := d.take(n)
		if err != nil {
			return nil, err
		}
		return atomValue(string(b)), nil
	case etfBinary:
		n, err := d.u32()
		if err != nil {
			return nil, err
		}
		b, err := d.take(n)
		if err != nil {
			return nil, err
		}
		if !utf8.Valid(b) {
			return nil, errors.New("etf: binary is not text")
		}
		return string(b), nil
	case etfString:
		// a short list of bytes, which is how Erlang writes a charlist
		n, err := d.u16()
		if err != nil {
			return nil, err
		}
		b, err := d.take(n)
		if err != nil {
			return nil, err
		}
		out := make([]any, n)
		for i, c := range b {
			out[i] = json.Number(strconv.Itoa(int(c)))
		}
		return out, nil
	case etfNil:
		return []any{}, nil
	case etfList:
		n, err := d.u32()
		if err != nil {
			return nil, err
		}
		out := make([]any, 0, min(n, 1024))
		for i := 0; i < n; i++ {
			v, err := d.term(depth + 1)
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		// the tail, an empty list for a proper one
		if _, err := d.term(depth + 1); err != nil {
			return nil, err
		}
		return out, nil
	case etfSmallTup, etfLargeTup:
		var n int
		if tag == etfSmallTup {
			n, err = d.u8()
		} else {
			n, err = d.u32()
		}
		if err != nil {
			return nil, err
		}
		out := make([]any, 0, min(n, 1024))
		for i := 0; i < n; i++ {
			v, err := d.term(depth + 1)
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, nil
	case etfMap:
		n, err := d.u32()
		if err != nil {
			return nil, err
		}
		out := make(map[string]any, min(n, 1024))
		for i := 0; i < n; i++ {
			k, err := d.term(depth + 1)
			if err != nil {
				return nil, err
			}
			v, err := d.term(depth + 1)
			if err != nil {
				return nil, err
			}
			var key string
			switch kk := k.(type) {
			case string:
				key = kk
			case json.Number:
				key = kk.String()
			case nil:
				key = "nil"
			case bool:
				key = strconv.FormatBool(kk)
			default:
				return nil, errors.New("etf: map key is not text")
			}
			out[key] = v
		}
		return out, nil
	}
	return nil, fmt.Errorf("etf: unsupported tag %d", tag)
}
