/**
 * Text that scrolls itself when it does not fit.
 *
 * A status is often longer than the space under a name, and an ellipsis cuts
 * it off exactly where the interesting part starts. This measures the words
 * against their box and, when they overflow, slides them across and back with
 * a short pause at each end, so the whole thing can be read without hovering
 * or opening anything.
 *
 * The motion is driven from here (the Web Animations API, planned in
 * marquee.ts) rather than by a CSS animation. A CSS animation's length and
 * distance lived in custom properties, and anything that changed the box's
 * width re-timed it mid-flight: pointing at a conversation in the sidebar
 * brings up its close button, which narrows the line, and the status jumped
 * back to its start every time. Now a change of width carries on from where
 * the text is, and a render that changes nothing leaves the motion alone.
 *
 * Nothing moves when it fits, and nothing moves for anyone who asked for less
 * motion: they get the ellipsis, which is the honest fallback.
 */
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useSettings } from "@/stores/settings";
import { keyframesOf, loopLegs, resumeLegs, resumePlan, stateAt, totalMs, translateXOf, travelMs, type Leg } from "./marquee";
import s from "./ScrollingText.module.css";

/**
 * Texts that scroll together. Everything inside a group shares one cycle, set
 * by its longest text: they all start, turn and come home at the same moments,
 * each at its own speed, and a loop is started on the page's clock so that
 * texts that mounted at different times still line up. A group inside a group
 * joins the outer one.
 */
interface Group {
  report(id: string, over: number): void;
  /** The widest overflow in the group: its longest trip sets the cycle. */
  over: number;
}
const GroupContext = createContext<Group | null>(null);

export function ScrollGroup({ children }: { children: ReactNode }) {
  const outer = useContext(GroupContext);
  const overs = useRef(new Map<string, number>());
  const [over, setOver] = useState(0);
  const report = useCallback((id: string, o: number) => {
    if (o > 0) overs.current.set(id, o);
    else overs.current.delete(id);
    setOver(Math.max(0, ...overs.current.values()));
  }, []);
  if (outer) return <>{children}</>;
  return <GroupContext.Provider value={{ report, over }}>{children}</GroupContext.Provider>;
}

interface Motion {
  cycle: number | undefined;
  anim: Animation;
  legs: Leg[];
  loop: boolean;
  sign: 1 | -1;
  over: number;
  version: number;
}

/** Less motion, asked for here (the setting, or the look remembered before it loads) or in the system. */
function useStill(): boolean {
  const setting = useSettings((x) => x.settings.reducedMotion);
  const [system, setSystem] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)") : undefined;
    if (!mq) return;
    const on = () => setSystem(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const remembered = typeof document !== "undefined" && document.documentElement.dataset["reducedMotion"] === "true";
  return setting || remembered || system;
}

/** How far along its reading direction the text has moved right now. */
function distanceNow(el: HTMLElement, sign: 1 | -1): number {
  return Math.max(0, sign * translateXOf(getComputedStyle(el).transform));
}

/**
 * Plays a plan. A loop repeats for good; anything else is a lead-in that
 * hands over to the loop when it ends, or, going home because the text fits
 * now, simply ends.
 */
function play(el: HTMLElement, ref: MutableRefObject<Motion | null>, legs: Leg[], sign: 1 | -1, over: number, version: number, loop: boolean, cycle?: number): Motion {
  const { frames, duration } = keyframesOf(legs, sign);
  const anim = el.animate(frames, { duration, iterations: loop ? Infinity : 1, fill: loop ? "none" : "forwards" });
  const m: Motion = { cycle, anim, legs, loop, sign, over, version };
  if (!loop) {
    anim.onfinish = () => {
      if (ref.current !== m) return;
      if (over > 0) {
        ref.current = play(el, ref, loopLegs(over, cycle), sign, over, version, true, cycle);
        anim.cancel();
      } else {
        ref.current = null;
        anim.cancel();
      }
    };
  }
  return m;
}

