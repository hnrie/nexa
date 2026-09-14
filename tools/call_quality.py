"""Call quality on bad networks, measured.

Two browsers share a voice channel through Cloudflare Realtime SFU, each behind
tools/netsim, which loses, delays, reorders and caps their media on the way to
Cloudflare and back, and can stall or cut their signalling (HTTP and the
gateway WebSocket) on its own. Each browser's microphone plays a continuous
speech-like signal, so on the other side every cut-out shows as silence. For
each scenario the script records what each side hears of the other in 10 ms
loudness blocks, and WebRTC's own counters: concealment, time-stretching,
jitter buffer delay, FEC, packets lost, and how often the call rebuilt itself.

Needs REALTIME_APP_ID and REALTIME_APP_SECRET in chatd.env (commented lines
count); only those two reach the test server. Uses a few minutes of real SFU
audio (tens of MB). Like e2e.py it tests bin/chatd and web/dist unless
E2E_CHATD / E2E_WEB_DIST say otherwise. Run it under a memory watchdog.

  tools/.venv/bin/python tools/call_quality.py --label before [--only a,b] [--seconds 30]

Switches for experiments, in the environment:
  CQ_COPIES=n    pins how many copies voice frames carry (0 to 2), whatever the app decides
  CQ_NOPRIO=1    strips priority and networkPriority from every sender's parameters
  CQ_RED=1       prefers Opus with RED on audio senders (Cloudflare answers without it)
  CQ_SENDERS=1   prints what each speaker's streams and transport sent
  CQ_RR=1        prints alice's receiver reports and round trip every second
  CQ_DEBUG=1     prints the speaker's console lines that contain [voice-debug]
"""
import argparse, json, math, os, re, struct, subprocess, sys, tempfile, time, urllib.request, wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
env = {}
for line in open(ROOT / "chatd.env"):
    m = re.match(r"#?\s*([A-Z_]+)=(.*)", line.strip())
    if m and m.group(2):
        env[m.group(1)] = m.group(2)
for k in ("REALTIME_APP_ID", "REALTIME_APP_SECRET"):
    if k not in env:
        sys.exit(f"{k} is not in chatd.env")
    os.environ[k] = env[k]
# no TURN: every path to the SFU has to go through the simulated network
for k in ("TURN_KEY_ID", "TURN_API_TOKEN", "TURN_URLS"):
    os.environ.pop(k, None)

ap = argparse.ArgumentParser()
ap.add_argument("--label", default="run")
ap.add_argument("--only", default="")
ap.add_argument("--seconds", type=float, default=30)
ap.add_argument("--settle", type=float, default=6)
args = ap.parse_args()
sys.argv = [sys.argv[0]]
sys.path.insert(0, str(ROOT / "tools"))
from e2e import PASSWORD, Server, Session, free_port  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

OUT = ROOT / "tools/out/call-quality"
OUT.mkdir(parents=True, exist_ok=True)


def speech_wav(path, seconds=24, rate=48000):
    """A continuous voice-like signal: a gliding pitch with formant-shaped harmonics and a
    syllable rhythm that never goes quiet, so silence on the far side means a cut-out."""
    frames = bytearray()
    formants = [(700, 1200), (400, 2000), (550, 1700), (300, 2300), (650, 1000)]
    phase = [0.0] * 16
    for n in range(int(seconds * rate)):
        t = n / rate
        f0 = 150 + 45 * math.sin(2 * math.pi * 0.7 * t) + 20 * math.sin(2 * math.pi * 3.1 * t)
        f1, f2 = formants[int(t * 4) % len(formants)]
        s = 0.0
        for h in range(1, 16):
            fh = f0 * h
            if fh > 7000:
                break
            phase[h] += 2 * math.pi * fh / rate
            w = math.exp(-((fh - f1) / 250) ** 2) + 0.6 * math.exp(-((fh - f2) / 400) ** 2) + 0.08
            s += w * math.sin(phase[h]) / h ** 0.3
        env_ = 0.45 + 0.55 * abs(math.sin(math.pi * 4 * t))
        v = max(-1.0, min(1.0, 0.16 * env_ * s))
        frames += struct.pack("<h", int(v * 32000))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))


