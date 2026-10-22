// The maths of the advert's motion: easing curves, the camera's smoothed
// path, how a scene comes and goes. Everything is a pure function of time,
// so any frame (or a fraction of one, for motion blur) is drawn the same.

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

// a cubic Bézier easing, as CSS's cubic-bezier() reads it
export const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x, d = dx(t);
      if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return sy(clamp(t));
  };
};
// arriving: quick to start, a long soft landing
export const easeOut = bezier(0.16, 1, 0.3, 1);
// travelling from one place to another: gathers speed, then lets it go
export const easeInOut = bezier(0.65, 0, 0.35, 1);
// a gentler one, for things that drift
export const sineInOut = (u: number) => -(Math.cos(Math.PI * u) - 1) / 2;
export const easeIn = bezier(0.55, 0, 0.75, 0.2);

export function along(map: number[][], t: number) {
  if (t <= map[0][0]) return map[0][1];
  for (let i = 1; i < map.length; i++) {
    const [a, sa] = map[i - 1], [b, sb] = map[i];
    if (t <= b) return lerp(sa, sb, (t - a) / Math.max(1e-6, b - a));
  }
  return map[map.length - 1][1];
}

// The camera inside a window follows its keys the way a camera operator
// would: each key [t, zoom, fx, fy, move] becomes the target `move` seconds
// before t, and the framing follows the target through three smoothing
// stages, so it starts softly, travels, and settles without ever stopping
// dead, even when a new target arrives mid-move. Zoom is followed on a log
// scale so it changes at an even rate to the eye.
export function cameraAt(keys: number[][], t: number, start: number): [number, number, number] {
  const k0 = keys[0];
  const s = [Math.log(k0[1]), k0[2], k0[3]];
  const st = [s.slice(), s.slice(), s.slice()];
  const dt = 1 / 240;
  let tt = start;
  let target = s.slice();
  let omega = 8;
  let ki = 1;
  while (tt < t) {
    while (ki < keys.length) {
      const [kt, z, fx, fy, mv = 0.9] = keys[ki];
      if (tt < kt - mv) break;
      target = [Math.log(z), fx, fy];
      omega = 6.3 / Math.max(0.05, mv);
      ki++;
    }
    const h = Math.min(dt, t - tt);
    const a = 1 - Math.exp(-omega * h);
    for (let d = 0; d < 3; d++) {
      st[0][d] += (target[d] - st[0][d]) * a;
      st[1][d] += (st[0][d] - st[1][d]) * a;
      st[2][d] += (st[1][d] - st[2][d]) * a;
    }
    tt += h;
  }
  return [Math.exp(st[2][0]), st[2][1], st[2][2]];
}

// a slow float on every window, from the song's own clock, so a cut never resets it
export function float(t: number, phase = 0) {
  const TAU = Math.PI * 2;
  return {
    y: Math.sin((TAU * t) / 5.6 + phase) * 6,
    rx: Math.cos((TAU * t) / 6.4 + phase) * 0.5,
    ry: Math.sin((TAU * t) / 8.2 + phase * 0.7) * 0.7,
  };
}
