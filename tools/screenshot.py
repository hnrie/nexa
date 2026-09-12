#!/usr/bin/env python3
"""Screenshot pages of the running app at one or more viewports.

  python3 tools/screenshot.py http://127.0.0.1:8090 out/ --paths /login /register --viewports 1366x768 390x844
  python3 tools/screenshot.py http://127.0.0.1:8090 out/ --login alice:password --paths /channels/@me

Uses the Playwright venv created per tools/README.md (or PLAYWRIGHT_VENV).
"""
import argparse, os, sys, time
from pathlib import Path

VENV = os.environ.get("PLAYWRIGHT_VENV")
if VENV and not sys.executable.startswith(VENV):
    os.execv(os.path.join(VENV, "bin", "python"), [os.path.join(VENV, "bin", "python"), *sys.argv])

from playwright.sync_api import sync_playwright  # noqa: E402


def login(page, base, username, password):
    page.goto(f"{base}/login", wait_until="networkidle")
    page.fill("input[autocomplete=username]", username)
    page.fill("input[type=password]", password)
    page.click("button[type=submit]")
    page.wait_for_url("**/channels/**", timeout=30000)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("out")
    ap.add_argument("--paths", nargs="+", default=["/"])
    ap.add_argument("--viewports", nargs="+", default=["1366x768", "390x844"])
    ap.add_argument("--login", default=None, help="user:password")
    ap.add_argument("--wait", type=float, default=1.0)
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--dark", default="dark")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for vp in args.viewports:
            w, h = (int(x) for x in vp.split("x"))
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=w < 768, has_touch=w < 768)
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            if args.login:
                u, pw = args.login.split(":", 1)
                login(page, args.base, u, pw)
            for path in args.paths:
                page.goto(args.base + path, wait_until="networkidle")
                time.sleep(args.wait)
                name = (path.strip("/").replace("/", "_").replace("@", "") or "root") + f"-{w}x{h}.png"
                page.screenshot(path=str(out / name), full_page=args.full)
                print("wrote", out / name)
            if errors:
                print("console/page errors:", *errors, sep="\n  ")
            ctx.close()
        browser.close()


if __name__ == "__main__":
    main()
