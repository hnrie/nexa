import { ApiError } from "@/api/client";
import { apps as appsApi, type AppForm, type CommandChoice, type InteractionAnswer, type InteractRequest } from "@/api/apps";
import { MSG_FLAG_EPHEMERAL, type Message } from "@/api/types";
import { b64 } from "@/crypto/bytes";
import { seal } from "@/crypto/keys";
import { t } from "@/i18n";
import { decryptForStore, type DecryptedMessage } from "@/lib/decrypt";
import { describeError } from "@/lib/errors";
import { idAt } from "@/lib/ids";
import { protocolLocale } from "@/lib/apps";
import { BOT_READS_ALL_FLAG } from "@/api/types";
import { channelCommands } from "@/stores/appCommands";
import { useMessages } from "@/stores/messages";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";

/**
 * Using what an app made: a command, a button or a select menu on its
 * message, a form it opened. The person's app sends it to the server, which
 * hands it to the app and waits up to three seconds for its first answer
 * (internal/api/bot_interactions.go). What the answer made is put in place at
 * once rather than left for the gateway (which brings it too): a message, a
 * changed message, a form to fill in or suggestions for an option.
 *
 * When the app does not answer, or answers with something that cannot be
 * shown, a line only this person sees says so in the conversation, under the
 * app's name, as a message only they see would: where they were looking.
 */

/** What an interaction came to, for the caller: suggestions for an option, or nothing more to do. */
export type Outcome = { ok: true; answer: InteractionAnswer } | { ok: false; error: string };

/** Answer types. */
export const ANSWER_MESSAGE = 4;
export const ANSWER_THINKING = 5;
export const ANSWER_LATER = 6;
export const ANSWER_UPDATE = 7;
export const ANSWER_CHOICES = 8;
export const ANSWER_FORM = 9;

/** The sentence for an interaction that failed, naming the app. */
export function interactionError(err: unknown, appName: string): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "app_unavailable":
        return t("apps.use.notConnected", { app: appName });
      case "app_no_response":
        return t("apps.use.noResponse", { app: appName });
      case "app_bad_response":
        return t("apps.use.badResponse", { app: appName });
      case "unknown_interaction":
        return t("apps.use.expired");
    }
  }
  return describeError(err, t("apps.use.failed", { app: appName }));
}

/** The app's name as its bot goes by. */
export function appName(appId: string): string {
  return displayName(useUsers.getState().byId[appId], t("apps.anApp"));
}

/** Puts what an answer made in its place in the conversation. */
async function place(message: Message | undefined, changed: boolean): Promise<void> {
  if (!message) return;
  const msg = await decryptForStore(message);
  const store = useMessages.getState();
  if (changed) store.update(message.channel_id, msg);
  else store.insert(message.channel_id, [msg]);
}

/**
 * Sends an interaction and puts its answer in place. A form the app opens is
 * opened here; suggestions are handed back. A failure is said in the
 * conversation (`quiet` leaves it to the caller, for suggestions typed into a
 * command, where it would only get in the way).
 */
export async function interact(req: Omit<InteractRequest, "locale">, opts: { quiet?: boolean } = {}): Promise<Outcome> {
  const name = appName(req.application_id);
  try {
    const answer = await appsApi.interact({ ...req, locale: protocolLocale() });
    switch (answer.type) {
      case ANSWER_MESSAGE:
      case ANSWER_THINKING:
        await place(answer.message, false);
        break;
      case ANSWER_UPDATE:
        await place(answer.message, true);
        break;
      case ANSWER_FORM:
        if (answer.modal) openForm(answer.modal, { interactionId: answer.id, appId: req.application_id, channelId: req.channel_id });
        break;
      case ANSWER_CHOICES:
      case ANSWER_LATER:
        break;
      default:
        // something this server never shows (an activity, a purchase)
        if (!opts.quiet) localNotice(req.channel_id, req.application_id, t("apps.use.unsupported", { app: name }));
    }
    return { ok: true, answer };
  } catch (err) {
    const error = interactionError(err, name);
    if (!opts.quiet) localNotice(req.channel_id, req.application_id, error);
    return { ok: false, error };
  }
}

/** Opens an app's form. */
export function openForm(form: AppForm, at: { interactionId: string; appId: string; channelId: string }): void {
  useUI.getState().openModal("appForm", { form, ...at });
}

/** Suggestions an app gave for an option being typed, or none. */
export function choicesOf(o: Outcome): CommandChoice[] {
  return o.ok && o.answer.type === ANSWER_CHOICES ? (o.answer.choices ?? []) : [];
}

let localSeq = 0;

/**
 * A line in the conversation only this device knows: from the app, seen only
 * by this person, gone when dismissed or when the conversation is loaded again.
 */
export function localNotice(channelId: string, appId: string, text: string): void {
  localSeq = (localSeq + 1) % 4096;
  const id = (BigInt(idAt(Date.now())) + BigInt(localSeq)).toString();
  const bot = useUsers.getState().byId[appId];
  const msg: DecryptedMessage = {
    id,
    channel_id: channelId,
    author_id: appId,
    type: "default",
    ciphertext: null,
    key_conv_id: null,
    key_epoch: null,
    reply_to_id: null,
    mentions: [],
    mention_roles: [],
    mention_everyone: false,
    attachments: [],
    reactions: [],
    flags: MSG_FLAG_EPHEMERAL,
    edited_at: null,
    created_at: Date.now(),
    local: true,
    hook: { name: displayName(bot, t("apps.anApp")), content: text, tts: false, embeds: [], components: [], attachments: [], link_embeds: [], stickers: [], application_id: appId },
    payload: { t: text },
  };
  useMessages.getState().insert(channelId, [msg]);
}

/** Puts away a message only this person sees: on the server too, unless only this device knew it. */
export function dismiss(msg: DecryptedMessage): void {
  useMessages.getState().remove(msg.channel_id, msg.id);
  if (!msg.local) void appsApi.dismiss(msg.id).catch(() => undefined);
}

/**
 * A message as an app may be shown it for a command used on it: nothing when
 * the app reads it already (it came readable, or the app reads every message
 * it can see); otherwise its content sealed to the app's bot, base64.
 */
export async function copyFor(appId: string, msg: DecryptedMessage): Promise<string | undefined> {
  if (msg.hook || !msg.payload) return undefined;
  // the channel's command list carries each app's bot with its key; the people
  // kept here may not have the bot at all (an app on someone's own account)
  const listed = channelCommands(msg.channel_id)?.applications.find((a) => a.id === appId)?.bot;
  const bot = listed?.public_key ? listed : useUsers.getState().byId[appId];
  if (!bot?.public_key || (bot.flags & BOT_READS_ALL_FLAG) !== 0) return undefined;
  try {
    return b64.enc(await seal(b64.dec(bot.public_key), new TextEncoder().encode(JSON.stringify(msg.payload))));
  } catch {
    return undefined;
  }
}
