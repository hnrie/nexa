/**
 * The words the app shows outside the page.
 *
 * There is one catalogue, and it lives in the web client: the page sends its
 * translations over as soon as it knows which language it is in, and they are
 * kept in settings so the next launch already has them — the tray, the menu
 * bar and the offline page all exist before any page has loaded.
 *
 * English is the fallback, per field, so a string added here but not yet sent
 * by an older page reads in English rather than as nothing.
 */
import type { NativeStrings } from "../shared/bridge";

const ENGLISH: NativeStrings = {
  open: "Open Nexa",
  mute: "Mute",
  deafen: "Deafen",
  checkForUpdates: "Check for Updates",
  quit: "Quit Nexa",
  view: "View",
  reload: "Reload",
  addToDictionary: "Add to Dictionary",
  copyLink: "Copy Link",
  openLinkInBrowser: "Open Link in Browser",
  offlineTitle: "Can't reach Nexa",
  offlineBody: "Check your connection. Trying again in a few seconds.",
  offlineRetry: "Try now",
  about: "End to end encrypted chat, voice and servers.",
  moveTitle: "Move Nexa to Applications?",
  moveBody: "Nexa works best from your Applications folder. It moves itself there and opens again.",
  moveReplaceBody: "This replaces the older Nexa in your Applications folder.",
  moveButton: "Move to Applications",
  notNow: "Not Now",
  moveFailed: "Nexa couldn't move itself to Applications. Drag it there from the disk image instead.",
};

let current: NativeStrings = { ...ENGLISH };

export function nativeStrings(): NativeStrings {
  return current;
}

/** Takes whichever fields the page sent, ignoring anything that is not a usable string. */
export function setNativeStrings(patch: unknown): NativeStrings {
  const next = { ...ENGLISH };
  if (patch && typeof patch === "object") {
    for (const key of Object.keys(ENGLISH) as (keyof NativeStrings)[]) {
      const value = (patch as Record<string, unknown>)[key];
      // a label long enough to break a menu is a bug on the page's side, not something to draw
      if (typeof value === "string" && value.trim() && value.length <= 120) next[key] = value.trim();
    }
  }
  current = next;
  return current;
}

/** Whether two sets differ, so the menus are only rebuilt when they have to be. */
export function stringsDiffer(a: NativeStrings, b: NativeStrings): boolean {
  return (Object.keys(ENGLISH) as (keyof NativeStrings)[]).some((k) => a[k] !== b[k]);
}
