import { Star } from "lucide-react";
import type { AttachmentMeta } from "@/crypto/message";
import { toggleFavoriteGif } from "@/lib/gifFavorites";
import { mediaKey } from "@/lib/mediaLinks";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import s from "./Embeds.module.css";

import { t } from "@/i18n";
/**
 * The favourite star over a GIF. For link embeds it saves the proxied URL;
 * for uploads `att` carries the encrypted file instead and `url` is only its
 * `attach:<blob_id>` identity.
 */
export function FavoriteButton({ url, w, h, att, className }: { url: string; w?: number; h?: number; att?: AttachmentMeta; className?: string }) {
  const on = useSettings((st) => st.settings.favoriteGifs.some((f) => mediaKey(f.url) === mediaKey(url)));
  const toast = useUI((u) => u.toast);
  return (
    <button
      className={className ?? s.star}
      data-on={on}
      title={on ? t("chat.embeds.removeFromFavorites") : t("chat.embeds.addToFavorites")}
      aria-label={on ? t("chat.embeds.removeFromFavorites") : t("chat.embeds.addToFavorites")}
      onClick={(e) => {
        e.stopPropagation();
        const now = toggleFavoriteGif({ url, ...(w ? { w } : {}), ...(h ? { h } : {}), ...(att ? { att } : {}) });
        toast(now ? t("chat.embeds.addedToYourGifFavorites") : t("chat.embeds.removedFromFavorites"), "success");
      }}
    >
      <Star size={16} fill={on ? "currentColor" : "none"} />
    </button>
  );
}
