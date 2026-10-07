import { Gamepad2 } from "lucide-react";
import { useId, type KeyboardEvent, type MouseEvent } from "react";
import { connections, DISCORD_KINDS } from "@/api/connections";
import { Tooltip } from "@/components/common/Tooltip";
import { t } from "@/i18n";
import { desktopBridge } from "@/lib/desktopBridge";
import { describeError } from "@/lib/errors";
import { bindText, keybindsOf } from "@/lib/keybinds";
import { toggleActivitySharing } from "@/lib/keybindActions";
import { useDesktop } from "@/stores/desktop";
import { useDiscord } from "@/stores/discord";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { button, defineMenu } from "@/lib/contextMenus/registry";

/**
 * The gamepad struck through, as the microphone and headphones beside it are
 * when they are off: Gamepad2's own lines, with a gap cut where the stroke
 * crosses them so the two never blur into one.
 */
export function GamepadOff({ size = 20 }: { size?: number }) {
  const mask = `gamepad-off-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <mask id={mask}>
        <rect width="24" height="24" fill="#fff" stroke="none" />
        <path d="M2 2 22 22" stroke="#000" strokeWidth={5} />
      </mask>
      <g mask={`url(#${mask})`}>
        <line x1="6" x2="10" y1="11" y2="11" />
        <line x1="8" x2="8" y1="9" y2="13" />
        <line x1="15" x2="15.01" y1="12" y2="12" />
        <line x1="18" x2="18.01" y1="10" y2="10" />
        <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
      </g>
      <path d="M2 2 22 22" />
    </svg>
  );
}

const DISCORD_KIND_LABELS: { bit: number; label: () => string }[] = [
  { bit: DISCORD_KINDS.listening, label: () => t("settings.activity.kindListening") },
  { bit: DISCORD_KINDS.playing, label: () => t("settings.activity.kindPlaying") },
  { bit: DISCORD_KINDS.watching, label: () => t("settings.activity.kindWatching") },
  { bit: DISCORD_KINDS.streaming, label: () => t("settings.activity.kindStreaming") },
  { bit: DISCORD_KINDS.competing, label: () => t("settings.activity.kindCompeting") },
];

const sharing = () => useSettings.getState().settings.shareActivity !== false;
/** The desktop app's Rich Presence, when the app is there to ask. */
function richPresence() {
  const bridge = desktopBridge();
  const rpc = useDesktop.getState().rpc;
  return bridge && rpc ? { bridge, rpc } : null;
}
const programsShown = () => {
  const r = richPresence();
  return !!r && r.rpc.enabled && r.rpc.apps.length > 0;
};

/**
 * What the button's right click offers: the switch itself, and each place
 * activity comes from, so one of them can be quiet while the rest still show.
 * In the desktop app, Rich Presence and each program heard through it; with
 * Discord linked, each kind of activity from there.
 */
export const activityMenu = defineMenu<null>("activity", [
  [button("shareActivity", () => ({ id: "share", label: t("settings.privacy.shareMyActivity"), checked: sharing(), toggle: true, keys: bindText(keybindsOf(useSettings.getState().settings.keybinds).activity) || undefined, onSelect: () => void toggleActivitySharing() }))],
  [
    // a line between Rich Presence and Discord, unless the programs' submenu stands between them
    button("richPresence", () => {
      const r = richPresence();
      return r && { id: "rpc", label: t("settings.desktop.richPresence"), checked: r.rpc.enabled, toggle: true, disabled: !sharing(), onSelect: () => void r.bridge.rpc.setEnabled(!r.rpc.enabled), separatorAfter: !programsShown() && !!useDiscord.getState().state?.linked };
    }),
    button("richPresencePrograms", () => {
      const r = richPresence();
      if (!r || !programsShown()) return null;
      return {
        id: "programs",
        label: t("settings.desktop.programs"),
        disabled: !sharing(),
        submenu: r.rpc.apps.map((app) => {
          const name = app.name || app.activity?.name || t("settings.desktop.programNamed", { id: app.clientId });
          return { id: `app-${app.clientId}`, label: name, checked: !app.hidden, toggle: true, onSelect: () => void r.bridge.rpc.setHidden(app.clientId, !app.hidden) };
        }),
      };
    }),
    button("discordActivityKinds", () => {
      const linked = useDiscord.getState().state?.linked;
      if (!linked) return null;
      return {
        id: "discord",
        label: t("settings.activity.discord"),
        disabled: !sharing(),
        submenu: DISCORD_KIND_LABELS.map((k) => {
          const on = (linked.kinds & k.bit) !== 0;
          return {
            id: `kind-${k.bit}`,
            label: k.label(),
            checked: on,
            toggle: true,
            onSelect: () =>
              void connections
                .setDiscord({ kinds: on ? linked.kinds & ~k.bit : linked.kinds | k.bit })
                .then((next) => useDiscord.getState().set(next))
                .catch((err) => useUI.getState().toast(describeError(err, t("settings.privacy.couldNotSave")), "error")),
          };
        }),
      };
    }),
  ],
  [button("activitySettings", () => ({ id: "settings", label: t("activityToggle.settings"), onSelect: () => useUI.getState().openModal("settings", { page: "activity" }) }))],
]);

/**
 * Beside mute and deafen: whether what you are playing or listening to shows
 * under your name, switched with one press. Off, it is struck through in red
 * the way they are. A right click chooses what shows.
 */
export function ActivityToggle({ className }: { className?: string | undefined }) {
  const share = useSettings((x) => x.settings.shareActivity !== false);
  const keys = useSettings((x) => bindText(keybindsOf(x.settings.keybinds).activity));
  const openMenu = (at: { x: number; y: number }) => activityMenu.open(null, { ...at, above: true, label: t("settings.activity.title") });
  return (
    <Tooltip text={share ? t("activityToggle.hide") : t("activityToggle.show")} keys={keys || undefined}>
      <button
        type="button"
        className={className}
        role="switch"
        aria-checked={share}
        aria-label={t("settings.privacy.shareMyActivity")}
        data-on={share}
        data-testid="activity-toggle"
        onClick={() => void toggleActivitySharing()}
        onContextMenu={(e: MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          openMenu({ x: e.clientX, y: e.clientY });
        }}
        onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
          // Shift+F10 and the Menu key open the same menu a right click does
          if (e.key !== "ContextMenu" && !(e.key === "F10" && e.shiftKey)) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          openMenu({ x: document.documentElement.dir === "rtl" ? r.right : r.left, y: r.top });
        }}
      >
        {share ? <Gamepad2 size={20} /> : <GamepadOff size={20} />}
      </button>
    </Tooltip>
  );
}
