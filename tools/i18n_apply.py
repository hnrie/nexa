#!/usr/bin/env python3
"""Writes one language's catalogue from a list of values in key order.

The keys are the English catalogue's, sorted; a language file is the same list
of values. Writing only the values keeps a translation file half the size and
makes a missing or extra one impossible to miss — the count has to match.

  python3 tools/i18n_apply.py es < es.values.json

With --merge the input is instead an object of key -> value, added to the
catalogue that is already there. That is what a later batch of new English
strings wants: the keys already translated stay as they are.

  python3 tools/i18n_apply.py --merge es < es.new.json
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "web/src/i18n/locales"


def main() -> int:
    args = sys.argv[1:]
    merge = "--merge" in args
    args = [a for a in args if a != "--merge"]
    if len(args) != 1:
        print("usage: i18n_apply.py [--merge] <tag>   (JSON on stdin)", file=sys.stderr)
        return 2
    tag = args[0]
    en = json.loads((LOCALES / "en.json").read_text())
    keys = sorted(en)
    if merge:
        return merge_in(tag, en, json.load(sys.stdin))
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


def merge_in(tag: str, en: dict, added: dict) -> int:
    path = LOCALES / f"{tag}.json"
    out = json.loads(path.read_text()) if path.exists() else {}
    for key, value in added.items():
        if key not in en:
            print(f"{tag}: {key} is not an English key", file=sys.stderr)
            return 1
        if value is None or value == "":
            continue
        source = en[key]
        if isinstance(source, dict) and not isinstance(value, dict):
            print(f"{tag}: {key} counts something and needs plural forms", file=sys.stderr)
            return 1
        if isinstance(source, str) and isinstance(value, dict):
            print(f"{tag}: {key} is not a plural", file=sys.stderr)
            return 1
        out[key] = value
    path.write_text(json.dumps({k: out[k] for k in sorted(out)}, ensure_ascii=False, indent=2) + "\n")
    missing = len(en) - len(out)
    print(f"{tag}: {len(out)} of {len(en)} translated" + (f", {missing} to go" if missing else ""))
    return 0


sys.exit(main())
