package automod

import (
	"encoding/json"
	"os"
	"testing"
)

type vector struct {
	Name    string   `json:"name"`
	Words   []string `json:"words"`
	Regex   []string `json:"regex"`
	Allow   []string `json:"allow"`
	Evasion bool     `json:"evasion"`
	Text    string   `json:"text"`
	Match   *string  `json:"match"`
}

// Every implementation of the matcher (this one, the web app's and the
// Android app's) answers testdata/vectors.json the same way.
func TestVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []vector
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		hit, ok := NewMatcher(c.Words, c.Regex, c.Allow, c.Evasion).Match(c.Text)
		switch {
		case c.Match == nil && ok:
			t.Errorf("%s: %q matched %q, want nothing", c.Name, c.Text, hit)
		case c.Match != nil && !ok:
			t.Errorf("%s: %q matched nothing, want %q", c.Name, c.Text, *c.Match)
		case c.Match != nil && hit != *c.Match:
			t.Errorf("%s: %q matched %q, want %q", c.Name, c.Text, hit, *c.Match)
		}
	}
}

// The ready-made lists catch what they are for and leave ordinary words alone.
func TestPresets(t *testing.T) {
	all := []string{}
	for _, name := range PresetNames {
		all = append(all, Presets[name]...)
	}
	m := NewMatcher(all, nil, nil, true)
	for _, bad := range []string{"what the fuuuck", "you're a f.a.g.g.o.t", "kys", "send nudes"} {
		if _, ok := m.Match(bad); !ok {
			t.Errorf("%q was not caught", bad)
		}
	}
	for _, fine := range []string{"pass the class", "classic assassin", "a spooky cocoon", "scunthorpe", "shiitake", "grape juice", "therapist", "cocktail", "analysis", "as far as i know", "snack crackers", "the dickens"} {
		if hit, ok := m.Match(fine); ok {
			t.Errorf("%q was caught by %q", fine, hit)
		}
	}
}
