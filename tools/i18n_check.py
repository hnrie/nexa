#!/usr/bin/env python3
"""Checks every language against English: keys, placeholders, plural forms."""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "web/src/i18n/locales"
PLACEHOLDER = re.compile(r"\{(\w+)\}")

# The plural categories each language actually uses (CLDR).
CATEGORIES = {
    "en": {"one", "other"}, "es": {"one", "many", "other"}, "fr": {"one", "many", "other"},
    "de": {"one", "other"}, "sv": {"one", "other"}, "pt-BR": {"one", "many", "other"},
    "ru": {"one", "few", "many", "other"}, "ja": {"other"}, "ko": {"other"},
    "zh-CN": {"other"}, "hi": {"one", "other"}, "ar": {"zero", "one", "two", "few", "many", "other"},
}


def names(message) -> set:
    if isinstance(message, str):
        return set(PLACEHOLDER.findall(message))
    out = set()
    for form in message.values():
        out |= set(PLACEHOLDER.findall(form))
    return out


def main() -> int:
    en = json.loads((LOCALES / "en.json").read_text())
    problems = []
    for path in sorted(LOCALES.glob("*.json")):
        tag = path.stem
        if tag == "en":
            continue
        cat = json.loads(path.read_text())
        extra = set(cat) - set(en)
        if extra:
            problems.append(f"{tag}: {len(extra)} keys English does not have: {sorted(extra)[:3]}")
        missing = set(en) - set(cat)
        if missing:
            problems.append(f"{tag}: {len(missing)} keys untranslated (they fall back to English)")
        for key, value in cat.items():
            if key not in en:
                continue
            want, got = names(en[key]), names(value)
            if want - got:
                problems.append(f"{tag}: {key} drops {sorted(want - got)}, so a value would go missing")
            if got - want:
                problems.append(f"{tag}: {key} adds {sorted(got - want)}, which nothing fills in")
            if isinstance(en[key], dict):
                if not isinstance(value, dict) or "other" not in value:
                    problems.append(f"{tag}: {key} needs at least an `other` form")
                else:
                    allowed = CATEGORIES.get(tag, {"one", "other"})
                    unused = set(value) - allowed
                    if unused:
                        problems.append(f"{tag}: {key} has forms {sorted(unused)} the language never uses")
    for p in problems:
        print(p)
    if problems:
        print(f"\n{len(problems)} problems")
        return 1
    langs = len(list(LOCALES.glob("*.json"))) - 1
    print(f"{langs} languages, {len(en)} keys each, every placeholder and plural form in order")
    return 0


sys.exit(main())