PATCH = r"""
(() => {
  const cfg = window.__netsim;
  const Native = window.RTCPeerConnection;
  window.__pcs = [];
  window.__iceRestarts = 0;
  function Patched(config, ...rest) {
    const pc = new Native(config, ...rest);
    window.__pcs.push(pc);
    return pc;
  }
  Patched.prototype = Native.prototype;
  Object.setPrototypeOf(Patched, Native);
  window.RTCPeerConnection = Patched;
  if (cfg && cfg.red) {
    // experiment: prefer Opus with redundancy (RED) on every audio sender
    const addT = Native.prototype.addTransceiver;
    Native.prototype.addTransceiver = function (trackOrKind, init) {
      const tr = addT.call(this, trackOrKind, init);
      const kind = typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind;
      if (kind === 'audio' && tr.setCodecPreferences) {
        const caps = RTCRtpSender.getCapabilities('audio').codecs;
        const red = caps.filter((c) => c.mimeType === 'audio/red');
        const rest = caps.filter((c) => c.mimeType !== 'audio/red');
        try { tr.setCodecPreferences([...red, ...rest]); } catch (e) { console.warn('red prefs failed', e); }
      }
      return tr;
    };
  }
  // the call's crypto worker: its counters (frames recovered from copies) and the copies it is asked to send
  const NativeWorker = window.Worker;
  window.__frameStats = null;
  window.__copyDepth = 0;
  window.__copyChanges = 0;
  function PatchedWorker(url, opts) {
    const w = new NativeWorker(url, opts);
    if (String(url).includes('frameCrypto')) {
      w.addEventListener('message', (e) => { if (e.data && e.data.type === 'stats') window.__frameStats = e.data; });
      const post = w.postMessage.bind(w);
      // CQ_COPIES pins how many copies voice frames carry, whatever the app decides
      const forced = window.__netsim && window.__netsim.copies;
      w.postMessage = (msg, ...rest) => {
        if (msg && msg.type === 'redundancy') { window.__copyChanges++; if (forced != null) msg = { ...msg, depth: forced }; window.__copyDepth = msg.depth; }
        return post(msg, ...rest);
      };
      if (forced != null) { window.__copyDepth = forced; post({ type: 'redundancy', depth: forced }); }
    }
    return w;
  }
  PatchedWorker.prototype = NativeWorker.prototype;
  window.Worker = PatchedWorker;
  if (cfg && cfg.noprio) {
    // CQ_NOPRIO: senders keep the browser's default priority
    const sp = RTCRtpSender.prototype.setParameters;
    RTCRtpSender.prototype.setParameters = function (params, ...rest) {
      for (const e of (params && params.encodings) || []) { delete e.priority; delete e.networkPriority; }
      return sp.call(this, params, ...rest);
    };
  }
  const restart = Native.prototype.restartIce;
  Native.prototype.restartIce = function () { window.__iceRestarts++; return restart.call(this); };
  if (cfg) {
    // every candidate of the far end is swapped for a leg of the simulated network that leads to it
    const legs = new Map();
    const legFor = (addr) => {
      if (!legs.has(addr)) legs.set(addr, fetch(cfg.ctrl + '/legs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: cfg.client, upstream: addr }) }).then((r) => r.json()).then((j) => j.port));
      return legs.get(addr);
    };
    const rewrite = async (sdp) => {
      const out = [];
      for (const line of sdp.split('\r\n')) {
        if (!line.startsWith('a=candidate:')) { out.push(line); continue; }
        const m = /^a=candidate:(\S+) (\d+) udp (\d+) ([0-9.]+) (\d+) typ (\S+)(.*)$/i.exec(line);
        if (!m) continue; // TCP and IPv6 candidates would go around it
        const port = await legFor(`${m[4]}:${m[5]}`);
        out.push(`a=candidate:${m[1]} ${m[2]} udp ${m[3]} 127.0.0.1 ${port} typ ${m[6]}${m[7]}`);
      }
      return out.join('\r\n');
    };
    const srd = Native.prototype.setRemoteDescription;
    window.__sdpLog = [];
    Native.prototype.setRemoteDescription = async function (desc) {
      if (desc && desc.sdp && desc.type !== 'rollback') {
        window.__sdpLog.push({ type: desc.type, audio: desc.sdp.split('\r\n').filter((l) => /^a=(rtpmap|fmtp):(63|111|109|96|97) /.test(l) || l.startsWith('m=audio')) });
        desc = { type: desc.type, sdp: await rewrite(desc.sdp) };
      }
      return srd.call(this, desc);
    };
    const sld = Native.prototype.setLocalDescription;
    Native.prototype.setLocalDescription = async function (desc) {
      const r = await sld.call(this, desc);
      const d = this.localDescription;
      if (d && d.sdp) window.__sdpLog.push({ type: 'local-' + d.type, audio: d.sdp.split('\r\n').filter((l) => l.startsWith('m=audio') || /^a=rtpmap:(63|111) /.test(l)) });
      return r;
    };
    const aic = Native.prototype.addIceCandidate;
    Native.prototype.addIceCandidate = async function (c) {
      if (c && c.candidate) return;
      return aic.call(this, c);
    };
  }
  // what the page plays for someone, in 10 ms loudness blocks; -1 while the app holds it silent on purpose
  const WORKLET = `class R extends AudioWorkletProcessor {
    constructor() { super(); this.acc = 0; this.n = 0; }
    process(inputs) {
      const ch = inputs[0] && inputs[0][0];
      const len = ch ? ch.length : 128;
      for (let i = 0; i < len; i++) { const v = ch ? ch[i] : 0; this.acc += v * v; if (++this.n === 480) { this.port.postMessage(Math.sqrt(this.acc / 480)); this.acc = 0; this.n = 0; } }
      return true;
    }
  }
  registerProcessor('rec', R);`;
  window.__rec = {};
  window.__record = async (userId) => {
    const prev = window.__rec[userId];
    if (prev) prev.stop();
    const ctx = new AudioContext({ sampleRate: 48000 });
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    const node = new AudioWorkletNode(ctx, 'rec');
    const rec = { blocks: [], els: 0, held: false, started: Date.now() };
    node.port.onmessage = (e) => rec.blocks.push(rec.held ? -1 : e.data);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);
    let el = null, src = null;
    const attach = () => {
      const cur = document.querySelector(`audio[data-voice-peer='${userId}']`);
      if (cur !== el) {
        if (src) { try { src.disconnect(); } catch {} src = null; }
        el = cur;
        if (el && el.srcObject) { src = ctx.createMediaStreamSource(el.srcObject); src.connect(node); rec.els++; }
      }
      rec.held = !!el && el.getAttribute('data-held') === 'true';
    };
    attach();
    const poll = setInterval(attach, 50);
    rec.stop = () => { clearInterval(poll); void ctx.close(); };
    window.__rec[userId] = rec;
    return !!el;
  };
  window.__takeRecord = (userId) => {
    const r = window.__rec[userId];
    if (!r) return null;
    return { blocks: r.blocks.splice(0), els: r.els, started: r.started };
  };
})();
"""

