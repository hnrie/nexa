// The advert as Remotion draws it: the takes (as picture frames) in windows
// placed in 3D on a coloured stage, the words, the song. The timeline itself
// (which take is where, when, framed how) comes from tools/advert_edit.py,
// which measures the song and lays the cut on its beats; this file draws any
// moment of it.
import React from "react";
import { AbsoluteFill, Audio, Freeze, Img, interpolate, useCurrentFrame } from "remotion";
import { along, bezier, cameraAt, clamp, easeIn, easeInOut, easeOut, float, lerp, sineInOut } from "./motion";
import { fontFamily } from "./font";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Spec = any;

const BAR = 30;

// ---------------------------------------------------------------------------
// layouts: where each kind of scene puts its windows (centre, width, turn)

type Place = { x: number; y: number; w?: number; h?: number; vh?: number; z?: number; rx: number; ry: number; dof?: number; phase?: number; phone?: boolean; screen?: boolean };

function layout(name: string, u: number): Place[] {
  switch (name) {
    case "single": return [{ x: 960, y: 602, w: 1520, rx: 1.2, ry: lerp(-2, 2, u) }];
    case "right": return [{ x: 1270, y: 548, w: 1160, rx: 3, ry: lerp(-12, -9, u) }];
    case "left": return [{ x: 650, y: 548, w: 1160, rx: 3, ry: lerp(12, 9, u) }];
    case "pair": return [
      { x: 660, y: 470, w: 1000, z: -300, rx: 2, ry: lerp(10, 7, u), dof: 1.6, phase: 1.7 },
      { x: 1280, y: 650, w: 1000, z: 0, rx: 2, ry: lerp(-8, -5, u) }];
    case "phoneTall": return [{ x: 540, y: 1095, w: 984, vh: 1500, rx: 0, ry: 0, screen: true }];
    case "duo": return [
      { x: 720, y: 600, w: 1180, rx: 2, ry: lerp(9, 6, u) },
      { x: 1575, y: 600, h: 820, rx: 2, ry: lerp(-15, -11, u), phone: true, phase: 2.3 }];
  }
  return [];
}

// a slot's size: the box it draws, and the view its picture shows through
function slotSize(pl: Place) {
  if (pl.screen) { const w = pl.w!, vh = pl.vh!; return { w, h: vh, vw: w, vh, iw: w, ih: Math.round((w * 1170) / 540), kind: "screen" }; }
  if (pl.phone) { const h = pl.h!, w = Math.round((h * 540) / 1170); return { w: w + 26, h: h + 26, vw: w, vh: h, iw: w, ih: h, kind: "phone" }; }
  const w = pl.w!, h = Math.round(pl.vh || (w * 9) / 16);
  const iw = Math.round(Math.max(w, (h * 16) / 9)), ih = Math.round((iw * 9) / 16);
  return { w, h: h + BAR, vw: w, vh: h, iw, ih, kind: "win" };
}

// ---------------------------------------------------------------------------
// pictures

function frameSrc(spec: Spec, src: any, t: number) {
  const f = spec.frames[src.key];
  const i = Math.round(clamp((along(src.map, t) - f.lo) * spec.fps, 0, f.n - 1));
  return `${spec.base}frames/${src.key}/${String(i + 1).padStart(5, "0")}.jpg`;
}

// where a camera puts the picture inside its view
function framing(cam: any, t: number, s0: number, s1: number, sz: ReturnType<typeof slotSize>) {
  if (!cam) return "none";
  let z: number, fx: number, fy: number;
  if (Array.isArray(cam)) {
    // an older framing: a slow push from z0 to z1 about a point
    const u = sineInOut(clamp((t - s0) / (s1 - s0)));
    const [z0, cx, cy, z1] = cam;
    z = Math.max(1, lerp(z0, z1 ?? z0, u));
    const k = clamp((z - 1) / 0.4);
    const tx = clamp(lerp(cx * sz.iw, sz.vw / 2, k) - z * cx * sz.iw, sz.vw - z * sz.iw, 0);
    const ty = clamp(lerp(cy * sz.ih, sz.vh / 2, k) - z * cy * sz.ih, sz.vh - z * sz.ih, 0);
    return `translate(${tx}px, ${ty}px) scale(${z})`;
  }
  [z, fx, fy] = cameraAt(cam.keys, t, cam.keys[0][0]);
  z = Math.max(1, z * (1 + (cam.drift ?? 0.02) * sineInOut(clamp((t - s0) / (s1 - s0)))));
  const tx = clamp(sz.vw / 2 - z * fx * sz.iw, sz.vw - z * sz.iw, 0);
  const ty = clamp(sz.vh / 2 - z * fy * sz.ih, sz.vh - z * sz.ih, 0);
  return `translate(${tx}px, ${ty}px) scale(${z})`;
}

