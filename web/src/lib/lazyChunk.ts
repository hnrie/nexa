/**
 * Lazily loaded pages, with a way back from a deploy.
 *
 * A page that is already open holds the file names its build was compiled
 * with. Publishing a new build replaces those files, so the next screen it
 * tries to open is a fetch for something that is no longer there. Rather than
 * showing that as a crash, the page reloads once and comes back on the new
 * build. Old files are also kept on the server for a week, so this is the
 * fallback rather than the usual path.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

const RELOAD_FLAG = "ec.chunkReload";

function reloadedAlready(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) !== null;
  } catch {
    return false;
  }
}

function markReloaded(): void {
  try {
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    /* private window: one attempt is all we get */
  }
}

/** Clears the guard once the app has run for a while on the new build. */
export function markChunksHealthy(): void {
  setTimeout(() => {
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
      /* nothing to clear */
    }
  }, 20_000);
}

/** React.lazy that survives the file it wanted being replaced by a deploy. */
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await load();
    } catch (err) {
      if (reloadedAlready()) throw err;
      markReloaded();
      window.location.reload();
      // the page is on its way out; never resolve, so nothing renders an error
      return await new Promise<{ default: T }>(() => undefined);
    }
  });
}
