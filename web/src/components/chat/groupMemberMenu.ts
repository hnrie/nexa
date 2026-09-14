import { ApiError } from "@/api/client";
import { channels as channelsApi } from "@/api/channels";
import { closeDM, managesGroup } from "@/components/sidebar/dmMenu";
import { channelDisplayName, friendNicknames } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useSettings } from "@/stores/settings";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";

export interface GroupMemberMenuCtx {
  nav: (path: string) => void;
  openModal: (kind: string, props?: Record<string, unknown>) => void;
}

/** Opens (or starts) the one-to-one conversation with someone. */
async function messageUser(userId: string, nav: (path: string) => void): Promise<void> {
  try {
    const ch = await channelsApi.createDM([userId]);
    useChannels.getState().upsert(ch);
    nav(`/channels/@me/${ch.id}`);
  } catch (err) {
    useUI.getState().toast(err instanceof ApiError ? err.message : "Could not open the conversation.", "error");
  }
}

/**
 * Context menu for someone in a group's member list: profile, mention and
 * message for everyone, and for whoever manages the group (its owner or an
 * instance admin) handing ownership on and removing people. The owner
 * outranks an instance admin, so is never offered for removal.
 */
export function groupMemberMenuItems(channelId: string, userId: string, ctx: GroupMemberMenuCtx): ContextMenuItem[] {
  const ch = useChannels.getState().byId[channelId];
  const me = useAuth.getState().me;
  if (!ch || ch.type !== "group_dm" || !me) return [];
  const users = useUsers.getState().byId;
  const nicknames = friendNicknames(useRelationships.getState().byUser);
  const self = userId === me.id;
  const user = users[userId];
  const name = nicknames[userId] || displayName(user, self ? me.display_name : "Unknown User");
  const group = channelDisplayName(ch, users, me.id, nicknames);
  const manage = managesGroup(ch);
  const isOwner = ch.owner_id === userId;
  const owner = ch.owner_id ? nicknames[ch.owner_id] || displayName(users[ch.owner_id], "its current owner") : "its current owner";

  const items: ContextMenuItem[] = [
    { id: "profile", label: "Profile", onSelect: () => ctx.openModal("profile", { userId }) },
    {
      id: "mention",
      label: "Mention",
      disabled: !user?.username,
      onSelect: () => window.dispatchEvent(new CustomEvent("ec:insert-text", { detail: `@${user?.username} ` })),
    },
  ];
  if (!self) items.push({ id: "message", label: "Message", onSelect: () => void messageUser(userId, ctx.nav) });
  items[items.length - 1]!.separatorAfter = true;

  if (manage && !isOwner) {
    items.push({
      id: "owner",
      label: self ? "Take Ownership" : "Transfer Ownership",
      onSelect: () =>
        ctx.openModal("confirm", {
          title: self ? `Take ownership of '${group}'` : `Transfer ownership of '${group}'`,
          body: self
            ? `You become the group's owner in place of ${owner}.`
            : ch.owner_id === me.id
              ? `${name} becomes the group's owner, able to remove people and delete the group, and you become a member like everyone else.`
              : `${name} becomes the group's owner in place of ${owner}.`,
          confirmLabel: self ? "Take Ownership" : "Transfer Ownership",
          onConfirm: () => channelsApi.patch(channelId, { owner_id: userId }),
        }),
    });
  }
  if (manage && !self && !isOwner) {
    items.push({
      id: "remove",
      label: "Remove From Group",
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: `Remove ${name}`,
          body: `${name} is removed from '${group}' and stops receiving its messages. They need a new invite to come back.`,
          confirmLabel: "Remove",
          danger: true,
          onConfirm: () => channelsApi.removeRecipient(channelId, userId),
        }),
    });
  }
  if (self) {
    items.push({
      id: "leave",
      label: "Leave Group",
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: `Leave '${group}'`,
          body: isOwner
            ? "You stop receiving messages from this group, and ownership passes to another member. You need a new invite to come back."
            : "You stop receiving messages from this group. You need a new invite to come back.",
          confirmLabel: "Leave Group",
          danger: true,
          onConfirm: () => closeDM(channelId, ctx.nav),
        }),
    });
  }
  if (useSettings.getState().settings.developerMode) {
    items[items.length - 1]!.separatorAfter = true;
    items.push({ id: "copy", label: "Copy User ID", onSelect: () => void navigator.clipboard?.writeText(userId).then(() => useUI.getState().toast("Copied!", "success")) });
  }
  return items;
}
