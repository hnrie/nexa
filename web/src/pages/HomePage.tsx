/**
 * The front page: what Nexa is, in as few words as it takes.
 *
 * Every claim here is one the app keeps, shown with pictures and short loops
 * taken from it actually running (tools/home_shots.py, tools/home_gifs.py)
 * rather than an illustration of it. Blocks appear as they are scrolled to and
 * the pictures sit on a plane that tips towards the pointer; all of it holds
 * still for anyone who asked for less motion.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AtSign, Gauge, Images, KeyRound, Languages, Link2, Lock, MessagesSquare,
  MonitorPlay, ScanSearch, Smile, Sparkles, UserPlus, ZoomIn,
} from "lucide-react";
import { NexaWordmark } from "@/components/common/Brand";
import { FloatingPlane } from "@/components/common/FloatingPlane";
import { useAuth } from "@/stores/auth";
import { useReveal } from "@/hooks/useReveal";
import { currentPlatform } from "@/lib/platform";
import { t } from "@/i18n";
import s from "./Home.module.css";

/** One block that fades up the first time it is seen. */
function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const [ref, seen] = useReveal<HTMLDivElement>();
  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} className={[s.reveal, className].filter(Boolean).join(" ")} data-seen={seen || undefined} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

/** A picture of the app, in a frame that reads as a window. */
function Shot({ src, alt }: { src: string; alt: string }) {
  return (
    <FloatingPlane>
      <figure className={s.shot}>
        <div className={s.chrome}><i /><i /><i /></div>
        <img src={src} alt={alt} loading="lazy" decoding="async" />
      </figure>
    </FloatingPlane>
  );
}

/**
 * A short loop of the app in use. The video is a fraction of the size of the
 * same thing as a GIF, and the GIF is there for anything that cannot play it.
 */
function Loop({ name, alt }: { name: string; alt: string }) {
  return (
    <FloatingPlane>
      <figure className={s.shot}>
        <div className={s.chrome}><i /><i /><i /></div>
        <video autoPlay muted loop playsInline preload="none" poster={`/home/${name}.png`} aria-label={alt}>
          <source src={`/home/${name}.webm`} type="video/webm" />
          <img src={`/home/${name}.gif`} alt={alt} loading="lazy" />
        </video>
      </figure>
    </FloatingPlane>
  );
}

const POINTS = () => [
  { icon: Lock, title: t("home.point.encryptedTitle"), body: t("home.point.encryptedBody") },
  { icon: MessagesSquare, title: t("home.point.subchatsTitle"), body: t("home.point.subchatsBody") },
  { icon: Smile, title: t("home.point.packsTitle"), body: t("home.point.packsBody") },
  { icon: AtSign, title: t("home.point.noEmailTitle"), body: t("home.point.noEmailBody") },
  { icon: UserPlus, title: t("home.point.guestsTitle"), body: t("home.point.guestsBody") },
  { icon: ScanSearch, title: t("home.point.searchTitle"), body: t("home.point.searchBody") },
  { icon: KeyRound, title: t("home.point.lockTitle"), body: t("home.point.lockBody") },
  { icon: Link2, title: t("home.point.previewsTitle"), body: t("home.point.previewsBody") },
  { icon: ZoomIn, title: t("home.point.zoomTitle"), body: t("home.point.zoomBody") },
  { icon: Sparkles, title: t("home.point.presenceTitle"), body: t("home.point.presenceBody") },
  { icon: Images, title: t("home.point.exportTitle"), body: t("home.point.exportBody") },
  { icon: Languages, title: t("home.point.languagesTitle"), body: t("home.point.languagesBody") },
];

const NUMBERS = () => [
  { value: "264 KB", label: t("home.speed.size") },
  { value: "50 ms", label: t("home.speed.switch") },
  { value: "50 MB", label: t("home.speed.memory") },
];

