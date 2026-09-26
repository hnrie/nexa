import { Modal } from "@/components/common/Modal";
import { useSettings } from "@/stores/settings";
import { t } from "@/i18n";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
// A Mac's keys are labelled with symbols, and Option is not called Alt there.
const mod = isMac ? "⌘" : "Ctrl";
const alt = isMac ? "⌥" : "Alt";
const shift = isMac ? "⇧" : "Shift";

/** Every shortcut the app answers to, grouped by what it is for. Built per render so it follows the language. */
function groups(pttKey: string | null): { head: string; rows: [string, string][] }[] {
  return [
    {
      head: t("modals.shortcutsHelp.groupGettingAround"),
      rows: [
        [`${mod} K`, t("modals.shortcutsHelp.quickSwitcherJumpToAnyConversation")],
        [`${mod} Tab`, t("modals.shortcutsHelp.switchSearchMode")],
        [`${alt} ↑ / ↓`, t("modals.shortcutsHelp.previousNextConversation")],
        [`${alt} ↑ / ↓`, t("modals.shortcutsHelp.moveTheFocusedItem")],
        [`${mod} /`, t("modals.shortcutsHelp.thisList")],
      ],
    },
    {
      head: t("modals.shortcutsHelp.groupMessages"),
      rows: [
        [`Enter / ${shift} Enter`, t("modals.shortcutsHelp.sendNewLine")],
        [t("modals.shortcutsHelp.upEmptyComposer"), t("modals.shortcutsHelp.editYourLastMessage")],
        [`${mod} E`, t("modals.shortcutsHelp.openTheEmojiPicker")],
        ["Esc", t("modals.shortcutsHelp.markTheChannelAsReadCancel")],
        ["↑ / ↓ · Home / End", t("modals.shortcutsHelp.moveBetweenMessages")],
        [`${shift} PageUp / PageDown`, t("modals.shortcutsHelp.scrollTheMessages")],
      ],
    },
    {
      head: t("modals.shortcutsHelp.groupFormatting"),
      rows: [
        [`${mod} B / I / U`, t("modals.shortcutsHelp.boldItalicUnderline")],
        [`${mod} ${shift} X`, t("modals.shortcutsHelp.strikeThrough")],
        [`${mod} K`, t("modals.shortcutsHelp.addLink")],
        [`${mod} Enter`, t("modals.shortcutsHelp.sendFromEditor")],
      ],
    },
    {
      head: t("modals.shortcutsHelp.groupTabs"),
      rows: [
        [`${mod} ${alt} ← / →`, t("modals.shortcutsHelp.switchTabs")],
        [`${mod} ${alt} W`, t("modals.shortcutsHelp.closePaneOrTab")],
        [isMac ? "⌫" : "Delete", t("modals.shortcutsHelp.closeTheFocusedTab")],
      ],
    },
    {
      head: t("modals.shortcutsHelp.groupCalls"),
      rows: [
        [`${mod} ${shift} M`, t("modals.shortcutsHelp.toggleMute")],
        [`${mod} ${shift} D`, t("modals.shortcutsHelp.toggleDeafen")],
        // only when push to talk is what the account uses; the key is the one it chose
        ...(pttKey ? ([[pttKey, t("modals.shortcutsHelp.holdToTalk")]] as [string, string][]) : []),
      ],
    },
  ];
}

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const voice = useSettings((s) => s.settings.voice);
  const pttKey = voice.mode === "ptt" ? voice.pttKey : null;
  return (
    <Modal open onClose={onClose} title={t("modals.shortcutsHelp.keyboardShortcuts")} width={560}>
      {groups(pttKey).map((g) => (
        <section key={g.head} style={{ marginBlockEnd: 16 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--text-subtle)" }}>{g.head}</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <tbody>
              {g.rows.map(([k, v]) => (
                <tr key={k + v}>
                  <td style={{ paddingBlock: 6, paddingInlineEnd: 12, whiteSpace: "nowrap", verticalAlign: "top", width: "1%" }}>
                    <kbd dir="ltr" style={{ padding: "2px 6px", borderRadius: 4, background: "var(--bg-input)", border: "1px solid var(--border)", fontSize: 13, fontFamily: "var(--font-mono)" }}>{k}</kbd>
                  </td>
                  <td style={{ paddingBlock: 6, color: "var(--text)" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </Modal>
  );
}
