import type { GatewayEvent, MentionMeta } from "./events";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useKeys } from "@/stores/keys";
import { useMessages } from "@/stores/messages";
import { usePresence } from "@/stores/presence";
import { useReadStates } from "@/stores/readStates";
import { useRelationships } from "@/stores/relationships";
import { useServers } from "@/stores/servers";
import { useExpressions } from "@/stores/expressions";
import { useSettings } from "@/stores/settings";
import { useTyping } from "@/stores/typing";
import { useUI } from "@/stores/ui";
import { applyLockPolicy } from "./session";
import { fetchMissingUsers, useUsers } from "@/stores/users";
import { decryptForStore, type DecryptedMessage } from "@/lib/decrypt";
import { appOnScreen } from "@/lib/notify";
import { readingPresent } from "@/lib/readPosition";
import { channels as channelsApi } from "@/api/channels";
import { ApiError } from "@/api/client";
import { expressions as expressionsApi } from "@/api/expressions";
import { ring } from "@/lib/keyring";
import type { Message, PublicUser, Relationship, ServerView } from "@/api/types";
import { nexa as nexaApi, type Announcement, type MemberCase, type NexaState } from "@/api/moderation";
import { useNexa } from "@/stores/nexa";
import { emitModEvent, useModeration } from "@/stores/moderation";
import { channelsOnScreen, usePanes } from "@/stores/panes";
import { mentionsMe } from "@/lib/mentionsMe";
import { loadChunk } from "@/lib/lazyChunk";

type VoiceModule = typeof import("@/voice/session");
let voiceModule: Promise<VoiceModule> | null = null;

/**
 * The call engine, fetched the first time an event needs it rather than with
 * the gateway: it is most of a hundred kilobytes, and the gateway comes with
 * pages (an invite, for one) that never show a call.
 */
function voice(): Promise<VoiceModule> {
  voiceModule ??= loadChunk(() => import("@/voice/session")).catch((err: unknown) => {
    voiceModule = null;
    throw err;
  });
  return voiceModule;
}

/** Something from Nexa worth a sound or a notification. */
export type NexaAlert = { kind: "notice" | "reply"; case: MemberCase } | { kind: "announcement"; announcement: Announcement } | { kind: "appeal"; caseId: string; userId: string };

/** Hooks other layers register: notifications, voice, servers (later phases). */
export const dispatchHooks: {
  onMessage: ((m: Message, mine: boolean, decrypted: DecryptedMessage) => void)[];
  onUnhandled: ((e: GatewayEvent) => void)[];
  onReady: (() => void)[];
  /** Someone new asked to be friends (not a request already known before). */
  onFriendRequest: ((r: Relationship) => void)[];
  /** Nexa has something new: a notice, a staff reply, an announcement, or for staff a member's appeal. */
  onNexa: ((a: NexaAlert) => void)[];
} = { onMessage: [], onUnhandled: [], onReady: [], onFriendRequest: [], onNexa: [] };

/** The account's standing, and for staff what is waiting on them. */
function applyNexaState(st: NexaState | undefined): void {
  if (!st) return;
  useNexa.getState().setState(st);
  if (st.staff) {
    useModeration.getState().setCounts(st.staff.counts);
    useModeration.getState().setOwner(st.staff.owner_id);
  }
}

/**
 * Which session the stores belong to.
 *
 * An event already past its first await — a decrypt, a grant ingest, a
 * settings load — resumes after sign-out and writes the account that has just
 * gone into the stores the next one will use. Bumping this makes that work
 * stop where it stands, the way the messages store's own generations do.
 */
let sessionGen = 0;

/** Called when a session ends, so nothing still in flight writes into the next one. */
export function endDispatchSession(): void {
  sessionGen += 1;
}

/** The session events are being applied for, so one queued before it ended can be dropped. */
export function dispatchGeneration(): number {
  return sessionGen;
}

// Channels are not cleared here: ready replaces them in one step, because a
// call whose channel vanished from the store even for a moment is ended.
export function resetAll(keepMessagesIn: string[] = []): void {
  useMessages.getState().clearAll(keepMessagesIn);
  // Ready does not bring back everyone the kept conversations show (people in
  // a large server, people who left), and their messages are never looked up
  // again, so their authors would turn into "Unknown User".
  useUsers.setState({ byId: usersShownIn(keepMessagesIn) });
  usePresence.getState().clear();
  useReadStates.getState().clear();
  useRelationships.getState().clear();
  useTyping.getState().clear();
  useServers.getState().clear();
  useExpressions.getState().clear();
}

