#!/usr/bin/env python3
"""Runs the e2e suite's media check against a server that is already up.

The throwaway SFU server keeps its accounts between runs, so the phone signed
in to it sees the same messages the browsers just sent — which is how the
Android side of old link previews is looked at by eye.

  tools/device/media_check.py BASE DIR CHANNEL_PATH
"""
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from e2e import Session, media_flow  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

base, run_dir, path = sys.argv[1], sys.argv[2], sys.argv[3]
out = Path("/tmp/nexa-device")
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    alice = Session(browser, base, "alice", out)
    bob = Session(browser, base, "bob", out)
    alice.login()
    bob.login()
    media_flow(SimpleNamespace(base=base, dir=run_dir), alice, bob, path)
    errors = alice.errors + bob.errors
    if errors:
        print("browser errors:", *errors[:10], sep="\n  ")
    browser.close()
