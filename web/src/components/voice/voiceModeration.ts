/**
 * What a moderator can do to someone in one of a server's voice channels:
 * server mute and deafen, moving them to another voice channel, and putting
 * them out of the call. The same items sit on the person's row under the
 * channel and on their tile in the call (VoiceParticipants, VoiceView), and
 * dragging their row onto another voice channel moves them (ServerSidebar).
 *
 * Every check is the server's own (handleVoiceModerate): the permission in
 * the channel they are in, a role above theirs (a guest holds none), and for
 * a move a channel this account can see and they may connect to. A mute and
 * a deafen stay on the member until a moderator lifts them.
 */
import { ApiError } from "@/api/client";
import type { Channel, VoiceState } from "@/api/types";
import { voice as voiceApi } from "@/api/voice";
import { outranks } from "@/components/server/memberMenu";
import { t } from "@/i18n";
import { isGuest } from "@/lib/guestLink";
import { P, has } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { channelTree, useChannels } from "@/stores/channels";
import { canI, channelPerms, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { button, type MenuButton } from "@/lib/contextMenus/registry";
import { useUsers } from "@/stores/users";

export interface VoicePowers {
  mute: boolean;
  deafen: boolean;
  /** Move to another channel, and disconnect. */
  move: boolean;
}

const NONE: VoicePowers = { mute: false, deafen: false, move: false };

/** Whether someone in a call is there through a guest link. */
export function inAsGuest(vs: Pick<VoiceState, "user_id" | "guest">): boolean {
  return !!vs.guest || isGuest(useUsers.getState().byId[vs.user_id]);
}

/** What this account may do to someone in a voice channel of a server; nothing to itself. */
export function voicePowers(serverId: string, channelId: string, vs: Pick<VoiceState, "user_id" | "guest">): VoicePowers {
  const st = useServers.getState().byId[serverId];
  const me = useAuth.getState().me;
  if (!st || !me || vs.user_id === me.id) return NONE;
  if (!inAsGuest(vs) && !outranks(serverId, vs.user_id)) return NONE;
  const may = (perm: bigint) => canI(st, P.VIEW_CHANNEL | perm, channelId);
  return { mute: may(P.MUTE_MEMBERS), deafen: may(P.DEAFEN_MEMBERS), move: may(P.MOVE_MEMBERS) };
}

/** The voice channels someone could be moved to, in the sidebar's order: ones this account can see and they may connect to. */
export function moveTargets(serverId: string, userId: string, fromId: string): Channel[] {
  const st = useServers.getState().byId[serverId];
  if (!st) return [];
  const tree = channelTree(useChannels.getState().byId, serverId);
  return [...tree.loose, ...tree.categories.flatMap((c) => c.children)].filter(
    (c) => c.type === "voice" && c.id !== fromId && canI(st, P.VIEW_CHANNEL, c.id) && has(channelPerms(st, c.id, userId), P.CONNECT),
  );
}

async function moderate(serverId: string, userId: string, body: { mute?: boolean; deaf?: boolean; channel_id?: string | null }): Promise<boolean> {
  try {
    await voiceApi.moderate(serverId, userId, body);
    return true;
  } catch (err) {
    useUI.getState().toast(err instanceof ApiError ? err.message : t("voice.moderation.failed"), "error");
    return false;
  }
}

export const setServerMute = (serverId: string, userId: string, on: boolean) => moderate(serverId, userId, { mute: on });
export const setServerDeafen = (serverId: string, userId: string, on: boolean) => moderate(serverId, userId, { deaf: on });
export const moveMember = (serverId: string, userId: string, channelId: string) => moderate(serverId, userId, { channel_id: channelId });
export const disconnectMember = (serverId: string, userId: string) => moderate(serverId, userId, { channel_id: null });

/** A server mute a moderator gave, as opposed to a channel that lets nobody speak. */
export function modMuted(vs: Pick<VoiceState, "server_mute" | "suppress">): boolean {
  return vs.server_mute && !vs.suppress;
}

/** Someone in a server's voice channel, as a moderator's buttons find them in the context of their menu. */
export interface VoiceTarget {
  serverId: string;
  channelId: string;
  vs: VoiceState;
}

/**
 * The moderator's part of someone's menu in a voice channel: Server Mute,
 * Server Deafen, Move To and Disconnect, each where this account may. None
 * for anyone else. A guest is put out with the call's own Remove From Call.
 * `ids` names the buttons in the menu they are in.
 */
export function voiceModerationButtons<C>(ids: { mute: string; deafen: string; move: string; disconnect: string }, of: (ctx: C) => VoiceTarget | null): MenuButton<C>[] {
  const target = (c: C) => {
    const x = of(c);
    return x && { ...x, userId: x.vs.user_id, can: voicePowers(x.serverId, x.channelId, x.vs) };
  };
  return [
    button(ids.mute, (c) => {
      const x = target(c);
      if (!x?.can.mute) return null;
      const muted = modMuted(x.vs);
      return { id: "server-mute", label: t("voice.moderation.serverMute"), checked: muted, toggle: true, onSelect: () => void setServerMute(x.serverId, x.userId, !muted) };
    }),
    button(ids.deafen, (c) => {
      const x = target(c);
      return !!x?.can.deafen && { id: "server-deafen", label: t("voice.moderation.serverDeafen"), checked: x.vs.server_deaf, toggle: true, onSelect: () => void setServerDeafen(x.serverId, x.userId, !x.vs.server_deaf) };
    }),
    button(ids.move, (c) => {
      const x = target(c);
      if (!x?.can.move || inAsGuest(x.vs)) return null;
      return { id: "move-to", label: t("voice.moderation.moveTo"), submenu: moveTargets(x.serverId, x.userId, x.channelId).map((ch) => ({ id: `move-${ch.id}`, label: ch.name, onSelect: () => void moveMember(x.serverId, x.userId, ch.id) })) };
    }),
    button(ids.disconnect, (c) => {
      const x = target(c);
      return !!x?.can.move && !inAsGuest(x.vs) && { id: "disconnect", label: t("voice.moderation.disconnect"), danger: true, onSelect: () => void disconnectMember(x.serverId, x.userId) };
    }),
  ];
}
