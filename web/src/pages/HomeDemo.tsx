import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { t, translator } from "@/i18n";
import s from "./HomeDemo.module.css";

/** A separate app realm, so exploring never touches a saved account or homepage state. */
export default function HomeDemo() {
  const [expanded, setExpanded] = useState(false);
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const origin = useRef<DOMRect | null>(null);
  const animation = useRef<Animation | null>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const still = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset["reducedMotion"] === "true";
  const collapse = useCallback(() => {
    if (!expanded) return;
    const el = windowRef.current;
    const to = slot.current?.getBoundingClientRect();
    animation.current?.cancel();
    if (!el || !to || still() || !el.animate) { setExpanded(false); return; }
    const from = el.getBoundingClientRect();
    const closing = el.animate([
      { transform: "none", borderRadius: "0px" },
      { transform: `translate(${to.left}px, ${to.top}px) scale(${to.width / from.width}, ${to.height / from.height})`, borderRadius: "18px" },
    ], { duration: 280, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" });
    animation.current = closing;
    void closing.finished.then(() => { setExpanded(false); closing.cancel(); }, () => undefined);
  }, [expanded]);
  useLayoutEffect(() => {
    const el = windowRef.current;
    const from = origin.current;
    if (!expanded || !el || !from || still() || !el.animate) return;
    const to = el.getBoundingClientRect();
    animation.current = el.animate([
      { transform: `translate(${from.left}px, ${from.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, borderRadius: "18px" },
      { transform: "none", borderRadius: "0px" },
    ], { duration: 340, easing: "cubic-bezier(.22,1,.36,1)" });
    return () => animation.current?.cancel();
  }, [expanded]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== location.origin) return;
      if (event.data?.type === "nexa-demo-ready") setReady(true);
      if (event.data?.type === "nexa-demo-collapse") collapse();
      if (event.data?.type === "nexa-demo-register") navigate("/register");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [navigate, collapse]);
  useEffect(() => {
    if (!expanded) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Make the surrounding page inert, while retaining the very same iframe and its edits.
    const siblings: { el: HTMLElement; inert: boolean }[] = [];
    let current: HTMLElement | null = windowRef.current;
    while (current?.parentElement) {
      for (const el of current.parentElement.children) if (el !== current && el instanceof HTMLElement) {
        siblings.push({ el, inert: el.inert }); el.inert = true;
      }
      current = current.parentElement;
    }
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") collapse(); };
    const focus = (event: FocusEvent) => { if (event.target instanceof Node && !windowRef.current?.contains(event.target)) expandButton.current?.focus(); };
    window.addEventListener("keydown", close);
    document.addEventListener("focusin", focus);
    expandButton.current?.focus();
    return () => {
      document.body.style.overflow = before;
      for (const { el, inert } of siblings) el.inert = inert;
      window.removeEventListener("keydown", close);
      document.removeEventListener("focusin", focus);
      expandButton.current?.focus();
    };
  }, [expanded, collapse]);
  const command = (action: string) => frame.current?.contentWindow?.postMessage({ type: "nexa-demo-command", action }, location.origin);
  return <div className={s.demo}>
    <div ref={slot} style={expanded ? { height: origin.current?.height } : undefined}>
    <div ref={windowRef} className={s.window} data-expanded={expanded || undefined} role={expanded ? "dialog" : "region"} aria-modal={expanded || undefined} aria-label={t("home.demo.title")}>
      <div className={s.toolbar}>
        <div className={s.caption}><strong>{t("home.demo.title")}</strong><span>{t("home.demo.ephemeral")}</span></div>
        <div className={s.tools}>
          <button type="button" onClick={() => { setReady(false); setVersion((n) => n + 1); }} aria-label={t("home.demo.reset")} title={t("home.demo.reset")}><RotateCcw size={17} /></button>
          <button type="button" ref={expandButton} onClick={() => {
            if (expanded) collapse();
            else { origin.current = windowRef.current?.getBoundingClientRect() ?? null; setExpanded(true); }
          }} aria-expanded={expanded} aria-label={t(expanded ? "home.demo.collapse" : "home.demo.expand")} title={t(expanded ? "home.demo.collapse" : "home.demo.expand")}>
            {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}<span>{t(expanded ? "home.demo.collapse" : "home.demo.expand")}</span>
          </button>
        </div>
      </div>
      <div className={s.shortcuts} aria-label={t("home.demo.try")}>
        <span>{t("home.demo.try")}</span>
        <button type="button" disabled={!ready} onClick={() => command("server")}>{t("modals.createServer.createYourServer")}</button>
        <button type="button" disabled={!ready} onClick={() => command("notes")}>{t("notes.title")}</button>
        <button type="button" disabled={!ready} onClick={() => command("appearance")}>{t("settings.appearance.appearance")}</button>
      </div>
      <div className={s.viewport}>
        {!ready && <div className={s.loading} role="status">{t("shell.requireAuth.connecting")}</div>}
        <iframe key={version} ref={frame} src={`/demo.html?locale=${encodeURIComponent(translator().locale)}`} title={t("home.demo.title")} loading="lazy" sandbox="allow-scripts allow-same-origin" allow="camera 'none'; microphone 'none'; display-capture 'none'; geolocation 'none'; clipboard-write 'none'" referrerPolicy="no-referrer" />
      </div>
    </div>
    </div>
    <p className={s.hint}>{t("home.demo.hint")}</p>
  </div>;
}
