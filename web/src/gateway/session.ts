import { GatewayClient } from "./client";
import { applyEvent, resetAll } from "./dispatch";
import { logoutHooks, useAuth } from "@/stores/auth";
import { useKeys } from "@/stores/keys";
import { useMessages } from "@/stores/messages";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useVoice } from "@/stores/voice";
import { admin as adminApi } from "@/api/admin";
import { setUploadLimits } from "@/lib/attachments";
import { clearLock, hasLock } from "@/lib/appLock";
import { clearMediaCache } from "@/lib/mediaCache";
import { keystore } from "@/crypto/keystore";
import { leaveVoice } from "@/voice/session";

let client: GatewayClient | null = null;
let queue: Promise<void> = Promise.resolve();

export function gatewayUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/gateway`;
}

/** Connects the gateway for the logged-in user; safe to call repeatedly. */
export async function startSession(): Promise<void> {
  const { me, identity, settingsKey } = useAuth.getState();
  if (!me || !identity) return;
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
  if (client) return;
  client = new GatewayClient({
    url: gatewayUrl,
    token: () => useAuth.getState().token,
    onEvent: (e) => {
      // events are applied strictly in order; a slow decrypt never reorders later frames
      queue = queue.then(() => applyEvent(e)).catch(() => undefined);
    },
    onStatus: (s) => useUI.getState().setConnection(s),
  });
  client.connect();
}

export function stopSession(): void {
  client?.close();
  client = null;
  useKeys.getState().reset();
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
  useUI.setState({ activeChannelId: null, replyTo: null, editing: null, jumpTo: null, contextMenu: null, quickSwitcher: false, modals: [], modal: null });
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
