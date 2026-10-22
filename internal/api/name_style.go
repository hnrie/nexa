package api

import (
	"encoding/json"
	"fmt"
	"strings"
)

// A name style is how someone's display name is drawn to everyone: one of the
// fonts the apps carry, an effect, and the effect's colours (0xRRGGBB). It is
// public, like the rest of a profile. The fonts and effects are the ones the
// apps know (web lib/nameStyle.ts, Android data/NameStyle.kt); a style an app
// cannot draw falls back to the plain name there.
type nameStyle struct {
	Font   string `json:"font,omitempty"`
	Effect string `json:"effect"`
	Colors []int  `json:"colors"`
}

var nameFonts = map[string]bool{
	"comic": true, "fraunces": true, "playfair": true, "dmserif": true, "youngserif": true, "syne": true, "bricolage": true, "spacegrotesk": true, "outfit": true, "lexend": true, "sora": true, "rubik": true, "fredoka": true, "comfortaa": true, "baloo": true, "quicksand": true, "bungee": true, "righteous": true, "chewy": true, "shrikhand": true, "titan": true, "orbitron": true, "pacifico": true, "lobster": true, "kalam": true, "patrick": true, "caveat": true, "pixelify": true, "spacemono": true,
}

// how many colours each effect takes, at least and at most
var nameEffects = map[string][2]int{
	"solid": {0, 1}, "gradient": {2, 2}, "glow": {1, 1}, "ink": {1, 1},
	"pop": {1, 1}, "candy": {2, 4}, "aurora": {2, 5}, "chrome": {1, 1},
}

// cleanNameStyle checks a style its owner sent and writes it the one way it is
// stored, or "" for the plain name. A JSON null is the plain name. The second
// result is the reason a style was refused.
func cleanNameStyle(raw json.RawMessage) (string, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", ""
	}
	var in nameStyle
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", "name_style must be an object or null."
	}
	if in.Font != "" && !nameFonts[in.Font] {
		return "", "That font isn't one on offer."
	}
	if in.Effect == "" {
		in.Effect = "solid"
	}
	span, ok := nameEffects[in.Effect]
	if !ok {
		return "", "That effect isn't one on offer."
	}
	if len(in.Colors) < span[0] || len(in.Colors) > span[1] {
		return "", fmt.Sprintf("The %s effect takes %d to %d colours.", in.Effect, span[0], span[1])
	}
	for _, c := range in.Colors {
		if c < 0 || c > 0xFFFFFF {
			return "", "Colours must be 0 to 16777215."
		}
	}
	if in.Colors == nil {
		in.Colors = []int{}
	}
	// the app's font in the usual colour is no style at all
	if in.Font == "" && in.Effect == "solid" && len(in.Colors) == 0 {
		return "", ""
	}
	out, err := json.Marshal(in)
	if err != nil {
		return "", "name_style could not be read."
	}
	return string(out), ""
}

// nameStyleText is a name style as words a moderation case can keep.
func nameStyleText(raw string) string {
	var st nameStyle
	if raw == "" || json.Unmarshal([]byte(raw), &st) != nil {
		return clipRunes(raw, maxKeptOldValue)
	}
	parts := []string{st.Effect}
	if st.Font != "" {
		parts = append(parts, st.Font)
	}
	for _, c := range st.Colors {
		parts = append(parts, fmt.Sprintf("#%06x", c))
	}
	return strings.Join(parts, " ")
}
