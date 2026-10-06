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
import { useUI, type ContextMenuItem } from "@/stores/ui";
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

/**
 * The moderator's part of someone's menu in a voice channel: Server Mute,
 * Server Deafen, Move To and Disconnect, each where this account may. Empty
 * for anyone else. A guest is put out with the call's own Remove From Call.
 */
export function voiceModerationItems(serverId: string, channelId: string, vs: VoiceState): ContextMenuItem[] {
  const can = voicePowers(serverId, channelId, vs);
  const userId = vs.user_id;
  const items: ContextMenuItem[] = [];
  const muted = modMuted(vs);
  if (can.mute) items.push({ id: "server-mute", label: t("voice.moderation.serverMute"), checked: muted, toggle: true, onSelect: () => void setServerMute(serverId, userId, !muted) });
  if (can.deafen) items.push({ id: "server-deafen", label: t("voice.moderation.serverDeafen"), checked: vs.server_deaf, toggle: true, onSelect: () => void setServerDeafen(serverId, userId, !vs.server_deaf) });
  if (can.move && !inAsGuest(vs)) {
    const targets = moveTargets(serverId, userId, channelId);
    items.push({ id: "move-to", label: t("voice.moderation.moveTo"), submenu: targets.map((c) => ({ id: `move-${c.id}`, label: c.name, onSelect: () => void moveMember(serverId, userId, c.id) })) });
    items.push({ id: "disconnect", label: t("voice.moderation.disconnect"), danger: true, onSelect: () => void disconnectMember(serverId, userId) });
  }
  return items;
}
