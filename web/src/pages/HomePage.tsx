/**
 * The front page: what Nexa is, shown before it is said.
 *
 * It opens on one conversation drawn twice, as the people in it read it and
 * as the server holds it, with a line between the two that anyone can move.
 * Below that, each part of the app gets a chapter of the same shape (a
 * heading, a line, a picture or a loop taken from the app running, and the
 * specifics), so a first visit can be read in one pass.
 *
 * The page keeps colours of its own that follow the visitor's light or dark
 * preference rather than the app's theme, and it scrolls the document itself,
 * so a phone's browser bars can get out of the way as it is read.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronsLeftRight, CornerUpLeft, Eye, Hash, Lock, Pause, PhoneCall, Play } from "lucide-react";
import { NexaWordmark } from "@/components/common/Brand";
import { hasSavedSession, useAuth } from "@/stores/auth";
import { useSettings } from "@/stores/settings";
import { currentPlatform } from "@/lib/platform";
import { CONTACT_EMAIL } from "@/lib/legal";
import { t, translator } from "@/i18n";
// The headings' weight, which the app itself never uses: it arrives with this page only.
import "@fontsource/noto-sans/800.css";
import s from "./Home.module.css";

/**
 * The most the app takes to load, gzipped: the script and styles every page
 * starts with. tools/app_size.py measures each build against it, so the claim
 * on this page cannot drift from the truth unnoticed, as "264 KB" had.
 */
export const LOAD_KB_LIMIT = 500;

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

/** The page's own background in each scheme, for the browser's bars (Home.module.css has the rest). */
const PAPER = { light: "#faf8fc", dark: "#141018" };

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
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const paint = () => meta?.setAttribute("content", mq?.matches ? PAPER.dark : PAPER.light);
    paint();
    mq?.addEventListener("change", paint);
    return () => {
      mq?.removeEventListener("change", paint);
      delete root.dataset["home"];
      if (meta && before !== null) meta.setAttribute("content", before);
      // the next page starts at its top, not wherever this one was left
      window.scrollTo(0, 0);
    };
  }, []);
}

/* ------------------------------------------------------------------------ */
/* The two sides of one conversation                                          */
/* ------------------------------------------------------------------------ */

type Who = "alice" | "bob" | "carol";
const PEOPLE: Record<Who, { name: string; colour: string; ink: string }> = {
  // the same two colours Alice and Bob have in the call loop further down
  alice: { name: "Alice", colour: "#d6336c", ink: "#fff" },
  bob: { name: "Bob", colour: "#f0a202", ink: "#2b1b00" },
  carol: { name: "Carol", colour: "#1f8a63", ink: "#fff" },
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

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * The conversation as the server would be handed it: each text sealed with
 * AES-GCM under a key made for this page view and never kept, nonce first,
 * as base64. It is real ciphertext rather than a picture of some. Where the
 * browser offers no WebCrypto (a page not served over HTTPS) random bytes of
 * the same length stand in, which read the same to anyone but a key holder.
 */
async function seal(texts: string[]): Promise<string[]> {
  const bytes = texts.map((text) => new TextEncoder().encode(text));
  try {
    const subtle = globalThis.crypto.subtle;
    const key = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    return await Promise.all(
      bytes.map(async (plain) => {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
        const out = new Uint8Array(iv.length + sealed.length);
        out.set(iv);
        out.set(sealed, iv.length);
        return base64(out);
      }),
    );
  } catch {
    return bytes.map((plain) => base64(crypto.getRandomValues(new Uint8Array(plain.length + 28))));
  }
}

/** Where the line rests, as a share of the width from the reading side. */
const REST = 58;
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
  const [seam, setSeam] = useState(still ? REST : 100);
  const [dragging, setDragging] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void seal(texts).then((out) => alive && setSealed(out));
    return () => {
      alive = false;
    };
  }, [texts]);

  // The one moment the page moves on its own: once, when it can be seen.
  useEffect(() => {
    if (still) {
      setSeam((v) => (v === 100 ? REST : v));
      return;
    }
    const el = stage.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeam(REST);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          setSeam((v) => (v === 100 ? REST : v));
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
    if (!el) return REST;
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
    if (dragging) setSeam(at(e.clientX));
  };
  const drop = () => setDragging(false);

  const style = { "--seam": `${seam}%` } as CSSProperties;
  return (
    <figure className={s.duo}>
      <div className={s.duoLegend} aria-hidden="true">
        <span>{t("home.duo.you")}</span>
        <span className={s.duoLegendServer}>{t("home.duo.server")}</span>
      </div>
      <div
        ref={stage}
        className={s.stage}
        style={style}
        data-dragging={dragging || undefined}
        data-still={still || undefined}
        // With a mouse, a press anywhere moves the line there. A finger only
        // moves it from the handle, so a thumb scrolling past never does.
        onPointerDown={(e) => e.pointerType === "mouse" && grab(e, true)}
        onPointerMove={drag}
        onPointerUp={drop}
        onPointerCancel={drop}
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
    <figure className={s.frame} data-shape={width === height ? "square" : undefined}>
      <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" />
    </figure>
  );
}

/**
 * A short loop of the app in use. It plays only while it is on screen, it can
 * be paused (it would otherwise never stop), and anyone who asked for less
 * movement gets the still it starts from instead.
 */
