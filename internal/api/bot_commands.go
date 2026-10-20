package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"evilion.xyz/chat/internal/botproto"
	"evilion.xyz/chat/internal/gateway"
	"evilion.xyz/chat/internal/ids"
	"evilion.xyz/chat/internal/perms"
	"evilion.xyz/chat/internal/store"
)

// Application commands: the slash commands an application offers in the
// message box, and the entries it adds to the menus of people and messages.
// A bot registers them over the bot API as the protocol defines them; they
// are kept as defined (store.Command.Data holds a commandDef) and checked by
// the same rules, so a library's own checks and the errors it expects line
// up. Who may use one in a server is the command's default_member_permissions
// and what the server's managers set on it (commandAllowed).

// Command types.
const (
	cmdChatInput  = 1
	cmdUser       = 2
	cmdMessage    = 3
	cmdEntryPoint = 4
)

// Option types.
const (
	optSubcommand  = 1
	optGroup       = 2
	optString      = 3
	optInteger     = 4
	optBoolean     = 5
	optUser        = 6
	optChannel     = 7
	optRole        = 8
	optMentionable = 9
	optNumber      = 10
	optAttachment  = 11
)

// Where a command may be used (contexts) and how its application must be
// installed for it (integration types).
const (
	ctxGuild   = 0
	ctxBotDM   = 1
	ctxPrivate = 2

	installGuild = 0
	installUser  = 1
)

// Limits the protocol sets on commands.
const (
	cmdMaxName        = 32
	cmdMaxDescription = 100
	cmdMaxOptions     = 25
	cmdMaxChoices     = 25
	cmdMaxChoiceName  = 100
	cmdMaxChoiceValue = 100
	cmdMaxStringLen   = 6000
	cmdMaxSize        = 8000
	cmdMaxSafeNumber  = 1 << 53
	cmdMaxPermEntries = 100
)

// reCommandName is what a slash command's and an option's name may be:
// letters, digits, - _ and ', lowercase where a letter has a lowercase.
var reCommandName = regexp.MustCompile(`^[-_'\p{L}\p{N}\p{Devanagari}\p{Thai}]{1,32}$`)

// discordLocales are the languages a command's names and descriptions can be
// given in, by the codes the protocol uses.
var discordLocales = map[string]bool{
	"id": true, "da": true, "de": true, "en-GB": true, "en-US": true, "es-ES": true, "es-419": true, "fr": true, "hr": true, "it": true,
	"lt": true, "hu": true, "nl": true, "no": true, "pl": true, "pt-BR": true, "ro": true, "fi": true, "sv-SE": true, "vi": true,
	"tr": true, "cs": true, "el": true, "bg": true, "ru": true, "uk": true, "hi": true, "th": true, "zh-CN": true, "ja": true,
	"zh-TW": true, "ko": true,
}

// commandChoice is one of the fixed answers an option offers.
type commandChoice struct {
	Name              string            `json:"name"`
	NameLocalizations map[string]string `json:"name_localizations,omitempty"`
	// Value is a string for a string option, a json.Number otherwise
	Value any `json:"value"`
}

// commandOption is an option of a slash command (or a subcommand, or a
// group of them).
type commandOption struct {
	Type                     int               `json:"type"`
	Name                     string            `json:"name"`
	NameLocalizations        map[string]string `json:"name_localizations,omitempty"`
	Description              string            `json:"description"`
	DescriptionLocalizations map[string]string `json:"description_localizations,omitempty"`
	Required                 bool              `json:"required,omitempty"`
	Choices                  []commandChoice   `json:"choices,omitempty"`
	Options                  []commandOption   `json:"options,omitempty"`
	ChannelTypes             []int             `json:"channel_types,omitempty"`
	MinValue                 *json.Number      `json:"min_value,omitempty"`
	MaxValue                 *json.Number      `json:"max_value,omitempty"`
	MinLength                *int              `json:"min_length,omitempty"`
	MaxLength                *int              `json:"max_length,omitempty"`
	Autocomplete             bool              `json:"autocomplete,omitempty"`
}

// commandDef is a command as its application defined it, checked: what
// store.Command.Data holds.
type commandDef struct {
	Type                     int               `json:"type"`
	Name                     string            `json:"name"`
	NameLocalizations        map[string]string `json:"name_localizations,omitempty"`
	Description              string            `json:"description"`
	DescriptionLocalizations map[string]string `json:"description_localizations,omitempty"`
	Options                  []commandOption   `json:"options,omitempty"`
	// DefaultMemberPermissions are what someone must hold to see it in a
	// server unless its managers say otherwise; nil is everyone, "0" nobody
	// but administrators
	DefaultMemberPermissions *string `json:"default_member_permissions"`
	NSFW                     bool    `json:"nsfw,omitempty"`
	// IntegrationTypes and Contexts, empty or nil for the defaults
	IntegrationTypes []int  `json:"integration_types,omitempty"`
	Contexts         *[]int `json:"contexts,omitempty"`
}

// readCommandDef reads a command's stored definition.
func readCommandDef(c *store.Command) *commandDef {
	var d commandDef
	if err := json.Unmarshal(c.Data, &d); err != nil {
		d = commandDef{}
	}
	d.Type, d.Name = c.Type, c.Name
	return &d
}

// integrationTypesOf are the installs a global command is offered through:
// those it names, or the application's own.
func integrationTypesOf(d *commandDef, app *store.Application) []int {
	if len(d.IntegrationTypes) > 0 {
		return d.IntegrationTypes
	}
	return appIntegrationTypes(app)
}

// appIntegrationTypes are the installs an application offers.
func appIntegrationTypes(app *store.Application) []int {
	out := []int{}
	for k := range app.IntegrationTypes {
		if n, err := strconv.Atoi(k); err == nil && (n == installGuild || n == installUser) {
			out = append(out, n)
		}
	}
	sort.Ints(out)
	if len(out) == 0 {
		out = []int{installGuild}
	}
	return out
}

// contextsOf are where a command may be used: those it names, or anywhere.
func contextsOf(d *commandDef) []int {
	if d.Contexts != nil {
		return *d.Contexts
	}
	return []int{ctxGuild, ctxBotDM, ctxPrivate}
}

func hasInt(list []int, v int) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// --- reading a definition -----------------------------------------------------------

// commandReader reads command definitions loosely, as the protocol does, and
// records what is wrong in the protocol's error shape.
type commandReader struct {
	jsonReader
}

