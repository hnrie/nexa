import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";

/**
 * Log Out, asked first. It is one tap from Settings and the status menu —
 * on a phone a chip in a sideways-scrolling row — and signing back in takes
 * the password, and on a device with a passcode, setting that up again.
 */
export function confirmLogout(): void {
  useUI.getState().openModal("confirm", {
    title: t("settings.settings.logOut"),
    body: t("settings.settings.logOutConfirm"),
    confirmLabel: t("settings.settings.logOut"),
    danger: true,
    onConfirm: () => useAuth.getState().logout(),
  });
}
