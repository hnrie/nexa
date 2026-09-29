import { dmOpenError } from "@/lib/errors";
import { channels as channelsApi } from "@/api/channels";
import { closeDM, managesGroup } from "@/components/sidebar/dmMenu";
import { copyText } from "@/lib/clipboard";
import { channelDisplayName, friendNicknames } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useSettings } from "@/stores/settings";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import { relationshipMenuItems } from "@/lib/friendship";

import { t } from "@/i18n";
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
    useUI.getState().toast(dmOpenError(err, t("chat.groupMemberMenu.couldNotOpenTheConversation")), "error");
  }
}

/**
 * Context menu for someone in a group's member list: profile, mention and
 * message for everyone, and for whoever manages the group (its owner or an
 * Nexa admin) handing ownership on and removing people. The owner
 * outranks a Nexa admin, so is never offered for removal.
 */
export function groupMemberMenuItems(channelId: string, userId: string, ctx: GroupMemberMenuCtx): ContextMenuItem[] {
  const ch = useChannels.getState().byId[channelId];
  const me = useAuth.getState().me;
  if (!ch || ch.type !== "group_dm" || !me) return [];
  const users = useUsers.getState().byId;
  const nicknames = friendNicknames(useRelationships.getState().byUser);
  const self = userId === me.id;
  const user = users[userId];
  const name = nicknames[userId] || displayName(user, self ? me.display_name : t("chat.groupMemberMenu.unknownUser"));
  const group = channelDisplayName(ch, users, me.id, nicknames);
  const manage = managesGroup(ch);
  const isOwner = ch.owner_id === userId;
  const owner = ch.owner_id ? nicknames[ch.owner_id] || displayName(users[ch.owner_id], t("chat.groupMemberMenu.itsCurrentOwner")) : t("chat.groupMemberMenu.itsCurrentOwner");

  const items: ContextMenuItem[] = [
    { id: "profile", label: t("profile.profile.profile"), onSelect: () => ctx.openModal("profile", { userId }) },
    {
      id: "mention",
      label: t("settings.notifications.mention"),
      disabled: !user?.username,
      onSelect: () => window.dispatchEvent(new CustomEvent("ec:insert-text", { detail: `@${user?.username} ` })),
    },
  ];
  if (!self) items.push({ id: "message", label: t("profile.profileCard.message"), onSelect: () => void messageUser(userId, ctx.nav) });
  items[items.length - 1]!.separatorAfter = true;
  // being friends, and blocking: the same choices a profile offers
  const people = relationshipMenuItems(userId);
  if (people.length) {
    items.push(...people);
    items[items.length - 1]!.separatorAfter = true;
  }

  if (manage && !isOwner) {
    items.push({
      id: "owner",
      label: self ? t("chat.groupMemberMenu.takeOwnership") : t("chat.groupMemberMenu.transferOwnership"),
      onSelect: () =>
        ctx.openModal("confirm", {
          title: self ? t("chat.groupMemberMenu.takeOwnershipOf", { group }) : t("chat.groupMemberMenu.transferOwnershipOf", { group }),
          body: self
            ? t("chat.groupMemberMenu.youBecomeTheOwnerInPlaceOf", { owner })
            : ch.owner_id === me.id
              ? t("chat.groupMemberMenu.theyBecomeTheOwnerAndYouAMember", { name })
              : t("chat.groupMemberMenu.theyBecomeTheOwnerInPlaceOf", { name, owner }),
          confirmLabel: self ? t("chat.groupMemberMenu.takeOwnership") : t("chat.groupMemberMenu.transferOwnership"),
          onConfirm: () => channelsApi.patch(channelId, { owner_id: userId }),
        }),
    });
  }
  if (manage && !self && !isOwner) {
    items.push({
      id: "remove",
      label: t("chat.groupMemberMenu.removeFromGroup"),
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: t("chat.groupMemberMenu.removeNamed", { name }),
          body: t("chat.groupMemberMenu.theyAreRemovedFromTheGroup", { name, group }),
          confirmLabel: t("composer.composer.remove"),
          danger: true,
          onConfirm: () => channelsApi.removeRecipient(channelId, userId),
        }),
    });
  }
  if (self) {
    items.push({
      id: "leave",
      label: t("chat.groupMemberMenu.leaveGroup"),
      danger: true,
      onSelect: () =>
        ctx.openModal("confirm", {
          title: t("sidebar.dmMenu.leaveNamed", { name: group }),
          body: isOwner
            ? t("chat.groupMemberMenu.youStopReceivingMessagesFromThis")
            : t("sidebar.dmMenu.youStopReceivingMessagesFromThis"),
          confirmLabel: t("chat.groupMemberMenu.leaveGroup"),
          danger: true,
          onConfirm: () => closeDM(channelId, ctx.nav),
        }),
    });
  }
  if (useSettings.getState().settings.developerMode) {
    items[items.length - 1]!.separatorAfter = true;
    items.push({ id: "copy", label: t("chat.groupMemberMenu.copyUserId"), onSelect: () => void copyText(userId, t("clipboard.idCopied")) });
  }
  return items;
}
