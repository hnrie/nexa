import { GatewayClient } from "./client";
import { applyEvent } from "./dispatch";
import { useAuth } from "@/stores/auth";
import { useKeys } from "@/stores/keys";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";

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