const XFADE = 0.16; // a cut inside a window dissolves over this long

// what a window shows at t: its piece then, the one before it fading out
// over the first moments, and before its first piece, that piece's first frame
function piecesFor(spec: Spec, rig: number, slot: number, t: number) {
  const mine = spec.pieces.filter((p: any) => p.rig === rig && p.slot === slot).sort((a: any, b: any) => a.t0 - b.t0);
  if (!mine.length) return { p: null, q: null, mix: 0 };
  let i = mine.findIndex((p: any) => t >= p.t0 && t < p.t1);
  if (i < 0) i = t < mine[0].t0 ? 0 : mine.reduce((k: number, p: any, j: number) => (p.t0 <= t ? j : k), 0);
  const p = mine[i], q = i > 0 ? mine[i - 1] : null;
  const u = (t - p.t0) / XFADE;
  return { p, q: q && u >= 0 && u < 1 ? q : null, mix: q ? 1 - easeInOut(clamp(u)) : 0 };
}

const Picture: React.FC<{ spec: Spec; r: any; rig: number; k: number; t: number; sz: ReturnType<typeof slotSize> }> = ({ spec, r, rig, k, t, sz }) => {
  const { p, q, mix } = piecesFor(spec, rig, k, t);
  const img = (piece: any, opacity: number) => {
    const cam = piece.cam ?? r.cams?.[k];
    const tf = piece.cam ? framing(cam, t, piece.t0, piece.t1, sz) : framing(cam, t, r.s0, r.s1, sz);
    return (
      <Img src={frameSrc(spec, piece.src, Math.min(Math.max(t, piece.t0), piece.t1 - 1e-3))}
        style={{ position: "absolute", left: 0, top: 0, width: sz.iw, height: sz.ih, transformOrigin: "0 0", transform: tf, opacity }} />
    );
  };
  return (
    <div style={{ position: "relative", width: sz.vw, height: sz.vh, overflow: "hidden", borderRadius: sz.kind === "phone" ? 49 : 0 }}>
      {p && img(p, 1)}
      {q && mix > 0.002 && img(q, mix)}
    </div>
  );
};

