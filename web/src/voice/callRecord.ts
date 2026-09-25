/**
 * Follows a DM or group call this device started until it is over, then seals
 * how it went onto the call's line (see callSummary.ts): whether anyone picked
 * up, who said no, whether the ringing ran out, and how long people talked.
 * All of it is what the gateway already tells every member of the
 * conversation; only the caller writes it down, once, and only as ciphertext.
 */
import { GUEST_FLAG, type Message } from "@/api/types";
import { voice as voiceApi } from "@/api/voice";
import { convForChannel } from "@/components/composer/send";
import { channelKeyFor, ring } from "@/lib/keyring";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useKeys } from "@/stores/keys";
import { participantsOf, useVoice } from "@/stores/voice";
import { sealCallSummary, type CallOutcome, type CallSummary } from "./callSummary";

interface Outgoing {
  channelId: string;
  /** The call's line, once the server's message for it has arrived. */
  messageId: string | null;
  /** When two people were first in the call, and when it was last down to one after that. */
  answeredAt: number;
  talkEnd: number;
  /** How many accounts were in it at the last look. */
  count: number;
  /** Who picked up, in the order they did; the caller is not counted. */
  joined: string[];
  declined: Set<string>;
  /** The ringing ran out with nobody picking up. */
  timedOut: boolean;
  /** The call is over; its summary goes out as soon as the line is known. */
  over: boolean;
}

const calls = new Map<string, Outgoing>();
/** How long after a reconnect a call nobody is in still counts as over, rather than as a server picking its calls back up. */
const SETTLE_MS = 15_000;
/** A call that got no line of its own (it carried on one from before a restart) is let go after this long. */
const NO_LINE_MS = 30_000;

function me(): string | undefined {
  return useAuth.getState().me?.id;
}

/** The accounts in a call right now; a guest in it picks up nobody's call. */
function accountsIn(channelId: string): string[] {
  return participantsOf(useVoice.getState().byChannel, channelId)
    .filter((p) => !p.guest && ((p.user?.flags ?? 0) & GUEST_FLAG) === 0)
    .map((p) => p.user_id);
}

/** Brings a call's account of itself up to date with who is in it now. */
function observe(c: Outgoing): void {
  if (c.over) return;
  const myId = me();
  const now = Date.now();
  const inCall = accountsIn(c.channelId);
  const count = inCall.length;
  // picking up means being in the call with someone else, not waiting alone in one
  if (count >= 2) for (const id of inCall) if (id !== myId && !c.joined.includes(id)) c.joined.push(id);
  if (count >= 2 && !c.answeredAt) c.answeredAt = now;
  if (count < 2 && c.count >= 2) c.talkEnd = now;
  c.count = count;
}

/** This device has just called a conversation nobody else is in. */
export function callStarted(channelId: string): void {
  calls.set(channelId, { channelId, messageId: null, answeredAt: 0, talkEnd: 0, count: accountsIn(channelId).length, joined: [], declined: new Set(), timedOut: false, over: false });
}

/** A message arrived: the server's line for a call this device started is where its summary goes. */
export function callLine(m: Message): void {
  if (m.type !== "system_call" || m.author_id !== me()) return;
  const c = calls.get(m.channel_id);
  if (!c || c.messageId) return;
  c.messageId = m.id;
  if (c.over) void write(c);
}

export function callDeclined(channelId: string, userId: string): void {
  calls.get(channelId)?.declined.add(userId);
}

function everyoneSaidNo(c: Outgoing): boolean {
  const others = (useChannels.getState().byId[c.channelId]?.recipient_ids ?? []).filter((id) => id !== me());
  return others.length > 0 && others.every((id) => c.declined.has(id));
}

/** Whether everyone called in a conversation has said no. */
export function allDeclined(channelId: string): boolean {
  const c = calls.get(channelId);
  return !!c && everyoneSaidNo(c);
}

export function callTimedOut(channelId: string): void {
  const c = calls.get(channelId);
  if (c && !c.answeredAt) c.timedOut = true;
}

/** The server says the call is over: nobody is left in it. */
export function callEnded(channelId: string): void {
  const c = calls.get(channelId);
  if (!c || c.over) return;
  observe(c);
  c.over = true;
  if (c.messageId) {
    void write(c);
    return;
  }
  setTimeout(() => {
    if (calls.get(channelId) === c && !c.messageId) calls.delete(channelId);
  }, NO_LINE_MS);
}

/**
 * The gateway came back. A call that ended while it was away never said so;
 * one with nobody in it now is over, unless this device is still in it (the
 * server restarted and everyone is picking it back up) — and a server that
 * restarted is given a moment for the others to come back too.
 */
export function callsAfterReady(inCall: (channelId: string) => boolean): void {
  for (const c of calls.values()) {
    if (c.over || inCall(c.channelId) || accountsIn(c.channelId).length > 0) continue;
    setTimeout(() => {
      if (calls.get(c.channelId) === c && !inCall(c.channelId) && accountsIn(c.channelId).length === 0) callEnded(c.channelId);
    }, SETTLE_MS);
  }
}

function summaryOf(c: Outgoing): CallSummary {
  let outcome: CallOutcome;
  if (c.answeredAt) outcome = "answered";
  else if (everyoneSaidNo(c)) outcome = "declined";
  else outcome = c.timedOut ? "unanswered" : "cancelled";
  const duration = outcome === "answered" ? Math.max(0, Math.round(((c.talkEnd || Date.now()) - c.answeredAt) / 1000)) : 0;
  return { outcome, duration, joined: outcome === "answered" ? c.joined : [], declined: [...c.declined] };
}

/** Seals the summary onto the line. Another device of this account may have written it already; either way it is done. */
async function write(c: Outgoing): Promise<void> {
  const summary = summaryOf(c);
  if (calls.get(c.channelId) === c) calls.delete(c.channelId);
  const myId = me();
  const messageId = c.messageId;
  if (!myId || !messageId) return;
  const conv = convForChannel(c.channelId);
  try {
    const latest = ring.latest(conv) ?? (await useKeys.getState().ensureConvKey(conv));
    const key = latest ? channelKeyFor(conv, latest.epoch, c.channelId) : undefined;
    if (!latest || !key) return;
    const env = await sealCallSummary(key, { conv, epoch: latest.epoch, channelId: c.channelId, authorId: myId, messageId }, summary);
    await voiceApi.callSummary(c.channelId, messageId, { ciphertext: env, key_conv_id: conv, key_epoch: latest.epoch });
  } catch (err) {
    console.warn("voice: the call's summary was not written", err);
  }
}

/** Keeps every call being followed up to date as people come and go. */
export function installCallRecord(): void {
  useVoice.subscribe((st, prev) => {
    if (st.byChannel === prev.byChannel || calls.size === 0) return;
    for (const c of calls.values()) observe(c);
  });
}

/** For tests: forget every call being followed. */
export function resetCallRecords(): void {
  calls.clear();
}
