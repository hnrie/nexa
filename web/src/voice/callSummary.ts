/**
 * How a DM or group call went, as its caller's device saw it: whether anyone
 * picked up, how long people talked, who joined and who said no. The caller
 * seals it with the conversation's key onto the line that says the call
 * started, so the conversation can show "Missed call from Alice" or "Call
 * with Bob · 12 minutes" while the server, which keeps no call records, holds
 * only ciphertext. A line without one (older calls, or a caller who went away
 * before writing it) reads as it always did.
 */
import { IV_LEN, gcmDecrypt, gcmEncrypt } from "@/crypto/aes";
import { b64, randomBytes, utf8 } from "@/crypto/bytes";
import { isEnvelope, type Envelope } from "@/crypto/message";
import { translator } from "@/i18n";
import type { DecryptedMessage } from "@/lib/decrypt";
import { channelKeyFor } from "@/lib/keyring";
import { formatShortDuration } from "@/lib/time";

/**
 * answered: someone picked up. declined: everyone called said no. unanswered:
 * the ringing ran out. cancelled: the caller hung up before any of that.
 */
export type CallOutcome = "answered" | "declined" | "unanswered" | "cancelled";

export interface CallSummary {
  outcome: CallOutcome;
  /** How long people talked, in seconds; 0 when nobody picked up. */
  duration: number;
  /** Who picked up, the caller left out. */
  joined: string[];
  /** Who said no. */
  declined: string[];
}

export interface CallSummaryAad {
  conv: string;
  epoch: number;
  channelId: string;
  authorId: string;
  messageId: string;
}

const OUTCOMES: ReadonlySet<string> = new Set<CallOutcome>(["answered", "declined", "unanswered", "cancelled"]);
/** More people than a group holds is not a summary anyone wrote. */
const MAX_PEOPLE = 100;
/** A week: a longer figure is not a call. */
const MAX_SECONDS = 7 * 24 * 3600;

/**
 * What the summary is bound to: which line, in which conversation, by whom.
 * The "call|" prefix keeps a summary from ever opening as a message and the
 * other way round, and the line's id keeps one call's summary off another's.
 */
function aadBytes(a: CallSummaryAad): Uint8Array {
  return utf8.enc(`call|${a.conv}|${a.epoch}|${a.channelId}|${a.authorId}|${a.messageId}`);
}

export async function sealCallSummary(key: Uint8Array, aad: CallSummaryAad, summary: CallSummary): Promise<Envelope> {
  const iv = randomBytes(IV_LEN);
  const ct = await gcmEncrypt(key, iv, utf8.enc(JSON.stringify(summary)), aadBytes(aad));
  return { v: 1, conv: aad.conv, epoch: aad.epoch, iv: b64.enc(iv), ct: b64.enc(ct) };
}

const ids = (x: unknown): string[] | null => (Array.isArray(x) && x.length <= MAX_PEOPLE && x.every((v) => typeof v === "string" && /^\d{1,20}$/.test(v)) ? (x as string[]) : null);

/** Opens a summary; throws when it does not open or is not one. */
export async function openCallSummary(key: Uint8Array, env: Envelope, aad: CallSummaryAad): Promise<CallSummary> {
  const plain = await gcmDecrypt(key, b64.dec(env.iv), b64.dec(env.ct), aadBytes(aad));
  const x = JSON.parse(utf8.dec(plain)) as Record<string, unknown> | null;
  const joined = ids(x?.joined);
  const declined = ids(x?.declined);
  const duration = x?.duration;
  if (!x || typeof x.outcome !== "string" || !OUTCOMES.has(x.outcome) || !joined || !declined || typeof duration !== "number" || !Number.isFinite(duration)) throw new Error("not a call summary");
  return { outcome: x.outcome as CallOutcome, duration: Math.max(0, Math.min(MAX_SECONDS, Math.round(duration))), joined, declined };
}

/**
 * Fills in a call line's summary for the message store. A line whose summary
 * cannot be opened says only that a call was started, as before; one whose
 * key is not here yet is opened again when it arrives.
 */
export async function decryptCallLine(out: DecryptedMessage): Promise<DecryptedMessage> {
  const env = out.ciphertext;
  if (!isEnvelope(env) || out.key_conv_id === null || out.key_epoch === null) return out;
  const key = channelKeyFor(out.key_conv_id, out.key_epoch, out.channel_id);
  if (!key) {
    out.decryptError = "no_key";
    return out;
  }
  try {
    out.call = await openCallSummary(key, env, { conv: out.key_conv_id, epoch: out.key_epoch, channelId: out.channel_id, authorId: out.author_id, messageId: out.id });
  } catch {
    /* read as a call that was started */
  }
  return out;
}

function unit(value: number, u: "second" | "minute" | "hour", locale: string): string {
  return new Intl.NumberFormat(locale, { style: "unit", unit: u, unitDisplay: "long" }).format(value);
}

/** "45 seconds", "12 minutes", "1 hour, 5 minutes", in the app's language. */
export function formatCallLength(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  const locale = translator().locale;
  try {
    if (s < 60) return unit(s, "second", locale);
    const m = Math.round(s / 60);
    if (m < 60) return unit(m, "minute", locale);
    const h = Math.floor(m / 60);
    const rest = m % 60;
    if (rest === 0) return unit(h, "hour", locale);
    const parts = [unit(h, "hour", locale), unit(rest, "minute", locale)];
    return typeof Intl.ListFormat === "function" ? new Intl.ListFormat(locale, { type: "unit", style: "long" }).format(parts) : parts.join(" ");
  } catch {
    return formatShortDuration(s);
  }
}