function usersShownIn(channelIds: string[]): Record<string, PublicUser> {
  const known = useUsers.getState().byId;
  const kept: Record<string, PublicUser> = {};
  const keep = (id: string): void => {
    const u = known[id];
    if (u) kept[id] = u;
  };
  for (const channelId of channelIds) {
    const ch = useMessages.getState().channels[channelId];
    for (const m of Object.values(ch?.byId ?? {})) {
      keep(m.author_id);
      for (const id of m.mentions) keep(id);
    }
  }
  return kept;
}

function ingestServerView(view: ServerView): void {
  useChannels.getState().upsert(view.channels);
  useServers.getState().setFromView(view);
}

const channelFetches = new Set<string>();
/** Key rotations under way, by conversation. */
const rotations = new Map<string, Promise<void>>();

/** Sign-out: the rotations queued for the account that has gone are not the next one's to wait behind. */
export function forgetRotations(): void {
  rotations.clear();
}

/** A message can arrive for a conversation this client closed or never saw. */
async function ensureChannel(id: string): Promise<void> {
  if (useChannels.getState().byId[id] || channelFetches.has(id)) return;
  channelFetches.add(id);
  const gen = sessionGen;
  try {
    const ch = await channelsApi.get(id);
    if (gen === sessionGen) useChannels.getState().upsert(ch);
  } catch (err) {
    // Gone, or not this account's to see: a message that raced the channel's
    // deletion would otherwise leave a list behind for a channel nothing shows.
    if (gen === sessionGen && err instanceof ApiError && (err.status === 403 || err.status === 404)) useMessages.getState().clearChannel(id);
  } finally {
    channelFetches.delete(id);
  }
}

/** Fetches someone this device has not loaded; unknown users render as placeholders meanwhile. */
function ensureUser(id: string): void {
  fetchMissingUsers([id]);
}

/**
 * Whether a message was one this account's mention count was bumped for: by
 * the copy loaded here, or else by what its event says it mentioned — the
 * badge counted messages this device never loaded too.
 */
function mentionedMe(channelId: string, messageId: string, meId: string | undefined, told?: Partial<MentionMeta>): boolean {
  if (!meId) return false;
  const loaded = useMessages.getState().channels[channelId]?.byId[messageId];
  if (loaded) return loaded.author_id !== meId && mentionsMe(loaded, meId);
  if (!told?.mentions || !told.author_id) return false;
  return told.author_id !== meId && mentionsMe({ channel_id: channelId, mentions: told.mentions, mention_roles: told.mention_roles ?? [], mention_everyone: !!told.mention_everyone }, meId);
}

