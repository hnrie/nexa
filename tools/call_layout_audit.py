#!/usr/bin/env python3
"""Check the shared web/desktop call layout in Chromium and WebKit.

Start Vite with VITE_API_TARGET pointing at a throwaway server, then run:
  tools/.venv/bin/python tools/call_layout_audit.py http://127.0.0.1:5275 --out /tmp/call-shots
The real VoiceView is mounted with local fixture state, without making a call.
"""
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright

CHECK = """() => {
  const failures = [];
  const stage = document.querySelector('[class*="_stage_"]').getBoundingClientRect();
  const tiles = document.querySelectorAll('[data-tile]');
  if (!tiles.length) failures.push('no call tiles');
  for (const tile of tiles) {
    const r = tile.getBoundingClientRect();
    // A focused view's thumbnail strip can scroll horizontally.
    if (r.top < stage.top - 1 || r.bottom > stage.bottom + 1 ||
        (tile.dataset.place !== 'strip' && (r.left < stage.left - 1 || r.right > stage.right + 1)))
      failures.push(`clipped tile ${tile.dataset.tile}`);
  }
  const root = document.querySelector('[data-embedded]').getBoundingClientRect();
  for (const button of document.querySelectorAll('[data-testid="voice-mute"], [data-testid="voice-leave"]')) {
    const r = button.getBoundingClientRect();
    if (r.left < root.left || r.right > root.right || r.bottom > root.bottom)
      failures.push(`clipped control ${button.dataset.testid}`);
  }
  return failures;
}"""

# Reproduce the old integer measurement after the initial layout. At 1083.75px,
# clientWidth was 1084px, so three 356px tiles plus two 8px gaps wrapped.
ROUND_MEASUREMENTS = """() => {
  const Observer = window.ResizeObserver;
  window.ResizeObserver = class extends Observer {
    constructor(callback) {
      super(entries => callback(entries.map(entry => ({
        contentRect: { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) }
      }))));
    }
  };
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base')
    parser.add_argument('--out', type=Path, default=Path('/tmp/nexa-call-shots'))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    url = args.base.rstrip('/') + '/tests/call-layout.html'
    checked = 0
    with sync_playwright() as pw:
        for engine in ['chromium', 'webkit']:
            browser = getattr(pw, engine).launch(**({'args': ['--mute-audio']} if engine == 'chromium' else {}))
            for embedded in [False, True]:
                page = browser.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(url + ('?embedded' if embedded else ''))
                page.wait_for_selector('[data-tile]')
                for width, height in [(1366, 768), (411, 914), (1121, 464)]:
                    page.set_viewport_size({'width': width, 'height': height})
                    # Fractional columns arise with panel resizing and browser zoom.
                    for inset in [0, .25, 1.25, 2.25]:
                        page.evaluate('(w) => document.getElementById("root").style.width = `${w}px`', width - 25 - inset)
                        page.wait_for_timeout(100)
                        assert not (failures := page.evaluate(CHECK)), (engine, embedded, width, inset, failures)
                        checked += 1
                    page.screenshot(path=str(args.out / f'{engine}-{width}-{"embedded" if embedded else "room"}.png'))
                # Focus a screen share, resize it, and return to the grid.
                page.locator('[data-kind="screen"]').click()
                page.wait_for_timeout(150)
                assert not page.evaluate(CHECK)
                page.locator('[data-place="focus"]').click()
                page.wait_for_timeout(150)
                assert not page.evaluate(CHECK)
                assert not errors, errors
                page.close()
            # Prove this catches the screenshot's original extra-row clipping.
            context = browser.new_context(viewport={'width': 1121, 'height': 464})
            context.add_init_script('(' + ROUND_MEASUREMENTS + ')()')
            page = context.new_page()
            page.goto(url)
            page.wait_for_selector('[data-tile]')
            page.evaluate('document.getElementById("root").style.width = "1095.75px"')
            page.wait_for_timeout(200)
            assert page.evaluate(CHECK), f'{engine}: negative control did not reproduce clipping'
            context.close()
            browser.close()
    print(f'{checked} call layouts passed; focus transitions and both negative controls passed')


if __name__ == '__main__':
    main()
