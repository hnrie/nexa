import type { Channel } from "@/api/types";
import { reportBugMenuItem } from "@/components/bugs/ReportBugButton";
import { threadButtons, type ThreadMenuCtx } from "@/components/threads/ThreadBar";
import { about, button, defineMenu } from "@/lib/contextMenus/registry";
import { t } from "@/i18n";

export interface ChatMoreCtx {
  /** The channel on screen. */
  channel: Channel;
  /** The conversation it belongs to: itself, or the DM or group a subchat is in. */
  convo: Channel;
  isServer: boolean;
  /** The other person in a one-to-one conversation. */
  other?: string;
  /** Set when the channel is a thread: its own choices come first. */
  thread: ThreadMenuCtx | null;
  /** The channel can hold threads, so there is a list of them to open. */
  threadsHere: boolean;
  membersOpen: boolean;
  /** You are in this conversation's call. */
  inThisCall: boolean;
  openPins: () => void;
  openThreads: () => void;
  openSubchats: () => void;
  toggleMembers: () => void;
  openModal: (kind: string, props?: Record<string, unknown>) => void;
}

/** A conversation header's More menu on a phone, which keeps the header's buttons in it. */
export const chatMoreMenu = defineMenu<ChatMoreCtx>("chatMore", [
  // a thread's own choices come first: joining it, closing, locking, its settings
  threadButtons<ChatMoreCtx>({ join: "joinThreadFromMore", archive: "closeThreadFromMore", lock: "lockThreadFromMore", settings: "threadSettingsFromMore", remove: "deleteThreadFromMore" }, (c) => c.thread),
  [
    button("pinnedMessages", ({ openPins }) => ({ id: "pins", label: t("chat.chat.pinnedMessages"), onSelect: openPins })),
    button("threadList", ({ threadsHere, openThreads }) => threadsHere && { id: "threads", label: t("threads.panel.title"), onSelect: openThreads }),
    button("followChannel", ({ isServer, channel, openModal }) => isServer && channel.type === "announcement" && { id: "follow", label: t("follows.follow"), onSelect: () => openModal("follow", { channelId: channel.id }) }),
    // server channels have no subchats
    button("subchatList", ({ isServer, openSubchats }) => !isServer && { id: "subchats", label: t("chat.chat.subchats"), onSelect: openSubchats }),
    button("inviteFromMore", ({ isServer, channel, convo, other, openModal }) =>
      isServer
        ? { id: "invite", label: t("chat.chat.invitePeople"), onSelect: () => openModal("invite", { serverId: channel.server_id, channelId: channel.id }) }
        : { id: "add", label: convo.type === "dm" ? t("chat.chat.addFriendsToDm") : t("chat.chat.inviteToGroup"), onSelect: () => openModal(convo.type === "group_dm" ? "groupInvite" : "createDM", convo.type === "dm" ? { initial: other ? [other] : [] } : { channelId: convo.id }) },
    ),
    button("toggleMemberList", ({ isServer, convo, membersOpen, toggleMembers }) => (isServer || convo.type === "group_dm") && { id: "members", label: membersOpen ? t("chat.chat.hideMembers") : t("chat.chat.showMembers"), onSelect: toggleMembers }),
    // a phone's call bar has no room for it, so inviting guests to the call is here too
    button("inviteGuestsFromMore", ({ isServer, inThisCall, convo, openModal }) => !isServer && inThisCall && (convo.type === "dm" || convo.type === "group_dm") && { id: "guests", label: t("chat.chat.inviteGuestsToCall"), onSelect: () => openModal("guestLink", { channelId: convo.id }) }),
    button("reportBugFromMore", ({ isServer, convo }) => !isServer && reportBugMenuItem(convo.type === "group_dm" ? "group" : "dm")),
  ],
]);
about(chatMoreMenu, ({ channel }) => ({ channelId: channel.id }));

