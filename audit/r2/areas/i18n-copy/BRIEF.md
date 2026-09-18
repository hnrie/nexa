# Brief — i18n-copy (finding prefix `I18N`)

Read `audit/r2/README.md` first. This brief is the scope; the protocol is there.

## Scope

Every word the product shows, in every language:

```
web/src/i18n/locales/  en.json ar.json de.json es.json fr.json hi.json ja.json ko.json pt-BR.json ru.json zh-CN.json
                       (one catalogue for both the web and the Android app — Android reads these files)
android/app/src/main/res/values/strings.xml   (what little is native)
desktop/src/main/strings.ts                   (the app's own menus)
web/src/i18n/core.ts index.tsx                (only to understand plurals, interpolation and fallback)
tools/i18n_*.py tools/android_i18n.py         (only to understand how keys are managed)
web/index.html web/public/manifest.webmanifest (titles, descriptions)
The English source strings inline in components are the other areas' to flag as untranslated;
you audit the catalogues.
```

## What this area is

1,842 web keys and 514 Android keys, all present in English; the other ten
languages were produced in bulk on 2026-09-16/17 ("every word in the app,
in all eleven languages"). Nobody who speaks most of these languages has
read them. The tone of the English is plain, lower-case brand ("nexa"),
short sentences, no exclamation marks; the owner rejected a marketing
phrase once ("games, music and videos you have open") in favour of
"RPC support and a better experience".

## Checklist

English first (it is the source; a bad source is translated ten times):
- Every string: is it a sentence a person would say? Jargon (epoch, grant,
  root key, SFU, TURN, KDF, CAS, upsert) leaking into user-facing text;
  developer wording ("invalid", "failed to", "error:"); passive voice
  hiding who must do what; inconsistent terms for one thing (server/guild,
  sign in/log in, delete/remove, DM/direct message, member/user/person,
  call/voice); inconsistent capitalisation (Title Case vs sentence case
  across buttons and headings); trailing periods on some buttons and not
  others; "Please"; exclamation marks; emoji in strings.
- Error strings: do they say what happened *and* what to do?
- Empty-state strings: do they teach the next step?
- Confirmations: do they say what will happen, not "Are you sure?"
- Strings with interpolation: does the sentence survive every value (a
  name with emoji, a count of 0/1/2/many, a very long channel name)?
  Are counts pluralised through the plural mechanism or by `{n} item(s)`?
- Strings that are concatenated in code from fragments (grep for `t("…") +`
  and template literals joining translated parts) — untranslatable in
  languages with different word order; list them with the file.
- Keys whose English is reused in two places with different meanings
  (e.g. "Close" the button vs. "Close" friends) — split them.
- The 12 unused keys the previous session noted; any key missing a
  translation in any language (`tools/i18n_check.py`); keys present in
  some locales but not `en`.

Each of the ten translations (you read each language critically; where
your confidence is low, say so rather than guess):
- Accuracy against the English; false friends; machine-translation tells;
  a technical term translated when the product community uses the English
  word (e.g. "server", "emoji", "GIF", "DM", "mute" in many locales).
- Register and formality: consistent within a language (German Sie/du,
  French vous/tu, Spanish tú/usted, Japanese です/ます vs. plain, Korean
  honorifics, Hindi आप/तुम, Russian вы/ты, Portuguese você). Pick the
  register a friendly chat app uses and flag every deviation.
- Plural forms per CLDR (Arabic has six, Russian three, Japanese one) — does
  the catalogue carry the forms the mechanism supports, and are they right?
- Length: German and Russian button labels that will not fit (the other
  areas check layout; you flag strings over ~1.5× the English on a
  control-sized string); CJK strings that need no spaces but got them.
- Punctuation and typography: French non-breaking spaces before `:;?!`,
  Spanish `¿¡`, Japanese `。` and full-width forms, Arabic comma `،`, Hindi
  danda, quotation marks per language («» „“ 「」), the ellipsis character.
- RTL (Arabic): strings that embed LTR tokens (names, URLs, codes) without
  isolation — recommend where `⁨…⁩` or `dir="auto"` is needed;
  numbers and percentages; mirrored phrases ("left"/"right" in
  instructions).
- Dates, times and numbers are formatted by `Intl` in code, not in strings
  — confirm no string carries a hard-coded format.
- Brand and product names untranslated and consistent ("nexa", "Discord",
  "Cloudflare", "Turnstile").
- The desktop menus (`strings.ts`): the same checks, and OS conventions
  (macOS "Quit nexa" vs Windows "Exit"; "Preferences…" vs "Settings").
- `strings.xml`: the app name, the notification channel names, anything
  Android shows before the catalogue loads.

Write findings per string or per pattern. For a pattern ("every Japanese
button ends with a period"), give three examples with keys. Propose the
corrected text in the finding — the fix phase will apply it verbatim, so
make it right.

## Round 1

None covered this. `audit/product-gaps.md` and the two UI reports mention
copy in passing; skim for anything about wording.

## Facts you would otherwise rediscover

- Keys are looked up with `t("key")` on the web and `tr_("key")`/`t("key")`
  on Android; `tools/i18n_keys_used.py` lists dynamic keys it cannot
  check — those are worth reading by hand.
- The translation pass was done by a model, not a person, in one session.
- 993 web tests include locale tests (`web/src/i18n/locales.test.ts`) —
  read that test to see what is enforced (probably key parity only).

## Order

`en.json` end to end (this is the largest single item; checkpoint every
~300 keys by key range in `PROGRESS.md`) → `core.ts` to confirm the plural
and interpolation mechanics → each locale in this order: de, fr, es,
pt-BR, ru, ar, ja, ko, zh-CN, hi → `strings.xml`, `strings.ts`,
`index.html`, the manifest → the summary.
