import { lazy, Suspense } from "react";
import { useUI } from "@/stores/ui";
import { CreateDMModal } from "./CreateDMModal";
import { CustomStatusModal } from "./CustomStatusModal";
import { QuickSwitcher } from "./QuickSwitcher";

const SettingsModal = lazy(() => import("@/components/settings/SettingsModal"));
const ProfileModal = lazy(() => import("@/components/profile/ProfileModal"));

/** Renders whichever modal the ui store asks for. */
export function ModalHost() {
  const modal = useUI((u) => u.modal);
  const close = useUI((u) => u.closeModal);
  return (
    <>
      <QuickSwitcher />
      {modal?.kind === "createDM" ? <CreateDMModal onClose={close} initial={(modal.props?.["initial"] as string[] | undefined) ?? []} /> : null}
      {modal?.kind === "customStatus" ? <CustomStatusModal onClose={close} /> : null}
      <Suspense fallback={null}>
        {modal?.kind === "settings" ? <SettingsModal onClose={close} page={(modal.props?.["page"] as string | undefined) ?? "account"} /> : null}
        {modal?.kind === "profile" ? <ProfileModal onClose={close} userId={modal.props?.["userId"] as string} /> : null}
      </Suspense>
    </>
  );
}
