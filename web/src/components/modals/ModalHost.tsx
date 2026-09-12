import { lazy, Suspense, useCallback } from "react";
import { useUI, type ModalState } from "@/stores/ui";
import { ConfirmModal } from "./ConfirmModal";
import { CreateDMModal } from "./CreateDMModal";
import { CustomStatusModal } from "./CustomStatusModal";
import { QuickSwitcher } from "./QuickSwitcher";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { CreateServerModal } from "./CreateServerModal";
import { InviteModal } from "./InviteModal";
import { GroupInviteModal } from "./GroupInviteModal";
import { CreateChannelModal } from "./CreateChannelModal";
import { CreateCategoryModal } from "./CreateCategoryModal";
import { ServerNotificationsModal } from "./ServerNotificationsModal";
import { ServerProfileModal } from "./ServerProfileModal";
import { ChannelTopicModal } from "./ChannelTopicModal";
import { IncomingCallHost } from "@/components/voice/IncomingCall";

const SettingsModal = lazy(() => import("@/components/settings/SettingsModal"));
const ProfileModal = lazy(() => import("@/components/profile/ProfileModal"));
const ServerSettingsModal = lazy(() => import("@/components/server/ServerSettingsModal"));
const ChannelSettingsModal = lazy(() => import("@/components/server/ChannelSettingsModal"));
const MemberActionModal = lazy(() => import("@/components/server/MemberActionModal"));

/** Renders every modal on the ui store's stack; later ones overlay earlier ones. */
export function ModalHost() {
  const modals = useUI((u) => u.modals);
  return (
    <>
      <QuickSwitcher />
      <IncomingCallHost />
      {modals.map((m) => (
        <ModalEntry key={m.id} modal={m} />
      ))}
    </>
  );
}

function ModalEntry({ modal }: { modal: ModalState }) {
  const closeModal = useUI((u) => u.closeModal);
  const close = useCallback(() => closeModal(modal.id), [closeModal, modal.id]);
  return (
    <>
      {modal?.kind === "createDM" ? <CreateDMModal onClose={close} initial={(modal.props?.["initial"] as string[] | undefined) ?? []} groupId={modal.props?.["groupId"] as string | undefined} /> : null}
      {modal?.kind === "confirm" ? (
        <ConfirmModal
          onClose={close}
          title={String(modal.props?.["title"] ?? "Are you sure?")}
          body={modal.props?.["body"] as React.ReactNode}
          confirmLabel={modal.props?.["confirmLabel"] as string | undefined}
          danger={Boolean(modal.props?.["danger"])}
          onConfirm={modal.props?.["onConfirm"] as () => unknown}
        />
      ) : null}
      {modal?.kind === "customStatus" ? <CustomStatusModal onClose={close} /> : null}
      {modal?.kind === "shortcuts" ? <ShortcutsHelp onClose={close} /> : null}
      {modal?.kind === "createServer" ? <CreateServerModal onClose={close} /> : null}
      {modal?.kind === "invite" ? <InviteModal onClose={close} serverId={String(modal.props?.["serverId"])} channelId={modal.props?.["channelId"] as string | undefined} /> : null}
      {modal?.kind === "groupInvite" ? <GroupInviteModal onClose={close} channelId={String(modal.props?.["channelId"])} /> : null}
      {modal?.kind === "createChannel" ? <CreateChannelModal onClose={close} serverId={String(modal.props?.["serverId"])} parentId={modal.props?.["parentId"] as string | undefined} /> : null}
      {modal?.kind === "createCategory" ? <CreateCategoryModal onClose={close} serverId={String(modal.props?.["serverId"])} /> : null}
      {modal?.kind === "serverNotifications" ? <ServerNotificationsModal onClose={close} serverId={String(modal.props?.["serverId"])} /> : null}
      {modal?.kind === "channelTopic" ? <ChannelTopicModal onClose={close} channelId={String(modal.props?.["channelId"])} /> : null}
      {modal?.kind === "serverProfile" ? <ServerProfileModal onClose={close} serverId={String(modal.props?.["serverId"])} userId={modal.props?.["userId"] as string | undefined} /> : null}
      <Suspense fallback={null}>
        {modal?.kind === "settings" ? <SettingsModal onClose={close} page={(modal.props?.["page"] as string | undefined) ?? "account"} packId={modal.props?.["packId"] as string | undefined} /> : null}
        {modal?.kind === "profile" ? <ProfileModal onClose={close} userId={modal.props?.["userId"] as string} /> : null}
        {modal?.kind === "serverSettings" ? <ServerSettingsModal onClose={close} serverId={String(modal.props?.["serverId"])} page={modal.props?.["page"] as string | undefined} /> : null}
        {modal?.kind === "channelSettings" ? <ChannelSettingsModal onClose={close} channelId={String(modal.props?.["channelId"])} page={modal.props?.["page"] as string | undefined} /> : null}
        {modal?.kind === "memberAction" ? <MemberActionModal onClose={close} serverId={String(modal.props?.["serverId"])} userId={String(modal.props?.["userId"])} action={modal.props?.["action"] as "kick" | "ban" | "timeout" | "roles"} /> : null}
      </Suspense>
    </>
  );
}