func (r commandReader) localizations(obj map[string]any, key string, path []string, max int, name bool) map[string]string {
	m, ok := r.object(obj, key, path)
	if !ok || len(m) == 0 {
		return nil
	}
	out := map[string]string{}
	for loc, v := range m {
		p := fieldPath(path, key, loc)
		if !discordLocales[loc] {
			r.errs.add(p, "ENUM_TYPE_COERCE", fmt.Sprintf("Value \"%s\" is not a valid enum value.", truncate(loc, 20)))
			continue
		}
		if v == nil {
			continue
		}
		s, ok := v.(string)
		if !ok {
			r.errs.add(p, "STRING_TYPE_CONVERT", "Could not interpret the value as string.")
			continue
		}
		if n := utf8.RuneCountInString(s); n < 1 || n > max {
			r.errs.add(p, "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", max))
			continue
		}
		if name && !validOptionName(s) {
			r.errs.add(p, "APPLICATION_COMMAND_INVALID_NAME", "Command name is invalid")
			continue
		}
		out[loc] = s
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// validOptionName is a slash command's (or an option's) name rule.
func validOptionName(s string) bool {
	return reCommandName.MatchString(s) && strings.ToLower(s) == s
}

// number reads a number field as the protocol takes one: within ±2^53, and
// whole for an integer option.
func (r commandReader) number(obj map[string]any, key string, path []string, integer bool) *json.Number {
	v, ok := obj[key]
	if !ok || v == nil {
		return nil
	}
	var s string
	switch x := v.(type) {
	case json.Number:
		s = x.String()
	case string:
		s = strings.TrimSpace(x)
	case float64:
		s = strconv.FormatFloat(x, 'f', -1, 64)
	default:
		r.errs.add(fieldPath(path, key), "NUMBER_TYPE_COERCE", "Value is not a number.")
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		r.errs.add(fieldPath(path, key), "NUMBER_TYPE_COERCE", fmt.Sprintf("Value \"%s\" is not a number.", truncate(s, 40)))
		return nil
	}
	if integer && f != math.Trunc(f) {
		r.errs.add(fieldPath(path, key), "NUMBER_TYPE_COERCE", fmt.Sprintf("Value \"%s\" is not int.", truncate(s, 40)))
		return nil
	}
	if math.Abs(f) > cmdMaxSafeNumber {
		r.errs.add(fieldPath(path, key), "NUMBER_TYPE_MAX", fmt.Sprintf("int value should be less than or equal to %d.", int64(cmdMaxSafeNumber)))
		return nil
	}
	n := json.Number(s)
	if integer {
		n = json.Number(strconv.FormatInt(int64(f), 10))
	}
	return &n
}

// parseCommandDef reads a command a bot sends (to create it, or with base set
// to change it, where what is left out stays as it was).
func parseCommandDef(raw map[string]any, path []string, errs *formErrors, base *commandDef) *commandDef {
	r := commandReader{jsonReader{errs}}
	d := &commandDef{Type: cmdChatInput}
	if base != nil {
		cp := *base
		d = &cp
	}
	if t, ok := r.integer(raw, "type", path); ok {
		if base != nil && int(t) != base.Type {
			errs.add(fieldPath(path, "type"), "APPLICATION_COMMAND_TYPE_IMMUTABLE", "A command's type cannot change.")
		}
		switch t {
		case cmdChatInput, cmdUser, cmdMessage:
			d.Type = int(t)
		case cmdEntryPoint:
			errs.add(fieldPath(path, "type"), "APPLICATION_COMMAND_ENTRY_POINT_UNSUPPORTED", "Activities are not available on this server.")
		default:
			errs.add(fieldPath(path, "type"), "ENUM_TYPE_COERCE", fmt.Sprintf("Value \"%d\" is not a valid enum value.", t))
		}
	}
	if name, ok := r.str(raw, "name", path); ok {
		d.Name = name
	} else if base == nil {
		errs.add(fieldPath(path, "name"), "BASE_TYPE_REQUIRED", "This field is required")
	}
	if n := utf8.RuneCountInString(d.Name); n < 1 || n > cmdMaxName {
		if base == nil || raw["name"] != nil {
			errs.add(fieldPath(path, "name"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", cmdMaxName))
		}
	} else if d.Type == cmdChatInput && !validOptionName(d.Name) {
		errs.add(fieldPath(path, "name"), "APPLICATION_COMMAND_INVALID_NAME", "Command name is invalid")
	} else if d.Type != cmdChatInput && strings.TrimSpace(d.Name) != d.Name {
		errs.add(fieldPath(path, "name"), "APPLICATION_COMMAND_INVALID_NAME", "Command name is invalid")
	}
	if _, ok := raw["name_localizations"]; ok {
		d.NameLocalizations = r.localizations(raw, "name_localizations", path, cmdMaxName, d.Type == cmdChatInput)
	}
	if d.Type == cmdChatInput {
		if desc, ok := r.str(raw, "description", path); ok {
			d.Description = desc
		} else if base == nil {
			errs.add(fieldPath(path, "description"), "BASE_TYPE_REQUIRED", "This field is required")
		}
		if n := utf8.RuneCountInString(d.Description); (n < 1 || n > cmdMaxDescription) && (base == nil || raw["description"] != nil) {
			errs.add(fieldPath(path, "description"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", cmdMaxDescription))
		}
		if _, ok := raw["description_localizations"]; ok {
			d.DescriptionLocalizations = r.localizations(raw, "description_localizations", path, cmdMaxDescription, false)
		}
		if list, ok := r.list(raw, "options", path); ok {
			d.Options = r.options(list, fieldPath(path, "options"), 0)
		} else if _, present := raw["options"]; present {
			d.Options = nil
		}
	} else {
		// a menu entry has no description and no options
		d.Description, d.DescriptionLocalizations, d.Options = "", nil, nil
	}
	if v, present := raw["default_member_permissions"]; present {
		if v == nil {
			d.DefaultMemberPermissions = nil
		} else if s, ok := r.str(raw, "default_member_permissions", path); ok {
			p, err := strconv.ParseUint(strings.TrimSpace(s), 10, 64)
			if err != nil {
				errs.add(fieldPath(path, "default_member_permissions"), "NUMBER_TYPE_COERCE", fmt.Sprintf("Value \"%s\" is not snowflake.", truncate(s, 40)))
			} else {
				v := strconv.FormatUint(p&uint64(perms.All|perms.UseApplicationCommands|perms.UseExternalApps), 10)
				if p == 0 {
					v = "0"
				}
				d.DefaultMemberPermissions = &v
			}
		}
	} else if dp, ok := r.boolean(raw, "default_permission", path); ok && !dp {
		// the old way of saying only administrators
		zero := "0"
		d.DefaultMemberPermissions = &zero
	}
	if b, ok := r.boolean(raw, "nsfw", path); ok {
		d.NSFW = b
	}
	if list, ok := r.list(raw, "integration_types", path); ok {
		d.IntegrationTypes = r.enumList(list, fieldPath(path, "integration_types"), installGuild, installUser)
	}
	if v, present := raw["contexts"]; present {
		if v == nil {
			d.Contexts = nil
		} else if list, ok := r.list(raw, "contexts", path); ok {
			c := r.enumList(list, fieldPath(path, "contexts"), ctxGuild, ctxPrivate)
			d.Contexts = &c
		}
	} else if dm, ok := r.boolean(raw, "dm_permission", path); ok && !dm && (base == nil || base.Contexts == nil) {
		// the old way of saying servers only
		c := []int{ctxGuild}
		d.Contexts = &c
	}
	if d.size() > cmdMaxSize {
		errs.add(path, "APPLICATION_COMMAND_TOO_LARGE", fmt.Sprintf("Command exceeds maximum size (%d)", cmdMaxSize))
	}
	return d
}

// enumList reads a list of small numbers between lo and hi, without repeats.
func (r commandReader) enumList(list []any, path []string, lo, hi int) []int {
	out := []int{}
	for i, v := range list {
		n, ok := r.integer(map[string]any{"v": v}, "v", nil)
		if !ok || n < int64(lo) || n > int64(hi) {
			r.errs.add(fieldPath(path, i), "ENUM_TYPE_COERCE", fmt.Sprintf("Value \"%v\" is not a valid enum value.", v))
			continue
		}
		if !hasInt(out, int(n)) {
			out = append(out, int(n))
		}
	}
	sort.Ints(out)
	return out
}

// options reads a level of options: depth 0 is the command's own, 1 a
// subcommand's or a group's, 2 a grouped subcommand's.
func (r commandReader) options(list []any, path []string, depth int) []commandOption {
	if len(list) > cmdMaxOptions {
		r.errs.add(path, "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("Must be %d or fewer in length.", cmdMaxOptions))
		list = list[:cmdMaxOptions]
	}
	out := make([]commandOption, 0, len(list))
	names := map[string]bool{}
	seenOptional := false
	nested, basic := 0, 0
	for i, v := range list {
		p := fieldPath(path, i)
		obj, ok := v.(map[string]any)
		if !ok {
			r.errs.add(p, "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
			continue
		}
		o := r.option(obj, p, depth)
		if o == nil {
			continue
		}
		if names[o.Name] {
			r.errs.add(fieldPath(p, "name"), "APPLICATION_COMMAND_OPTIONS_NAME_ALREADY_EXISTS", "Option names must be unique")
		}
		names[o.Name] = true
		if o.Type == optSubcommand || o.Type == optGroup {
			nested++
		} else {
			basic++
			if o.Required && seenOptional {
				r.errs.add(fieldPath(p, "required"), "APPLICATION_COMMAND_OPTIONS_REQUIRED_INVALID", "Required options must be placed before non-required options")
			}
			if !o.Required {
				seenOptional = true
			}
		}
		out = append(out, *o)
	}
	if nested > 0 && basic > 0 {
		r.errs.add(path, "APPLICATION_COMMAND_OPTIONS_TYPE_INVALID", "Sub-command and sub-command group option types are mutually exclusive to all other types")
	}
	return out
}

// option reads one option.
func (r commandReader) option(obj map[string]any, path []string, depth int) *commandOption {
	t, ok := r.integer(obj, "type", path)
	if !ok {
		if _, present := obj["type"]; !present {
			r.errs.add(fieldPath(path, "type"), "BASE_TYPE_REQUIRED", "This field is required")
		}
		return nil
	}
	if t < optSubcommand || t > optAttachment {
		r.errs.add(fieldPath(path, "type"), "ENUM_TYPE_COERCE", fmt.Sprintf("Value \"%d\" is not a valid enum value.", t))
		return nil
	}
	o := &commandOption{Type: int(t)}
	// where each kind may sit: a group only on the command, a subcommand on
	// the command or in a group, the rest under a subcommand or the command
	switch {
	case o.Type == optGroup && depth != 0, o.Type == optSubcommand && depth > 1:
		r.errs.add(fieldPath(path, "type"), "APPLICATION_COMMAND_OPTIONS_TYPE_INVALID", "This option type cannot be nested this deep")
		return nil
	case o.Type != optSubcommand && o.Type != optGroup && depth == 1 && !r.underSubcommand(path):
		r.errs.add(fieldPath(path, "type"), "APPLICATION_COMMAND_OPTIONS_TYPE_INVALID", "A sub-command group may only contain sub-commands")
		return nil
	}
	o.Name, _ = r.str(obj, "name", path)
	if n := utf8.RuneCountInString(o.Name); n < 1 || n > cmdMaxName {
		r.errs.add(fieldPath(path, "name"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", cmdMaxName))
	} else if !validOptionName(o.Name) {
		r.errs.add(fieldPath(path, "name"), "APPLICATION_COMMAND_INVALID_NAME", "Command name is invalid")
	}
	o.NameLocalizations = r.localizations(obj, "name_localizations", path, cmdMaxName, true)
	o.Description, _ = r.str(obj, "description", path)
	if n := utf8.RuneCountInString(o.Description); n < 1 || n > cmdMaxDescription {
		r.errs.add(fieldPath(path, "description"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", cmdMaxDescription))
	}
	o.DescriptionLocalizations = r.localizations(obj, "description_localizations", path, cmdMaxDescription, false)
	switch o.Type {
	case optSubcommand, optGroup:
		if list, ok := r.list(obj, "options", path); ok {
			o.Options = r.options(list, fieldPath(path, "options"), depth+1)
			for i, sub := range o.Options {
				if o.Type == optGroup && sub.Type != optSubcommand {
					r.errs.add(fieldPath(path, "options", i, "type"), "APPLICATION_COMMAND_OPTIONS_TYPE_INVALID", "A sub-command group may only contain sub-commands")
				}
				if o.Type == optSubcommand && (sub.Type == optSubcommand || sub.Type == optGroup) {
					r.errs.add(fieldPath(path, "options", i, "type"), "APPLICATION_COMMAND_OPTIONS_TYPE_INVALID", "A sub-command cannot contain sub-commands")
				}
			}
		}
		return o
	}
	o.Required, _ = r.boolean(obj, "required", path)
	o.Autocomplete, _ = r.boolean(obj, "autocomplete", path)
	if o.Autocomplete && o.Type != optString && o.Type != optInteger && o.Type != optNumber {
		r.errs.add(fieldPath(path, "autocomplete"), "APPLICATION_COMMAND_OPTION_AUTOCOMPLETE_INVALID", "Autocomplete is only for string, integer and number options")
		o.Autocomplete = false
	}
	if list, ok := r.list(obj, "choices", path); ok && len(list) > 0 {
		switch o.Type {
		case optString, optInteger, optNumber:
		default:
			r.errs.add(fieldPath(path, "choices"), "APPLICATION_COMMAND_OPTION_CHOICES_INVALID", "Choices are only for string, integer and number options")
			list = nil
		}
		if o.Autocomplete && len(list) > 0 {
			r.errs.add(fieldPath(path, "choices"), "APPLICATION_COMMAND_OPTION_CHOICES_AUTOCOMPLETE", "Autocomplete cannot be used with choices")
		}
		if len(list) > cmdMaxChoices {
			r.errs.add(fieldPath(path, "choices"), "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("Must be %d or fewer in length.", cmdMaxChoices))
			list = list[:cmdMaxChoices]
		}
		for i, v := range list {
			cp := fieldPath(path, "choices", i)
			cobj, ok := v.(map[string]any)
			if !ok {
				r.errs.add(cp, "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
				continue
			}
			if c := r.choice(cobj, cp, o.Type); c != nil {
				o.Choices = append(o.Choices, *c)
			}
		}
	}
	if o.Type == optChannel {
		if list, ok := r.list(obj, "channel_types", path); ok {
			for i, v := range list {
				n, ok := r.integer(map[string]any{"v": v}, "v", nil)
				if !ok || n < 0 || n > 16 {
					r.errs.add(fieldPath(path, "channel_types", i), "ENUM_TYPE_COERCE", fmt.Sprintf("Value \"%v\" is not a valid enum value.", v))
					continue
				}
				if !hasInt(o.ChannelTypes, int(n)) {
					o.ChannelTypes = append(o.ChannelTypes, int(n))
				}
			}
		}
	}
	if o.Type == optInteger || o.Type == optNumber {
		o.MinValue = r.number(obj, "min_value", path, o.Type == optInteger)
		o.MaxValue = r.number(obj, "max_value", path, o.Type == optInteger)
		if o.MinValue != nil && o.MaxValue != nil {
			lo, _ := o.MinValue.Float64()
			hi, _ := o.MaxValue.Float64()
			if lo > hi {
				r.errs.add(fieldPath(path, "min_value"), "APPLICATION_COMMAND_OPTION_MIN_MAX_INVALID", "The minimum value cannot be larger than the maximum value")
			}
		}
	}
	if o.Type == optString {
		if v, ok := r.integer(obj, "min_length", path); ok {
			if v < 0 || v > cmdMaxStringLen {
				r.errs.add(fieldPath(path, "min_length"), "NUMBER_TYPE_MAX", fmt.Sprintf("int value should be between 0 and %d.", cmdMaxStringLen))
			} else {
				n := int(v)
				o.MinLength = &n
			}
		}
		if v, ok := r.integer(obj, "max_length", path); ok {
			if v < 1 || v > cmdMaxStringLen {
				r.errs.add(fieldPath(path, "max_length"), "NUMBER_TYPE_MAX", fmt.Sprintf("int value should be between 1 and %d.", cmdMaxStringLen))
			} else {
				n := int(v)
				o.MaxLength = &n
			}
		}
		if o.MinLength != nil && o.MaxLength != nil && *o.MinLength > *o.MaxLength {
			r.errs.add(fieldPath(path, "min_length"), "APPLICATION_COMMAND_OPTION_MIN_MAX_INVALID", "The minimum length cannot be larger than the maximum length")
		}
	}
	return o
}

// underSubcommand reports whether an option at depth 1 sits under a
// subcommand (and not a group): its path ends options.N.options.M.
func (r commandReader) underSubcommand(path []string) bool {
	return len(path) >= 4 && path[len(path)-2] == "options"
}

// choice reads one choice of an option of type t.
func (r commandReader) choice(obj map[string]any, path []string, t int) *commandChoice {
	c := &commandChoice{}
	c.Name, _ = r.str(obj, "name", path)
	if n := utf8.RuneCountInString(c.Name); n < 1 || n > cmdMaxChoiceName {
		r.errs.add(fieldPath(path, "name"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", cmdMaxChoiceName))
	}
	c.NameLocalizations = r.localizations(obj, "name_localizations", path, cmdMaxChoiceName, false)
	switch t {
	case optString:
		s, ok := r.str(obj, "value", path)
		if !ok {
			r.errs.add(fieldPath(path, "value"), "BASE_TYPE_REQUIRED", "This field is required")
			return nil
		}
		if n := utf8.RuneCountInString(s); n < 1 || n > cmdMaxChoiceValue {
			r.errs.add(fieldPath(path, "value"), "BASE_TYPE_BAD_LENGTH", fmt.Sprintf("Must be between 1 and %d in length.", cmdMaxChoiceValue))
		}
		c.Value = s
	default:
		n := r.number(obj, "value", path, t == optInteger)
		if n == nil {
			if _, present := obj["value"]; !present {
				r.errs.add(fieldPath(path, "value"), "BASE_TYPE_REQUIRED", "This field is required")
			}
			return nil
		}
		c.Value = *n
	}
	return c
}

// size is what the protocol counts against a command's size: the names,
// descriptions and choice values of it and all of its options.
func (d *commandDef) size() int {
	n := utf8.RuneCountInString(d.Name) + utf8.RuneCountInString(d.Description)
	var walk func(list []commandOption)
	walk = func(list []commandOption) {
		for _, o := range list {
			n += utf8.RuneCountInString(o.Name) + utf8.RuneCountInString(o.Description)
			for _, c := range o.Choices {
				n += utf8.RuneCountInString(c.Name) + utf8.RuneCountInString(fmt.Sprint(c.Value))
			}
			walk(o.Options)
		}
	}
	walk(d.Options)
	return n
}

// --- objects ----------------------------------------------------------------------

type dCommand struct {
	ID                       snow              `json:"id"`
	Type                     int               `json:"type"`
	ApplicationID            snow              `json:"application_id"`
	GuildID                  *snow             `json:"guild_id,omitempty"`
	Name                     string            `json:"name"`
	NameLocalizations        map[string]string `json:"name_localizations"`
	Description              string            `json:"description"`
	DescriptionLocalizations map[string]string `json:"description_localizations"`
	Options                  []commandOption   `json:"options,omitempty"`
	DefaultMemberPermissions *string           `json:"default_member_permissions"`
	DMPermission             bool              `json:"dm_permission"`
	DefaultPermission        bool              `json:"default_permission"`
	NSFW                     bool              `json:"nsfw"`
	IntegrationTypes         []int             `json:"integration_types"`
	Contexts                 []int             `json:"contexts"`
	Version                  snow              `json:"version"`
}

func commandObj(c *store.Command, app *store.Application) dCommand {
	d := readCommandDef(c)
	out := dCommand{ID: snow(c.ID), Type: c.Type, ApplicationID: snow(c.ApplicationID), GuildID: botproto.SP(c.GuildID), Name: c.Name,
		NameLocalizations: d.NameLocalizations, Description: d.Description, DescriptionLocalizations: d.DescriptionLocalizations, Options: d.Options,
		DefaultMemberPermissions: d.DefaultMemberPermissions, DefaultPermission: true, NSFW: d.NSFW, Version: snow(c.Version)}
	if c.GuildID == nil {
		out.IntegrationTypes = integrationTypesOf(d, app)
		out.Contexts = contextsOf(d)
	} else {
		out.IntegrationTypes = []int{installGuild}
		out.Contexts = nil
	}
	out.DMPermission = c.GuildID == nil && (hasInt(contextsOf(d), ctxBotDM) || hasInt(contextsOf(d), ctxPrivate))
	return out
}

// commandPermission is one entry of who may use a command in a server: a
// role, a member, or a channel (ids as Nexa writes them).
type commandPermission struct {
	ID         ids.ID `json:"id"`
	Type       int    `json:"type"`
	Permission bool   `json:"permission"`
}

const (
	cmdPermRole    = 1
	cmdPermUser    = 2
	cmdPermChannel = 3
)

type dCommandPermission struct {
	ID         snow `json:"id"`
	Type       int  `json:"type"`
	Permission bool `json:"permission"`
}

type dCommandPermissions struct {
	ID            snow                 `json:"id"`
	ApplicationID snow                 `json:"application_id"`
	GuildID       snow                 `json:"guild_id"`
	Permissions   []dCommandPermission `json:"permissions"`
}

func readCommandPermissions(raw json.RawMessage) []commandPermission {
	var list []commandPermission
	_ = json.Unmarshal(raw, &list)
	return list
}

func commandPermissionsObj(p *store.CommandPermissions) dCommandPermissions {
	out := dCommandPermissions{ID: snow(p.CommandID), ApplicationID: snow(p.ApplicationID), GuildID: snow(p.GuildID), Permissions: []dCommandPermission{}}
	for _, e := range readCommandPermissions(p.Permissions) {
		out.Permissions = append(out.Permissions, dCommandPermission{ID: snow(e.ID), Type: e.Type, Permission: e.Permission})
	}
	return out
}

// allChannelsID is the id that, in a command's permissions, stands for every
// channel of a server: one less than the server's.
func allChannelsID(guild ids.ID) ids.ID { return guild - 1 }

// --- who may use a command ----------------------------------------------------------------

// commandAccess is what deciding whether someone may use an application's
// commands in a server channel needs, read once per request.
type commandAccess struct {
	guild    ids.ID
	channel  ids.ID
	parent   ids.ID // a thread's parent, whose permissions it follows
	uid      ids.ID
	roles    []ids.ID
	perms    perms.Perm
	sets     map[ids.ID][]commandPermission
	appWide  []commandPermission
	appID    ids.ID
	isAdmin  bool
	loadedOK bool
}

// newCommandAccess reads someone's standing in a server channel and the
// permissions an application's commands have there.
func (s *Server) newCommandAccess(ctx context.Context, app ids.ID, ch *store.Channel, uid ids.ID) *commandAccess {
	a := &commandAccess{guild: *ch.ServerID, channel: ch.ID, parent: ch.ID, uid: uid, appID: app, sets: map[ids.ID][]commandPermission{}}
	if store.IsThread(ch.Type) && ch.ParentID != nil {
		a.parent = *ch.ParentID
	}
	p, err := s.Store.PermsIn(ctx, ch, uid)
	if err != nil {
		return a
	}
	a.perms = p
	a.isAdmin = p.Has(perms.Administrator)
	if m, err := s.Store.Member(ctx, *ch.ServerID, uid); err == nil {
		a.roles = m.RoleIDs
	}
	if list, err := s.Store.CommandPermissionsIn(ctx, app, *ch.ServerID); err == nil {
		for _, set := range list {
			entries := readCommandPermissions(set.Permissions)
			if set.CommandID == app {
				a.appWide = entries
			} else {
				a.sets[set.CommandID] = entries
			}
		}
	}
	a.loadedOK = true
	return a
}

// decideChannel and decideMember read one level of permissions (a
// command's, or the whole application's) the way the protocol does: the
// channel first, then the member, then their roles (any allowed role
// allows), then @everyone. Each returns whether that level says yes or no,
// and whether it said anything.
func (a *commandAccess) decideChannel(entries []commandPermission) (allow, said bool) {
	for _, e := range entries {
		if e.Type == cmdPermChannel && (e.ID == a.channel || e.ID == a.parent) {
			return e.Permission, true
		}
	}
	for _, e := range entries {
		if e.Type == cmdPermChannel && e.ID == allChannelsID(a.guild) {
			return e.Permission, true
		}
	}
	return false, false
}

func (a *commandAccess) decideMember(entries []commandPermission) (allow, said bool) {
	for _, e := range entries {
		if e.Type == cmdPermUser && e.ID == a.uid {
			return e.Permission, true
		}
	}
	anyRole, anyAllowed := false, false
	for _, e := range entries {
		if e.Type == cmdPermRole && e.ID != a.guild && hasID(a.roles, e.ID) {
			anyRole = true
			if e.Permission {
				anyAllowed = true
			}
		}
	}
	if anyRole {
		return anyAllowed, true
	}
	for _, e := range entries {
		if e.Type == cmdPermRole && e.ID == a.guild {
			return e.Permission, true
		}
	}
	return false, false
}

// allows reports whether the member may use a command (nil for the
// application as a whole) of a guild install here.
func (a *commandAccess) allows(c *store.Command, d *commandDef) bool {
	if !a.loadedOK || !a.perms.Has(perms.ViewChannel) {
		return false
	}
	if !a.perms.Has(perms.UseApplicationCommands) {
		return false
	}
	var cmdEntries []commandPermission
	if c != nil {
		cmdEntries = a.sets[c.ID]
	}
	// channels: the command's own say, then the application's
	if allow, said := a.decideChannel(cmdEntries); said {
		if !allow && !a.isAdmin {
			return false
		}
	} else if allow, said := a.decideChannel(a.appWide); said && !allow && !a.isAdmin {
		return false
	}
	// administrators may use every command they can see
	if a.isAdmin {
		return true
	}
	if allow, said := a.decideMember(cmdEntries); said {
		return allow
	}
	if allow, said := a.decideMember(a.appWide); said {
		return allow
	}
	if d != nil && d.DefaultMemberPermissions != nil {
		need, err := strconv.ParseUint(*d.DefaultMemberPermissions, 10, 64)
		if err != nil {
			return false
		}
		if need == 0 {
			return false
		}
		return a.perms.Has(perms.Perm(need))
	}
	return true
}

// --- routes -------------------------------------------------------------------------

func (s *Server) botCommandRoutes(mux *http.ServeMux) {
	for _, base := range []string{"/applications/{app}/commands", "/applications/{app}/guilds/{guild}/commands"} {
		s.botHandle(mux, "GET", base, authBotOrBearer, s.botCommandsList, scoped("applications.commands.update"), bucketed("read"))
		s.botHandle(mux, "POST", base, authBotOrBearer, s.botCommandCreate, scoped("applications.commands.update"), bucketed("command"))
		s.botHandle(mux, "PUT", base, authBotOrBearer, s.botCommandsOverwrite, scoped("applications.commands.update"), bucketed("command"))
		s.botHandle(mux, "GET", base+"/{command}", authBotOrBearer, s.botCommandGet, scoped("applications.commands.update"), bucketed("read"))
		s.botHandle(mux, "PATCH", base+"/{command}", authBotOrBearer, s.botCommandEdit, scoped("applications.commands.update"), bucketed("command"))
		s.botHandle(mux, "DELETE", base+"/{command}", authBotOrBearer, s.botCommandDelete, scoped("applications.commands.update"), bucketed("command"))
	}
	s.botHandle(mux, "GET", "/applications/{app}/guilds/{guild}/commands/permissions", authBotOrBearer, s.botCommandPermsList, bucketed("read"))
	s.botHandle(mux, "GET", "/applications/{app}/guilds/{guild}/commands/{command}/permissions", authBotOrBearer, s.botCommandPermsGet, bucketed("read"))
	s.botHandle(mux, "PUT", "/applications/{app}/guilds/{guild}/commands/{command}/permissions", authBearer, s.botCommandPermsPut, scoped("applications.commands.permissions.update"), bucketed("command"))
	s.botHandle(mux, "PUT", "/applications/{app}/guilds/{guild}/commands/permissions", authBotOrBearer, func(w http.ResponseWriter, r *http.Request) {
		writeBotError(w, dErrMethod, nil)
	})
}

// commandsTarget reads the application and, for a server's commands, the
// server a command route names, checking the caller is that application and
// that it is installed there.
func (s *Server) commandsTarget(w http.ResponseWriter, r *http.Request) (*store.Application, *ids.ID, bool) {
	b := botOf(r)
	appID, ok := pathID(r, "app")
	if !ok || appID != b.app.ID {
		writeBotError(w, dErrMissingAccess, nil)
		return nil, nil, false
	}
	if r.PathValue("guild") == "" {
		return b.app, nil, true
	}
	gid, ok := pathID(r, "guild")
	if !ok {
		writeBotError(w, dErrUnknownGuild, nil)
		return nil, nil, false
	}
	if _, err := s.Store.GuildInstall(r.Context(), b.app.ID, gid); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeBotError(w, dErrMissingAccess, nil)
		} else {
			writeBotError(w, err, nil)
		}
		return nil, nil, false
	}
	return b.app, &gid, true
}

// readBotJSON reads a bot's JSON body loosely (numbers kept as written).
func readBotJSON(w http.ResponseWriter, r *http.Request, max int64) (any, *dError) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, max))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, dErrTooLarge
		}
		if errors.Is(err, io.EOF) {
			return map[string]any{}, nil
		}
		return nil, dErrBadJSON
	}
	return v, nil
}

// readBotObject is readBotJSON for a body that must be an object.
func readBotObject(w http.ResponseWriter, r *http.Request, max int64) (map[string]any, *dError) {
	v, derr := readBotJSON(w, r, max)
	if derr != nil {
		return nil, derr
	}
	if v == nil {
		return map[string]any{}, nil
	}
	obj, ok := v.(map[string]any)
	if !ok {
		f := &formErrors{}
		f.add(nil, "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
		return nil, f.err()
	}
	return obj, nil
}

func (s *Server) botCommandsList(w http.ResponseWriter, r *http.Request) {
	app, guild, ok := s.commandsTarget(w, r)
	if !ok {
		return
	}
	list, err := s.Store.Commands(r.Context(), app.ID, guild)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	withLoc := boolQuery(r, "with_localizations", false)
	out := make([]dCommand, 0, len(list))
	for _, c := range list {
		o := commandObj(c, app)
		if !withLoc {
			o.NameLocalizations, o.DescriptionLocalizations = nil, nil
		}
		out = append(out, o)
	}
	WriteJSON(w, http.StatusOK, out)
}

// storedCommand turns a checked definition into the row that keeps it.
func storedCommand(app ids.ID, guild *ids.ID, d *commandDef) (*store.Command, error) {
	data, err := json.Marshal(d)
	if err != nil {
		return nil, err
	}
	return &store.Command{ApplicationID: app, GuildID: guild, Type: d.Type, Name: d.Name, Data: data}, nil
}

func (s *Server) botCommandCreate(w http.ResponseWriter, r *http.Request) {
	app, guild, ok := s.commandsTarget(w, r)
	if !ok {
		return
	}
	raw, derr := readBotObject(w, r, 256<<10)
	if derr != nil {
		writeBotError(w, derr, nil)
		return
	}
	errs := &formErrors{}
	d := parseCommandDef(raw, nil, errs, nil)
	if !errs.empty() {
		writeBotError(w, errs.err(), nil)
		return
	}
	c, err := storedCommand(app.ID, guild, d)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	created, err := s.Store.PutCommand(r.Context(), c)
	if errors.Is(err, store.ErrTooMany) {
		writeBotError(w, dErr(http.StatusBadRequest, 30032, "Maximum number of application commands reached"), nil)
		return
	}
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	s.commandsChanged(r.Context(), app.ID, guild)
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	WriteJSON(w, status, commandObj(c, app))
}

func (s *Server) botCommandsOverwrite(w http.ResponseWriter, r *http.Request) {
	app, guild, ok := s.commandsTarget(w, r)
	if !ok {
		return
	}
	v, derr := readBotJSON(w, r, 4<<20)
	if derr != nil {
		writeBotError(w, derr, nil)
		return
	}
	list, ok := v.([]any)
	if !ok {
		f := &formErrors{}
		f.add(nil, "LIST_TYPE_CONVERT", "Only iterables may be used in a ListType")
		writeBotError(w, f.err(), nil)
		return
	}
	errs := &formErrors{}
	if len(list) > store.MaxSlashCommands+2*store.MaxContextCommands {
		errs.add(nil, "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("Must be %d or fewer in length.", store.MaxSlashCommands+2*store.MaxContextCommands))
		writeBotError(w, errs.err(), nil)
		return
	}
	counts := map[int]int{}
	seen := map[string]bool{}
	rows := make([]*store.Command, 0, len(list))
	for i, item := range list {
		obj, ok := item.(map[string]any)
		if !ok {
			errs.add(fieldPath(i), "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
			continue
		}
		d := parseCommandDef(obj, fieldPath(i), errs, nil)
		key := strconv.Itoa(d.Type) + ":" + d.Name
		if seen[key] {
			errs.add(fieldPath(i, "name"), "APPLICATION_COMMANDS_DUPLICATE_NAME", "Application command names must be unique")
		}
		seen[key] = true
		counts[d.Type]++
		c, err := storedCommand(app.ID, guild, d)
		if err != nil {
			writeBotError(w, err, nil)
			return
		}
		rows = append(rows, c)
	}
	if counts[cmdChatInput] > store.MaxSlashCommands || counts[cmdUser] > store.MaxContextCommands || counts[cmdMessage] > store.MaxContextCommands {
		errs.add(nil, "APPLICATION_COMMANDS_TOO_MANY", "Maximum number of application commands reached")
	}
	if !errs.empty() {
		writeBotError(w, errs.err(), nil)
		return
	}
	if err := s.Store.ReplaceCommands(r.Context(), app.ID, guild, rows); err != nil {
		writeBotError(w, err, nil)
		return
	}
	s.commandsChanged(r.Context(), app.ID, guild)
	out := make([]dCommand, 0, len(rows))
	for _, c := range rows {
		out = append(out, commandObj(c, app))
	}
	WriteJSON(w, http.StatusOK, out)
}

// botCommand loads the {command} of a command route.
func (s *Server) botCommand(w http.ResponseWriter, r *http.Request, app *store.Application, guild *ids.ID) *store.Command {
	id, ok := pathID(r, "command")
	if !ok {
		writeBotError(w, dErrUnknownCommand, nil)
		return nil
	}
	c, err := s.Store.CommandByID(r.Context(), id)
	if err != nil || c.ApplicationID != app.ID || (guild == nil) != (c.GuildID == nil) || (guild != nil && *guild != *c.GuildID) {
		writeBotError(w, dErrUnknownCommand, nil)
		return nil
	}
	return c
}

func (s *Server) botCommandGet(w http.ResponseWriter, r *http.Request) {
	app, guild, ok := s.commandsTarget(w, r)
	if !ok {
		return
	}
	if c := s.botCommand(w, r, app, guild); c != nil {
		WriteJSON(w, http.StatusOK, commandObj(c, app))
	}
}

func (s *Server) botCommandEdit(w http.ResponseWriter, r *http.Request) {
	app, guild, ok := s.commandsTarget(w, r)
	if !ok {
		return
	}
	c := s.botCommand(w, r, app, guild)
	if c == nil {
		return
	}
	raw, derr := readBotObject(w, r, 256<<10)
	if derr != nil {
		writeBotError(w, derr, nil)
		return
	}
	errs := &formErrors{}
	d := parseCommandDef(raw, nil, errs, readCommandDef(c))
	if !errs.empty() {
		writeBotError(w, errs.err(), nil)
		return
	}
	data, err := json.Marshal(d)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	c.Name, c.Data = d.Name, data
	if err := s.Store.UpdateCommand(r.Context(), c); err != nil {
		if errors.Is(err, store.ErrAlreadyExists) {
			writeBotError(w, dFormError("APPLICATION_COMMANDS_DUPLICATE_NAME", "Application command names must be unique", "name"), nil)
			return
		}
		writeBotError(w, err, dErrUnknownCommand)
		return
	}
	s.commandsChanged(r.Context(), app.ID, guild)
	WriteJSON(w, http.StatusOK, commandObj(c, app))
}

func (s *Server) botCommandDelete(w http.ResponseWriter, r *http.Request) {
	app, guild, ok := s.commandsTarget(w, r)
	if !ok {
		return
	}
	c := s.botCommand(w, r, app, guild)
	if c == nil {
		return
	}
	if err := s.Store.DeleteCommand(r.Context(), c); err != nil {
		writeBotError(w, err, dErrUnknownCommand)
		return
	}
	s.commandsChanged(r.Context(), app.ID, guild)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) botCommandPermsList(w http.ResponseWriter, r *http.Request) {
	app, guild, ok := s.commandsTarget(w, r)
	if !ok {
		return
	}
	list, err := s.Store.CommandPermissionsIn(r.Context(), app.ID, *guild)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	out := make([]dCommandPermissions, 0, len(list))
	for _, p := range list {
		out = append(out, commandPermissionsObj(p))
	}
	WriteJSON(w, http.StatusOK, out)
}

// commandPermsTarget reads the {command} of a permissions route: one of the
// application's commands usable in the server, or the application itself.
func (s *Server) commandPermsTarget(w http.ResponseWriter, r *http.Request, app *store.Application, guild ids.ID) (ids.ID, bool) {
	id, ok := pathID(r, "command")
	if !ok {
		writeBotError(w, dErrUnknownCommand, nil)
		return 0, false
	}
	if id == app.ID {
		return id, true
	}
	c, err := s.Store.CommandByID(r.Context(), id)
	if err != nil || c.ApplicationID != app.ID || (c.GuildID != nil && *c.GuildID != guild) {
		writeBotError(w, dErrUnknownCommand, nil)
		return 0, false
	}
	return id, true
}

func (s *Server) botCommandPermsGet(w http.ResponseWriter, r *http.Request) {
	app, guild, ok := s.commandsTarget(w, r)
	if !ok {
		return
	}
	cmd, ok := s.commandPermsTarget(w, r, app, *guild)
	if !ok {
		return
	}
	list, err := s.Store.CommandPermissionsIn(r.Context(), app.ID, *guild)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	for _, p := range list {
		if p.CommandID == cmd {
			WriteJSON(w, http.StatusOK, commandPermissionsObj(p))
			return
		}
	}
	writeBotError(w, dErr(http.StatusNotFound, 10066, "Unknown application command permissions"), nil)
}

// botCommandPermsPut sets who may use a command in a server, for an
// application holding a person's token with the scope for it: that person
// must be able to manage the server and its roles, as in the app.
func (s *Server) botCommandPermsPut(w http.ResponseWriter, r *http.Request) {
	b := botOf(r)
	appID, ok := pathID(r, "app")
	if !ok || appID != b.app.ID {
		writeBotError(w, dErrMissingAccess, nil)
		return
	}
	gid, ok := pathID(r, "guild")
	if !ok {
		writeBotError(w, dErrUnknownGuild, nil)
		return
	}
	if _, err := s.Store.GuildInstall(r.Context(), b.app.ID, gid); err != nil {
		writeBotError(w, dErrMissingAccess, nil)
		return
	}
	cmd, ok := s.commandPermsTarget(w, r, b.app, gid)
	if !ok {
		return
	}
	raw, derr := readBotObject(w, r, 64<<10)
	if derr != nil {
		writeBotError(w, derr, nil)
		return
	}
	errs := &formErrors{}
	list := parseCommandPermissions(jsonReader{errs}, raw, gid)
	if !errs.empty() {
		writeBotError(w, errs.err(), nil)
		return
	}
	p, err := s.setCommandPermissions(r, b.user, b.app, gid, cmd, list)
	if err != nil {
		writeBotError(w, err, nil)
		return
	}
	WriteJSON(w, http.StatusOK, commandPermissionsObj(p))
}

// parseCommandPermissions reads {permissions: [{id, type, permission}]}.
func parseCommandPermissions(r jsonReader, raw map[string]any, guild ids.ID) []commandPermission {
	list, ok := r.list(raw, "permissions", nil)
	if !ok {
		r.errs.add(fieldPath("permissions"), "BASE_TYPE_REQUIRED", "This field is required")
		return nil
	}
	if len(list) > cmdMaxPermEntries {
		r.errs.add(fieldPath("permissions"), "BASE_TYPE_MAX_LENGTH", fmt.Sprintf("Must be %d or fewer in length.", cmdMaxPermEntries))
		return nil
	}
	out := make([]commandPermission, 0, len(list))
	seen := map[string]bool{}
	for i, v := range list {
		p := fieldPath("permissions", i)
		obj, ok := v.(map[string]any)
		if !ok {
			r.errs.add(p, "MODEL_TYPE_CONVERT", "Only dictionaries may be used in a ModelType")
			continue
		}
		sid, _ := r.str(obj, "id", p)
		id, err := parseBotID(sid)
		if err != nil {
			// the constant for every channel is the server's id less one,
			// which may read as below Nexa's range when the server is new
			if n, perr := strconv.ParseInt(sid, 10, 64); perr == nil && ids.ID(n) == guild-1 {
				id = guild - 1
			} else {
				r.errs.add(fieldPath(p, "id"), "NUMBER_TYPE_COERCE", fmt.Sprintf("Value \"%s\" is not snowflake.", truncate(sid, 30)))
				continue
			}
		}
		t, ok := r.integer(obj, "type", p)
		if !ok || t < cmdPermRole || t > cmdPermChannel {
			r.errs.add(fieldPath(p, "type"), "ENUM_TYPE_COERCE", "Value is not a valid enum value.")
			continue
		}
		allow, ok := r.boolean(obj, "permission", p)
		if !ok {
			r.errs.add(fieldPath(p, "permission"), "BASE_TYPE_REQUIRED", "This field is required")
			continue
		}
		key := strconv.FormatInt(t, 10) + ":" + id.String()
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, commandPermission{ID: id, Type: int(t), Permission: allow})
	}
	return out
}

// setCommandPermissions replaces who may use a command (or every command of
// an application, cmd being its id) in a server, for someone who manages the
// server and its roles, and tells the application and the server.
func (s *Server) setCommandPermissions(r *http.Request, actor *store.User, app *store.Application, guild, cmd ids.ID, list []commandPermission) (*store.CommandPermissions, error) {
	ctx := r.Context()
	p, err := s.Store.ServerPerms(ctx, guild, actor.ID)
	if err != nil {
		return nil, err
	}
	if !p.Has(perms.ManageServer) || !p.Has(perms.ManageRoles) {
		return nil, dErrMissingPerms
	}
	// every entry must name something of this server
	for _, e := range list {
		switch e.Type {
		case cmdPermRole:
			if e.ID == guild {
				continue
			}
			if role, err := s.Store.RoleByID(ctx, e.ID); err != nil || role.ServerID != guild {
				return nil, dFormError("APPLICATION_COMMAND_PERMISSIONS_INVALID_ROLE", "Unknown role", "permissions")
			}
		case cmdPermUser:
			if member, _ := s.Store.IsMember(ctx, guild, e.ID); !member {
				return nil, dFormError("APPLICATION_COMMAND_PERMISSIONS_INVALID_USER", "Unknown user", "permissions")
			}
		case cmdPermChannel:
			if e.ID == allChannelsID(guild) {
				continue
			}
			if ch, err := s.Store.ChannelByID(ctx, e.ID); err != nil || ch.ServerID == nil || *ch.ServerID != guild {
				return nil, dFormError("APPLICATION_COMMAND_PERMISSIONS_INVALID_CHANNEL", "Unknown channel", "permissions")
			}
		}
	}
	raw, err := json.Marshal(list)
	if err != nil {
		return nil, err
	}
	set := &store.CommandPermissions{ApplicationID: app.ID, GuildID: guild, CommandID: cmd, Permissions: raw}
	if err := s.Store.SetCommandPermissions(ctx, set); err != nil {
		return nil, err
	}
	obj := commandPermissionsObj(set)
	s.audit(r, guild, actor.ID, "application_command_permission_update", "command", &cmd, map[string]any{"application_id": app.ID, "permissions": list}, "")
	g := guild
	s.tellBot(app.ID, &g, "APPLICATION_COMMAND_PERMISSIONS_UPDATE", obj)
	s.emitServer(ctx, guild, gateway.EvAppCommandsUpdate, map[string]any{"application_id": app.ID, "guild_id": guild})
	return set, nil
}

// commandsChanged tells the apps that an application's commands changed, so
// a command list they keep is read again: in one server, or wherever the
// application is.
func (s *Server) commandsChanged(ctx context.Context, app ids.ID, guild *ids.ID) {
	payload := map[string]any{"application_id": app, "guild_id": guild}
	if guild != nil {
		s.emitServer(ctx, *guild, gateway.EvAppCommandsUpdate, payload)
		return
	}
	servers, err := s.Store.ApplicationGuilds(ctx, app)
	if err == nil {
		for _, g := range servers {
			s.emitServer(ctx, g, gateway.EvAppCommandsUpdate, payload)
		}
	}
	if users, err := s.Store.ApplicationUsers(ctx, app); err == nil && len(users) > 0 {
		s.Bcast.EmitUsers(users, gateway.EvAppCommandsUpdate, payload)
	}
}

// --- the app's side: what can be used where ------------------------------------------------

// commandView is a command as the app's command list shows it: the
// definition, in Nexa's ids.
type commandView struct {
	ID            ids.ID  `json:"id"`
	ApplicationID ids.ID  `json:"application_id"`
	GuildID       *ids.ID `json:"guild_id,omitempty"`
	Version       ids.ID  `json:"version"`
	commandDef
}

// cmdAppView is an application as the app's command list and menus show it.
type cmdAppView struct {
	ID          ids.ID  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	IconID      *ids.ID `json:"icon_id"`
	// Bot is the bot's account, for its name and picture
	Bot *store.User `json:"bot"`
	// Installed says how the application is there: "guild", "user" or both
	Installed []string `json:"installed"`
}

// usableApps lists the applications whose commands someone may use in a
// channel, with how each is installed for them there.
func (s *Server) usableApps(ctx context.Context, ch *store.Channel, me *store.User) (map[ids.ID]*store.Application, map[ids.ID][]int, int, error) {
	apps := map[ids.ID]*store.Application{}
	how := map[ids.ID][]int{}
	where := ctxPrivate
	if ch.ServerID != nil {
		where = ctxGuild
		installs, err := s.Store.GuildInstalls(ctx, *ch.ServerID)
		if err != nil {
			return nil, nil, 0, err
		}
		for _, in := range installs {
			how[in.ApplicationID] = append(how[in.ApplicationID], installGuild)
		}
	} else {
		// a conversation with a bot is that bot's own
		for _, id := range ch.Recipients {
			if id == me.ID {
				continue
			}
			if u, err := s.Store.UserByID(ctx, id); err == nil && u.Flags&store.FlagBot != 0 && ch.Type == "dm" {
				where = ctxBotDM
				how[u.ID] = append(how[u.ID], installGuild)
			}
		}
	}
	users, err := s.Store.UserInstalls(ctx, me.ID)
	if err != nil {
		return nil, nil, 0, err
	}
	for _, in := range users {
		how[in.ApplicationID] = append(how[in.ApplicationID], installUser)
	}
	list := make([]ids.ID, 0, len(how))
	for id := range how {
		list = append(list, id)
	}
	found, err := s.Store.ApplicationsByIDs(ctx, list)
	if err != nil {
		return nil, nil, 0, err
	}
	for id, app := range found {
		// an application whose bot or owner was taken down offers nothing
		if bot, err := s.Store.UserByID(ctx, id); err != nil || bot.Flags&(store.FlagDisabled|store.FlagDeleted) != 0 {
			continue
		}
		apps[id] = app
	}
	return apps, how, where, nil
}

// commandUsable reports whether someone may use a command in a channel, and
// through which installs.
func commandUsable(c *store.Command, d *commandDef, app *store.Application, how []int, where int, guild *ids.ID, access *commandAccess) (byGuild, byUser bool) {
	if c.GuildID != nil {
		// a server's own commands need the application installed there
		if guild == nil || *c.GuildID != *guild || !hasInt(how, installGuild) {
			return false, false
		}
		return access == nil || access.allows(c, d), false
	}
	if !hasInt(contextsOf(d), where) {
		return false, false
	}
	types := integrationTypesOf(d, app)
	if hasInt(types, installGuild) && hasInt(how, installGuild) {
		switch where {
		case ctxGuild:
			byGuild = access == nil || access.allows(c, d)
		case ctxBotDM:
			byGuild = true
		}
	}
	if hasInt(types, installUser) && hasInt(how, installUser) {
		byUser = true
	}
	return byGuild, byUser
}

// handleChannelCommands lists what someone can use in a channel: the
// applications there and their commands, slash commands and menu entries.
func (s *Server) handleChannelCommands(w http.ResponseWriter, r *http.Request) {
	ch, me := s.channel(w, r, NeedView)
	if ch == nil {
		return
	}
	ctx := r.Context()
	apps, how, where, err := s.usableApps(ctx, ch, me)
	if err != nil {
		WriteError(w, err)
		return
	}
	appIDs := make([]ids.ID, 0, len(apps))
	for id := range apps {
		appIDs = append(appIDs, id)
	}
	sort.Slice(appIDs, func(i, j int) bool { return appIDs[i] < appIDs[j] })
	var guild ids.ID
	if ch.ServerID != nil {
		guild = *ch.ServerID
	}
	cmds, err := s.Store.CommandsOf(ctx, appIDs, guild)
	if err != nil {
		WriteError(w, err)
		return
	}
	access := map[ids.ID]*commandAccess{}
	views := []commandView{}
	usedApps := map[ids.ID]bool{}
	for _, c := range cmds {
		app := apps[c.ApplicationID]
		if app == nil {
			continue
		}
		var acc *commandAccess
		if ch.ServerID != nil {
			acc = access[app.ID]
			if acc == nil {
				acc = s.newCommandAccess(ctx, app.ID, ch, me.ID)
				access[app.ID] = acc
			}
		}
		d := readCommandDef(c)
		byGuild, byUser := commandUsable(c, d, app, how[app.ID], where, ch.ServerID, acc)
		if !byGuild && !byUser {
			continue
		}
		views = append(views, commandView{ID: c.ID, ApplicationID: c.ApplicationID, GuildID: c.GuildID, Version: c.Version, commandDef: *d})
		usedApps[app.ID] = true
	}
	appList := []cmdAppView{}
	for _, id := range appIDs {
		if !usedApps[id] {
			continue
		}
		app := apps[id]
		bot, err := s.Store.UserByID(ctx, id)
		if err != nil {
			continue
		}
		v := cmdAppView{ID: id, Name: app.Name, Description: app.Description, IconID: app.IconID, Bot: bot, Installed: []string{}}
		for _, t := range how[id] {
			if t == installGuild {
				v.Installed = append(v.Installed, "guild")
			} else {
				v.Installed = append(v.Installed, "user")
			}
		}
		appList = append(appList, v)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"applications": appList, "commands": views, "context": where})
}