export default function HomePage() {
  const me = useAuth((a) => a.me);
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

  return (
    <div className={s.page}>
      <header className={s.top}>
        <Link to="/" className={s.logo} aria-label="Nexa"><NexaWordmark height={26} /></Link>
        <nav className={s.nav}>
          <Link className={s.quiet} to="/download">{t("home.nav.download")}</Link>
          {me ? (
            <Link className={s.cta} to="/channels/@me">{t("home.nav.open")}</Link>
          ) : (
            <>
              <Link className={s.quiet} to="/login">{t("home.nav.logIn")}</Link>
              <Link className={s.cta} to="/register">{t("home.nav.getStarted")}</Link>
            </>
          )}
        </nav>
      </header>

      <section className={s.hero}>
        <div className={s.glow} aria-hidden="true" />
        <Reveal>
          <h1 className={s.h1}>{t("home.hero.title")}</h1>
          <p className={s.lede}>{t("home.hero.lede")}</p>
          <div className={s.actions}>
            <Link className={s.big} to={me ? "/channels/@me" : "/register"}>{me ? t("home.nav.open") : t("home.hero.start")}</Link>
            <Link className={s.bigQuiet} to="/download">{os ? t("home.hero.downloadFor", { os }) : t("home.nav.download")}</Link>
          </div>
          <p className={s.fine}>{t("home.hero.fine")}</p>
        </Reveal>
        <Reveal delay={90} className={s.heroShot}>
          <Shot src="/home/app.png" alt={t("home.shot.app")} />
        </Reveal>
      </section>

      <section className={s.strip}>
        <Reveal>
          <h2 className={s.h2}>{t("home.calls.title")}</h2>
          <p className={s.body}>{t("home.calls.body")}</p>
          <ul className={s.list}>
            <li>{t("home.calls.a")}</li>
            <li>{t("home.calls.b")}</li>
            <li>{t("home.calls.c")}</li>
          </ul>
        </Reveal>
        <Reveal delay={80}><Loop name="call-loop" alt={t("home.shot.call")} /></Reveal>
      </section>

      <section className={s.strip} data-flip="">
        <Reveal>
          <h2 className={s.h2}>{t("home.speed.title")}</h2>
          <p className={s.body}>{t("home.speed.body")}</p>
          <div className={s.numbers}>
            {NUMBERS().map((n) => (
              <div key={n.label} className={s.number}>
                <span className={s.numberValue}>{n.value}</span>
                <span className={s.numberLabel}>{n.label}</span>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={80}><Loop name="speed" alt={t("home.shot.speed")} /></Reveal>
      </section>

      <section className={s.strip}>
        <Reveal>
          <h2 className={s.h2}>{t("home.express.title")}</h2>
          <p className={s.body}>{t("home.express.body")}</p>
        </Reveal>
        <Reveal delay={80}><Shot src="/home/express.png" alt={t("home.shot.express")} /></Reveal>
      </section>

      <section className={s.points}>
        {POINTS().map((p, i) => (
          <Reveal key={p.title} delay={(i % 3) * 70}>
            <div className={s.point}>
              <span className={s.pointIcon}><p.icon size={20} /></span>
              <h2 className={s.pointTitle}>{p.title}</h2>
              <p className={s.pointBody}>{p.body}</p>
            </div>
          </Reveal>
        ))}
      </section>

      <section className={s.compare}>
        <Reveal>
          <h2 className={s.h2}>{t("home.compare.title")}</h2>
          <p className={s.body}>{t("home.compare.body")}</p>
          <table className={s.table}>
            <thead>
              <tr><th /><th>Nexa</th><th>{t("home.compare.them")}</th></tr>
            </thead>
            <tbody>
              {[
                ["home.compare.e2ee", true, false],
                ["home.compare.subchats", true, false],
                ["home.compare.packs", true, false],
                ["home.compare.emojiEverywhere", true, false],
                ["home.compare.noEmail", true, false],
                ["home.compare.guests", true, false],
                ["home.compare.lock", true, false],
                ["home.compare.zoom", true, false],
                ["home.compare.rpc", true, true],
                ["home.compare.calls", true, true],
              ].map(([key, ours, theirs]) => (
                <tr key={String(key)}>
                  <td>{t(String(key))}</td>
                  <td data-yes={ours || undefined}>{ours ? "✓" : "✕"}</td>
                  <td data-yes={theirs || undefined}>{theirs ? "✓" : "✕"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
      </section>

      <section className={s.end}>
        <Reveal>
          <NexaWordmark height={44} className={s.endMark} />
          <p className={s.body}>{t("home.end.body")}</p>
          <div className={s.actions}>
            <Link className={s.big} to={me ? "/channels/@me" : "/register"}>{me ? t("home.nav.open") : t("home.hero.start")}</Link>
            <Link className={s.bigQuiet} to="/download">{t("home.nav.download")}</Link>
          </div>
        </Reveal>
      </section>

      <footer className={s.foot}>
        <span>{t("home.foot.tagline")}</span>
        <span className={s.footLinks}>
          <Link to="/download">{t("home.nav.download")}</Link>
          <Link to="/login">{t("home.nav.logIn")}</Link>
        </span>
      </footer>
    </div>
  );
}
