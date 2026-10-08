import { useEffect, useRef, useSyncExternalStore } from "react";
import { useActiveSeason } from "@/components/common/SeasonalPerch";
import { useSettings } from "@/stores/settings";
import s from "./SnowFall.module.css";

/**
 * Snow falling behind the messages, for a seasonal theme that has it (Winter
 * Night), unless turned off in Settings, Appearance (seasonalSnow). Small and faint so the text in front stays the thing to read, and
 * never drawn when motion is reduced, by the app's setting or the system's.
 * Android draws the same flakes with the same numbers (ui/chat/SnowFall.kt).
 */
export function SnowFall() {
  const season = useActiveSeason();
  const on = useSettings((x) => x.settings.seasonalSnow !== false);
  const reducedSetting = useSettings((x) => x.settings.reducedMotion);
  const reducedSystem = useReducedMotionQuery();
  if (!season?.snow || !on || reducedSetting || reducedSystem) return null;
  return <Snow />;
}

const REDUCE = "(prefers-reduced-motion: reduce)";

/** Whether the system asks for less motion, following it as it changes. */
function useReducedMotionQuery(): boolean {
  return useSyncExternalStore(
    (on) => {
      const mq = window.matchMedia?.(REDUCE);
      mq?.addEventListener("change", on);
      return () => mq?.removeEventListener("change", on);
    },
    () => !!window.matchMedia?.(REDUCE).matches,
  );
}

/**
 * How the snow moves, the same on Android (ui/chat/SnowFall.kt). Nothing is a
 * path worked out in advance: the wind, each flake's drift, its fall and its
 * spin are random walks that keep being pulled back towards calm (an
 * Ornstein-Uhlenbeck process), so every flake is pushed about by fresh noise
 * every frame and never does the same thing twice. Each flake eases into what
 * the air does rather than following it exactly. Depth decides the rest: a
 * near flake is bigger, brighter, faster and blown further, and a little soft
 * at the edge; most are far away.
 */
interface Flake {
  x: number;
  y: number;
  /** Depth, 0.3 far to 1 near. */
  z: number;
  r: number;
  /** Sideways speed, px a second: what the flake has picked up from the air so far. */
  vx: number;
  /** Its own gusts and eddies, px a second, a random walk. */
  eddy: number;
  fall: number;
  /** How much its fall wavers as it tumbles, a random walk around 0. */
  waver: number;
}

/** One flake for this many square pixels, up to MAX. */
const AREA_PER_FLAKE = 6500;
const MAX = 160;
/** Nearer than this, a flake has a soft edge. */
const SOFT_Z = 0.7;

/** A normally distributed random number (Box-Muller). */
function gauss(): number {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

/** One step of a random walk pulled back towards `mean` at `rate`, shaken by noise of strength `sigma`. */
function walk(v: number, mean: number, rate: number, sigma: number, dt: number): number {
  return v + rate * (mean - v) * dt + sigma * Math.sqrt(dt) * gauss();
}

function flake(w: number, h: number, anywhere: boolean, wind: number): Flake {
  const z = 0.3 + 0.7 * Math.random() ** 1.6;
  const r = 0.6 + z * 2.2;
  return {
    x: Math.random() * w,
    y: anywhere ? Math.random() * h : -r * 6,
    z,
    r,
    vx: wind * z,
    eddy: gauss() * 8 * z,
    fall: (20 + 26 * z) * (0.85 + Math.random() * 0.3),
    waver: 0,
  };
}

function Snow() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let w = 0;
    let h = 0;
    let dpr = 1;
    // the air everyone shares: a slow random walk around a light breeze
    let wind = 4;
    let flakes: Flake[] = [];
    const size = () => {
      dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const want = Math.min(MAX, Math.round((w * h) / AREA_PER_FLAKE));
      flakes = flakes.slice(0, want);
      while (flakes.length < want) flakes.push(flake(w, h, true, wind));
    };
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    size();

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      // A long gap (a hidden tab, a stall) moves the snow on by a twentieth of a
      // second, not all at once. The time a frame is given can be a little
      // before the moment it was asked for, which made the first step after
      // coming back to the tab negative; the square root of that turned every
      // flake into NaN for good, and the snow was gone.
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      wind = walk(wind, 4, 0.15, 4, dt);
      if (!Number.isFinite(wind)) wind = 4;
      // the whole canvas wiped every frame: nothing of the last one is left behind
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#e8f1ff";
      // how quickly a flake takes up a change in the air: light, so within half a second or so
      const ease = Math.min(1, 3 * dt);
      for (let i = 0; i < flakes.length; i++) {
        let f = flakes[i]!;
        f.eddy = walk(f.eddy, 0, 1.2, 18 * f.z, dt);
        f.waver = walk(f.waver, 0, 1, 0.25, dt);
        f.vx += (wind * f.z + f.eddy - f.vx) * ease;
        f.x += f.vx * dt;
        f.y += f.fall * Math.max(0.6, 1 + f.waver) * dt;
        // past the bottom, or (should anything ever go wrong with the numbers) nowhere at all: a new flake at the top
        if (!(f.y <= h + f.r * 6) || !Number.isFinite(f.x)) f = flakes[i] = flake(w, h, false, wind);
        if (f.x < -10) f.x += w + 20;
        else if (f.x > w + 10) f.x -= w + 20;
        const alpha = 0.18 + 0.5 * f.z;
        // the nearest are a little soft at the edge, as something close and out of focus is
        if (f.z > SOFT_Z) {
          ctx.globalAlpha = alpha * 0.22;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * 1.9, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", start);
    start();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", start);
    };
  }, []);
  return <canvas ref={ref} className={s.snow} aria-hidden="true" data-testid="snowfall" />;
}