export function ScrollingText({ children, className }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const still = useStill();
  const group = useContext(GroupContext);
  const id = useId();
  const [over, setOver] = useState(0);
  const [rtl, setRtl] = useState(false);
  /** Bumped when the words change: new words start again from their beginning. */
  const [version, setVersion] = useState(0);
  /** The text last measured; callers pass JSX, so `children` is a new object every render. */
  const measured = useRef<string | null>(null);
  const motion = useRef<Motion | null>(null);

  const measure = useCallback(() => {
    const outer = box.current;
    const text = inner.current;
    if (!outer || !text) return;
    // a fraction of a pixel is rounding, not overflow
    const diff = Math.round(text.scrollWidth - outer.clientWidth);
    setOver(diff > 1 ? diff : 0);
    // the words' own direction (dir="auto"), which says which way they travel
    setRtl(getComputedStyle(text).direction === "rtl");
  }, []);

  useEffect(() => {
    const outer = box.current;
    const text = inner.current;
    if (!outer || !text || still) return;
    if (typeof ResizeObserver === "undefined") return;
    // an observer reports once as it starts, which is the first measurement
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(text);
    return () => ro.disconnect();
  }, [measure, still]);

  // No dependency list, and the rendered text rather than `children`: keying on
  // the JSX rebuilt the observer and forced a synchronous layout read on every
  // render of the row above, twenty of them per presence packet in a sidebar.
  // The box changing size is the observer's job; this is only for new words.
  useEffect(() => {
    const text = inner.current;
    if (!text) return;
    const now = text.textContent ?? "";
    if (now === measured.current) return;
    const first = measured.current === null;
    measured.current = now;
    if (!first) setVersion((v) => v + 1);
    if (!still) measure();
  });

  // the group's cycle is its longest trip, kept only while this text moves too
  useEffect(() => {
    if (!group) return;
    group.report(id, still ? 0 : over);
    return () => group.report(id, 0);
  }, [group, id, over, still]);
  const cycle = group && over > 0 ? travelMs(Math.max(group.over, over)) : undefined;

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || typeof el.animate !== "function") return;
    const sign: 1 | -1 = rtl ? 1 : -1;
    const cur = motion.current;
    if (still || over === 0) {
      if (!cur) return;
      const at = distanceNow(el, cur.sign);
      cur.anim.cancel();
      motion.current = null;
      // fits now (the line grew): it goes back to its start rather than jumping there
      if (!still && at >= 1) motion.current = play(el, motion, resumeLegs({ kind: "back", at, restLeft: 0 }, 0), cur.sign, 0, version, false);
      return;
    }
    if (!cur || cur.sign !== sign || cur.version !== version || cur.cycle !== cycle) {
      cur?.anim.cancel();
      const legs = loopLegs(over, cycle);
      const next = play(el, motion, legs, sign, over, version, true, cycle);
      // in a group the loop runs on the page's clock, so every text is at the same point of the same cycle
      if (cycle !== undefined) next.anim.currentTime = (document.timeline.currentTime as number) % totalMs(legs);
      motion.current = next;
      return;
    }
    if (cur.over === over) return;
    // The line changed width part way through: carry on from where the text is.
    const time = Number(cur.anim.currentTime ?? 0) || 0;
    const total = totalMs(cur.legs);
    const state = stateAt(cur.legs, cur.loop && total > 0 ? time % total : time, distanceNow(el, sign));
    cur.anim.cancel();
    const plan = resumePlan(state, over, cycle);
    const next = play(el, motion, plan.legs, sign, over, version, plan.loop, cycle);
    next.anim.currentTime = plan.startAt;
    motion.current = next;
  }, [over, still, rtl, version, cycle]);

  useEffect(
    () => () => {
      motion.current?.anim.cancel();
      motion.current = null;
    },
    [],
  );

  const scrolling = over > 0 && !still;
  return (
    // While it travels, the box takes the words' own direction, so their start
    // is what shows at rest even in a line laid out the other way.
    <span ref={box} className={[s.box, className].filter(Boolean).join(" ")} dir={scrolling ? (rtl ? "rtl" : "ltr") : undefined}>
      <span ref={inner} className={s.inner} dir="auto" data-scrolling={scrolling || undefined}>
        {children}
      </span>
    </span>
  );
}