STATS = r"""
async () => {
  const out = [];
  for (const pc of window.__pcs || []) {
    if (pc.connectionState === 'closed') continue;
    const r = await pc.getStats();
    const codecs = {};
    r.forEach((s) => { if (s.type === 'codec') codecs[s.id] = s.mimeType + (s.sdpFmtpLine ? ' ' + s.sdpFmtpLine : ''); });
    r.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'audio') out.push({ dir: 'in', mid: s.mid, codec: codecs[s.codecId], packetsReceived: s.packetsReceived, packetsLost: s.packetsLost, jitter: s.jitter, concealedSamples: s.concealedSamples, silentConcealedSamples: s.silentConcealedSamples, concealmentEvents: s.concealmentEvents, totalSamplesReceived: s.totalSamplesReceived, inserted: s.insertedSamplesForDeceleration, removed: s.removedSamplesForAcceleration, jbDelay: s.jitterBufferDelay, jbEmitted: s.jitterBufferEmittedCount, jbTarget: s.jitterBufferTargetDelay, fecReceived: s.fecPacketsReceived, fecDiscarded: s.fecPacketsDiscarded, discarded: s.packetsDiscarded });
      if (s.type === 'outbound-rtp' && s.kind === 'audio') out.push({ dir: 'out', mid: s.mid, codec: codecs[s.codecId], packetsSent: s.packetsSent, bytesSent: s.bytesSent, targetBitrate: s.targetBitrate });
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') out.push({ dir: 'pair', rtt: s.currentRoundTripTime, available: s.availableOutgoingBitrate });
      if (s.type === 'transport') out.push({ dir: 'transport', mid: 'transport', packetsSent: s.packetsSent, bytesSent: s.bytesSent });
      if (s.type === 'outbound-rtp') out.push({ dir: 'outall', mid: s.mid + ':' + s.kind + ':' + s.ssrc, kind: s.kind, packetsSent: s.packetsSent, bytesSent: s.bytesSent, headerBytesSent: s.headerBytesSent, retransmittedPacketsSent: s.retransmittedPacketsSent, nackCount: s.nackCount, active: s.active });
    });
  }
  return { at: Date.now(), stats: out, pcs: (window.__pcs || []).length, restarts: window.__iceRestarts || 0, state: (window.__pcs || []).map((p) => p.connectionState).join(','), recovered: (window.__frameStats && window.__frameStats.recovered) || 0, depth: window.__copyDepth || 0 };
}
"""

