import { GatewayClient } from "./client";
import type { GatewayEvent } from "./events";
import { applyEvent, dispatchGeneration, endDispatchSession, resetAll } from "./dispatch";
import { logoutHooks, useAuth } from "@/stores/auth";
import { useKeys } from "@/stores/keys";
import { useMessages } from "@/stores/messages";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useVoice } from "@/stores/voice";
import { useNexa } from "@/stores/nexa";
import { useModeration } from "@/stores/moderation";
import { useUploads } from "@/stores/uploads";
import { forgetSends } from "@/components/composer/send";
import { forgetUnsentAcks } from "@/stores/readStates";
import { admin as adminApi } from "@/api/admin";
import { setUploadLimits } from "@/lib/attachments";
import { clearLock, hasLock } from "@/lib/appLock";
import { clearMediaCache } from "@/lib/mediaCache";
import { keystore } from "@/crypto/keystore";
import { leaveVoice } from "@/voice/session";
import { workerClearTimeout, workerSetTimeout } from "@/lib/workerTimers";
import { usePanes } from "@/stores/panes";

let client: GatewayClient | null = null;
let queue: Promise<void> = Promise.resolve();
/** Set for the whole of startSession, including its awaits, so two overlapping calls build one client. */
let starting = false;
/** Moves on when a session ends, so one still starting knows to stop. */
let sessionGeneration = 0;

export function gatewayUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/gateway`;
}

/** Connects the gateway for the logged-in user; safe to call repeatedly. */
export async function startSession(): Promise<void> {
  const { me, identity, settingsKey } = useAuth.getState();
  if (!me || !identity) return;
  // The key store is read before the client is built, and two callers that
  // overlap on that await would both find `client` null: the second socket is
  // never referenced again but keeps applying every event a second time.
  if (starting) return;
  starting = true;
  const gen = ++sessionGeneration;
  try {
    useSettings.getState().setKey(settingsKey);
    void loadUploadLimits();
    try {
      await useKeys.getState().init(me.id, identity);
    } catch (err) {
      // The cached keys are only a head start: ready brings every grant again,
      // so a key store that fails (WebKit drops it after a long background stay)
      // must not leave the app without a connection.
      console.warn("keystore: could not load cached keys", err);
      useKeys.setState({ userId: me.id, identity, waiting: {} });
    }
    // Locked or signed out while the keys were loading: this session is not
    // wanted any more, and connecting now would bring it back to life.
    if (gen !== sessionGeneration) {
      useKeys.getState().reset();
      return;
    }
    if (client) return;
    client = new GatewayClient({
      url: gatewayUrl,
      token: () => useAuth.getState().token,
      onEvent: (e) => {
        // events are applied strictly in order; a slow decrypt never reorders later frames
        const gen = dispatchGeneration();
        queue = queue.then(() => (gen === dispatchGeneration() ? applyEvent(e) : undefined)).catch(() => undefined);
      },
      onStatus: (s) => useUI.getState().setConnection(s),
      // heartbeats keep their pace in a hidden window, where the page's own timers slow to once a minute
      setTimeoutImpl: workerSetTimeout,
      clearTimeoutImpl: workerClearTimeout,
    });
    client.connect();
    window.addEventListener("online", wakeGateway);
    window.addEventListener("pageshow", wakeGateway);
    document.addEventListener("visibilitychange", wakeGatewayIfShown);
  } finally {
    starting = false;
  }
}

/**
 * Connects the gateway for a guest in a call: no account, keys or settings,
 * only the events of that one call, handed to `onEvent` as they come.
 */
export function startGuestSession(token: string, onEvent: (e: GatewayEvent) => void): void {
  stopGuestSession();
  client = new GatewayClient({
    url: gatewayUrl,
    token: () => token,
    onEvent,
    onStatus: (s) => useUI.getState().setConnection(s),
    setTimeoutImpl: workerSetTimeout,
    clearTimeoutImpl: workerClearTimeout,
  });
  client.connect();
  window.addEventListener("online", wakeGateway);
  window.addEventListener("pageshow", wakeGateway);
  document.addEventListener("visibilitychange", wakeGatewayIfShown);
}

export function stopGuestSession(): void {
  window.removeEventListener("online", wakeGateway);
  window.removeEventListener("pageshow", wakeGateway);
  document.removeEventListener("visibilitychange", wakeGatewayIfShown);
  client?.close();
  client = null;
}

/** Coming back online or to the app is when a connection is most likely to have died. */
function wakeGateway(): void {
  client?.wake();
}

function wakeGatewayIfShown(): void {
  if (document.visibilityState === "visible") client?.wake();
}

export function stopSession(): void {
  sessionGeneration++;
  window.removeEventListener("online", wakeGateway);
  window.removeEventListener("pageshow", wakeGateway);
  document.removeEventListener("visibilitychange", wakeGatewayIfShown);
  // Events already partway through applying stop here rather than finishing
  // into stores that have just been cleared.
  endDispatchSession();
  client?.close();
  client = null;
  useKeys.getState().reset();
  // Changes still waiting to be saved go now, sealed with the key they were
  // made under: the reset below forgets them, so a theme picked a moment
  // before the app locked itself was simply gone when it unlocked.
  void useSettings.getState().flush();
  useSettings.getState().reset();
  // Without the keys nothing decrypted should stay readable either; unlocking
  // loads the conversations again.
  useMessages.getState().clearAll();
  clearMediaCache();
}

/**
 * Ends the session on sign-out: hangs up any call, so the microphone and the
 * peer connections do not outlive the account, and forgets everything the
 * account had loaded so the next person on this tab starts from nothing.
 */
export async function endSession(): Promise<void> {
  try {
    await leaveVoice(true);
  } catch {
    /* nothing to hang up */
  }
  stopSession();
  resetAll();
  useVoice.getState().clear();
  useUI.setState({ activeChannelId: null, replyTo: null, editing: null, editDrafts: {}, jumpTo: null, contextMenu: null, quickSwitcher: false, modals: [], modal: null });
  // a deletion notice stays, to be read on the sign-in page
  useNexa.getState().reset();
  useModeration.getState().reset();
  // files picked or on their way belong to the account that picked them, and
  // so do messages still being sent or left failed: the next person on this
  // tab must neither read them nor, with Retry, send them as their own
  useUploads.getState().clear();
  forgetSends();
  useMessages.setState({ channels: {} });
  forgetUnsentAcks();
  // tabs and split panes name another account's channels
  usePanes.getState().reset();
}

logoutHooks.push(endSession);

export function gateway(): GatewayClient | null {
  return client;
}

/**
 * Keeps this device in step with the account's passcode: asks for it when the
 * account has one and this device does not, and forgets it when it is removed
 * somewhere else.
 */
export function applyLockPolicy(): void {
  const { me, identity } = useAuth.getState();
  const { settings, loaded } = useSettings.getState();
  // Before the account's settings arrive they are all defaults, and acting on
  // those would read "no passcode" and throw this device's copy away.
  if (!me || !loaded) return;
  const policy = settings.appLock;
  const local = hasLock(me.id);
  if (policy && !local) {
    useAuth.getState().requirePasscode();
    return;
  }
  if (!policy && local && identity) {
    clearLock(me.id);
    void keystore.saveIdentity(me.id, identity);
  }
}

/** Asks the server what it accepts, so the composer can refuse early. */
async function loadUploadLimits(): Promise<void> {
  try {
    const info = await adminApi.instance();
    setUploadLimits({ max: info.max_upload_bytes, single: info.upload_single_bytes, chunk: info.upload_chunk_bytes });
  } catch {
    /* the built-in defaults stand */
  }
}
