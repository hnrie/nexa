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
- `tools/sfu_call.py` — a real three-person call through Cloudflare Realtime SFU (keys from `chatd.env`): audio, TURN relay, camera, screen share pulls, cross-channel refusal.
- `tools/licenses.py` (`make licenses`) — writes `web/src/data/licenses.json`, which is what Settings → Licenses shows: every dependency that ships in a build, read out of the two `package-lock.json` files and `go list -deps`, with one copy of each licence text.
