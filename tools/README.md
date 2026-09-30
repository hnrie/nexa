# Tools

Visual checks and end-to-end runs use Playwright from a Python venv:

```
python3 -m venv tools/.venv
tools/.venv/bin/pip install -r tools/requirements.txt
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac14 tools/.venv/bin/python -m playwright install chromium
```

(`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac14` is needed on macOS 13, where Playwright
would otherwise refuse to download its Chromium.)

- `tools/screenshot.py <base-url> <out-dir> --paths /login --viewports 1366x768 390x844`
- `tools/e2e.py` — starts a throwaway server and drives two browsers through register → friend → DM → attachments.
- `tools/webhook_e2e.py` — starts a throwaway server, makes a webhook in Server Settings, Integrations, posts every kind of webhook message through it (embeds, link buttons, layout components, a poll, files, GitHub and Slack formats, an edit) and screenshots them at desktop and phone sizes while a second account votes in the poll.
- `tools/seed.py <base-url>` — fills a running throwaway server with two people, a server and one message of every kind of formatting, to look at how they are drawn.
- `tools/sfu_call.py` — a real three-person call through Cloudflare Realtime SFU (keys from `chatd.env`): audio, TURN relay, camera, screen share pulls, cross-channel refusal.
- `tools/licenses.py` (`make licenses`) — writes `web/src/data/licenses.json`, which is what Settings → Licenses shows: every dependency that ships in a build, read out of the two `package-lock.json` files and `go list -deps`, with one copy of each licence text.
- `tools/twemoji_font.py` — builds `web/src/assets/fonts/twemoji-colr.woff2`, the colour font text boxes, names and menus draw emoji with, from the same Twemoji SVGs messages show. Rerun after upgrading `@twemoji/svg` or `emojibase-data`, then run `tools/twemoji_font_check.py` (add `--browser firefox` or `--browser webkit` after `python -m playwright install firefox webkit`): it draws every emoji in the font and as its SVG and fails on any that differ or fall apart into pieces.
