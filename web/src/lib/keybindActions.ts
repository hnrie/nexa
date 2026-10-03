/**
 * What each keybind does (lib/keybinds), whichever way it came in: a key
 * pressed in the window (components/shell/Shortcuts.tsx) or one the desktop
 * app holds system-wide (components/desktop/DesktopEffects.tsx).
 */
import { t } from "@/i18n";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useVoiceLocal } from "@/stores/voiceLocal";
import { firstOfPress, type KeybindAction } from "./keybinds";

export function runKeybind(action: KeybindAction): void {
  if (!firstOfPress(action)) return;
  // the sound for muting comes from the voice session, which hears every change (voice/session.ts)
  if (action === "mute") useVoiceLocal.getState().toggleMute();
  else if (action === "deafen") useVoiceLocal.getState().toggleDeafen();
  else {
    const on = toggleActivitySharing();
    // a key leaves nothing else to show that it worked
    useUI.getState().toast(on ? t("activityToggle.nowSharing") : t("activityToggle.nowHidden"), "info");
  }
}

/** Shares activity if it was hidden and hides it if it was shared; says which it is now. */
export function toggleActivitySharing(): boolean {
  const st = useSettings.getState();
  const on = st.settings.shareActivity === false;
  st.patch({ shareActivity: on });
  return on;
}
