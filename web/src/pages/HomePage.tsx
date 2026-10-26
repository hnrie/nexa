/**
 * The front page: what Nexa is, shown before it is said.
 *
 * It is laid out the way the app is: a dark canvas with the accent's glow in
 * its corner, a rail down the side (here, one tile for each part of the page,
 * lit for the part being read), and lit panels floating on the canvas for
 * what is really the app: one conversation drawn twice, as the people in it
 * read it and as the server holds it, with a line between the two that
 * anyone can move; pictures and loops of the app running; and what the server
 * can and cannot read. The words stay on the canvas.
 *
 * Straight after the opening come four promises, set as type alone, each with
 * the things that keep it: what someone weighing Nexa up most wants to know,
 * before the tour of the app that follows.
 *
 * One thing moves by itself, once: as the page opens the conversation's
 * window lifts in and the line sweeps across it, sealing what it passes.
 * Everything else moves only when someone does something to it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Archive, AudioLines, ChevronsLeftRight, CornerUpLeft, Eye, EyeOff, FileUp, Hash, Headphones, HeartHandshake, KeyRound, Lock, LockKeyhole, MailX, MessagesSquare, MonitorUp, NotebookPen, Palette, Pause, PhoneCall, Play, Puzzle, QrCode, Search, ShieldCheck, Smile, Sparkles, Users, Zap, type LucideIcon } from "lucide-react";
import { NexaTile, NexaWordmark } from "@/components/common/Brand";
import { hasSavedSession, useAuth } from "@/stores/auth";
import { useSettings } from "@/stores/settings";
import { currentPlatform, isAndroidBrowser } from "@/lib/platform";
import { CONTACT_EMAIL } from "@/lib/legal";
import { formatBytes } from "@/lib/time";
import { admin } from "@/api/admin";
import { android } from "@/api/android";
import { AndroidBanner } from "@/components/shell/AndroidBanner";
import { t, translator } from "@/i18n";
// The headings' weight, which the app itself never uses: it arrives with this page only.
import "@fontsource/noto-sans/800.css";
import { seal } from "./homeSeal";
import s from "./Home.module.css";

/**
 * The most the app takes to load, gzipped: the script and styles every page
 * starts with. tools/app_size.py measures each build against it, so the claim
 * on this page cannot drift from the truth unnoticed, as "264 KB" had. (It
 * was 208 kB when this was first set at 300, and 500 had stopped saying much;
 * it was 321 kB when it became 330, about half of it the English strings,
 * 330.3 kB when it became 335, 337 kB when it became 340, 342.4 kB when
 * it became 345, with apps' strings, and 345.1 kB when it became 350, with
 * the person menu in conversations.)
 */
export const LOAD_KB_LIMIT = 360;

/** Whether this visitor has asked for less movement, by either route. */
function useStillness(): boolean {
  const setting = useSettings((x) => x.settings.reducedMotion);
  const [system, setSystem] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setSystem(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return setting || system;
}

/** The canvas the page is drawn on, the app's own, for the browser's bars too (Home.module.css has the rest). */
const CANVAS = "#120f18";

/**
 * Hands the document to this page while it is open: the app's body is a
 * fixed frame that never scrolls, and this page is a long read. Done before
 * the first paint, so there is no frame of the app's colours in between; the
 * style the server put in the front page's head for the same reason (see
 * serveHomePage) has done its job by then and goes.
 */
function useFrontDocument() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset["home"] = "";
    document.getElementById("front-paint")?.remove();
    const meta = document.querySelector('meta[name="theme-color"]');
    const before = meta?.getAttribute("content") ?? null;
    meta?.setAttribute("content", CANVAS);
    return () => {
      delete root.dataset["home"];
      if (meta && before !== null) meta.setAttribute("content", before);
      // the next page starts at its top, not wherever this one was left
      window.scrollTo(0, 0);
    };
  }, []);
}

/** Whether the page has been scrolled at all, which gives the header its edge. */
function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const look = () => setScrolled(window.scrollY > 8);
    look();
    window.addEventListener("scroll", look, { passive: true });
    return () => window.removeEventListener("scroll", look);
  }, []);
  return scrolled;
}

/* ------------------------------------------------------------------------ */
/* The two sides of one conversation                                          */
/* ------------------------------------------------------------------------ */