const Frame: React.FC<{ sz: ReturnType<typeof slotSize>; title: string; children: React.ReactNode }> = ({ sz, title, children }) => {
  if (sz.kind === "screen") return <div className="screen">{children}</div>;
  if (sz.kind === "phone") return <div className="phone">{children}<div className="island" /></div>;
  return (
    <div className="win">
      <div className="bar"><i /><i /><i /><span>{title}</span></div>
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// how a scene arrives and leaves

export function sceneMotion(spec: Spec, r: any, t: number) {
  const D = spec.trans ?? 0.9, W = spec.size[0];
  const o = { dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, s: 1, op: 1, blur: 0 };
  if (r.enter === "glide") {
    // a push: the scene before and this one travel as one strip, a camera
    // panning from one to the next, easing back a little as it goes
    const u = clamp((t - (r.s0 - D / 2)) / D);
    if (u < 1) { const e = easeInOut(u); o.dx += W * (1 - e); o.dz -= 260 * Math.sin(Math.PI * u); }
  } else {
    const ein = r.enterDur || 0.75, u = clamp((t - r.s0) / ein);
    if (u < 1) {
      if (r.enter === "rise") { const e = bezier(0.5, 0, 0.1, 1)(u); o.dy += 760 * (1 - e); o.rx += 22 * (1 - e); o.dz -= 260 * (1 - e); }
      else if (r.enter === "far") { const e = easeOut(u); o.dz -= 1100 * (1 - e); o.op *= clamp(u * 1.8); o.blur += 8 * (1 - e); }
      else if (r.enter === "focus") { const e = easeOut(u); o.s *= lerp(0.92, 1, e); o.op *= clamp(u * 2.5); o.blur += 14 * (1 - e); }
    }
  }
  if (r.exit === "glide") {
    const v = clamp((t - (r.s1 - D / 2)) / D);
    if (v > 0) { const e = easeInOut(v); o.dx -= W * e; o.dz -= 260 * Math.sin(Math.PI * v); }
  } else if (r.exit === "recede") {
    const eout = r.exitDur || 0.5, v = clamp((t - (r.s1 - eout)) / eout);
    if (v > 0) { const e = easeIn(v); o.dz -= 900 * e; o.op *= 1 - sineInOut(v); o.blur += 8 * e; }
  }
  return o;
}

export function sceneOn(spec: Spec, r: any, t: number) {
  const D = spec.trans ?? 0.9;
  return t >= r.s0 - (r.enter === "glide" ? D / 2 : 0) && t < r.s1 + (r.exit === "glide" ? D / 2 : 0);
}

const Scene: React.FC<{ spec: Spec; r: any; i: number; t: number }> = ({ spec, r, i, t }) => {
  const u = clamp((t - r.s0) / (r.s1 - r.s0));
  const o = sceneMotion(spec, r, t);
  if (r.layout === "wall") {
    // every screen at once, arriving one after another, the wall drifting back into the dark
    const e = sineInOut(u), cols = 4, rows = 3, w = 540, gap = 44;
    const sz = slotSize({ x: 0, y: 0, w, rx: 0, ry: 0 });
    return (
      <div style={{ position: "absolute", inset: 0, opacity: o.op, filter: o.blur > 0.2 ? `blur(${o.blur}px)` : undefined, transform: `translateX(${o.dx}px)` }}>
        <div className="wall" style={{ transform: `translateZ(${lerp(-150, -760, e) + o.dz}px) rotateX(${lerp(22, 15, e)}deg) rotateY(${lerp(-20, -12, e)}deg) rotateZ(${lerp(5, 3, e)}deg) translateY(${lerp(50, -30, e)}px)` }}>
          {Array.from({ length: cols * rows }, (_, k) => {
            const a = easeOut(clamp((t - r.s0 - (r.stagger || 0.06) * k) / 1.1));
            const gx = ((k % cols) - (cols - 1) / 2) * (w + gap), gy = (Math.floor(k / cols) - (rows - 1) / 2) * (sz.h + gap);
            return (
              <div key={k} className="slot" style={{ transform: `translate3d(${gx - sz.w / 2}px, ${gy - sz.h / 2}px, ${lerp(-420, 0, a)}px)`, opacity: clamp(a * 1.4) }}>
                <Frame sz={sz} title="Nexa"><Picture spec={spec} r={r} rig={i} k={k} t={t} sz={sz} /></Frame>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  const places = layout(r.layout, sineInOut(u));
  return (
    <>
      {places.map((pl, k) => {
        const sz = slotSize(pl), fl = float(t, pl.phase || 0);
        const blur = (pl.dof || 0) + o.blur;
        return (
          <div key={k} className="slot" style={{
            transform: `translate3d(${pl.x - sz.w / 2 + o.dx}px, ${pl.y - sz.h / 2 + o.dy + fl.y}px, ${(pl.z || 0) + o.dz}px) rotateX(${pl.rx + o.rx + fl.rx}deg) rotateY(${pl.ry + o.ry + fl.ry}deg) scale(${o.s})`,
            opacity: o.op, filter: blur > 0.2 ? `blur(${blur}px)` : undefined,
          }}>
            <Frame sz={sz} title={r.titles?.[k] || "Nexa"}><Picture spec={spec} r={r} rig={i} k={k} t={t} sz={sz} /></Frame>
          </div>
        );
      })}
    </>
  );
};

// ---------------------------------------------------------------------------
// words, each kind moving its own way

const Words: React.FC<{ spec: Spec; t: number }> = ({ spec, t }) => {
  return (
    <>
      {spec.texts.map((it: any, n: number) => {
        // a title belonging to a scene travels with it, and stays until it is gone
        const rig = it.rig != null ? spec.rigs[it.rig] : null;
        const t1 = rig && rig.exit === "glide" ? rig.s1 + (spec.trans ?? 0.9) / 2 : it.t1;
        if (t < it.t0 || t >= t1) return null;
        const ride = rig ? sceneMotion(spec, rig, t).dx : 0;
        return <Text key={n} it={it} t={t} t1={t1} ride={ride} rides={!!rig} brand={spec.brand} />;
      })}
    </>
  );
};

const exitOf = (t: number, t1: number, dur: number) => clamp((t - (t1 - dur)) / dur);

const Text: React.FC<{ it: any; t: number; t1: number; ride: number; rides: boolean; brand: any }> = ({ it, t, t1, ride, rides, brand }) => {
  const size = it.size ? { fontSize: it.size } : {};
  if (it.kind === "headline") {
    // word by word on the piano, out of a soft focus, the spacing closing up as it lands
    const words = it.lines.flatMap((l: string, li: number) => l.split(" ").map((w: string) => ({ w, li })));
    const x = sineInOut(exitOf(t, t1, 0.8));
    const [ma, mb, dy, sc] = it.move || [0, 1, 0, 1];
    const m = easeOut(clamp((t - ma) / (mb - ma)));
    let wi = 0;
    return (
      <div className="text headline" style={{ top: it.y, ...size, opacity: 1 - x, filter: x ? `blur(${x * 12}px)` : undefined,
        transformOrigin: "50% 0", transform: `translateY(${-x * 60 + dy * m}px) scale(${lerp(1, sc, m)})` }}>
        {it.lines.map((_: string, li: number) => (
          <span className="line" key={li}>
            {words.filter((w: any) => w.li === li).map((w: any) => {
              const at = it.times[wi++], e = easeOut(clamp((t - at) / 1.2));
              return <React.Fragment key={wi}><span className="c" style={{ opacity: clamp((t - at) / 0.4), filter: `blur(${(1 - e) * 10}px)`, transform: `translateY(${(1 - e) * 0.16}em)`, letterSpacing: `${(1 - e) * 0.05}em` }}>{w.w}</span>{" "}</React.Fragment>;
            })}
          </span>
        ))}
      </div>
    );
  }
  if (it.kind === "title") {
    // word by word up out of each line's mask; a title on its own leaves the
    // same way, one riding its scene leaves with it
    const lines: string[] = it.text.split("\n");
    const n = lines.join(" ").split(" ").length;
    const place: React.CSSProperties = it.place === "left" ? { left: 110, top: 548, translate: "0 -50%" }
      : it.place === "right" ? { right: 110, top: 548, translate: "0 -50%", textAlign: "right" } : {};
    let wi = 0;
    return (
      <div className={`text title ${it.place === "top" ? "top" : "side"}`} style={{ ...place, ...(it.y != null ? { top: it.y } : {}), ...size, transform: `translateX(${ride}px)` }}>
        {lines.map((l, li) => (
          <span className="ln" key={li}>
            {l.split(" ").map((w) => {
              const i = wi++, at = it.t0 + i * 0.055, e = easeOut(clamp((t - at) / 0.95));
              const out = rides ? 0 : easeIn(clamp((t - (t1 - 0.4 + (i - n) * 0.02)) / 0.36));
              return <React.Fragment key={i}><span className="c" style={{ transform: `translateY(${(1 - e) * 105 - out * 105}%)` }}>{w}</span>{" "}</React.Fragment>;
            })}
          </span>
        ))}
      </div>
    );
  }
  if (it.kind === "statement") {
    // each word lands on its beat, rising out of the line
    const words: string[] = it.text.split(" ");
    const x = sineInOut(exitOf(t, it.t1, 0.4));
    return (
      <div className="text statement" style={{ ...(it.y != null ? { top: it.y } : {}), ...size, opacity: 1 - x, filter: x ? `blur(${x * 10}px)` : undefined }}>
        <span className="ln">
          {words.map((w, i) => {
            const e = easeOut(clamp((t - it.times[i]) / 0.8));
            return <React.Fragment key={i}><span className="c" style={{ transform: `translateY(${(1 - e) * 105}%)` }}>{w}</span>{" "}</React.Fragment>;
          })}
        </span>
      </div>
    );
  }
  if (it.kind === "tagline" || it.kind === "url") {
    // the last words resolve slowly, letter by letter
    const cs = [...it.text];
    return (
      <div className={`text ${it.kind}`} style={{ ...(it.y != null ? { top: it.y } : {}), ...size }}>
        {cs.map((c, i) => {
          const at = it.t0 + i * (it.kind === "url" ? 0.03 : 0.04), e = easeOut(clamp((t - at) / 1.3));
          return c === " " ? " " : <span key={i} className="c" style={{ opacity: clamp((t - at) / 0.7), filter: `blur(${(1 - e) * 6}px)` }}>{c}</span>;
        })}
      </div>
    );
  }
  if (it.kind === "wordmark") {
    // the letters come out of focus as they rise; the sparkles turn in after
    const e = easeOut(clamp((t - it.t0) / 1.4));
    const x = sineInOut(exitOf(t, it.t1, 0.6));
    const sparks = brand.spark.split("Z").filter((d: string) => d.trim());
    return (
      <div className="mark" style={{ top: it.y - it.size / 2, opacity: 1 - x, filter: `blur(${(1 - e) * 12 + x * 10}px)`, transform: `translateY(${(1 - e) * 24 - x * 40}px)` }}>
        <svg height={it.size} viewBox="0 0 229.45 100" style={{ overflow: "visible" }}>
          <path d={brand.letters} fill="#fff" fillRule="evenodd" style={{ opacity: clamp((t - it.t0) / 0.5) }} />
          {sparks.map((d: string, k: number) => {
            const a0 = t - it.t0 - 0.35 - k * 0.14, a = easeOut(clamp(a0 / 1.2));
            return <path key={k} d={d + "Z"} fill="#a160ff" style={{ transformBox: "fill-box", transformOrigin: "50% 50%", opacity: clamp(a0 / 0.3), transform: `rotate(${(1 - a) * -90}deg) scale(${lerp(0.3, 1, a)})` }} />;
          })}
        </svg>
      </div>
    );
  }
  return null;
};

// ---------------------------------------------------------------------------
// the room: light that follows the scene

function hex(c: string) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixC(a: string, b: string, u: number) { const x = hex(a), y = hex(b); return x.map((v, i) => Math.round(lerp(v, y[i], u))).join(","); }

const Room: React.FC<{ spec: Spec; t: number }> = ({ spec, t }) => {
  const bg = spec.bg;
  let i = 0;
  while (i + 1 < bg.length && bg[i + 1][0] <= t) i++;
  const cur = bg[i], prev = bg[Math.max(0, i - 1)];
  const u = i === 0 ? 1 : sineInOut(clamp((t - cur[0]) / 1.4));
  const a = mixC(prev[1], cur[1], u), b = mixC(prev[2], cur[2], u), g = lerp(prev[3], cur[3], u);
  const [W, H] = spec.size, sx = W / 1920, sy = H / 1080;
  return (
    <AbsoluteFill style={{ background: "#0e0b16" }}>
      <div className="glow" style={{ left: (440 + Math.sin(t * 0.21) * 110) * sx, top: (170 + Math.cos(t * 0.17) * 70) * sy, background: `radial-gradient(closest-side, rgba(${a},${0.9 * g}), rgba(${a},0))` }} />
      <div className="glow" style={{ left: (1540 + Math.cos(t * 0.19) * 110) * sx, top: (990 + Math.sin(t * 0.23) * 70) * sy, background: `radial-gradient(closest-side, rgba(${b},${0.8 * g}), rgba(${b},0))` }} />
    </AbsoluteFill>
  );
};

// fine film grain, the same pattern moved every frame
const GRAIN = (() => {
  if (typeof document === "undefined") return "";
  const c = document.createElement("canvas");
  c.width = c.height = 384;
  const g = c.getContext("2d")!, d = g.createImageData(384, 384);
  let s = 1234567;
  for (let i = 0; i < d.data.length; i += 4) { s = (s * 1103515245 + 12345) >>> 0; const v = s >>> 24; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0);
  return c.toDataURL();
})();

const Moving: React.FC<{ spec: Spec }> = ({ spec }) => {
  const frame = useCurrentFrame();
  const t = spec.span[0] + frame / spec.fps;
  const [W, H] = spec.size;
  return (
    <AbsoluteFill>
      <Room spec={spec} t={t} />
      <AbsoluteFill style={{ perspective: 2600, perspectiveOrigin: `${W / 2}px ${H * 0.52}px` }}>
        {spec.rigs.map((r: any, i: number) => (sceneOn(spec, r, t) ? <Scene key={i} spec={spec} r={r} i={i} t={t} /> : null))}
      </AbsoluteFill>
      <AbsoluteFill><Words spec={spec} t={t} /></AbsoluteFill>
    </AbsoluteFill>
  );
};

// How far things on screen travel in a frame at t, in pixels, roughly: the
// scenes coming and going, and the cameras inside their windows.
function speedAt(spec: Spec, t: number) {
  const dt = 1 / spec.fps;
  let v = 0;
  for (const r of spec.rigs) {
    if (!sceneOn(spec, r, t) && !sceneOn(spec, r, t - dt)) continue;
    const a = sceneMotion(spec, r, t), b = sceneMotion(spec, r, t - dt);
    v = Math.max(v, Math.hypot(a.dx - b.dx, a.dy - b.dy, (a.dz - b.dz) * 0.5));
    if (r.layout === "wall") v = Math.max(v, 3);
    const places = r.layout === "wall" ? [] : layout(r.layout, 0);
    places.forEach((pl, k) => {
      const sz = slotSize(pl);
      const { p } = piecesFor(spec, spec.rigs.indexOf(r), k, t);
      const cam = p?.cam ?? r.cams?.[k];
      if (!cam || Array.isArray(cam)) return;
      const [z1, x1, y1] = cameraAt(cam.keys, t, cam.keys[0][0]);
      const [z0, x0, y0] = cameraAt(cam.keys, t - dt, cam.keys[0][0]);
      v = Math.max(v, Math.abs(z1 - z0) * sz.vw + Math.hypot((x1 - x0) * sz.iw * z1, (y1 - y0) * sz.ih * z1));
    });
  }
  for (const it of spec.texts) {
    if (it.move && t > it.move[0] && t < it.move[1] + 0.3) v = Math.max(v, 8);
  }
  return v;
}

// A film camera's shutter: the frame is the average of the moments its
// shutter was open (180 degrees, half a frame), so anything moving fast blurs
// along its path. A still frame needs one sample; a fast one gets eight.
const ShutterBlur: React.FC<{ spec: Spec; frame: number; children: React.ReactNode }> = ({ spec, frame, children }) => {
  const v = speedAt(spec, spec.span[0] + frame / spec.fps);
  const n = v < 1.5 ? 1 : v < 6 ? 4 : 8;
  if (n === 1) return <AbsoluteFill>{children}</AbsoluteFill>;
  const shutter = (spec.shutter ?? 180) / 360;
  return (
    <AbsoluteFill style={{ isolation: "isolate" }}>
      {Array.from({ length: n }, (_, i) => (
        <AbsoluteFill key={i} style={{ mixBlendMode: "plus-lighter", filter: `opacity(${1 / n})` }}>
          <Freeze frame={frame - shutter * ((i + 0.5) / n - 0.5)}>{children}</Freeze>
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
};

export const Advert: React.FC<{ spec: Spec }> = ({ spec }) => {
  const frame = useCurrentFrame();
  const t = spec.span[0] + frame / spec.fps;
  const [f0, f1] = spec.fade;
  // the song from where the cut starts; it fades with the picture when the cut ends first
  const songEnd = spec.songEnd ?? 1e9;
  return (
    <AbsoluteFill style={{ background: "#000", fontFamily, color: "#fff" }}>
      <style>{CSS}</style>
      <ShutterBlur spec={spec} frame={frame}>
        <Moving spec={spec} />
      </ShutterBlur>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 75% 70% at 50% 48%, transparent 55%, rgba(0,0,0,.5) 100%)" }} />
      <AbsoluteFill style={{ backgroundImage: `url(${GRAIN})`, opacity: 0.045, mixBlendMode: "overlay", backgroundPosition: `${(frame * 137) % 384}px ${(frame * 263) % 384}px` }} />
      <AbsoluteFill style={{ background: "#000", opacity: sineInOut(clamp((t - f0) / (f1 - f0))) }} />
      <Audio src={spec.base + spec.song} trimBefore={Math.round(spec.span[0] * spec.fps)}
        volume={(f) => interpolate(spec.span[0] + f / spec.fps, [songEnd - 1.6, songEnd], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    </AbsoluteFill>
  );
};

const CSS = `
.glow { position: absolute; width: 1900px; height: 1900px; margin: -950px 0 0 -950px; border-radius: 50%; }
.slot { position: absolute; left: 0; top: 0; transform-origin: 50% 50%; backface-visibility: hidden; }
.win { border-radius: 14px; overflow: hidden; background: #17151d;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 0 0 1px rgba(255,255,255,.07), 0 2px 6px rgba(0,0,0,.25), 0 28px 60px rgba(0,0,0,.35), 0 60px 140px rgba(0,0,0,.45); }
.bar { position: relative; height: 30px; background: #1d1a24; display: flex; align-items: center; padding-left: 14px; gap: 8px; }
.bar i { width: 12px; height: 12px; border-radius: 50%; display: block; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.25); }
.bar i:nth-child(1) { background: #ff5f57; } .bar i:nth-child(2) { background: #febc2e; } .bar i:nth-child(3) { background: #28c840; }
.bar span { position: absolute; left: 0; right: 0; text-align: center; font-size: 13px; font-weight: 600; color: rgba(255,255,255,.5); }
.screen { border-radius: 46px; overflow: hidden; background: #17151d; box-shadow: 0 0 0 1px rgba(255,255,255,.1), 0 30px 70px rgba(0,0,0,.4), 0 70px 160px rgba(0,0,0,.45); }
.phone { position: relative; padding: 13px; border-radius: 62px; background: #0b0b0e; box-shadow: 0 0 0 2px #3a3940, 0 0 0 3px #111, 0 28px 60px rgba(0,0,0,.35), 0 60px 140px rgba(0,0,0,.45); }
.phone .island { position: absolute; left: 50%; top: 26px; width: 118px; height: 34px; margin-left: -59px; border-radius: 20px; background: #000; z-index: 2; }
.wall { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform-style: preserve-3d; }
.text { position: absolute; white-space: nowrap; }
.c { display: inline-block; }
.ln { display: block; overflow: hidden; padding: 0.06em 0.04em 0.16em; margin: -0.06em -0.04em -0.16em; }
.headline { left: 0; right: 0; text-align: center; font-size: 118px; font-weight: 760; line-height: 1.04; letter-spacing: -.035em; }
.headline .line { display: block; }
.title { font-size: 52px; font-weight: 700; letter-spacing: -.025em; }
.title.top { left: 0; right: 0; top: 64px; text-align: center; }
.title.side { font-size: 92px; line-height: 1.02; letter-spacing: -.04em; width: 640px; }
.statement { left: 0; right: 0; text-align: center; font-size: 132px; font-weight: 760; letter-spacing: -.04em; top: 455px; }
.tagline { left: 0; right: 0; top: 602px; text-align: center; font-size: 46px; font-weight: 600; letter-spacing: -.02em; }
.url { left: 0; right: 0; top: 672px; text-align: center; font-size: 96px; font-weight: 700; letter-spacing: -.02em; }
.mark { position: absolute; left: 0; right: 0; display: flex; justify-content: center; }
`;
