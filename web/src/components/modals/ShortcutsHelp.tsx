import { Modal } from "@/components/common/Modal";

import { t } from "@/i18n";
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";

const rows = (): [string, string][] => [
  [`${mod} K`, t("modals.shortcutsHelp.quickSwitcherJumpToAnyConversation")],
  ["Alt ↑ / ↓", t("modals.shortcutsHelp.previousNextConversation")],
  ["Esc", t("modals.shortcutsHelp.markTheChannelAsReadCancel")],
  [t("modals.shortcutsHelp.upEmptyComposer"), t("modals.shortcutsHelp.editYourLastMessage")],
  ["Enter / Shift Enter", t("modals.shortcutsHelp.sendNewLine")],
  [`${mod} E`, t("modals.shortcutsHelp.openTheEmojiPicker")],
  [`${mod} Shift M`, t("modals.shortcutsHelp.toggleMute")],
  [`${mod} Shift D`, t("modals.shortcutsHelp.toggleDeafen")],
  ["Shift PageUp / PageDown", t("modals.shortcutsHelp.scrollTheMessages")],
  [`${mod} /`, t("modals.shortcutsHelp.thisList")],
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={t("modals.shortcutsHelp.keyboardShortcuts")} width={520}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <tbody>
          {rows().map(([k, v]) => (
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
