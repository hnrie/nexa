#!/usr/bin/env python3
"""Adds or updates translated strings in all eleven web locale files.

    python3 android/tools/add_strings.py strings.json

strings.json maps each key to its text per locale:
    {"android.composer.photosAndVideos": {"en": "Photos and Videos", "de": "...", ...}}

Every key must have all eleven locales. A new key goes in after the last key
that sorts before it, so files stay in the order they are kept in and
unrelated additions rarely touch the same lines.
"""
import json
import os
import sys

LOCALES = ["ar", "de", "en", "es", "fr", "hi", "ja", "ko", "pt-BR", "ru", "zh-CN"]
HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "..", "web", "src", "i18n", "locales")


def main() -> None:
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    for key, texts in spec.items():
        missing = [loc for loc in LOCALES if not texts.get(loc)]
        if missing:
            sys.exit(f"{key}: missing {', '.join(missing)}")
    for loc in LOCALES:
        path = os.path.join(DIR, f"{loc}.json")
        data = json.load(open(path, encoding="utf-8"))
        items = list(data.items())
        for key, texts in spec.items():
            if key in data:
                items = [(k, texts[loc] if k == key else v) for k, v in items]
                data[key] = texts[loc]
                continue
            at = 0
            for i, (k, _) in enumerate(items):
                if k < key:
                    at = i + 1
            items.insert(at, (key, texts[loc]))
            data[key] = texts[loc]
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps(dict(items), ensure_ascii=False, indent=2) + "\n")
    print(f"{len(spec)} string(s) written to {len(LOCALES)} locales")


if __name__ == "__main__":
    main()
