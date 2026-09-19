# Progress — i18n-copy
State: auditing
Last checkpoint: 2026-09-18T12:40Z
Next finding id: 001

Facts learned (so a successor need not rediscover them):
- `web/src/i18n/locales/en.json` is flat and sorted: 2,123 top-level dotted keys, 55 of them plural
  objects (`{one, other}` in English). Placeholders are `{name}`; `{count}` is both the plural
  selector and a placeholder. `Intl.PluralRules(locale)` picks the form; a missing category falls
  to `other`. Numbers are formatted by `Intl.NumberFormat` in `interpolate`.
- `locales.test.ts` enforces key parity, placeholder parity and valid plural categories only. It
  says nothing about content, so an untranslated (English) value in a locale passes.
- `tools/i18n_check.py` is the same check outside vitest; `tools/i18n_keys_used.py` lists missing
  and orphan keys; `tools/android_i18n.py` is how Android's inline strings were moved into the
  catalogue (key = `<folder>.<file>.<camelWords>`, reusing an existing key when the English matched
  — so one key can serve two screens).
- Key ranges below are 0-based indices into the sorted key list, aligned on prefix groups.

## Inspected

### Mechanics and tooling
- [x] web/src/i18n/core.ts
- [x] web/src/i18n/index.tsx
- [x] web/src/i18n/locales.test.ts
- [ ] web/src/i18n/core.test.ts
- [x] tools/i18n_check.py
- [x] tools/i18n_keys_used.py
- [x] tools/i18n_apply.py
- [x] tools/android_i18n.py
- [ ] tools/i18n_extract.py
- [ ] run tools/i18n_check.py and tools/i18n_keys_used.py (read-only); read the orphan and dynamic keys by hand
- [ ] grep web/src and android for translated fragments joined in code (`t("…") +`, template literals)
- [ ] English values reused under several keys / one key used with two meanings
- [ ] round 1 skim: audit/product-gaps.md, audit/web-ui.md, audit/android-ui.md for wording

### en.json (source) — 8 ranges
- [ ] en 1/8  idx 0–283    activity … chatScreen (incl. auth, chat)
- [ ] en 2/8  idx 284–530  common … guestLink (composer, desktop, download, encryption, errors, friends, guestCall)
- [ ] en 3/8  idx 531–827  home … modals
- [ ] en 4/8  idx 828–1135 names … search (perms, pickers, profile, recover, register)
- [ ] en 5/8  idx 1136–1430 server
- [ ] en 6/8  idx 1431–1700 servers, services, session, settings (first part)
- [ ] en 7/8  idx 1701–1949 settings (rest), sfu, shareQuality, sheets, shell
- [ ] en 8/8  idx 1950–2122 sidebar … voiceSession (sounds, stickerPack, time, toasts, uploads, voice)

### Cross-locale scripted checks (all ten at once)
- [ ] values identical to English (untranslated), per locale
- [ ] length ratio > 1.5× English on short control strings, per locale
- [ ] punctuation/typography: trailing periods, `!`, `...` vs `…`, CJK spaces, French NBSP, Spanish ¿¡, Arabic ،, Hindi danda, quotes
- [ ] brand and product names (nexa/Nexa, Discord, Cloudflare, Turnstile, GIF, emoji, DM) per locale
- [ ] plural objects: each locale carries the CLDR forms its language selects; forms actually differ
- [ ] hard-coded date/number formats in strings
- [ ] Arabic: LTR tokens next to placeholders, left/right words

### Locales (hand-read against English, same 8 ranges each)
- de:    [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5 [ ] 6 [ ] 7 [ ] 8
- fr:    [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5 [ ] 6 [ ] 7 [ ] 8
- es:    [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5 [ ] 6 [ ] 7 [ ] 8
- pt-BR: [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5 [ ] 6 [ ] 7 [ ] 8
- ru:    [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5 [ ] 6 [ ] 7 [ ] 8
- ar:    [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5 [ ] 6 [ ] 7 [ ] 8
- ja:    [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5 [ ] 6 [ ] 7 [ ] 8
- ko:    [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5 [ ] 6 [ ] 7 [ ] 8
- zh-CN: [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5 [ ] 6 [ ] 7 [ ] 8
- hi:    [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5 [ ] 6 [ ] 7 [ ] 8

### Native strings and page metadata
- [ ] android/app/src/main/res/values/strings.xml
- [ ] desktop/src/main/strings.ts
- [ ] web/index.html
- [ ] web/public/manifest.webmanifest

### Finish
- [ ] Summary at the top of FINDINGS.md, State: audit-done

## Handoff note
Fresh start. Mechanics read. Nothing in FINDINGS.md yet. Next: run the checkers and greps, then
read en.json range 1/8 (`python3 -c` printing `key = value` for idx 0–283 of the sorted keys).
