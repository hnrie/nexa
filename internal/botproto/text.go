package botproto

import (
	"regexp"
	"strconv"

	"evilion.xyz/chat/internal/ids"
)

// reIDToken finds the ids written into message text: a user (<@id>, <@!id>),
// a role (<@&id>), a channel (<#id>), a custom emoji (<:name:id>,
// <a:name:id>) and a command (</name:id>, </name sub:id>). Nexa's markdown
// and the bots' share these forms; only the ids in them differ.
var reIDToken = regexp.MustCompile(`<(@!?|@&|#|a?:[A-Za-z0-9_]{1,32}:|/[-_\p{L}\p{N} ]{1,100}:)(\d{1,20})>`)

func rewrite(s string, fn func(n int64) (int64, bool)) string {
	if len(s) < 4 {
		return s
	}
	return reIDToken.ReplaceAllStringFunc(s, func(tok string) string {
		m := reIDToken.FindStringSubmatch(tok)
		n, err := strconv.ParseInt(m[2], 10, 64)
		if err != nil {
			return tok
		}
		out, ok := fn(n)
		if !ok {
			return tok
		}
		return "<" + m[1] + strconv.FormatInt(out, 10) + ">"
	})
}

// OutText writes the ids in Nexa text the way bots see them.
func OutText(s string) string {
	return rewrite(s, func(n int64) (int64, bool) {
		if n <= 0 {
			return 0, false
		}
		return Out(ids.ID(n)), true
	})
}

// InText reads the ids in text a bot sent back into Nexa's own, leaving an
// id that names nothing Nexa could hold as it was written.
func InText(s string) string {
	return rewrite(s, func(n int64) (int64, bool) {
		v := In(n)
		return v, v > 0
	})
}
