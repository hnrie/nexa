# Findings — web-core (prefix `WCORE`)

(Summary is written at the top when the audit is done.)

---

### WCORE-001 · P2 · bug · `api.request` still throws a bare `SyntaxError` on a 200 with an HTML body; only `api.upload` got the captive-portal fix
- Where: `web/src/api/client.ts:234-235`; the guarded twin is `client.ts:292-296`; test coverage only for upload at `web/src/api/client.test.ts:419-426`
- What: after `res.ok`, `JSON.parse(raw)` runs unguarded. The `!res.ok` branch already tolerates a non-JSON body (`errorFrom` falls back to `http_<status>`), and `upload` catches the parse and rejects with `bad_response`, but the 2xx path of `request` — every JSON call in the app — does not. A captive portal, a CDN interstitial or a proxy answering `200 text/html` rejects with `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, which is not an `ApiError`.
- Impact: on hotel/airport Wi-Fi every call that awaits `api.request` fails with the parser's untranslated text; the callers that branch on `instanceof ApiError` fall through to `err.message`, so that string lands in toasts and error rows (thirteen call sites show `err.message`, per the comment at `client.ts:83`). Login and register are the first two things a person tries on such a network.
- Fix: wrap the parse exactly as `upload` does (`new ApiError(res.status, "bad_response", t("attachments.theServerSAnswerCouldNot"))`), and add the missing test next to the upload one. Optionally treat a 2xx whose `Content-Type` is not `application/json` the same way before parsing.
- Effort: S
- Status: open

### WCORE-002 · P2 · a11y · Pinch-zoom is disabled on every phone: `user-scalable=no`/`maximum-scale=1` in the viewport tag and WebKit gesture events cancelled
- Where: `web/index.html:5`; `web/src/lib/noZoom.ts:14-22` (installed unconditionally from `web/src/main.tsx:46`)
- What: the viewport meta forbids zoom where browsers honour it (Chrome and Firefox on Android), and for iOS Safari — which ignores the meta for pinch — `installNoZoom` cancels `gesturestart/gesturechange/gestureend` so the pinch is blocked there too. The stated reason (`noZoom.ts:3-9`) is to stop iOS zooming into a focused text field, which is achieved by keeping inputs at 16 px or larger; double-tap zoom is already removed by `touch-action` without blocking pinch.
- Impact: WCAG 2.1 SC 1.4.4 (AA) fails on phones — a low-vision reader cannot enlarge message text, a small avatar, an emoji, or the safety-number digits and QR code in the key-verification sheet. axe's `meta-viewport` rule flags exactly this tag, so round 1's "zero axe violations" was measured on a viewport where it does not apply. (OS-level magnification still works, which is why this is P2 rather than P1.)
- Fix: drop `maximum-scale=1, user-scalable=no` (keep `viewport-fit=cover`), keep `touch-action: manipulation` on the page, and make sure no input on the phone layout is under 16 px (`web-chat-ui`/`web-shell-ui` to confirm); delete `noZoom.ts` and its test. Verify on the iOS Simulator that focusing the composer no longer zooms.
- Effort: S
- Status: open

### WCORE-003 · P3 · code · `@tanstack/react-virtual` is still a dependency nothing imports
- Where: `web/package.json:20`; `grep -rn react-virtual web/src` matches only `web/src/data/licenses.json:95`
- What: round 1 noted the message list is not virtualised although the library is installed; it is still installed and still unused. Vite tree-shakes it out of the bundle, so the cost is install time and a licences page that credits a library the app does not ship.
- Impact: none for users beyond an inaccurate credits list; a maintenance trap (someone will assume the list is virtualised).
- Fix: remove the dependency and regenerate `licenses.json`, or actually adopt it (that is `web-chat-ui`'s decision for `MessageList`).
- Effort: S
- Status: open
