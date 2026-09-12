import { Modal } from "@/components/common/Modal";

/** Placeholder; the full settings layer arrives with the profile/settings step. */
export default function SettingsModal({ onClose, page }: { onClose: () => void; page: string }) {
  return (
    <Modal open onClose={onClose} title="Settings">
      <p style={{ color: "var(--text-muted)" }}>Settings ({page}) coming next.</p>
    </Modal>
  );
}
