/**
 * The front page: what Nexa is, in as few words as it takes.
 *
 * Everything here is a claim the app actually keeps, shown with real pictures
 * of it rather than an illustration of one. The page reveals each block as it
 * scrolls into view and holds still for anyone who asked for less motion.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Gift, Lock, MonitorPlay, Server, Sparkles, Zap } from "lucide-react";
import { NexaWordmark } from "@/components/common/Brand";
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
function Shot({ src, alt, wide }: { src: string; alt: string; wide?: boolean }) {
  return (
    <figure className={s.shot} data-wide={wide || undefined}>
      <div className={s.chrome}><i /><i /><i /></div>
      <img src={src} alt={alt} loading="lazy" decoding="async" />
    </figure>
  );
}

const POINTS = () => [
  { icon: Lock, title: t("home.point.encryptedTitle"), body: t("home.point.encryptedBody") },
  { icon: Gift, title: t("home.point.freeTitle"), body: t("home.point.freeBody") },
  { icon: MonitorPlay, title: t("home.point.callsTitle"), body: t("home.point.callsBody") },
  { icon: Server, title: t("home.point.yoursTitle"), body: t("home.point.yoursBody") },
  { icon: Sparkles, title: t("home.point.presenceTitle"), body: t("home.point.presenceBody") },
  { icon: Zap, title: t("home.point.fastTitle"), body: t("home.point.fastBody") },
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
          <Shot src="/home/app.png" alt={t("home.shot.app")} wide />
        </Reveal>
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

      <section className={s.strip}>
        <Reveal>
          <h2 className={s.h2}>{t("home.calls.title")}</h2>
          <p className={s.body}>{t("home.calls.body")}</p>
        </Reveal>
        <Reveal delay={80}><Shot src="/home/call.png" alt={t("home.shot.call")} wide /></Reveal>
      </section>

      <section className={s.strip} data-flip="">
        <Reveal>
          <h2 className={s.h2}>{t("home.express.title")}</h2>
          <p className={s.body}>{t("home.express.body")}</p>
        </Reveal>
        <Reveal delay={80}><Shot src="/home/express.png" alt={t("home.shot.express")} /></Reveal>
      </section>

      <section className={s.compare}>
        <Reveal>
          <h2 className={s.h2}>{t("home.compare.title")}</h2>
          <table className={s.table}>
            <thead>
              <tr><th /><th>Nexa</th><th>{t("home.compare.them")}</th></tr>
            </thead>
            <tbody>
              {[
                ["home.compare.e2ee", true, false],
                ["home.compare.uploads", true, false],
                ["home.compare.emoji", true, false],
                ["home.compare.selfHost", true, false],
                ["home.compare.ads", true, false],
                ["home.compare.rpc", true, true],
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
