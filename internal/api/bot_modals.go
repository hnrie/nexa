package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"evilion.xyz/chat/internal/botproto"
	"evilion.xyz/chat/internal/ids"
)

// Forms (modals): what an application opens in answer to a command or a
// button, a few fields for someone to fill in. The application sends it as
// the protocol defines one; it is checked here (parseModal), kept with the
// interaction that opened it, drawn by the person's app, and what they
// submit is checked against it (modalSubmission) before the application is
// sent it.

// Modal component types besides the message ones.
const (
	compTextInput     = 4
	compLabel         = 18
	compFileUpload    = 19
	compRadioGroup    = 21
	compCheckboxGroup = 22
	compCheckbox      = 23
)

// Limits the protocol sets on forms.
const (
	modalMaxTitle       = 45
	modalMaxCustomID    = 100
	modalMaxParts       = 5
	modalMaxLabel       = 45
	modalMaxDescription = 100
	modalMaxText        = 4000
	modalMaxPlaceholder = 100
	modalMaxOptions     = 25
	modalMaxFiles       = 10
	modalMaxChoiceText  = 100
)

// modalDef is a form, checked.
type modalDef struct {
	CustomID   string      `json:"custom_id"`
	Title      string      `json:"title"`
	Components []modalPart `json:"components"`
}

// modalPart is one line of a form: a field with a label above it (a label,
// or the older action row holding a text input), or text.
type modalPart struct {
	Type        int         `json:"type"`
	ID          int         `json:"id"`
	Label       string      `json:"label,omitempty"`
	Description string      `json:"description,omitempty"`
	Content     string      `json:"content,omitempty"`
	Field       *modalField `json:"component,omitempty"`
}

// modalField is one field of a form.
type modalField struct {
	Type          int              `json:"type"`
	ID            int              `json:"id"`
	CustomID      string           `json:"custom_id"`
	Style         int              `json:"style,omitempty"`
	Placeholder   string           `json:"placeholder,omitempty"`
	Value         string           `json:"value,omitempty"`
	MinLength     *int             `json:"min_length,omitempty"`
	MaxLength     *int             `json:"max_length,omitempty"`
	Required      bool             `json:"required"`
	Options       []wmSelectOption `json:"options,omitempty"`
	MinValues     *int             `json:"min_values,omitempty"`
	MaxValues     *int             `json:"max_values,omitempty"`
	DefaultValues []wmDefaultValue `json:"default_values,omitempty"`
	ChannelTypes  []int            `json:"channel_types,omitempty"`
	FileTypes     []string         `json:"file_types,omitempty"`
	Default       bool             `json:"default,omitempty"`
}

