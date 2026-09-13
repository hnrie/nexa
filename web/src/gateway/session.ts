import { GatewayClient } from "./client";
import { applyEvent } from "./dispatch";
import { useAuth } from "@/stores/auth";
import { useKeys } from "@/stores/keys";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { admin as adminApi } from "@/api/admin";
import { setUploadLimits } from "@/lib/attachments";
import { clearLock, hasLock } from "@/lib/appLock";
import { keystore } from "@/crypto/keystore";

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
  await useKeys.getState().init(me.id, identity);
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
}

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
