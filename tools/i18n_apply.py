#!/usr/bin/env python3
"""Writes one language's catalogue from a list of values in key order.

The keys are the English catalogue's, sorted; a language file is the same list
of values. Writing only the values keeps a translation file half the size and
makes a missing or extra one impossible to miss — the count has to match.

  python3 tools/i18n_apply.py es < es.values.json
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "web/src/i18n/locales"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: i18n_apply.py <tag>   (values as JSON on stdin)", file=sys.stderr)
        return 2
    tag = sys.argv[1]
    en = json.loads((LOCALES / "en.json").read_text())
    keys = sorted(en)
    values = json.load(sys.stdin)
    if len(values) != len(keys):
        print(f"{tag}: {len(values)} values for {len(keys)} keys", file=sys.stderr)
        return 1
    out = {}
    for key, value in zip(keys, values):
        if value is None or value == "":
            continue  # left for English
        source = en[key]
        if isinstance(source, dict) and not isinstance(value, dict):
            print(f"{tag}: {key} counts something and needs plural forms", file=sys.stderr)
            return 1
        if isinstance(source, str) and isinstance(value, dict):
            print(f"{tag}: {key} is not a plural", file=sys.stderr)
            return 1
        out[key] = value
    (LOCALES / f"{tag}.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    print(f"{tag}: {len(out)} of {len(keys)} translated")
    return 0


sys.exit(main())
