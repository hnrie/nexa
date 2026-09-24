import { MessagesSquare, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/common/Button";
import { t } from "@/i18n";
import { NexaAvatar, OfficialBadge } from "./NexaBits";
import s from "./Nexa.module.css";

/**
 * Nexa's profile. It is not a person: nobody can message, befriend or block
 * it, so it shows what it is and the way to what it has sent.
 */
export function NexaProfile({ variant, onClose }: { variant: string; onClose?: () => void }) {
  const nav = useNavigate();
  return (
    <div className={s.nexaProfile} data-variant={variant} data-testid={`profile-${variant}`}>
      <div className={s.nexaProfileBanner}>
        {onClose && variant !== "panel" ? (
          <button type="button" className={s.nexaProfileClose} onClick={onClose} aria-label={t("chat.attachments.close")}>
            <X size={18} />
          </button>
        ) : null}
      </div>
      <div className={s.nexaProfileAvatar}>
        <NexaAvatar size={variant === "panel" ? 80 : 104} />
      </div>
      <div className={s.nexaProfileBody}>
        <h2 className={s.nexaProfileName}>
          Nexa <OfficialBadge />
        </h2>
        <span className={s.personUser}>@nexa</span>
        <p className={s.nexaProfileAbout}>{t("nexa.profileAbout")}</p>
        <p className={s.nexaProfileFine}>{t("nexa.profileNever")}</p>
        <Button
          size="sm"
          onClick={() => {
            onClose?.();
            nav("/channels/@me/nexa");
          }}
        >
          <MessagesSquare size={16} aria-hidden="true" /> {t("nexa.profileOpen")}
        </Button>
      </div>
    </div>
  );
}
