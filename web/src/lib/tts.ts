import type { Message } from "@/api/types";
import { dispatchHooks } from "@/gateway/dispatch";
import { parse, plainText } from "@/markdown";
import type { DecryptedMessage } from "@/stores/messages";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import { doNotDisturb } from "./dnd";
import { appOnScreen } from "./notify";

import { t, translator } from "@/i18n";

/** The longest stretch of a message that is read out. */
const MAX_SPOKEN = 300;

/**
 * Text-to-speech messages. A webhook can ask for its message to be read aloud
 * (its `tts`); the app reads it, "name said text", to whoever has that
 * conversation open in front of them and has not turned it off in Settings,
 * Notifications. Only new messages are read, never history.
 */
function onMessage(m: Message, mine: boolean, decrypted?: DecryptedMessage): void {
  const hook = decrypted?.hook;
  if (mine || !hook?.tts || !hook.content) return;
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
  if (!useSettings.getState().settings.tts || doNotDisturb()) return;
  if (useUI.getState().activeChannelId !== m.channel_id || !appOnScreen()) return;
  const text = plainText(parse(hook.content)).slice(0, MAX_SPOKEN).trim();
  if (!text) return;
  // an app's message is said with its bot's name, as the conversation shows it
  const name = m.webhook_id ? hook.name : displayName(useUsers.getState().byId[m.author_id], hook.name);
  const u = new SpeechSynthesisUtterance(t("webhook.ttsSaid", { name, text }));
  u.lang = translator().locale;
  window.speechSynthesis.speak(u);
}

let installed = false;

/** Starts reading text-to-speech messages as they arrive. */
export function installTTS(): void {
  if (installed) return;
  installed = true;
  dispatchHooks.onMessage.push(onMessage);
}

/** Stops whatever is being read out, as a click on the stop control or leaving the conversation asks. */
export function stopTTS(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
