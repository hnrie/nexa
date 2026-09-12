import type { GatewayEvent } from "./events";
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
import { useUsers } from "@/stores/users";
import { decryptForStore } from "@/lib/decrypt";
import { users as usersApi } from "@/api/users";
import { ring } from "@/lib/keyring";
import type { Message, ServerView } from "@/api/types";

/** Hooks other layers register: notifications, voice, servers (later phases). */
export const dispatchHooks: {
  onMessage: ((m: Message, mine: boolean) => void)[];
  onUnhandled: ((e: GatewayEvent) => void)[];
  onReady: (() => void)[];
} = { onMessage: [], onUnhandled: [], onReady: [] };

function resetAll(): void {
  useMessages.getState().clearAll();
  useChannels.getState().clear();
  useUsers.getState().clear();
  usePresence.getState().clear();
  useReadStates.getState().clear();
  useRelationships.getState().clear();
  useTyping.getState().clear();
  useServers.getState().clear();
  useExpressions.getState().clear();
}

function ingestServerView(view: ServerView): void {
  useChannels.getState().upsert(view.channels);
  useServers.getState().setFromView(view);
}

async function ensureUser(id: string): Promise<void> {
  if (useUsers.getState().byId[id]) return;
  try {
    useUsers.getState().upsert(await usersApi.get(id));
  } catch {
    /* unknown users render as placeholders */
  }
}

function mentionsMe(m: Message, meId: string): boolean {
  return m.mention_everyone || m.mentions.includes(meId);
}

export async function applyEvent(e: GatewayEvent): Promise<void> {
  const meId = useAuth.getState().me?.id;
  switch (e.t) {
    case "ready": {
      const d = e.d;
      resetAll();
      useAuth.getState().setMe(d.user);
      useUsers.getState().upsert([...d.users, d.user]);
      useChannels.getState().upsert(d.channels);
      useRelationships.getState().setMany(d.relationships);
      useReadStates.getState().setMany(d.read_states);
      usePresence.getState().setMany(d.presences);
      for (const view of d.servers ?? []) ingestServerView(view);
      useExpressions.getState().setAllEmojis(d.emojis ?? []);
      useExpressions.getState().setPacks(d.sticker_packs ?? []);
      const settings = useSettings.getState();
      await settings.load(d.settings?.blob ?? null, d.settings?.version ?? 0);
      await useKeys.getState().ingestGrants(d.key_grants);
      for (const h of dispatchHooks.onReady) h();
      void useKeys.getState().reconcile();
      const active = useUI.getState().activeChannelId;
      if (active) {
        useMessages.getState().clearChannel(active);
        void useMessages.getState().loadInitial(active);
      }
      return;
    }
    case "message_create": {
      const m = e.d;
      const decrypted = await decryptForStore(m);
      const messages = useMessages.getState();
      if (m.nonce && meId === m.author_id) messages.resolvePendingByNonce(m.channel_id, m.nonce);
      messages.insert(m.channel_id, [decrypted]);
      useChannels.getState().setLastMessage(m.channel_id, m.id);
      useTyping.getState().remove(m.channel_id, m.author_id);
      if (decrypted.decryptError === "no_key" && m.key_conv_id) useKeys.getState().markWaiting(m.key_conv_id);
      void ensureUser(m.author_id);
      const mine = meId === m.author_id;
      const ui = useUI.getState();
      const visible = ui.activeChannelId === m.channel_id && ui.focused && typeof document !== "undefined" && document.visibilityState === "visible";
      if (mine || visible) {
        void useReadStates.getState().ack(m.channel_id, m.id);
      } else if (meId && mentionsMe(m, meId)) {
        useReadStates.getState().bumpMentions(m.channel_id);
      }
      for (const h of dispatchHooks.onMessage) h(m, mine);
      return;
    }
    case "message_update": {
      const decrypted = await decryptForStore(e.d);
      useMessages.getState().update(e.d.channel_id, decrypted);
      return;
    }
    case "message_delete":
      useMessages.getState().remove(e.d.channel_id, e.d.id);
      return;
    case "message_delete_bulk":
      useMessages.getState().removeMany(e.d.channel_id, e.d.ids);
      return;
    case "reaction_add":
    case "reaction_remove":
      useMessages.getState().setReaction(e.d.channel_id, e.d.message_id, e.d.emoji, e.d.user_id, e.t === "reaction_add", e.d.user_id === meId);
      return;
    case "typing":
      if (e.d.user_id !== meId) useTyping.getState().add(e.d.channel_id, e.d.user_id, e.d.ts);
      return;
    case "channel_create":
    case "channel_update":
      useChannels.getState().upsert(e.d);
      for (const id of e.d.recipient_ids) void ensureUser(id);
      return;
    case "channel_delete":
      useChannels.getState().remove(e.d.id);
      useMessages.getState().clearChannel(e.d.id);
      return;
    case "channel_positions":
      useChannels.getState().applyPositions(e.d.channels);
      return;
    case "server_create":
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
    case "member_add":
      useUsers.getState().upsert(e.d.user);
      useServers.getState().upsertMember(e.d.member);
      return;
    case "member_update":
      useServers.getState().upsertMember(e.d);
      return;
    case "member_remove":
      useServers.getState().removeMember(e.d.server_id, e.d.user_id);
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
    case "relationship_add":
      useRelationships.getState().set(e.d);
      useUsers.getState().upsert(e.d.user);
      return;
    case "relationship_remove":
      useRelationships.getState().remove(e.d.user_id);
      return;
    case "read_state":
      useReadStates.getState().set(e.d);
      return;
    case "key_grant":
      await useKeys.getState().ingestGrants([e.d]);
      return;
    case "keys_needed":
      if (ring.get(e.d.conv_id, e.d.epoch)) await useKeys.getState().grantTo(e.d.conv_id, e.d.epoch, e.d.user_ids);
      return;
    case "key_rotation_needed":
      if (ring.latest(e.d.conv_id)) await useKeys.getState().rotate(e.d.conv_id, "membership change");
      return;
    case "pin_update": {
      const ch = useMessages.getState().channels[e.d.channel_id];
      const m = ch?.byId[e.d.message_id];
      if (m) useMessages.getState().setFlags(e.d.channel_id, e.d.message_id, e.d.pinned ? m.flags | 1 : m.flags & ~1);
      return;
    }
    case "settings_update":
      void useSettings.getState().reload();
      return;
    case "session_expired":
      void useAuth.getState().logout();
      return;
    case "heartbeat_ack":
      return;
    case "voice_state":
    case "voice_signal":
    case "call_ring":
    case "call_end":
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
