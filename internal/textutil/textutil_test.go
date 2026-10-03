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

func TestCleanTextCutsZalgoBack(t *testing.T) {
	zalgo := "H̵̡̛̤̺̖e̵͙͊́l̴̙̓l̷̨̇o̶̘͝"
	got, ok := CleanText(zalgo, 100)
	if !ok {
		t.Fatal("refused")
	}
	run := 0
	for _, r := range got {
		if ZalgoMark(r) {
			run++
			if run > MaxStackedMarks {
				t.Fatalf("more than %d marks on a letter left in %q", MaxStackedMarks, got)
			}
		} else {
			run = 0
		}
	}
	// what languages need stays as written: Vietnamese, accents, and the marks of scripts of their own
	for _, keep := range []string{"Tiếng Việt", "ệ", "café", "שָׁלוֹם", "مُحَمَّد", "हिंदी", "ภาษาไทย", "1️⃣"} {
		if out, _ := CleanText(keep, 100); out != keep {
			t.Errorf("%q became %q", keep, out)
		}
	}
}
