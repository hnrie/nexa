import { Modal } from "@/components/common/Modal";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";

const ROWS: [string, string][] = [
  [`${mod} K`, "Quick switcher — jump to any conversation"],
  ["Alt ↑ / ↓", "Previous / next conversation"],
  ["Esc", "Mark the channel as read, cancel a reply or edit"],
  ["↑ (empty composer)", "Edit your last message"],
  ["Enter / Shift Enter", "Send / new line"],
  [`${mod} E`, "Open the emoji picker"],
  [`${mod} Shift M`, "Toggle mute"],
  [`${mod} Shift D`, "Toggle deafen"],
  ["Shift PageUp / PageDown", "Scroll the messages"],
  [`${mod} /`, "This list"],
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Keyboard shortcuts" width={520}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <tbody>
          {ROWS.map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: "8px 12px 8px 0", whiteSpace: "nowrap" }}><kbd style={{ padding: "2px 6px", borderRadius: 4, background: "var(--bg-input)", border: "1px solid var(--border)", fontSize: 13 }}>{k}</kbd></td>
              <td style={{ padding: "8px 0", color: "var(--text)" }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
