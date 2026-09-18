#!/usr/bin/env python3
"""Parks a browser in a voice call and says whether it hears the phone.

Signs in as alice (see seed.py), joins the server's General voice channel and
stays there. Every two seconds it writes what it receives to a status file,
which call_soak.py reads to tell a call that is up from one that is up but
silent in one direction:

  audio_in   audio packets received, summed over the live peer connections
  opened     frames the browser could decrypt, from the frame-crypto worker
  dropped    frames it could not

  tools/device/call_peer.py BASE SERVER_ID [--status /tmp/nexa-device/peer.json]
"""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from e2e import Session  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

# Every peer connection the page makes, and the frame-crypto worker's running
# totals, which it posts every two seconds.
HOOKS = """
(() => {
  const PC = window.RTCPeerConnection;
  window.__pcs = [];
  function Tracked(...args) { const pc = new PC(...args); window.__pcs.push(pc); return pc; }
  Tracked.prototype = PC.prototype;
  Object.setPrototypeOf(Tracked, PC);
  window.RTCPeerConnection = Tracked;

  const W = window.Worker;
  window.__crypto = null;
  function Watched(...args) {
    const w = new W(...args);
    w.addEventListener("message", (e) => { if (e.data && e.data.type === "stats") window.__crypto = e.data; });
    return w;
  }
  Watched.prototype = W.prototype;
  Object.setPrototypeOf(Watched, W);
  window.Worker = Watched;
})();
"""

STATS = """
async () => {
  let audioIn = 0, videoFrames = 0, audioOut = 0, live = 0;
  for (const pc of window.__pcs) {
    if (pc.connectionState === "closed") continue;
    live++;
    const report = await pc.getStats().catch(() => null);
    if (!report) continue;
    report.forEach((r) => {
      if (r.type === "inbound-rtp" && r.kind === "audio") audioIn += r.packetsReceived || 0;
      if (r.type === "inbound-rtp" && r.kind === "video") videoFrames += r.framesDecoded || 0;
      if (r.type === "outbound-rtp" && r.kind === "audio") audioOut += r.packetsSent || 0;
    });
  }
  const c = window.__crypto || {};
  return { audio_in: audioIn, video_frames: videoFrames, audio_out: audioOut, live_pcs: live,
           sealed: c.sealed || 0, opened: c.opened || 0, dropped: c.dropped || 0 };
}
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("server_id")
    ap.add_argument("--status", default="/tmp/nexa-device/peer.json")
    args = ap.parse_args()
    status = Path(args.status)
    status.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
        ])
        alice = Session(browser, args.base, "alice", status.parent)
        alice.page.add_init_script(HOOKS)
        alice.login()
        p = alice.page
        p.goto(args.base + "/channels/" + args.server_id, wait_until="networkidle")
        p.locator("[data-channel]:has(span:text-is('General')) button").first.click()
        p.wait_for_selector("[data-testid=voice-status]", timeout=30000)
        print("alice is in the call", flush=True)

        try:
            while True:
                s = p.evaluate(STATS)
                s["t"] = time.time()
                s["in_call"] = p.locator("[data-testid=voice-status]").count() > 0
                s["participants"] = p.locator("[data-testid=voice-participants] [data-user]").count()
                s["errors"] = alice.errors[-5:]
                tmp = status.with_suffix(".tmp")
                tmp.write_text(json.dumps(s))
                tmp.replace(status)
                if not s["in_call"]:
                    # dropped out: back in, the way a person would
                    p.locator("[data-channel]:has(span:text-is('General')) button").first.click()
                p.wait_for_timeout(2000)
        except KeyboardInterrupt:
            pass
        browser.close()


if __name__ == "__main__":
    main()