type Who = "alice" | "bob" | "carol";
const PEOPLE: Record<Who, { name: string; colour: string; ink: string }> = {
  // the same two colours Alice and Bob have in the call loop further down
  alice: { name: "Alice", colour: "#d6336c", ink: "#fff" },
  bob: { name: "Bob", colour: "#f0a202", ink: "#2b1b00" },
  carol: { name: "Carol", colour: "#1b7a57", ink: "#fff" },
};

interface Line {
  who: Who;
  /** Minutes past 21:00, shown in the reader's own clock. */
  at: number;
  text: string;
  reply?: { who: Who; text: string };
}

function conversation(): Line[] {
  const m2 = t("home.duo.m2");
  return [
    { who: "carol", at: 12, text: t("home.duo.m1") },
    { who: "bob", at: 14, text: m2 },
    { who: "alice", at: 15, text: t("home.duo.m3"), reply: { who: "bob", text: m2 } },
    { who: "carol", at: 17, text: t("home.duo.m4") },
  ];
}

function clock(minutes: number): string {
  const when = new Date(2026, 0, 3, 21, minutes);
  try {
    return new Intl.DateTimeFormat(translator().locale, { hour: "numeric", minute: "2-digit" }).format(when);
  } catch {
    return `21:${String(minutes).padStart(2, "0")}`;
  }
}

/**
 * Where the line rests, as a share of the width from the reading side: on a
 * phone further over, where a message has fewer words to spare.
 */
const restingPlace = (): number => (typeof window !== "undefined" && window.innerWidth < 600 ? 64 : 58);
/** How close to either edge it may go: the handle stays whole inside the frame. */
const EDGE = 4;

function Avatar({ who }: { who: Who }) {
  const p = PEOPLE[who];
  return (
    <span className={s.avatar} style={{ background: p.colour, color: p.ink }} aria-hidden="true">
      {p.name[0]}
    </span>
  );
}

/**
 * A message's words. On the server's side they are kept, unseen, to hold the
 * same space, and the ciphertext is laid over them: the two drawings then
 * line up exactly, name for name and line for line.
 */
function Words({ text, sealed, className }: { text: string; sealed?: string | undefined; className?: string | undefined }) {
  if (sealed === undefined) return <span className={className} dir="auto">{text}</span>;
  return (
    <span className={[className, s.sealedWords].join(" ")}>
      <span className={s.unseen}>{text}</span>
      <span className={s.cipher} dir="ltr">{sealed}</span>
    </span>
  );
}

function Conversation({ lines, sealed, server }: { lines: Line[]; sealed: string[] | null; server?: boolean }) {
  // the server's drawing seals every text; a reply's quote is a text as well
  let n = 0;
  const next = () => (server ? (sealed?.[n++] ?? "") : undefined);
  return (
    <div className={s.convo} data-side={server ? "server" : "you"} aria-hidden={server || undefined}>
      <div className={s.convoTop}>
        <Hash size={18} aria-hidden="true" />
        <span>{t("home.duo.channel")}</span>
      </div>
      <ol className={s.convoLines}>
        {lines.map((line, i) => (
          <li key={i} className={s.line}>
            {line.reply ? (
              <div className={s.replyTo}>
                <CornerUpLeft size={14} aria-hidden="true" />
                <span className={s.replyName}>{PEOPLE[line.reply.who].name}</span>
                <Words text={line.reply.text} sealed={next()} className={s.replyText} />
              </div>
            ) : null}
            <div className={s.lineRow}>
              <Avatar who={line.who} />
              <div className={s.lineMain}>
                <div className={s.lineHead}>
                  <span className={s.name}>{PEOPLE[line.who].name}</span>
                  <time className={s.time}>{clock(line.at)}</time>
                </div>
                <Words text={line.text} sealed={next()} className={s.text} />
              </div>
            </div>
          </li>
        ))}
        <li className={s.event}>
          <PhoneCall size={16} aria-hidden="true" />
          <span>{t("home.duo.call", { name: PEOPLE.bob.name })}</span>
          <time className={s.time}>{clock(18)}</time>
        </li>
      </ol>
    </div>
  );
}

