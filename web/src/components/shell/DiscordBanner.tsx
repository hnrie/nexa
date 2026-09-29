import { RotateCw, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { rejoinDiscord } from "@/components/settings/ActivityPage";
import { t } from "@/i18n";
import { useAuth } from "@/stores/auth";
import { useDiscord } from "@/stores/discord";
import s from "./DownloadBanner.module.css";

const dismissKey = (userId: string) => `nexa.discord-left-dismissed.${userId}`;

function dismissedAt(userId: string): number {
  try {
    return Number(localStorage.getItem(dismissKey(userId))) || 0;
  } catch {
    return 0;
  }
}

/**
 * The linked Discord account left the Discord server Nexa's bot reads
 * presence in, so its activity stopped showing here. Rejoin puts it back.
 * Closing it keeps it away until the account leaves again.
 */
export function DiscordBanner() {
  const meId = useAuth((a) => a.me?.id);
  const linked = useDiscord((x) => x.state?.linked);
  const [closed, setClosed] = useState(0);
  const [busy, setBusy] = useState(false);
  if (!meId || !linked || linked.in_guild || linked.left_at <= 0) return null;
  if (closed === linked.left_at || dismissedAt(meId) === linked.left_at) return null;

  const close = () => {
    setClosed(linked.left_at);
    try {
      localStorage.setItem(dismissKey(meId), String(linked.left_at));
    } catch {
      /* private mode: closed for this visit */
    }
  };
  const rejoin = async () => {
    setBusy(true);
    try {
      await rejoinDiscord();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.banner} role="region" aria-label={t("settings.activity.discord")} data-testid="discord-banner">
      <span className={s.icon}><TriangleAlert size={18} /></span>
      <span className={s.text}>
        <b>{t("shell.discordBanner.title")}</b>
        <span style={{ opacity: 0.8 }}> {t("shell.discordBanner.body")}</span>
      </span>
      <button className={s.download} onClick={() => void rejoin()} disabled={busy} data-testid="discord-banner-rejoin">
        <RotateCw size={14} /> {t("settings.activity.rejoin")}
      </button>
      <button className={s.close} aria-label={t("chat.attachments.close")} title={t("chat.attachments.close")} onClick={close} data-testid="discord-banner-close"><X size={16} /></button>
    </div>
  );
}
