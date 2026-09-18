import { create } from "zustand";
import { notePublicKey, pinKey, pinnedKey, type PinVerdict } from "@/lib/keyPins";
import { useUI } from "./ui";

import { t } from "@/i18n";

/**
 * What this device noticed about identity keys, and what it refused to do.
 *
 * Two things happen behind the user's back in a system where the server names
 * the recipients and supplies their keys: a conversation key gets sealed for
 * somebody who is not in the conversation, and a key quietly changes under a
 * name that has not changed. Neither had anywhere to surface before — the
 * client did both silently — so this store is the surface. It holds a short
 * log the account's owner (and, through them, the operator) can read, and the
 * changes that are waiting on a human to look at them.
 *
 * Nothing here is sent anywhere. It is a record of what one device saw.
 */

export type SecurityEventKind =
  /** The server offered a different identity key for someone this device knows. */
  | "key_changed"
  /** A grant was asked for on behalf of an account that is not in the conversation. */
  | "outsider_refused"
  /** A grant was withheld because the recipient's key had changed. */
  | "grant_withheld"
  /** Recipients could not be checked against a membership list this device holds in full. */
  | "unchecked";

export interface SecurityEvent {
  id: number;
  at: number;
  kind: SecurityEventKind;
  /** The person concerned, where the event is about one. */
  userId?: string;
  /** The conversation, where the event is about a grant. */
  conv?: string;
  epoch?: number;
  /** How many recipients the event covers, for the ones that are about a list. */
  count?: number;
}

/** A key change waiting on a decision: what was pinned, and what is being offered instead. */
export interface PendingKeyChange {
  userId: string;
  pinned: string;
  offered: string;
  firstSeen: number;
}

interface KeyAlertsState {
  events: SecurityEvent[];
  pending: Record<string, PendingKeyChange>;
  /** Raised by the key paths; also toasts, so a refusal is not only in a log. */
  report: (e: Omit<SecurityEvent, "id" | "at">) => void;
  /** Records a changed key as needing a decision and puts the question on screen. */
  flagKeyChange: (userId: string, offered: string) => void;
  /** The user has looked at the new key and says it is really them. */
  acceptKeyChange: (userId: string) => void;
  /** The user says it is not. The old pin stays, so nothing is ever sealed to the new key. */
  rejectKeyChange: (userId: string) => void;
  clearEvents: () => void;
  reset: () => void;
}

/** Enough to see a pattern, few enough that nothing grows without bound. */
const MAX_EVENTS = 100;

let nextId = 1;

export const useKeyAlerts = create<KeyAlertsState>()((set, get) => ({
  events: [],
  pending: {},
  report: (e) => {
    set((s) => ({ events: [{ ...e, id: nextId++, at: Date.now() }, ...s.events].slice(0, MAX_EVENTS) }));
    // A refusal that only ever reached the console is a refusal nobody knows
    // about, which is most of what made the original problem invisible.
    if (e.kind === "outsider_refused") {
      console.warn("keys: refused to seal a conversation key for an account outside the conversation", e);
      useUI.getState().toast(t("encryption.refusedOutsiderToast", { count: e.count ?? 1 }), "error");
    }
    if (e.kind === "unchecked") {
      console.warn("keys: could not check grant recipients against a membership list held in full", e);
    }
  },
  flagKeyChange: (userId, offered) => {
    const pinned = pinnedKey(userId);
    if (!pinned || pinned === offered) return;
    const already = get().pending[userId];
    if (already?.offered === offered) return;
    set((s) => ({ pending: { ...s.pending, [userId]: { userId, pinned, offered, firstSeen: Date.now() } } }));
    get().report({ kind: "key_changed", userId });
    // Opened rather than merely logged: until this is answered nothing is
    // sealed to the new key, so the person would otherwise just silently stop
    // receiving keys with no idea why.
    useUI.getState().openModal("keyChange", { userId });
  },
  acceptKeyChange: (userId) => {
    const p = get().pending[userId];
    if (!p) return;
    pinKey(userId, p.offered);
    set((s) => {
      const pending = { ...s.pending };
      delete pending[userId];
      return { pending };
    });
  },
  rejectKeyChange: (userId) => {
    set((s) => {
      const pending = { ...s.pending };
      delete pending[userId];
      return { pending };
    });
  },
  clearEvents: () => set({ events: [] }),
  reset: () => set({ events: [], pending: {} }),
}));

/**
 * The one call the rest of the app makes about somebody's key: pin it if this
 * device has never seen one for them, say whether it is the one it remembers,
 * and put a change in front of a human rather than deciding it here.
 *
 * Every user object the server sends goes through this, not only the ones a key
 * is about to be sealed to, so a swap is noticed the moment it is offered
 * rather than the next time a rotation happens to come round.
 */
export function judgeKey(userId: string, publicKeyB64: string | null | undefined): PinVerdict {
  const verdict = notePublicKey(userId, publicKeyB64);
  if (verdict === "changed" && publicKeyB64) useKeyAlerts.getState().flagKeyChange(userId, publicKeyB64);
  return verdict;
}