/**
 * The same conversation twice, as its people read it and as the server holds
 * it, with a line between them. The line comes in from the far side once, the
 * first time the whole thing is in view, and then goes wherever it is dragged
 * (or moved with the arrow keys: the slider under it is a real one).
 */
function Duo({ still }: { still: boolean }) {
  const lines = useMemo(conversation, []);
  const texts = useMemo(() => lines.flatMap((l) => (l.reply ? [l.reply.text, l.text] : [l.text])), [lines]);
  const [sealed, setSealed] = useState<string[] | null>(null);
  const [seam, setSeam] = useState(() => (still ? restingPlace() : 100));
  const [dragging, setDragging] = useState(false);
  // the line has finished its sweep: its glow dies down and the handle catches the light once
  const [settled, setSettled] = useState(still);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void seal(texts).then((out) => alive && setSealed(out));
    return () => {
      alive = false;
    };
  }, [texts]);

  // The sweep ends when the line's transition does; a browser that cannot
  // animate the line jumps it, and the timer stands in for the end.
  useEffect(() => {
    if (settled || seam === 100) return;
    const el = stage.current;
    const done = () => setSettled(true);
    const onEnd = (e: TransitionEvent) => e.propertyName === "--seam" && done();
    el?.addEventListener("transitionend", onEnd);
    const timer = window.setTimeout(done, 2600);
    return () => {
      el?.removeEventListener("transitionend", onEnd);
      window.clearTimeout(timer);
    };
  }, [seam, settled]);

  // The one moment the page moves on its own: once, when it can be seen.
  useEffect(() => {
    const settle = () => setSeam((v) => (v === 100 ? restingPlace() : v));
    const el = stage.current;
    if (still || !el || typeof IntersectionObserver === "undefined") {
      settle();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          settle();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [still]);

  /** The share of the width between the reading edge and the pointer. */
  const at = (clientX: number): number => {
    const el = stage.current;
    if (!el) return restingPlace();
    const box = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === "rtl";
    const from = rtl ? box.right - clientX : clientX - box.left;
    return Math.max(EDGE, Math.min(100 - EDGE, (from / box.width) * 100));
  };

  const grab = (e: React.PointerEvent<HTMLElement>, jump: boolean) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    if (jump) setSeam(at(e.clientX));
  };
  const drag = (e: React.PointerEvent<HTMLElement>) => {
    // a mouse whose button came up somewhere this never heard of has stopped dragging
    if (dragging && e.pointerType === "mouse" && !(e.buttons & 1)) setDragging(false);
    else if (dragging) setSeam(at(e.clientX));
  };
  const drop = () => setDragging(false);

  const style = { "--seam": `${seam}%` } as CSSProperties;
  return (
    <figure className={s.duo}>
      <div className={s.duoLegend} aria-hidden="true">
        <span className={s.duoLegendYou}>{t("home.duo.you")}</span>
        <span className={s.duoLegendServer}><Lock size={13} aria-hidden="true" />{t("home.duo.server")}</span>
      </div>
      <div
        ref={stage}
        className={s.stage}
        style={style}
        data-dragging={dragging || undefined}
        data-still={still || undefined}
        data-settled={settled || undefined}
        // With a mouse, a press anywhere moves the line there. A finger only
        // moves it from the handle, so a thumb scrolling past never does.
        onPointerDown={(e) => e.pointerType === "mouse" && grab(e, true)}
        onPointerMove={drag}
        onPointerUp={drop}
        onPointerCancel={drop}
        onLostPointerCapture={drop}
      >
        <Conversation lines={lines} sealed={sealed} />
        <div className={s.serverSide}>
          <Conversation lines={lines} sealed={sealed} server />
        </div>
        <input
          className={s.seamInput}
          type="range"
          min={EDGE}
          max={100 - EDGE}
          step={1}
          value={Math.round(Math.min(seam, 100 - EDGE))}
          onChange={(e) => setSeam(Number(e.target.value))}
          aria-label={t("home.duo.slider")}
          aria-valuetext={t("home.duo.sliderValue", { percent: Math.round(100 - seam) })}
        />
        <div className={s.seam} aria-hidden="true">
          <span
            className={s.knob}
            onPointerDown={(e) => {
              // the frame under it would take this press as a jump as well
              e.stopPropagation();
              grab(e, false);
            }}
          >
            <ChevronsLeftRight size={20} />
          </span>
        </div>
      </div>
      <figcaption className={s.duoCaption}>{t("home.duo.caption")}</figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------------ */
/* Pictures and loops of the app                                              */
/* ------------------------------------------------------------------------ */

/**
 * A picture of the app. Its own size is given even though the CSS scales it
 * to the column: without one the browser has nothing to reserve, and pictures
 * arriving one by one would each shove the page down under whoever is reading.
 */
function Still({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) {
  return (
    // never drawn wider than it was taken, which would only blur it
    <figure className={s.frame} style={{ maxWidth: width }}>
      <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" />
    </figure>
  );
}

/**
 * A short loop of the app in use. Nothing of it is fetched until it is nearly
 * on screen, it plays only while it is, it can be paused (it would otherwise
 * never stop), and anyone who asked for less movement gets its still instead.
 * `from` is where the still was taken (tools/home_gifs.py), so playing starts
 * on the very frame the still showed.
 */
function Movie({ name, alt, still, from = 0 }: { name: string; alt: string; still: boolean; from?: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [near, setNear] = useState(false);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const soon = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "600px 0px" });
    const now = new IntersectionObserver((entries) => setSeen(entries.some((e) => e.isIntersecting)), { threshold: 0.25 });
    soon.observe(el);
    now.observe(el);
    return () => {
      soon.disconnect();
      now.disconnect();
    };
  }, [still]);

  useEffect(() => {
    const el = video.current;
    if (!el || !near) return;
    if (seen && !paused) void el.play().catch(() => undefined);
    else el.pause();
  }, [near, seen, paused]);

  if (still) {
    return (
      <figure className={s.frame}>
        <img src={`/home/${name}.png`} alt={alt} width={900} height={563} loading="lazy" decoding="async" />
      </figure>
    );
  }
  return (
    <figure className={s.frame}>
      <video ref={video} muted loop playsInline preload="none" poster={near ? `/home/${name}.png` : undefined} aria-label={alt} width={900} height={563}>
        {near ? <source src={`/home/${name}.webm${from ? `#t=${from}` : ""}`} type="video/webm" /> : null}
      </video>
      <button type="button" className={s.pause} onClick={() => setPaused((p) => !p)} aria-label={paused ? t("home.movie.play") : t("home.movie.pause")}>
        {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
      </button>
    </figure>
  );
}

/* ------------------------------------------------------------------------ */
/* Chapters                                                                   */
/* ------------------------------------------------------------------------ */

interface Fact {
  title: string;
  body: string;
}

/** The specifics of one part of the app: a name each, and a sentence. */
function Facts({ items }: { items: Fact[] }) {
  return (
    <dl className={s.facts}>
      {items.map((f) => (
        <div key={f.title} className={s.fact}>
          <dt>{f.title}</dt>
          <dd>{f.body}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The parts of the page, in order: each has a tile in the rail, with the picture its heading wears too. */
const CHAPTERS: { id: string; icon: LucideIcon; title: () => string }[] = [
  { id: "home-why", icon: Sparkles, title: () => t("home.why.title") },
  { id: "home-servers", icon: Users, title: () => t("home.servers.title") },
  { id: "home-calls", icon: Headphones, title: () => t("home.calls.title") },
  { id: "home-notes", icon: NotebookPen, title: () => t("home.notes.title") },
  { id: "home-yours", icon: Palette, title: () => t("home.yours.title") },
  { id: "home-private", icon: Lock, title: () => t("home.private.title") },
  { id: "home-quick", icon: Zap, title: () => t("home.quick.title") },
  { id: "home-people", icon: HeartHandshake, title: () => t("home.people.title") },
];

/** One part of the app: what it is in a line, what it looks like, and the specifics. */
function Chapter({ id, title, lede, media, facts, children }: { id: string; title: string; lede: string; media?: ReactNode; facts?: Fact[]; children?: ReactNode }) {
  const Icon = CHAPTERS.find((c) => c.id === id)?.icon;
  return (
    <section className={s.chapter} id={id} aria-labelledby={`${id}-title`}>
      <div className={s.chapterHead}>
        {Icon ? (
          <span className={s.chapterTile} aria-hidden="true">
            <Icon size={22} />
          </span>
        ) : null}
        <h2 id={`${id}-title`} className={s.h2}>{title}</h2>
        <p className={s.chapterLede}>{lede}</p>
      </div>
      <div className={s.chapterBody}>
        {media}
        {children}
        {facts?.length ? <Facts items={facts} /> : null}
      </div>
    </section>
  );
}

/**
 * The page's own rail, drawn as the app's server rail is: a tile for each
 * part of the page, the one being read lit, with the light at the rail's edge.
 * Picking one goes there. Only on screens wide enough to keep it beside the
 * words.
 */
function PageRail({ still }: { still: boolean }) {
  const [at, setAt] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    // the part crossing the middle of the screen is the one being read
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setAt(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    const hero = document.getElementById("home-top");
    if (hero) io.observe(hero);
    for (const c of CHAPTERS) {
      const el = document.getElementById(c.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  };
  return (
    <nav className={s.rail} aria-label={t("home.rail.label")}>
      <a href="#home-top" className={s.railItem} data-on={at === "home-top" || at === null || undefined} onClick={go("home-top")} aria-label="Nexa">
        <span className={s.railPill} aria-hidden="true" />
        <span className={s.railHome}><NexaTile size={48} radius={0.32} /></span>
        <span className={s.railTip} aria-hidden="true">Nexa</span>
      </a>
      <span className={s.railSep} aria-hidden="true" />
      {CHAPTERS.map(({ id, icon: Icon, title }) => (
        <a key={id} href={`#${id}`} className={s.railItem} data-on={at === id || undefined} aria-current={at === id ? "location" : undefined} onClick={go(id)} aria-label={title()}>
          <span className={s.railPill} aria-hidden="true" />
          <span className={s.railBtn}><Icon size={22} aria-hidden="true" /></span>
          <span className={s.railTip} aria-hidden="true">{title()}</span>
        </a>
      ))}
    </nav>
  );
}

/**
 * What the server cannot read, laid over what it holds of it: the panel's
 * ground is the list itself, sealed, as the server keeps it.
 */
function SealedGround({ texts }: { texts: string[] }) {
  const [sealed, setSealed] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // enough of it to fill the panel behind the list
    void seal([...texts, ...texts, ...texts]).then((out) => alive && setSealed(out.join(" ")));
    return () => {
      alive = false;
    };
  }, [texts]);
  return sealed ? (
    <span className={s.sealedGround} aria-hidden="true" dir="ltr">
      {sealed}
    </span>
  ) : null;
}

/**
 * What Nexa promises, four of them, each with the things that keep it. Every
 * one of these was checked as something people may not get elsewhere, which
 * is why they come before the tour.
 */
const PROMISES: { key: string; items: { key: string; icon: LucideIcon }[] }[] = [
  {
    key: "private",
    items: [
      { key: "encrypted", icon: ShieldCheck },
      { key: "search", icon: Search },
      { key: "safety", icon: QrCode },
      { key: "lock", icon: LockKeyhole },
    ],
  },
  {
    key: "hand",
    items: [
      { key: "signup", icon: MailX },
      { key: "ads", icon: EyeOff },
      { key: "recovery", icon: KeyRound },
      { key: "export", icon: Archive },
    ],
  },
  {
    key: "pay",
    items: [
      { key: "emoji", icon: Smile },
      { key: "share", icon: MonitorUp },
      { key: "files", icon: FileUp },
      { key: "themes", icon: Palette },
    ],
  },
  {
    key: "more",
    items: [
      { key: "notes", icon: NotebookPen },
      { key: "subchats", icon: MessagesSquare },
      { key: "sounds", icon: AudioLines },
      { key: "plugins", icon: Puzzle },
    ],
  },
];

/**
 * The most one file may be, as this server allows it: the promise names the
 * real figure, and says only "big" when the server could not be asked.
 */
function useUploadLimit(): number | null {
  const [max, setMax] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    admin
      .instance()
      .then((info) => {
        if (alive && info.max_upload_bytes > 0) setMax(info.max_upload_bytes);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return max;
}

/**
 * The four promises, set as type: each one large, the things that keep it
 * beside it. No panels: these are words, and the panels on this page are kept
 * for what is really the app.
 */
function Promises({ uploadLimit }: { uploadLimit: number | null }) {
  const title = (key: string): string => (key !== "files" ? t(`home.why.${key}Title`) : uploadLimit ? t("home.why.filesTitle", { size: formatBytes(uploadLimit) }) : t("home.why.filesTitlePlain"));
  return (
    <section className={s.why} id="home-why" aria-labelledby="home-why-title">
      <h2 id="home-why-title" className="visually-hidden">{t("home.why.title")}</h2>
      {PROMISES.map((promise) => (
        <div key={promise.key} className={s.promise}>
          <div className={s.promiseHead}>
            <h3 className={s.promiseTitle}>{t(`home.why.${promise.key}Title`)}</h3>
            <p className={s.promiseLede}>{t(`home.why.${promise.key}Body`)}</p>
          </div>
          <ul className={s.promiseItems}>
            {promise.items.map(({ key, icon: Icon }) => (
              <li key={key} className={s.promiseItem}>
                <Icon size={20} aria-hidden="true" className={s.promiseIcon} />
                <div>
                  <h4 className={s.promiseItemTitle}>{title(key)}</h4>
                  <p className={s.promiseItemBody}>{t(`home.why.${key}Body`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

const facts = (area: string, names: string[]): Fact[] => names.map((n) => ({ title: t(`home.${area}.${n}Title`), body: t(`home.${area}.${n}Body`) }));

/** A number with its unit, as the reader's language writes it. */
function kilobytes(value: number): string {
  try {
    return new Intl.NumberFormat(translator().locale, { style: "unit", unit: "kilobyte" }).format(value);
  } catch {
    return `${value} kB`;
  }
}

const CANT = ["messages", "files", "calls", "keys", "settings"] as const;
const KNOWS = ["account", "where", "when", "sizes", "emoji"] as const;

export default function HomePage() {
  useFrontDocument();
  const still = useStillness();
  const scrolled = useScrolled();
  const signedIn = useAuth((a) => !!a.me) || hasSavedSession();
  const [os, setOs] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // an Android phone is offered its app once one is published
    if (isAndroidBrowser()) {
      void android
        .latest()
        .then((rel) => {
          if (alive && rel) setOs("Android");
        })
        .catch(() => undefined);
    } else {
      void currentPlatform().then(({ os: kind }) => {
        if (alive) setOs(kind === "mac" ? "macOS" : kind === "windows" ? "Windows" : kind === "linux" ? "Linux" : null);
      });
    }
    return () => {
      alive = false;
    };
  }, []);
  const cantTexts = useMemo(() => CANT.map((k) => t(`home.private.cant.${k}`)), []);
  const uploadLimit = useUploadLimit();

  const start = signedIn ? (
    <Link className={s.primary} to="/channels/@me">{t("home.nav.open")}</Link>
  ) : (
    <Link className={s.primary} to="/register">{t("home.nav.getStarted")}</Link>
  );

  return (
    <div className={s.page} data-still={still || undefined}>
      <AndroidBanner />
      <header className={s.top} data-scrolled={scrolled || undefined}>
        <div className={s.topInner}>
          <Link to="/" className={s.logo} aria-label="Nexa">
            <NexaWordmark height={24} />
          </Link>
          <nav className={s.nav}>
            <Link className={[s.navLink, s.navDownload].join(" ")} to="/download">{t("home.nav.download")}</Link>
            {signedIn ? (
              <Link className={s.navCta} to="/channels/@me">{t("home.nav.open")}</Link>
            ) : (
              <>
                <Link className={s.navLink} to="/login">{t("home.nav.logIn")}</Link>
                <Link className={s.navCta} to="/register">{t("home.nav.getStarted")}</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <div className={s.body}>
        <PageRail still={still} />
        <main className={s.main}>
          {/* In one column (a phone, a tablet held upright) the conversation
              comes straight after the headline, so the first screen shows what
              the page is about rather than a paragraph describing it; the
              header keeps Get Started in reach meanwhile. */}
          <section className={s.hero} id="home-top" aria-labelledby="home-title">
            <h1 id="home-title" className={s.h1}>{t("home.hero.title")}</h1>
            <Duo still={still} />
            <div className={s.heroText}>
              <p className={s.lede}>{t("home.hero.lede")}</p>
              <div className={s.actions}>
                {start}
                <Link className={s.secondary} to="/download">{os ? t("home.hero.downloadFor", { os }) : t("home.nav.download")}</Link>
              </div>
              <p className={s.fine}>{t("home.hero.fine")}</p>
            </div>
          </section>

          <Promises uploadLimit={uploadLimit} />

          <Chapter
            id="home-servers"
            title={t("home.servers.title")}
            lede={t("home.servers.lede")}
            media={<Still src="/home/app.png" alt={t("home.shot.app")} width={1440} height={900} />}
            facts={facts("servers", ["roles", "private", "invites", "folders"])}
          />
          <Chapter
            id="home-calls"
            title={t("home.calls.title")}
            lede={t("home.calls.lede")}
            media={<Movie name="call-loop" alt={t("home.shot.call")} still={still} />}
            facts={facts("calls", ["zoom", "guests", "volume", "talk"])}
          />
          <Chapter
            id="home-notes"
            title={t("home.notes.title")}
            lede={t("home.notes.lede")}
            media={<Movie name="notes" alt={t("home.shot.notes")} still={still} from={3} />}
            facts={facts("notes", ["pictures", "history", "share", "offline"])}
          />
          <Chapter
            id="home-yours"
            title={t("home.yours.title")}
            lede={t("home.yours.lede")}
            media={<Movie name="themes" alt={t("home.shot.themes")} still={still} />}
            facts={facts("yours", ["themes", "stickers", "format"])}
          />
          <Chapter id="home-private" title={t("home.private.title")} lede={t("home.private.lede")} facts={facts("private", ["twoFactor", "previews"])}>
            <div className={s.ledger}>
              <div className={s.ledgerSide} data-sealed="">
                <SealedGround texts={cantTexts} />
                <h3 className={s.h3}>{t("home.private.cantTitle")}</h3>
                <ul>
                  {CANT.map((k, i) => (
                    <li key={k}>
                      <Lock size={16} aria-hidden="true" />
                      <span>{cantTexts[i]}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={s.ledgerSide}>
                <h3 className={s.h3}>{t("home.private.knowsTitle")}</h3>
                <ul>
                  {KNOWS.map((k) => (
                    <li key={k}>
                      <Eye size={16} aria-hidden="true" />
                      <span>{t(`home.private.knows.${k}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Chapter>
          <Chapter
            id="home-quick"
            title={t("home.quick.title")}
            lede={t("home.quick.lede", { size: kilobytes(LOAD_KB_LIMIT) })}
            media={<Movie name="speed" alt={t("home.shot.speed")} still={still} from={2} />}
            facts={facts("quick", ["desktop", "phone", "languages"])}
          />
          <Chapter id="home-people" title={t("home.people.title")} lede={t("home.people.lede")}>
            <Facts items={facts("people", ["data", "moderation", "reports"])} />
            <p className={s.aboutLinks}>
              <Link className={s.small} to="/about">{t("home.people.about")}</Link>
              <a className={s.small} href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          </Chapter>

          <section className={s.end} aria-labelledby="home-end">
            <div className={s.endPanel}>
              <NexaTile size={64} radius={0.3} className={s.endTile} />
              <div className={s.endText}>
                <h2 id="home-end" className={s.endTitle}>{t("home.end.title")}</h2>
                <p className={s.endBody}>{t("home.end.body")}</p>
              </div>
              <div className={[s.actions, s.endActions].join(" ")}>
                {start}
                <Link className={s.secondary} to="/download">{t("home.nav.download")}</Link>
              </div>
            </div>
          </section>
        </main>
      </div>

      <footer className={s.foot}>
        <div className={s.footInner}>
          <NexaWordmark height={20} className={s.footMark} />
          <p className={s.footTag}>{t("home.foot.tagline")}</p>
          <ul className={s.footLinks}>
            <li><Link to="/about">{t("legal.aboutTitle")}</Link></li>
            <li><Link to="/terms">{t("legal.termsTitle")}</Link></li>
            <li><Link to="/privacy">{t("legal.privacyTitle")}</Link></li>
            <li><a href={`mailto:${CONTACT_EMAIL}`}>{t("legal.contactOwner")}</a></li>
            <li><Link to="/download">{t("home.nav.download")}</Link></li>
            {signedIn ? null : <li><Link to="/login">{t("home.nav.logIn")}</Link></li>}
          </ul>
        </div>
      </footer>
    </div>
  );
}
