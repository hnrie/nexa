import { Modal } from "@/components/common/Modal";
import { useUsers } from "@/stores/users";

/** Placeholder profile modal; replaced by the popout/profile step. */
export default function ProfileModal({ onClose, userId }: { onClose: () => void; userId: string }) {
  const u = useUsers((s) => s.byId[userId]);
  return (
    <Modal open onClose={onClose} title={u?.display_name ?? "Profile"}>
      <p style={{ color: "var(--text-muted)" }}>@{u?.username}</p>
    </Modal>
  );
}