RR = r"""
async () => {
  const out = [];
  for (const pc of window.__pcs || []) {
    if (pc.connectionState === 'closed') continue;
    (await pc.getStats()).forEach((s) => {
      if (s.type === 'remote-inbound-rtp' && s.kind === 'audio') out.push({ reports: s.reportsReceived, fractionLost: s.fractionLost, lost: s.packetsLost, rtt: s.roundTripTime, ts: Math.round(s.timestamp) % 100000 });
      if (s.type === 'outbound-rtp' && s.kind === 'audio') out.push({ sent: s.packetsSent });
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') out.push({ pairRtt: s.currentRoundTripTime, responses: s.responsesReceived });
    });
  }
  return JSON.stringify(out);
}
"""

COUNTERS = ["packetsReceived", "packetsLost", "concealedSamples", "silentConcealedSamples", "concealmentEvents", "totalSamplesReceived", "inserted", "removed", "jbDelay", "jbEmitted", "fecReceived", "fecDiscarded", "discarded"]


class Caller(Session):
    """A Session whose page may talk to netsim (no CSP) and whose WebRTC goes through it."""

    def __init__(self, browser, base, name, out, ctrl):
        self.base, self.name, self.out = base, name, out
        self.ctx = browser.new_context(viewport={"width": 1280, "height": 800}, permissions=["microphone", "camera"], bypass_csp=True)
        self.ctx.add_init_script("window.__netsim = " + json.dumps({"ctrl": ctrl, "client": name, "red": os.environ.get("CQ_RED") == "1", "copies": int(os.environ["CQ_COPIES"]) if os.environ.get("CQ_COPIES") else None, "noprio": os.environ.get("CQ_NOPRIO") == "1"}) + ";")
        self.ctx.add_init_script(PATCH)
        self.page = self.ctx.new_page()
        self.errors, self.trace, self.events, self.readies = [], [], [], 0
        self.page.on("pageerror", lambda e: self.errors.append(f"{name}: {e}"))
        self.page.on("console", lambda m: self.events.append(m.text[:300]) if m.type in ("warning", "error") else None)
        self.page.on("websocket", lambda ws: ws.on("framereceived", lambda p: self._frame(p)))

    def _frame(self, payload):
        if isinstance(payload, str) and payload.startswith('{"t":"ready"'):
            self.readies += 1