// parseModal reads the form an application opens.
func parseModal(rd jsonReader, data map[string]any) (*modalDef, error) {
	errs := rd.errs
	base := fieldPath("data")
	m := &modalDef{}
	m.CustomID, _ = rd.str(data, "custom_id", base)
	if n := utf8.RuneCountInString(m.CustomID); n < 1 || n > modalMaxCustomID {
		errs.add(fieldPath(base, "custom_id"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", modalMaxCustomID))
	}
	m.Title, _ = rd.str(data, "title", base)
	m.Title = strings.TrimSpace(clean(m.Title))
	if n := utf8.RuneCountInString(m.Title); n < 1 || n > modalMaxTitle {
		errs.add(fieldPath(base, "title"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", modalMaxTitle))
	}
	list, _ := rd.list(data, "components", base)
	if len(list) < 1 || len(list) > modalMaxParts {
		errs.add(fieldPath(base, "components"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", modalMaxParts))
	}
	nextID := 0
	used := map[int]bool{}
	customIDs := map[string]bool{}
	takeID := func(obj map[string]any, path []string) int {
		if v, ok := rd.integer(obj, "id", path); ok && v > 0 && v < 1<<31 && !used[int(v)] {
			used[int(v)] = true
			return int(v)
		}
		for {
			nextID++
			if !used[nextID] {
				used[nextID] = true
				return nextID
			}
		}
	}
	fields := 0
	for i, v := range list {
		if i >= modalMaxParts {
			break
		}
		p := fieldPath(base, "components", i)
		obj, ok := v.(map[string]any)
		if !ok {
			errs.add(p, "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
			continue
		}
		t, _ := rd.integer(obj, "type", p)
		part := modalPart{Type: int(t), ID: takeID(obj, p)}
		switch part.Type {
		case compActionRow:
			inner, _ := rd.list(obj, "components", p)
			if len(inner) != 1 {
				errs.add(fieldPath(p, "components"), "BASE_TYPE_BAD_LENGTH", "Must be between 1 and 1 in length.")
				continue
			}
			fobj, ok := inner[0].(map[string]any)
			if !ok {
				errs.add(fieldPath(p, "components", 0), "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
				continue
			}
			fp := fieldPath(p, "components", 0)
			if ft, _ := rd.integer(fobj, "type", fp); ft != compTextInput {
				errs.add(fieldPath(fp, "type"), "COMPONENT_TYPE_INVALID", "An action row in a form holds one text input.")
				continue
			}
			// the older text input carries its own label
			label, _ := rd.str(fobj, "label", fp)
			label = strings.TrimSpace(clean(label))
			if n := utf8.RuneCountInString(label); n < 1 || n > modalMaxLabel {
				errs.add(fieldPath(fp, "label"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", modalMaxLabel))
			}
			part.Label = label
			part.Field = parseModalField(rd, fobj, fp, takeID, customIDs)
			fields++
		case compLabel:
			label, _ := rd.str(obj, "label", p)
			part.Label = strings.TrimSpace(clean(label))
			if n := utf8.RuneCountInString(part.Label); n < 1 || n > modalMaxLabel {
				errs.add(fieldPath(p, "label"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", modalMaxLabel))
			}
			if desc, ok := rd.str(obj, "description", p); ok {
				part.Description = strings.TrimSpace(clean(desc))
				rd.maxLen(part.Description, modalMaxDescription, fieldPath(p, "description"))
			}
			fobj, ok := rd.object(obj, "component", p)
			if !ok {
				errs.add(fieldPath(p, "component"), "BASE_TYPE_REQUIRED", "This field is required")
				continue
			}
			part.Field = parseModalField(rd, fobj, fieldPath(p, "component"), takeID, customIDs)
			fields++
		case compTextDisplay:
			part.Content, _ = rd.str(obj, "content", p)
			part.Content = botproto.InText(clean(part.Content))
			if n := utf8.RuneCountInString(part.Content); n < 1 || n > modalMaxText {
				errs.add(fieldPath(p, "content"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", modalMaxText))
			}
		default:
			errs.add(fieldPath(p, "type"), "COMPONENT_TYPE_INVALID", "A form holds labels, action rows with a text input, and text displays.")
			continue
		}
		m.Components = append(m.Components, part)
	}
	if fields == 0 && errs.empty() {
		errs.add(fieldPath(base, "components"), "MODAL_NO_FIELDS", "A form needs at least one field.")
	}
	if !errs.empty() {
		return nil, errs.err()
	}
	return m, nil
}

// parseModalField reads one field of a form.
func parseModalField(rd jsonReader, obj map[string]any, path []string, takeID func(map[string]any, []string) int, customIDs map[string]bool) *modalField {
	errs := rd.errs
	t, _ := rd.integer(obj, "type", path)
	f := &modalField{Type: int(t), ID: takeID(obj, path), Required: true}
	f.CustomID, _ = rd.str(obj, "custom_id", path)
	if n := utf8.RuneCountInString(f.CustomID); n < 1 || n > modalMaxCustomID {
		errs.add(fieldPath(path, "custom_id"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", modalMaxCustomID))
	} else if customIDs[f.CustomID] {
		errs.add(fieldPath(path, "custom_id"), "COMPONENT_CUSTOM_ID_DUPLICATED", "Component custom id cannot be duplicated")
	}
	customIDs[f.CustomID] = true
	if req, ok := rd.boolean(obj, "required", path); ok {
		f.Required = req
	}
	count := func(key string, lo, hi int) *int {
		v, ok := rd.integer(obj, key, path)
		if !ok {
			return nil
		}
		if v < int64(lo) || v > int64(hi) {
			errs.add(fieldPath(path, key), "NUMBER_TYPE_MAX", fmt.Sprintf("int value should be between %d and %d.", lo, hi))
			return nil
		}
		n := int(v)
		return &n
	}
	options := func(lo, hi int, withEmoji bool) {
		list, _ := rd.list(obj, "options", path)
		if len(list) < lo || len(list) > hi {
			errs.add(fieldPath(path, "options"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between %d and %d in length.", lo, hi))
		}
		values := map[string]bool{}
		for i, v := range list {
			op := fieldPath(path, "options", i)
			o, ok := v.(map[string]any)
			if !ok {
				errs.add(op, "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
				continue
			}
			opt := wmSelectOption{}
			opt.Label, _ = rd.str(o, "label", op)
			opt.Label = clean(opt.Label)
			if n := utf8.RuneCountInString(opt.Label); n < 1 || n > modalMaxChoiceText {
				errs.add(fieldPath(op, "label"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", modalMaxChoiceText))
			}
			opt.Value, _ = rd.str(o, "value", op)
			if n := utf8.RuneCountInString(opt.Value); n < 1 || n > modalMaxChoiceText {
				errs.add(fieldPath(op, "value"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", modalMaxChoiceText))
			}
			if values[opt.Value] {
				errs.add(fieldPath(op, "value"), "SELECT_COMPONENT_OPTION_VALUE_DUPLICATED", "Select component option values cannot be duplicated")
			}
			values[opt.Value] = true
			if d, ok := rd.str(o, "description", op); ok {
				opt.Description = clean(d)
				rd.maxLen(opt.Description, modalMaxChoiceText, fieldPath(op, "description"))
			}
			if withEmoji {
				if e, ok := rd.object(o, "emoji", op); ok {
					opt.Emoji = parseWMEmoji(rd, e, fieldPath(op, "emoji"))
				}
			}
			opt.Default, _ = rd.boolean(o, "default", op)
			f.Options = append(f.Options, opt)
		}
	}
	switch f.Type {
	case compTextInput:
		style, _ := rd.integer(obj, "style", path)
		if style != 1 && style != 2 {
			errs.add(fieldPath(path, "style"), "ENUM_TYPE_COERCE", fmt.Sprintf("Value \"%d\" is not a valid enum value.", style))
		}
		f.Style = int(style)
		f.MinLength = count("min_length", 0, modalMaxText)
		f.MaxLength = count("max_length", 1, modalMaxText)
		if f.MinLength != nil && f.MaxLength != nil && *f.MinLength > *f.MaxLength {
			errs.add(fieldPath(path, "min_length"), "TEXT_INPUT_MIN_MAX_INVALID", "The minimum length cannot be larger than the maximum length")
		}
		if v, ok := rd.str(obj, "value", path); ok {
			f.Value = v
			rd.maxLen(v, modalMaxText, fieldPath(path, "value"))
		}
		if v, ok := rd.str(obj, "placeholder", path); ok {
			f.Placeholder = clean(v)
			rd.maxLen(f.Placeholder, modalMaxPlaceholder, fieldPath(path, "placeholder"))
		}
	case compStringSel, compUserSel, compRoleSel, compMentionSel, compChannelSel:
		if v, ok := rd.str(obj, "placeholder", path); ok {
			f.Placeholder = clean(v)
			rd.maxLen(f.Placeholder, 150, fieldPath(path, "placeholder"))
		}
		f.MinValues = count("min_values", 0, modalMaxOptions)
		f.MaxValues = count("max_values", 1, modalMaxOptions)
		if f.Type == compStringSel {
			options(1, modalMaxOptions, true)
		} else {
			if list, ok := rd.list(obj, "default_values", path); ok {
				for i, v := range list {
					dp := fieldPath(path, "default_values", i)
					o, ok := v.(map[string]any)
					if !ok {
						continue
					}
					sid, _ := rd.str(o, "id", dp)
					id, err := parseBotID(sid)
					typ, _ := rd.str(o, "type", dp)
					if err != nil || (typ != "user" && typ != "role" && typ != "channel") {
						errs.add(dp, "SELECT_DEFAULT_VALUE_INVALID", "Invalid default value")
						continue
					}
					f.DefaultValues = append(f.DefaultValues, wmDefaultValue{ID: id, Type: typ})
				}
			}
			if f.Type == compChannelSel {
				if list, ok := rd.list(obj, "channel_types", path); ok {
					for _, v := range list {
						if n, ok := rd.integer(map[string]any{"v": v}, "v", nil); ok {
							f.ChannelTypes = append(f.ChannelTypes, int(n))
						}
					}
				}
			}
		}
	case compFileUpload:
		f.MinValues = count("min_values", 0, modalMaxFiles)
		f.MaxValues = count("max_values", 1, modalMaxFiles)
		if list, ok := rd.list(obj, "file_types", path); ok {
			for _, v := range list {
				if s, ok := v.(string); ok && len(s) <= 100 {
					f.FileTypes = append(f.FileTypes, strings.ToLower(s))
				}
			}
		}
	case compRadioGroup:
		options(2, 10, false)
	case compCheckboxGroup:
		options(1, 10, false)
		f.MinValues = count("min_values", 0, 10)
		f.MaxValues = count("max_values", 1, 10)
	case compCheckbox:
		f.Default, _ = rd.boolean(obj, "default", path)
		f.Required = false
	default:
		errs.add(fieldPath(path, "type"), "COMPONENT_TYPE_INVALID", "That component cannot be in a form.")
	}
	if f.MinValues != nil && f.MaxValues != nil && *f.MinValues > *f.MaxValues {
		errs.add(fieldPath(path, "min_values"), "SELECT_COMPONENT_MIN_MAX_INVALID", "The minimum cannot be larger than the maximum")
	}
	return f
}

// modalSubmission checks what someone filled into a form and builds the
// components the application is sent.
func (s *Server) modalSubmission(sc *interactionScene, m *modalDef, fields []interactField, res *dResolved) ([]map[string]any, error) {
	given := map[string]interactField{}
	for _, f := range fields {
		if _, dup := given[f.CustomID]; dup {
			return nil, E(http.StatusBadRequest, "bad_form", "A field was filled in twice.")
		}
		given[f.CustomID] = f
	}
	out := make([]map[string]any, 0, len(m.Components))
	for _, part := range m.Components {
		switch part.Type {
		case compTextDisplay:
			out = append(out, map[string]any{"type": compTextDisplay, "id": part.ID})
			continue
		}
		f := part.Field
		if f == nil {
			continue
		}
		got := given[f.CustomID]
		value, err := s.modalValue(sc, f, got, res)
		if err != nil {
			name := part.Label
			if name == "" {
				name = f.CustomID
			}
			return nil, E(http.StatusBadRequest, "bad_form", name+": "+err.Error())
		}
		value["type"], value["id"], value["custom_id"] = f.Type, f.ID, f.CustomID
		if part.Type == compActionRow {
			out = append(out, map[string]any{"type": compActionRow, "id": part.ID, "components": []any{value}})
		} else {
			out = append(out, map[string]any{"type": compLabel, "id": part.ID, "component": value})
		}
	}
	return out, nil
}

// modalValue checks one field's answer and gives the part of the component
// that carries it.
func (s *Server) modalValue(sc *interactionScene, f *modalField, got interactField, res *dResolved) (map[string]any, error) {
	ctx := sc.b.ctx
	countOK := func(n, defMin, defMax int) error {
		min, max := defMin, defMax
		if f.MinValues != nil {
			min = *f.MinValues
		}
		if f.MaxValues != nil {
			max = *f.MaxValues
		}
		if !f.Required && n == 0 {
			return nil
		}
		if n < min || n > max {
			return fmt.Errorf("pick between %d and %d", min, max)
		}
		return nil
	}
	switch f.Type {
	case compTextInput:
		v := ""
		if got.Value != nil {
			v = clean(*got.Value)
		}
		n := utf8.RuneCountInString(v)
		if n == 0 {
			if f.Required {
				return nil, fmt.Errorf("this field is required")
			}
			return map[string]any{"value": ""}, nil
		}
		min, max := 0, modalMaxText
		if f.MinLength != nil {
			min = *f.MinLength
		}
		if f.MaxLength != nil {
			max = *f.MaxLength
		}
		if n < min || n > max {
			return nil, fmt.Errorf("must be between %d and %d characters", min, max)
		}
		return map[string]any{"value": v}, nil
	case compStringSel, compCheckboxGroup:
		if err := countOK(len(got.Values), 1, 1); err != nil {
			if f.Type == compCheckboxGroup {
				if err := countOK(len(got.Values), 0, len(f.Options)); err != nil {
					return nil, err
				}
			} else {
				return nil, err
			}
		}
		seen := map[string]bool{}
		for _, v := range got.Values {
			if seen[v] || !optionHas(f.Options, v) {
				return nil, fmt.Errorf("that is not one of the choices")
			}
			seen[v] = true
		}
		return map[string]any{"values": nonNilStrings(got.Values)}, nil
	case compRadioGroup:
		if got.Value == nil || *got.Value == "" {
			if f.Required {
				return nil, fmt.Errorf("pick one")
			}
			return map[string]any{"value": nil}, nil
		}
		if !optionHas(f.Options, *got.Value) {
			return nil, fmt.Errorf("that is not one of the choices")
		}
		return map[string]any{"value": *got.Value}, nil
	case compCheckbox:
		checked := got.Checked != nil && *got.Checked
		return map[string]any{"value": checked}, nil
	case compUserSel, compRoleSel, compMentionSel, compChannelSel:
		if err := countOK(len(got.Values), 1, 1); err != nil {
			return nil, err
		}
		c := &wmComponent{Type: f.Type, ChannelTypes: f.ChannelTypes}
		zero, max := 0, len(got.Values)
		c.MinValues, c.MaxValues = &zero, &max
		values, err := s.selectValues(sc, c, got.Values, res)
		if err != nil {
			var ae *Error
			if errors.As(err, &ae) {
				return nil, fmt.Errorf("%s", strings.TrimSuffix(strings.ToLower(ae.Message[:1])+ae.Message[1:], "."))
			}
			return nil, err
		}
		return map[string]any{"values": nonNilStrings(values)}, nil
	case compFileUpload:
		if err := countOK(len(got.Values), 1, 1); err != nil {
			return nil, err
		}
		out := []string{}
		for _, v := range got.Values {
			id, err := ids.Parse(v)
			if err != nil {
				return nil, fmt.Errorf("that is not a file you sent")
			}
			fileRow, err := s.Store.InteractionFileByBlob(ctx, id)
			if err != nil || fileRow.UserID != sc.me.ID {
				return nil, fmt.Errorf("that is not a file you sent")
			}
			blob, err := s.Store.BlobByID(ctx, id)
			if err != nil {
				return nil, fmt.Errorf("that is not a file you sent")
			}
			if len(f.FileTypes) > 0 && !fileTypeAllowed(f.FileTypes, fileRow.Filename, blob.Mime) {
				return nil, fmt.Errorf("that kind of file is not taken here")
			}
			sc.resolveFile(res, blob)
			out = append(out, botproto.OutString(id))
		}
		return map[string]any{"values": out}, nil
	}
	return nil, fmt.Errorf("cannot be filled in")
}

func optionHas(list []wmSelectOption, v string) bool {
	for _, o := range list {
		if o.Value == v {
			return true
		}
	}
	return false
}

func nonNilStrings(list []string) []string {
	if list == nil {
		return []string{}
	}
	return list
}

// fileTypeAllowed reports whether a file matches a field's file types: an
// extension (".png"), a type ("image/png") or a family ("image/*").
func fileTypeAllowed(types []string, name, mime string) bool {
	lname, lmime := strings.ToLower(name), strings.ToLower(mime)
	for _, t := range types {
		switch {
		case strings.HasPrefix(t, "."):
			if strings.HasSuffix(lname, t) {
				return true
			}
		case strings.HasSuffix(t, "/*"):
			if strings.HasPrefix(lmime, strings.TrimSuffix(t, "*")) {
				return true
			}
		case t == lmime:
			return true
		}
	}
	return false
}
