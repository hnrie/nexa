import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportCrash } from "@/lib/crashReport";
import { storage } from "@/lib/storage";
import s from "./ErrorBoundary.module.css";

import { t } from "@/i18n";
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string;
  /** How many times this session has crashed; a loop should not reload forever. */
  reloads: number;
}

const RELOAD_KEY = "crashReloads";
const RELOAD_AT = "crashReloadAt";
const MAX_AUTO_RELOADS = 2;

function recentReloads(): number {
  const at = Number(storage.get(RELOAD_AT) ?? 0);
  // a crash more than five minutes after the last one starts the count again
  if (!at || Date.now() - at > 5 * 60 * 1000) return 0;
  return Number(storage.get(RELOAD_KEY) ?? 0);
}

/**
 * Catches render crashes and offers a way out instead of a blank page. The
 * first couple of crashes reload automatically, since a stale bundle or a
 * half-applied update usually fixes itself; after that it stops and shows
 * the error so a real bug is visible rather than looping.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: "", reloads: recentReloads() };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("render crash", error, info.componentStack);
    reportCrash({ kind: "render", message: `${error.name}: ${error.message}`, stack: error.stack ?? "", component: info.componentStack ?? "" });
    this.setState({ info: (info.componentStack ?? "").split("\n").slice(0, 8).join("\n") });
    const count = recentReloads();
    if (count < MAX_AUTO_RELOADS) {
      storage.set(RELOAD_KEY, String(count + 1));
      storage.set(RELOAD_AT, String(Date.now()));
      setTimeout(() => window.location.reload(), 400);
    }
  }

  private reload = (): void => {
    storage.set(RELOAD_KEY, "0");
    window.location.reload();
  };

  private reset = async (): Promise<void> => {
    // last resort: drop caches and the service worker, keep the session
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      for (const r of regs ?? []) await r.unregister();
      const keys = await caches?.keys?.();
      for (const k of keys ?? []) await caches.delete(k);
    } catch {
      /* nothing cached */
    }
    storage.set(RELOAD_KEY, "0");
    window.location.reload();
  };

  override render(): ReactNode {
    const { error, info, reloads } = this.state;
    if (!error) return this.props.children;
    const looping = reloads >= MAX_AUTO_RELOADS;
    return (
      <div className={s.wrap} role="alert">
        <div className={s.card}>
          <h1 className={s.title}>{looping ? t("shell.errorBoundary.somethingKeepsGoingWrong") : t("shell.errorBoundary.reloading")}</h1>
          <p className={s.body}>
            {looping
              ? t("shell.errorBoundary.thisPageCrashedMoreThanOnce")
              : t("shell.errorBoundary.thisPageHitAnErrorAnd")}
          </p>
          <pre className={s.detail}>{error.message}{info ? `\n${info}` : ""}</pre>
          <div className={s.actions}>
            <button className={s.primary} onClick={this.reload}>{t("shell.errorBoundary.reload")}</button>
            <button className={s.secondary} onClick={() => void this.reset()}>{t("shell.errorBoundary.clearCacheAndReload")}</button>
          </div>
          <p className={s.note}>{t("shell.errorBoundary.ifItKeepsHappeningTellWhoever")}</p>
        </div>
      </div>
    );
  }
}

/** Clears the crash counter once the app has stayed up for a while. */
export function markHealthy(): void {
  setTimeout(() => storage.set(RELOAD_KEY, "0"), 15000);
}
