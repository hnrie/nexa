# Nexa: working notes

Nexa is the end-to-end encrypted chat app served at https://chat.evilion.xyz: a Go server
(`cmd/`, `internal/`) and a React + TypeScript web app (`web/src`) that the desktop app also runs.
README.md has the architecture.

## Every major feature gets a What's New entry

When a change adds a major feature, redesigns something, or changes behaviour people will notice,
the same change adds an entry to the What's New popup. People see the popup once, the first time
they open the app after an update, and it is how they find out what changed.

- The list is `RELEASES` in `web/src/lib/whatsNew.ts`, newest first. Add a release at the top whose
  `id` is the deploy date (`"2026-09-26"`, then `"2026-09-26.2"` for a second one that day), or add
  items to the newest release if that one has not been deployed yet.
- Each item is a lucide-react icon, a title and one or two plain sentences. Title and body are i18n
  keys (`whatsNew.<release>.<name>Title` and `...Body`) translated into all eleven locales.
- Say what people can do now and where to find it. Small fixes and polish do not need an entry.
- The popup is `web/src/components/shell/WhatsNewDialog.tsx`. It shows the releases an account has
  not seen yet (tracked in its synced settings) and skips releases older than the account.

## Writing UI text

- Short, plain sentences that sound like a person. Sentence case for labels, buttons and headings.
- Avoid em dashes; use a comma, a full stop or parentheses.
- Describe Nexa on its own terms. Do not compare it to Discord. Naming Discord is fine only where a
  feature really talks to the Discord program (the desktop app's Rich Presence relay).
- Never hardcode user-visible English: use `t("key")` / `<Tr>` from `@/i18n`, and add every new key
  to all eleven files in `web/src/i18n/locales/` with real translations.
  `python3 tools/i18n_check.py` must pass.

## Building is deploying

`web/dist` and `bin/chatd` are what the live instance serves, so `npm run build`, `make web`,
`make server` and `make build` publish immediately. To check a change, use `npm run typecheck`,
`npx vitest run`, `go test ./...`, or build somewhere else:
`npx vite build --outDir <scratch dir> --emptyOutDir` and `go build -o <scratch dir>/chatd ./cmd/chatd`.
Deploy only when the owner asks, after backing up `data/`.

## Checking UI changes

Look at every UI change at desktop and phone sizes. `tools/screenshot.py` and `tools/e2e.py` drive
the app with Playwright from Python (setup in `tools/README.md`); test on a throwaway server, never
on port 8090.

## Other facts

- SQLite is live and the Postgres dialect must keep working: a new migration goes in both
  `internal/db/migrations` and `internal/db/migrations-postgres` with the same number.
- The Android app is discontinued and removed. Do not add anything for it.
- The desktop (Electron) source is not checked out on this machine; keep `web/src/lib/desktopBridge.ts`
  compatible with the app people already have installed.