function Movie({ name, alt, still }: { name: string; alt: string; still: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setSeen(entries.some((e) => e.isIntersecting)), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [still]);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (seen && !paused) void el.play().catch(() => undefined);
    else el.pause();
  }, [seen, paused]);

  if (still) {
    return (
      <figure className={s.frame}>
        <img src={`/home/${name}.png`} alt={alt} width={900} height={563} loading="lazy" decoding="async" />
      </figure>
    );
  }
  return (
    <figure className={s.frame}>
      <video ref={video} muted loop playsInline preload="none" poster={`/home/${name}.png`} aria-label={alt} width={900} height={563}>
        <source src={`/home/${name}.webm`} type="video/webm" />
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

/** One part of the app: what it is in a line, what it looks like, and the specifics. */
function Chapter({ id, title, lede, media, facts, children }: { id: string; title: string; lede: string; media?: ReactNode; facts?: Fact[]; children?: ReactNode }) {
  return (
    <section className={s.chapter} aria-labelledby={id}>
      <div className={s.chapterHead}>
        <h2 id={id} className={s.h2}>{title}</h2>
        <p className={s.chapterLede}>{lede}</p>
      </div>
      <div className={s.chapterBody}>
        {media}
        {children}
        {facts?.length ? (
          <dl className={s.facts}>
            {facts.map((f) => (
              <div key={f.title} className={s.fact}>
                <dt>{f.title}</dt>
                <dd>{f.body}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
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

export default function HomePage() {
  useFrontDocument();
  const still = useStillness();
  const signedIn = useAuth((a) => !!a.me) || hasSavedSession();
  const [os, setOs] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void currentPlatform().then(({ os: kind }) => {
      if (alive) setOs(kind === "mac" ? "macOS" : kind === "windows" ? "Windows" : kind === "linux" ? "Linux" : null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const start = signedIn ? (
    <Link className={s.primary} to="/channels/@me">{t("home.nav.open")}</Link>
  ) : (
    <Link className={s.primary} to="/register">{t("home.nav.getStarted")}</Link>
  );

  return (
    <div className={s.page}>
      <header className={s.top}>
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

      <main>
        <section className={s.hero} aria-labelledby="home-title">
          <div className={s.heroText}>
            <h1 id="home-title" className={s.h1}>{t("home.hero.title")}</h1>
            <p className={s.lede}>{t("home.hero.lede")}</p>
            <div className={s.actions}>
              {start}
              <Link className={s.secondary} to="/download">{os ? t("home.hero.downloadFor", { os }) : t("home.nav.download")}</Link>
            </div>
            <p className={s.fine}>{t("home.hero.fine")}</p>
          </div>
          <Duo still={still} />
        </section>

        <Chapter
          id="home-servers"
          title={t("home.servers.title")}
          lede={t("home.servers.lede")}
          media={<Still src="/home/app.png" alt={t("home.shot.app")} width={1440} height={900} />}
          facts={facts("servers", ["roles", "private", "invites", "subchats", "folders"])}
        />
        <Chapter
          id="home-calls"
          title={t("home.calls.title")}
          lede={t("home.calls.lede")}
          media={<Movie name="call-loop" alt={t("home.shot.call")} still={still} />}
          facts={facts("calls", ["share", "volume", "talk", "address", "guests", "zoom"])}
        />
        <Chapter
          id="home-yours"
          title={t("home.yours.title")}
          lede={t("home.yours.lede")}
          media={<Still src="/home/express.png" alt={t("home.shot.express")} width={554} height={554} />}
          facts={facts("yours", ["emoji", "stickers", "themes", "plugins", "format"])}
        />
        <Chapter id="home-private" title={t("home.private.title")} lede={t("home.private.lede")} facts={facts("private", ["signup", "recovery", "safety", "lock", "previews", "search", "export"])}>
          <div className={s.ledger}>
            <div className={s.ledgerSide} data-sealed="">
              <h3 className={s.h3}>{t("home.private.cantTitle")}</h3>
              <ul>
                {["messages", "files", "calls", "keys", "settings"].map((k) => (
                  <li key={k}>
                    <Lock size={16} aria-hidden="true" />
                    <span>{t(`home.private.cant.${k}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={s.ledgerSide}>
              <h3 className={s.h3}>{t("home.private.knowsTitle")}</h3>
              <ul>
                {["account", "where", "when", "sizes"].map((k) => (
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
          media={<Movie name="speed" alt={t("home.shot.speed")} still={still} />}
          facts={facts("quick", ["desktop", "phone", "languages"])}
        />
        <Chapter id="home-people" title={t("home.people.title")} lede={t("home.people.lede")} facts={facts("people", ["reports"])}>
          <p className={s.aboutLinks}>
            <Link to="/about">{t("home.people.about")}</Link>
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </Chapter>

        <section className={s.end} aria-labelledby="home-end">
          <h2 id="home-end" className={s.endTitle}>{t("home.end.title")}</h2>
          <p className={s.endBody}>{t("home.end.body")}</p>
          <div className={s.actions}>
            {start}
            <Link className={s.secondary} to="/download">{t("home.nav.download")}</Link>
          </div>
        </section>
      </main>

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
