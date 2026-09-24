package textutil

import "testing"

func TestCleanTextDropsDirectionControls(t *testing.T) {
	for in, want := range map[string]string{
		"abc\u202Edef":                "abcdef",
		"\u2067abc\u2069":             "abc",
		"a\u2028b":                    "a\nb",
		"\u202Dabc":                   "abc",
		"keep 👨\u200D👩\u200D👧 intact": "keep 👨\u200D👩\u200D👧 intact",
	} {
		if got, ok := CleanText(in, 100); !ok || got != want {
			t.Errorf("CleanText(%q) = %q, %v; want %q", in, got, ok, want)
		}
	}
}

func TestCleanNameDropsWhatShowsNothing(t *testing.T) {
	for in, want := range map[string]string{
		"\u3164":           "",
		"\u115F":           "",
		"Ne\u200Bxa":       "Nexa",
		"a\tb\nc":          "a b c",
		"\uFEFFname\u2060": "name",
	} {
		if got, ok := CleanName(in, 32); !ok || got != want {
			t.Errorf("CleanName(%q) = %q, %v; want %q", in, got, ok, want)
		}
	}
}

func TestSkeletonSeesThroughDisguises(t *testing.T) {
	for _, in := range []string{"Nexa", "NEXA", "N e x a", "Ne\u200Bxa", "Nexa\u00A0", "Nеxa", "Ｎｅｘａ", "Nèxa", "ΝΕΧΑ", "Nexa 🛡\uFE0F", "N.e.x.a", "nexa\u2060", "Nexa\u200D"} {
		if got := Skeleton(in); got != "nexa" {
			t.Errorf("Skeleton(%q) = %q", in, got)
		}
	}
	if Skeleton("Nexus") == "nexa" || Skeleton("Alexa") == "nexa" {
		t.Error("different names share a skeleton")
	}
}
