import type { Channel, Member, Presence, PublicUser, Relationship } from "@/api/types";
import { onLocaleChange } from "@/i18n";
import { useRelationships } from "@/stores/relationships";
import { useServers, type ServerState } from "@/stores/servers";
import { useTyping } from "@/stores/typing";
import { useUsers } from "@/stores/users";

/**
 * What happens in the app, for what follows it without being part of it (the
 * plugin API's events, step 3 of docs/superpowers/plans/2026-10-07-plugin-api-v2.md).
 * Each is fired once the stores have the change, so reading them gives what
 * is there now; whatever goes is handed over as this device had it.
 *
 * Most come from the gateway's events (dispatch.ts). Three come from watching
 * a store instead, because the change also happens without an event of its
 * own, or arrives twice: a server joined or left (the REST answer and the
 * gateway's event both bring it), a relationship (a request sent from here is
 * in the store before its event), and typing (it also stops when its time
 * runs out, or when the person's message arrives).
 */

/** How this account stands with someone; "none" when there is no relationship. */
export type RelationshipKind = Relationship["type"] | "none";

export type AppEvent =
  | { type: "reaction"; channelId: string; messageId: string; userId: string; emoji: string; added: boolean }
  | { type: "typing"; channelId: string; userId: string; started: boolean }
  | { type: "memberJoined"; serverId: string; member: Member }
  | { type: "memberUpdated"; serverId: string; member: Member }
  | { type: "memberLeft"; serverId: string; userId: string; member: Member | null }
  | { type: "serverJoined"; server: ServerState }
  | { type: "serverLeft"; id: string; server: ServerState }
  | { type: "channelCreated"; channel: Channel }
  | { type: "channelUpdated"; channel: Channel }
  | { type: "channelDeleted"; id: string; serverId: string | null; channel: Channel | null }
  | { type: "userUpdated"; user: PublicUser }
  | { type: "presenceUpdated"; presence: Presence }
  | { type: "relationshipChanged"; userId: string; user: PublicUser | null; relationship: RelationshipKind; old: RelationshipKind }
  | { type: "localeChanged"; locale: string };

/** Who is told; `dispatchHooks.onEvent` is this same list. */
export const appEventHooks: ((e: AppEvent) => void)[] = [];

/** Calls each of `list`, so one that throws never stops the others, nor whatever is firing them. */
export function each<F extends (...args: never[]) => unknown>(list: readonly F[], call: (h: F) => unknown): void {
  for (const h of [...list]) {
    try {
      call(h);
    } catch (err) {
      console.warn("a dispatch hook failed", err);
    }
  }
}

export function emitAppEvent(e: AppEvent): void {
  if (appEventHooks.length) each(appEventHooks, (h) => h(e));
}

let quiet = 0;

/**
 * Runs `fn` without the store watchers telling anyone: for the stores being
 * filled from `ready` or emptied at sign-out, where nothing has been joined,
 * left or changed.
 */
export function quietly<T>(fn: () => T): T {
  quiet++;
  try {
    return fn();
  } finally {
    quiet--;
  }
}

type Servers = Record<string, ServerState>;
type Relationships = Record<string, Relationship>;
type Typing = Record<string, Record<string, number>>;

function diffServers(was: Servers, now: Servers): void {
  for (const [id, st] of Object.entries(was)) if (!now[id]) emitAppEvent({ type: "serverLeft", id, server: st });
  for (const [id, st] of Object.entries(now)) if (!was[id]) emitAppEvent({ type: "serverJoined", server: st });
}

function diffRelationships(was: Relationships, now: Relationships): void {
  for (const userId of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const after = now[userId];
    const before = was[userId];
    const relationship: RelationshipKind = after?.type ?? "none";
    const old: RelationshipKind = before?.type ?? "none";
    if (relationship === old) continue;
    emitAppEvent({ type: "relationshipChanged", userId, user: after?.user ?? before?.user ?? useUsers.getState().byId[userId] ?? null, relationship, old });
  }
}

// someone typing again before their time runs out is still the same typing: only coming and going counts
function diffTyping(was: Typing, now: Typing): void {
  for (const channelId of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const after = now[channelId] ?? {};
    const before = was[channelId] ?? {};
    if (after === before) continue;
    for (const userId of Object.keys(before)) if (!(userId in after)) emitAppEvent({ type: "typing", channelId, userId, started: false });
    for (const userId of Object.keys(after)) if (!(userId in before)) emitAppEvent({ type: "typing", channelId, userId, started: true });
  }
}

useServers.subscribe((s, was) => {
  if (s.byId !== was.byId && !quiet) diffServers(was.byId, s.byId);
});
useRelationships.subscribe((s, was) => {
  if (s.byUser !== was.byUser && !quiet) diffRelationships(was.byUser, s.byUser);
});
useTyping.subscribe((s, was) => {
  if (s.byChannel !== was.byChannel && !quiet) diffTyping(was.byChannel, s.byChannel);
});

/** What the watched stores held, to tell afterwards what changed while they were filled quietly. */
export interface Watched {
  servers: Servers;
  relationships: Relationships;
  typing: Typing;
}

export function watched(): Watched {
  return { servers: useServers.getState().byId, relationships: useRelationships.getState().byUser, typing: useTyping.getState().byChannel };
}

/**
 * After a reconnect's ready, what changed while the connection was down: a
 * server left or joined, a relationship that moved on, and everyone who was
 * typing has stopped (ready starts typing afresh).
 */
export function reportMissed(before: Watched): void {
  const now = watched();
  diffServers(before.servers, now.servers);
  diffRelationships(before.relationships, now.relationships);
  diffTyping(before.typing, now.typing);
}

// --- the language --------------------------------------------------------------

onLocaleChange((locale) => emitAppEvent({ type: "localeChanged", locale }));
