import type { Relationship } from "@/api/types";
import { about, button, defineMenu } from "@/lib/contextMenus/registry";
import { copyAndSay } from "@/lib/copyText";
import { confirmRemoveFriend, openBlockDialog, unblockUser } from "@/lib/friendship";
import { copyProfileLink } from "@/lib/profileLinks";
import { usePick } from "@/stores/pick";
import { t } from "@/i18n";

export interface FriendMenuCtx {
  rel: Relationship;
  profile: () => void;
  message: () => void;
  call: () => void;
}

/** A row's menu in the friends list. */
export const friendMenu = defineMenu<FriendMenuCtx>("friend", [
  [
    button("viewFriendProfile", ({ profile }) => ({ id: "profile", label: t("profile.profile.profile"), onSelect: profile })),
    button("messageFriend", ({ message }) => ({ id: "msg", label: t("profile.profileCard.message"), onSelect: message })),
    button("callFriend", ({ rel, call }) => rel.type === "friend" && { id: "call", label: t("chat.chat.startVoiceCall"), onSelect: call }),
  ],
  [
    button("removeFriend", ({ rel }) => rel.type === "friend" && { id: "rm", label: t("profile.profileCard.removeFriend"), danger: true, onSelect: () => confirmRemoveFriend(rel.user) }),
    // the one block dialog, with its choices about their messages
    button("blockFriend", ({ rel }) =>
      rel.type !== "blocked"
        ? { id: "block", label: t("profile.profileCard.block"), danger: true, onSelect: () => openBlockDialog(rel.user.id) }
        : { id: "unblock", label: t("friends.unblock"), onSelect: () => void unblockUser(rel.user.id) },
    ),
    button("copyFriendProfileLink", ({ rel }) => ({ id: "copy-profile-link", label: t("profileLink.copy"), onSelect: () => copyProfileLink(rel.user.username) })),
    button("copyFriendId", ({ rel }) => ({ id: "copy", label: t("chat.groupMemberMenu.copyUserId"), onSelect: () => copyAndSay(rel.user.id, t("friends.userIdCopied")) })),
  ],
  // the way into picking on a touch screen, where there is no Ctrl to hold
  [button("selectFriends", ({ rel }) => ({ id: "select", label: t("pick.select"), onSelect: () => usePick.getState().start("friends", rel.user.id) }))],
]);
about(friendMenu, ({ rel }) => ({ userId: rel.user.id }));