def api(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def page_api(page, method, path, body=None):
    return page.evaluate(
        """async ([method, path, body]) => {
          const res = await fetch('/api/v1' + path, { method, headers: { Authorization: 'Bearer ' + localStorage.getItem('ec.token'), 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
          let json = null; try { json = await res.json(); } catch {}
          return { status: res.status, body: json };
        }""",
        [method, path, body],
    )


def analyze(blocks, ref, skip=30):
    b = blocks[skip:]
    thr = ref * 0.12
    silent = [x < 0 or x < thr for x in b]
    runs, i = [], 0
    while i < len(silent):
        if silent[i]:
            j = i
            while j < len(silent) and silent[j]:
                j += 1
            if j - i >= 3:
                runs.append((i, j - i))
            i = j
        else:
            i += 1
    return {
        "seconds": round(len(b) / 100, 1),
        "dropouts": len(runs),
        "dropout_ms": sum(n for _, n in runs) * 10,
        "longest_ms": max((n for _, n in runs), default=0) * 10,
        "silent_pct": round(100 * sum(silent) / max(1, len(silent)), 2),
        "runs": runs,
    }


def out_kbps(before, after):
    """What this page's voice cost on the wire (payload bytes) over the scenario."""
    b = {x["mid"]: x for x in before["stats"] if x["dir"] == "out"}
    for x in after["stats"]:
        if x["dir"] == "out" and x["mid"] in b and after.get("at") and before.get("at"):
            secs = (after["at"] - before["at"]) / 1000
            sent = x["bytesSent"] - b[x["mid"]]["bytesSent"]
            # a connection made again starts its counters over
            return round(sent * 8 / 1000 / max(0.1, secs), 1) if sent >= 0 else None
    return None


def sender_rates(before, after):
    """Packets and kbps each outbound stream (and the whole transport) sent over the scenario."""
    secs = max(0.1, (after.get("at", 0) - before.get("at", 0)) / 1000)
    b = {x["mid"]: x for x in before["stats"] if x["dir"] in ("outall", "transport")}
    out = {}
    for x in after["stats"]:
        if x["dir"] not in ("outall", "transport"):
            continue
        was = b.get(x["mid"], {})
        pk = (x.get("packetsSent") or 0) - (was.get("packetsSent") or 0)
        kb = ((x.get("bytesSent") or 0) - (was.get("bytesSent") or 0)) * 8 / 1000
        row = {"pps": round(pk / secs, 1), "kbps": round(kb / secs, 1)}
        if x["dir"] == "outall":
            row["rtx_pps"] = round(((x.get("retransmittedPacketsSent") or 0) - (was.get("retransmittedPacketsSent") or 0)) / secs, 1)
            row["active"] = x.get("active")
        out[x["mid"]] = row
    return out


def deltas(before, after):
    prev = {x["mid"]: x for x in before["stats"] if x["dir"] == "in"}
    tot = {k: 0.0 for k in COUNTERS}
    codec = ""
    for x in after["stats"]:
        if x["dir"] != "in":
            continue
        codec = x.get("codec") or codec
        b = prev.get(x["mid"])
        for k in COUNTERS:
            now = x.get(k) or 0
            was = (b.get(k) or 0) if b else 0
            tot[k] += now - was if now >= was else now
    total = max(1.0, tot["totalSamplesReceived"])
    got = tot["packetsReceived"] + tot["packetsLost"]
    return {
        "concealed_pct": round(100 * tot["concealedSamples"] / total, 2),
        "silent_concealed_pct": round(100 * tot["silentConcealedSamples"] / total, 2),
        "stretch_pct": round(100 * (tot["inserted"] + tot["removed"]) / total, 2),
        "jb_ms": round(1000 * tot["jbDelay"] / tot["jbEmitted"], 1) if tot["jbEmitted"] else None,
        "loss_pct": round(100 * tot["packetsLost"] / got, 2) if got else None,
        "fec": int(tot["fecReceived"]),
        "late_discarded": int(tot["discarded"]),
        "events": int(tot["concealmentEvents"]),
        "codec": codec,
        "out_codec": next((x.get("codec") for x in after["stats"] if x["dir"] == "out"), ""),
        "rebuilds": after["pcs"] - before["pcs"],
        "recovered": (after.get("recovered") or 0) - (before.get("recovered") or 0),
        "sender_copies": after.get("depth", 0),
        "out_kbps": out_kbps(before, after),
        "uplink_kbps": next((round((x.get("available") or 0) / 1000) for x in after["stats"] if x["dir"] == "pair" and x.get("available")), None),
        "ice_restarts": after["restarts"] - before["restarts"],
    }


# --- scenarios -----------------------------------------------------------------
# Each names what happens to alice's and bob's links ("up" is towards Cloudflare) and,
# optionally, a timeline of changes: [seconds, client, dir, profile] or [seconds, client, "tcp", mode].
def S(name, desc, profiles=None, timeline=None, seconds=None):
    return {"name": name, "desc": desc, "profiles": profiles or {}, "timeline": timeline or [], "seconds": seconds}


MOBILE = {"loss": 0.04, "delay_ms": 60, "jitter_ms": 40, "spike_chance": 0.01, "spike_ms": 220}
SCENARIOS = [
    S("clean", "no impairment"),
    S("up-loss-5", "alice's uplink loses 5% at random", {"alice": {"up": {"loss": 0.05}}}),
    S("up-loss-15", "alice's uplink loses 15% at random", {"alice": {"up": {"loss": 0.15}}}),
    S("up-loss-30", "alice's uplink loses 30% at random", {"alice": {"up": {"loss": 0.30}}}),
    S("down-loss-5", "bob's downlink loses 5% at random", {"bob": {"down": {"loss": 0.05}}}),
    S("down-loss-15", "bob's downlink loses 15% at random", {"bob": {"down": {"loss": 0.15}}}),
    S("down-loss-30", "bob's downlink loses 30% at random", {"bob": {"down": {"loss": 0.30}}}),
    S("down-bursts-short", "bob's downlink loses bursts of ~60 ms (about 6%)", {"bob": {"down": {"burst_enter": 0.02, "burst_exit": 0.33}}}),
    S("down-bursts-long", "bob's downlink loses bursts of ~200 ms (about 20%)", {"bob": {"down": {"burst_enter": 0.025, "burst_exit": 0.1}}}),
    S("down-jitter-30", "bob's downlink jitters ±30 ms", {"bob": {"down": {"delay_ms": 40, "jitter_ms": 30}}}),
    S("down-jitter-80", "bob's downlink jitters ±80 ms", {"bob": {"down": {"delay_ms": 90, "jitter_ms": 80}}}),
    S("down-spikes", "bob's downlink stalls 300 ms on 2% of packets (Wi-Fi retries)", {"bob": {"down": {"delay_ms": 20, "jitter_ms": 15, "spike_chance": 0.02, "spike_ms": 300}}}),
    S("latency-300", "300 ms each way for both", {"alice": {"up": {"delay_ms": 150}, "down": {"delay_ms": 150}}, "bob": {"up": {"delay_ms": 150}, "down": {"delay_ms": 150}}}),
    S("up-cap-40", "alice's uplink capped at 40 kbps", {"alice": {"up": {"rate_kbps": 40}}}),
    S("up-cap-24", "alice's uplink capped at 24 kbps", {"alice": {"up": {"rate_kbps": 24}}}),
    S("down-cap-64", "bob's downlink capped at 64 kbps", {"bob": {"down": {"rate_kbps": 64}}}),
    S("down-cap-64-loss-5", "bob's downlink capped at 64 kbps and losing 5%", {"bob": {"down": {"rate_kbps": 64, "loss": 0.05}}}),
    S("down-flaps", "bob's downlink goes dark 1 s in every 8", {"bob": {"down": {"outage_every_ms": 8000, "outage_for_ms": 1000}}}),
    S("blackout-4", "alice loses all UDP for 4 s", timeline=[[6, "alice", "both", {"down": True}], [10, "alice", "both", {}]], seconds=30),
    S("blackout-15", "alice loses all UDP for 15 s", timeline=[[6, "alice", "both", {"down": True}], [21, "alice", "both", {}]], seconds=45),
    S("blackout-25", "alice loses all UDP for 25 s (about when the SFU lets go of her tracks)", timeline=[[6, "alice", "both", {"down": True}], [31, "alice", "both", {}]], seconds=55),
    S("blackout-40", "alice loses all UDP for 40 s (past the SFU keeping her tracks)", timeline=[[6, "alice", "both", {"down": True}], [46, "alice", "both", {}]], seconds=70),
    S("mobile-both", "both on a poor mobile link both ways (4% loss, ±40 ms jitter, spikes, 60 ms)", {"alice": {"up": MOBILE, "down": MOBILE}, "bob": {"up": MOBILE, "down": MOBILE}}),
    S("gateway-stall-20", "alice's signalling stalls for 20 s while media flows", timeline=[[5, "alice", "tcp", "stall"], [25, "alice", "tcp", "ok"]], seconds=45),
    S("gateway-reset", "alice's signalling connections are cut once while media flows", timeline=[[6, "alice", "tcp", "reset"]], seconds=30),
]


def main():
    only = {x for x in args.only.split(",") if x}
    scenarios = [s for s in SCENARIOS if not only or s["name"] in only or s["name"] == "clean"]
    tmp = Path(tempfile.mkdtemp(prefix="call-quality-"))
    wav = tmp / "speech.wav"
    speech_wav(wav)
    netsim_bin = tmp / "netsim"
    subprocess.run(["go", "build", "-o", str(netsim_bin), "./tools/netsim"], cwd=ROOT, check=True)
    srv = Server()
    ctrl_port, pa, pb = free_port(), free_port(), free_port()
    ctrl = f"http://127.0.0.1:{ctrl_port}"
    chatd = srv.base.replace("http://", "")
    ns = subprocess.Popen([str(netsim_bin), "-ctrl", f"127.0.0.1:{ctrl_port}", "-tcp", f"alice=127.0.0.1:{pa}>{chatd}", "-tcp", f"bob=127.0.0.1:{pb}>{chatd}"], stdout=open(tmp / "netsim.log", "w"), stderr=subprocess.STDOUT)
    time.sleep(0.5)
    results = []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", f"--use-file-for-fake-audio-capture={wav}", "--autoplay-policy=no-user-gesture-required"])
            alice = Caller(b, f"http://127.0.0.1:{pa}", "alice", OUT, ctrl)
            bob = Caller(b, f"http://127.0.0.1:{pb}", "bob", OUT, ctrl)
            callers = [alice, bob]
            alice.register("Alice")
            bob.register("Bob")
            for c in callers:
                # the test signal is loud and steady: voice activity and processing stay out of the way
                c.open_settings("voice")
                p = c.page
                for label in ("Automatically determine input sensitivity", "Noise suppression", "Echo cancellation", "Automatic gain control"):
                    box = p.locator(f"input[role=switch][aria-label='{label}']")
                    if box.is_checked():
                        box.click(force=True)
                        p.wait_for_timeout(150)
                p.locator("input[type=range][min='-100']").fill("-100")
                p.wait_for_timeout(1200)
                c.close_settings()
            a = alice.page
            a.goto(alice.base + "/channels/@me", wait_until="networkidle")
            a.click("button[aria-label='Add a Server']")
            a.fill("[data-testid=server-name]", "Calls")
            a.click("button:has-text('Create')")
            a.wait_for_selector("textarea[aria-label='Message #general']", timeout=20000)
            server_id = a.url.split("/channels/")[1].split("/")[0]
            a.click("button[aria-label='Invite People']")
            box = a.locator("[data-testid=invite-link]")
            box.wait_for(timeout=15000)
            link = ""
            for _ in range(80):
                link = box.input_value()
                if "#k=" in link:
                    break
                a.wait_for_timeout(100)
            a.keyboard.press("Escape")
            bp = bob.page
            bp.goto(link.replace(alice.base, bob.base), wait_until="networkidle")
            btn = bp.locator("button:has-text('Accept Invite'), button:has-text('Join')").first
            btn.wait_for(timeout=15000)
            btn.click()
            bp.wait_for_url("**/channels/*/*", timeout=20000)
            ids = {c.name: page_api(c.page, "GET", "/users/@me")["body"]["id"] for c in callers}
            for c in callers:
                c.page.goto(c.base + "/channels/" + server_id, wait_until="networkidle")
                c.page.locator("[data-channel]:has(span:text-is('General')) button").first.click()
                c.page.wait_for_selector("[data-testid=voice-status]", timeout=30000)
            peer = {"alice": ids["bob"], "bob": ids["alice"]}
            for c in callers:
                c.page.wait_for_selector(f"audio[data-voice-peer='{peer[c.name]}'][data-held=false]", state="attached", timeout=60000)
            print("call up; codec check and baseline next", flush=True)
            for c in callers:
                for entry in c.page.evaluate("() => window.__sdpLog")[:8]:
                    print(f"  {c.name} {entry['type']}: {entry['audio']}", flush=True)
            ref = {}
            for sc in scenarios:
                seconds = sc["seconds"] or args.seconds
                api("POST", ctrl + "/reset")
                for c in callers:
                    c.page.evaluate("(id) => window.__record(id)", peer[c.name])
                before = {c.name: c.page.evaluate(STATS) for c in callers}
                ev_before = {c.name: (len(c.events), c.readies) for c in callers}
                for client in ("alice", "bob"):
                    for d in ("up", "down"):
                        api("PUT", ctrl + "/profile", {"client": client, "dir": d, "profile": sc["profiles"].get(client, {}).get(d, {})})
                start = time.time()
                timeline = sorted(sc["timeline"], key=lambda x: x[0])
                depths = {c.name: "" for c in callers}
                next_sample = 0
                while time.time() - start < seconds:
                    if time.time() - start >= next_sample:
                        next_sample += 1
                        for c in callers:
                            try:
                                depths[c.name] += str(c.page.evaluate("() => window.__copyDepth || 0"))
                            except Exception:
                                depths[c.name] += "?"
                        if os.environ.get("CQ_RR"):
                            rr = alice.page.evaluate(RR)
                            print(f"   t={int(time.time() - start):>2}s alice rr: {rr}", flush=True)
                    now = time.time() - start
                    while timeline and timeline[0][0] <= now:
                        at, client, d, what = timeline.pop(0)
                        if d == "tcp":
                            api("PUT", ctrl + "/tcp", {"name": client, "mode": what})
                        else:
                            api("PUT", ctrl + "/profile", {"client": client, "dir": d, "profile": what})
                    a.wait_for_timeout(200)
                after = {c.name: c.page.evaluate(STATS) for c in callers}
                for client in ("alice", "bob"):
                    api("PUT", ctrl + "/profile", {"client": client, "dir": "both", "profile": {}})
                    api("PUT", ctrl + "/tcp", {"name": client, "mode": "ok"})
                net = api("GET", ctrl + "/stats")
                row = {"scenario": sc["name"], "desc": sc["desc"], "seconds": seconds, "net": net, "paths": {}}
                for c in callers:
                    rec = c.page.evaluate("(id) => window.__takeRecord(id)", peer[c.name]) or {"blocks": [], "els": 0}
                    blocks = rec["blocks"]
                    if sc["name"] == "clean":
                        loud = sorted(x for x in blocks[30:] if x > 0)
                        ref[c.name] = loud[len(loud) // 2] if loud else 0.05
                    heard = analyze(blocks, ref.get(c.name, 0.05))
                    if sc["timeline"]:
                        # how long sound took to come back after the last change of the timeline
                        end_at = max(x[0] for x in sc["timeline"])
                        idx = int(end_at * 100) - 30
                        back = None
                        thr = ref.get(c.name, 0.05) * 0.12
                        for i in range(max(0, idx), len(blocks) - 30 - 10):
                            if all(x >= thr for x in blocks[30 + i:30 + i + 10]):
                                back = (i - idx) * 10
                                break
                        heard["back_after_ms"] = back
                    stats = deltas(before[c.name], after[c.name])
                    # how many copies the speaker's frames carried by the end (the other page's setting)
                    other = "bob" if c.name == "alice" else "alice"
                    stats["sender_copies"] = after[other].get("depth", 0)
                    stats["sender_kbps"] = out_kbps(before[other], after[other])
                    stats["copies_series"] = depths[other]
                    stats["senders"] = sender_rates(before[other], after[other])
                    speaker = alice if other == "alice" else bob
                    stats["speaker_debug"] = [e for e in speaker.events[ev_before[other][0]:] if "[voice-debug]" in e]
                    stats["warnings"] = [e for e in c.events[ev_before[c.name][0]:] if "voice" in e][: (60 if os.environ.get("CQ_DEBUG") else 6)]
                    stats["gateway_readies"] = c.readies - ev_before[c.name][1]
                    stats["pc_state"] = after[c.name]["state"]
                    heard.pop("runs", None)
                    row["paths"][f"{'bob' if c.name == 'alice' else 'alice'}->{c.name}"] = {**heard, **stats, "elements": rec["els"]}
                results.append(row)
                print_row(row)
                a.wait_for_timeout(int(args.settle * 1000))
            errors = alice.errors + bob.errors
            b.close()
    finally:
        ns.terminate()
        srv.stop()
    path = OUT / f"results-{args.label}.json"
    path.write_text(json.dumps(results, indent=1))
    print("wrote", path)
    if errors:
        print("page errors:", errors[:10])


def print_row(row):
    for name, p in row["paths"].items():
        print(f"{row['scenario']:<20} {name:<11} drop {p['dropouts']:>3} ({p['dropout_ms']:>5} ms, longest {p['longest_ms']:>5})"
              f"  silent {p['silent_pct']:>5}%  conceal {p['concealed_pct']:>5}%  stretch {p['stretch_pct']:>5}%  jb {p['jb_ms']}ms"
              f"  loss {p['loss_pct']}% late {p.get('late_discarded')}  fec {p['fec']}  rec {p.get('recovered', 0)} copies {p.get('sender_copies', 0)} sent {p.get('sender_kbps')}kbps up {p.get('uplink_kbps')}k  rebuild {p['rebuilds']} ice {p['ice_restarts']} ready {p['gateway_readies']}"
              + (f"  back {p.get('back_after_ms')}ms" if "back_after_ms" in p else "") + f"  [in {p['codec']} | out {p['out_codec']}]", flush=True)
        for w in p["warnings"]:
            if "[voice-debug]" not in w:
                print("      ", w, flush=True)
        for w in p.get("speaker_debug", []) if os.environ.get("CQ_DEBUG") else []:
            print("       speaker:", w, flush=True)
        print(f"{'':<20} {name:<11} speaker sent: {p.get('senders')}", flush=True) if os.environ.get("CQ_SENDERS") else None
        if p.get("copies_series") and set(p["copies_series"]) != {"0"}:
            print(f"{'':<20} {name:<11} copies over time: {p['copies_series']}", flush=True)


if __name__ == "__main__":
    main()