export async function applyEvent(e: GatewayEvent): Promise<void> {
  const meId = useAuth.getState().me?.id;
  const gen = sessionGen;
  const gone = (): boolean => gen !== sessionGen;
  switch (e.t) {
    case "ready": {
      const d = e.d;
      // A reconnect re-sends ready. Everything else is rebuilt from the
      // payload, but the conversations on screen — the open one and those in
      // the split panes beside it — keep their messages, so each reader stays
      // where they were instead of being thrown to the newest message.
      const active = useUI.getState().activeChannelId;
      const shown = [...new Set([...(active ? [active] : []), ...channelsOnScreen()])];
      resetAll(shown);
      // Merged, not replaced: a field the gateway leaves out must not read as
      // "none" here, or the next profile save sends that back and wipes it.
      const was = useAuth.getState().me;
      useAuth.getState().setMe(was && was.id === d.user.id ? { ...was, ...d.user } : d.user);
      useUsers.getState().upsert([...d.users, d.user]);
      // a reconnect may have missed what Nexa said meanwhile: open views load it again
      useNexa.setState({ feed: null, threads: {} });
      applyNexaState(d.nexa);
      const servers = d.servers ?? [];
      const channels = [...d.channels, ...servers.flatMap((v) => v.channels)];
      useChannels.setState({ byId: Object.fromEntries(channels.map((c) => [c.id, c])) });
      useRelationships.getState().setMany(d.relationships);
      useReadStates.getState().setMany(d.read_states);
      usePresence.getState().setMany(d.presences);
      for (const view of servers) useServers.getState().setFromView(view);
      useExpressions.getState().setAllEmojis(d.emojis ?? []);
      useExpressions.getState().setPacks(d.sticker_packs ?? []);
      // Recents ride REST rather than ready: one small request after the
      // reconnect storm, and every device lands on the same saved row.
      void expressionsApi
        .recentStickers()
        .then((list) => {
          if (!gone()) useExpressions.getState().setRecents(list);
        })
        .catch(() => undefined);
      // Not waited for: the engine's first load must not hold up the settings,
      // the keys and the conversations below. Call events after this one wait
      // on the same load, so they still come after it.
      void voice()
        .then((v) => {
          if (!gone()) v.onReadyVoice(d.voice_states ?? [], d.session_id);
        })
        .catch((err: unknown) => console.warn("voice: could not load the call engine", err));
      const settings = useSettings.getState();
      await settings.load(d.settings?.blob ?? null, d.settings?.version ?? 0);
      if (gone()) return;
      // The account's passcode policy only arrives with the settings, so this
      // is the first moment a fresh device can know it needs to ask for one.
      applyLockPolicy();
      await useKeys.getState().ingestGrants(d.key_grants);
      if (gone()) return;
      for (const h of dispatchHooks.onReady) h();
      void useKeys.getState().reconcile();
      for (const id of shown) void useMessages.getState().syncGap(id);
      return;
    }
    case "message_create": {
      const m = e.d;
      const decrypted = await decryptForStore(m);
      if (gone()) return;
      const messages = useMessages.getState();
      if (m.nonce && meId === m.author_id) messages.settle(m.channel_id, [decrypted], { nonce: m.nonce });
      else messages.insert(m.channel_id, [decrypted]);
      useChannels.getState().setLastMessage(m.channel_id, m.id);
      useTyping.getState().remove(m.channel_id, m.author_id);
      if (decrypted.decryptError === "no_key" && m.key_conv_id) useKeys.getState().markWaiting(m.key_conv_id);
      ensureUser(m.author_id);
      void ensureChannel(m.channel_id);
      const mine = meId === m.author_id;
      const ui = useUI.getState();
      // Seen means seen: the channel open, the app in front of the person, and
      // the list showing the present at the bottom of it. Without the last two
      // this marked read a message five hundred messages below where the
      // reader was — and `ui.focused` has two writers, one of which the
      // desktop app is documented to lie to.
      const visible = ui.activeChannelId === m.channel_id && appOnScreen() && readingPresent(m.channel_id);
      if (mine || visible) {
        void useReadStates.getState().ack(m.channel_id, m.id);
      } else {
        if (meId && mentionsMe(m, meId)) useReadStates.getState().bumpMentions(m.channel_id);
        // conversations count every message, so their badges say how many are waiting
        const type = useChannels.getState().byId[m.channel_id]?.type;
        if (!type || type === "dm" || type === "group_dm") useReadStates.getState().bumpUnread(m.channel_id);
      }
      for (const h of dispatchHooks.onMessage) h(m, mine, decrypted);
      return;
    }
    case "message_update": {
      const decrypted = await decryptForStore(e.d);
      if (gone()) return;
      // An edit can add a mention the badge should count or take one back
      // that it did; the event says what the message mentioned before.
      if (meId && e.d.was && e.d.author_id !== meId) {
        const before = mentionsMe({ ...e.d.was, channel_id: e.d.channel_id }, meId);
        const after = mentionsMe(e.d, meId);
        if (before && !after) useReadStates.getState().dropMention(e.d.channel_id, e.d.id);
        else if (!before && after) useReadStates.getState().addMention(e.d.channel_id, e.d.id);
      }
      useMessages.getState().update(e.d.channel_id, decrypted);
      return;
    }
    case "message_delete": {
      // Read before it goes: only the message itself says whether it was
      // counted as a mention, and a mention taken back as unread but not as a
      // mention leaves a red pill on a channel with nothing left to read.
      const counted = mentionedMe(e.d.channel_id, e.d.id, meId, e.d);
      useMessages.getState().remove(e.d.channel_id, e.d.id);
      useReadStates.getState().dropUnread(e.d.channel_id, e.d.id);
      if (counted) useReadStates.getState().dropMention(e.d.channel_id, e.d.id);
      return;
    }
    case "message_delete_bulk": {
      const told = new Map((e.d.mentions ?? []).map((m) => [m.id, m]));
      const counted = e.d.ids.filter((id) => mentionedMe(e.d.channel_id, id, meId, told.get(id)));
      useMessages.getState().removeMany(e.d.channel_id, e.d.ids);
      for (const id of e.d.ids) useReadStates.getState().dropUnread(e.d.channel_id, id);
      for (const id of counted) useReadStates.getState().dropMention(e.d.channel_id, id);
      return;
    }
    case "reaction_add":
    case "reaction_remove":
      useMessages.getState().setReaction(e.d.channel_id, e.d.message_id, e.d.emoji, e.d.user_id, e.t === "reaction_add", e.d.user_id === meId);
      return;
    case "typing":
      if (e.d.user_id === meId) return;
      if (e.d.stop) useTyping.getState().remove(e.d.channel_id, e.d.user_id);
      // timed from when it arrived: the server's clock and this device's rarely agree
      else useTyping.getState().add(e.d.channel_id, e.d.user_id);
      return;
    case "channel_create":
    case "channel_update":
      useChannels.getState().upsert(e.d);
      fetchMissingUsers(e.d.recipient_ids);
      return;
    case "channel_delete":
      useChannels.getState().remove(e.d.id);
      useMessages.getState().clearChannel(e.d.id);
      // split panes still showing it close (the focused one follows the address)
      usePanes.getState().forgetChannel(e.d.id);
      return;
    case "channel_positions":
      useChannels.getState().applyPositions(e.d.channels);
      return;
    case "server_create":
      if (e.d.users) useUsers.getState().upsert(e.d.users);
      ingestServerView(e.d);
      for (const h of dispatchHooks.onUnhandled) h(e);
      return;
    case "server_update":
      useServers.getState().updateServer(e.d);
      return;
    case "server_delete": {
      const chans = useChannels.getState();
      for (const ch of Object.values(chans.byId)) {
        if (ch.server_id === e.d.id) {
          chans.remove(ch.id);
          useMessages.getState().clearChannel(ch.id);
          usePanes.getState().forgetChannel(ch.id);
        }
      }
      useServers.getState().remove(e.d.id);
      useExpressions.getState().removeServer(e.d.id);
      for (const h of dispatchHooks.onUnhandled) h(e);
      return;
    }
    case "emoji_update":
      useExpressions.getState().setEmojis(e.d.server_id, e.d.emojis);
      return;
    case "sticker_update":
      if (e.d.deleted || !e.d.pack) useExpressions.getState().removePack(e.d.pack_id);
      else useExpressions.getState().upsertPack(e.d.pack);
      return;
    case "sticker_recent":
      useExpressions.getState().noteRecent(e.d.sticker);
      return;
    case "member_add":
      useUsers.getState().upsert(e.d.user);
      useServers.getState().upsertMember(e.d.member, true);
      return;
    case "member_update":
      useServers.getState().upsertMember(e.d);
      return;
    case "member_remove":
      useServers.getState().removeMember(e.d.server_id, e.d.user_id, true);
      return;
    case "role_create":
    case "role_update":
      useServers.getState().upsertRole(e.d);
      return;
    case "role_delete":
      useServers.getState().removeRole(e.d.server_id, e.d.id);
      return;
    case "presence":
      usePresence.getState().set(e.d);
      return;
    case "user_update":
      useUsers.getState().upsert(e.d);
      if (e.d.id === meId) {
        const me = useAuth.getState().me;
        if (me) useAuth.getState().setMe({ ...me, ...e.d, flags: me.flags });
      }
      return;
    case "relationship_add": {
      const before = useRelationships.getState().byUser[e.d.user.id]?.type;
      useRelationships.getState().set(e.d);
      useUsers.getState().upsert(e.d.user);
      if (e.d.type === "incoming" && before !== "incoming") for (const h of dispatchHooks.onFriendRequest) h(e.d);
      return;
    }
    case "relationship_remove":
      useRelationships.getState().remove(e.d.user_id);
      return;
    case "read_state":
      useReadStates.getState().set(e.d);
      return;
    case "key_grant":
      await useKeys.getState().ingestGrants([e.d]);
      return;
    // Key upkeep can mean hundreds of requests. It runs beside the event queue
    // rather than in it, so messages, typing and calls do not wait behind it.
    //
    // `user_ids` is the server's answer to a question only the server was ever
    // asked, and one fabricated event naming an attacker's account used to be
    // enough to make this device seal the conversation root for it. The list is
    // held against the membership this client knows in `putGrantsFor`, which
    // every grant — this event, /keys/needs and a new epoch — goes through.
    case "keys_needed":
      if (ring.get(e.d.conv_id, e.d.epoch)) void useKeys.getState().grantTo(e.d.conv_id, e.d.epoch, e.d.user_ids).catch(() => undefined);
      return;
    case "key_rotation_needed": {
      const conv = e.d.conv_id;
      if (!ring.latest(conv)) return;
      // Each change still gets its own rotation, one after another: a key made
      // before a second removal may already have gone to the person removed.
      const job = (rotations.get(conv) ?? Promise.resolve())
        .then(() => useKeys.getState().rotate(conv, "membership change"))
        .catch(() => undefined)
        .finally(() => {
          if (rotations.get(conv) === job) rotations.delete(conv);
        });
      rotations.set(conv, job);
      return;
    }
    case "pin_update": {
      const ch = useMessages.getState().channels[e.d.channel_id];
      const m = ch?.byId[e.d.message_id];
      if (m) useMessages.getState().setFlags(e.d.channel_id, e.d.message_id, e.d.pinned ? m.flags | 1 : m.flags & ~1);
      return;
    }
    case "settings_update":
      // our own saves come back here too, and there is nothing new to fetch in those
      if (e.d.version > useSettings.getState().version) void useSettings.getState().reload().catch(() => undefined);
      return;
    case "session_expired":
      void useAuth.getState().logout();
      return;
    case "heartbeat_ack":
    case "guest_ended":
      return;
    case "nexa_notice":
      useNexa.getState().onNotice(e.d.case, e.d.people, e.d.state);
      applyNexaState(e.d.state);
      for (const h of dispatchHooks.onNexa) h({ kind: "notice", case: e.d.case });
      return;
    case "nexa_state":
      applyNexaState(e.d);
      return;
    case "nexa_case":
      useNexa.getState().onCase(e.d.case, e.d.messages, e.d.people, e.d.state);
      applyNexaState(e.d.state);
      if (e.d.messages.some((m) => m.kind === "staff")) for (const h of dispatchHooks.onNexa) h({ kind: "reply", case: e.d.case });
      return;
    case "nexa_announcement":
      useNexa.getState().onAnnouncement(e.d.announcement, e.d.people);
      emitModEvent({ type: "announcement", announcement: e.d.announcement, people: e.d.people });
      for (const h of dispatchHooks.onNexa) h({ kind: "announcement", announcement: e.d.announcement });
      return;
    case "nexa_announcement_delete":
      useNexa.getState().onAnnouncementGone(e.d.id);
      emitModEvent({ type: "announcement_gone", id: e.d.id });
      return;
    case "mod_case":
      useModeration.getState().setCounts(e.d.counts);
      emitModEvent({ type: "case", case: e.d.case, messages: e.d.messages, people: e.d.people });
      // a member writing is what the staff are waiting for
      if (e.d.messages.some((m) => m.kind === "member")) for (const h of dispatchHooks.onNexa) h({ kind: "appeal", caseId: e.d.case.id, userId: e.d.case.user_id });
      return;
    case "mod_log":
      emitModEvent({ type: "log", entry: e.d.entry, people: e.d.people });
      return;
    case "account_banned":
      // the socket was shut on a ban; what the ban screen needs comes over REST
      void nexaApi
        .state()
        .then((r) => {
          if (!gone()) applyNexaState(r.state);
        })
        .catch(() => undefined);
      return;
    case "voice_state":
    case "voice_signal":
    case "voice_error":
    case "voice_resumed":
    case "call_ring":
    case "call_end": {
      const v = await voice();
      if (!gone()) v.handleVoiceEvent(e);
      return;
    }
    case "ban_add":
    case "ban_remove":
    case "invite_create":
    case "invite_delete":
      for (const h of dispatchHooks.onUnhandled) h(e);
      return;
    default: {
      const never: never = e;
      void never;
    }
  }
}

/**
 * An event that arrived while the app was locked with a call going on. The
 * keys are gone, so nothing that needs them is applied — the ready after
 * unlocking brings all of that back — but the call goes on: its own events are
 * handled as usual, and a reconnect meanwhile still resumes it. A call ringing
 * in is left: nobody can answer it behind the passcode.
 */
export async function applyLockedEvent(e: GatewayEvent): Promise<void> {
  const gen = sessionGen;
  switch (e.t) {
    case "ready": {
      const v = await voice();
      if (gen === sessionGen) v.onReadyVoice(e.d.voice_states ?? [], e.d.session_id);
      return;
    }
    case "voice_state":
    case "voice_signal":
    case "voice_error":
    case "voice_resumed":
    case "call_end": {
      const v = await voice();
      if (gen === sessionGen) v.handleVoiceEvent(e);
      return;
    }
    case "session_expired":
    case "account_banned":
      return applyEvent(e);
    default:
      return;
  }
}
