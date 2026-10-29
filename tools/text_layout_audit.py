#!/usr/bin/env python3
"""Check real text components/CSS with adversarial Unicode in Chromium.

Start Vite with VITE_API_TARGET pointing at a throwaway server, then:
  tools/.venv/bin/python tools/text_layout_audit.py http://127.0.0.1:5275 --out /tmp/text-shots
The fixture is dev-only, not an app route or production build entry.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

PAYLOADS = {
    "wide": "﷽" * 100,
    "unbroken": "W" * 100,
    "nbsp": "long\u00a0name" * 12,
    "breaks": "name\n\r\u2028\u2029" * 12,
    "combining": "a" + "\u0301\u035c\u036f" * 33,
    "rtl": "\u202e" + "اسم طويل ﷽" * 10 + "\u202c",
    "emoji": "👩🏽‍💻" * 15,
    "cjk": "漢字カタカナ" * 16,
    "markup": '<img src=x onerror="alert(1)">**﷽**' * 3,
    "normal": "Alice and friends",
}

CHECK = """() => {
  const failures = [];
  for (const button of document.querySelectorAll('[data-full-label]')) {
    const label = button.lastElementChild;
    const range = document.createRange();
    range.selectNodeContents(label);
    const text = range.getBoundingClientRect(), box = label.getBoundingClientRect();
    if (text.left < box.left - 1 || text.right > box.right + 1) failures.push(`clipped action: ${button.textContent}`);
  }
  if (document.querySelectorAll("[data-boundary]").length < 15) failures.push("fixture did not render");
  for (const el of document.querySelectorAll('[data-emoji-slot]')) {
    if (el.getBoundingClientRect().width > 28) failures.push(`emoji slot expanded to ${el.getBoundingClientRect().width}`);
  }
  for (const el of document.querySelectorAll('[data-boundary="typing"] [class*="_words_"]')) {
    if (el.getBoundingClientRect().height > parseFloat(getComputedStyle(el).lineHeight) * 3 + 1) failures.push('typing preview exceeds three lines');
  }
  const bounds = document.querySelectorAll('[data-boundary], [data-scroll]');
  for (const el of bounds) {
    if (el.scrollWidth > el.clientWidth + 1) failures.push(`${el.dataset.boundary || el.dataset.scroll}: width ${el.scrollWidth} > ${el.clientWidth}`);
  }
  for (const el of document.querySelectorAll('[data-lines], [data-boundary^="invite"] [class*="_name_"], [data-boundary="rich-embed"] [class*="_title_"]')) {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const lh = parseFloat(s.lineHeight);
    const lines = Number(el.dataset.lines || (el.closest('[data-boundary="rich-embed"]') ? 3 : 2));
    if (Number.isFinite(lh) && r.height > lh * lines + parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) + 2) failures.push(`${el.className}: height ${r.height} > ${lh} * ${el.dataset.lines}`);
  }
  for (const el of document.querySelectorAll('[data-action]')) {
    const r = el.getBoundingClientRect(), p = el.closest('[data-boundary]').getBoundingClientRect();
    if (r.width < 1 || r.left < p.left - 1 || r.right > p.right + 1) failures.push(`action escaped ${el.closest('[data-boundary]').dataset.boundary}`);
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('page scrolls sideways');
  return failures;
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base")
    parser.add_argument("--out", type=Path, default=Path("/tmp/nexa-text-shots"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    results = []
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for width, height in [(1366, 768), (411, 914), (320, 740)]:
            page = browser.new_page(viewport={"width": width, "height": height})
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("dialog", lambda dialog: (errors.append("Unexpected dialog: " + dialog.message), dialog.dismiss()))
            page.goto(args.base.rstrip("/") + "/tests/text-layout.html")
            page.wait_for_function("typeof window.setAuditText === 'function'")
            page.evaluate("document.fonts.ready")
            for direction in ["ltr", "rtl"]:
                page.evaluate("dir => document.documentElement.dir = dir", direction)
                for name, text in PAYLOADS.items():
                    body = text * 3 + "\n# " + text + "\n<@1> <@&1> <#1>\n```\n" + "x" * 500 + "\n```\n| name | value |\n| --- | --- |\n| " + text + " | " + "y" * 500 + " |"
                    page.evaluate("([a,b]) => window.setAuditText(a,b)", [text, body])
                    page.wait_for_timeout(80)
                    failures = page.evaluate(CHECK)
                    results.append({"width": width, "direction": direction, "payload": name, "failures": failures})
                    if name in ["wide", "normal"] and direction == "ltr":
                        page.screenshot(path=str(args.out / f"{width}-{name}.png"), full_page=True)
            # A negative control proves the suite catches the original invite-height bug.
            page.evaluate("([a,b]) => window.setAuditText(a,b)", [PAYLOADS["wide"], "Message"])
            page.wait_for_timeout(80)
            unclamped = page.add_style_tag(content='[data-boundary^="invite"] [class*="_name_"] { -webkit-line-clamp: unset; }')
            assert any("height" in failure for failure in page.evaluate(CHECK)), "negative control did not detect unbounded titles"
            unclamped.evaluate("el => el.remove()")
            if width == 1366:
                squeezed = page.add_style_tag(content='[data-full-label] { flex-shrink: 1; }')
                assert any("clipped action" in failure for failure in page.evaluate(CHECK)), "negative control did not detect clipped buttons"
                squeezed.evaluate("el => el.remove()")
            page.close()
        browser.close()
    (args.out / "results.json").write_text(json.dumps({"results": results, "errors": errors}, indent=2))
    failures = [r for r in results if r["failures"]]
    for r in failures:
        print(r)
    if errors:
        print("Browser errors:", errors)
    assert not failures and not errors, f"{len(failures)} failed cases"
    print(f"Passed {len(results)} cases: 3 widths, both directions, {len(PAYLOADS)} payloads.")


if __name__ == "__main__":
    main()
