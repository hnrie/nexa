import { Share2 } from "lucide-react";
import { t } from "@/i18n";
import { touchFirst } from "@/lib/touch";
import { Button } from "./Button";

/**
 * Hands a link to another app through the phone's own share sheet, beside a
 * link's Copy button. Shown only on a touch screen whose browser can share;
 * a share the person backs out of is not an error.
 */
export function ShareLinkButton({ link, title }: { link: string; title: string }) {
  if (!touchFirst() || typeof navigator === "undefined" || typeof navigator.share !== "function") return null;
  return (
    <Button variant="secondary" disabled={!link} aria-label={t("invite.shareLink")} title={t("invite.shareLink")} onClick={() => void navigator.share({ title, url: link }).catch(() => undefined)} data-testid="share-link">
      <Share2 size={16} aria-hidden="true" />
    </Button>
  );
}
