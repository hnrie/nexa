import { LockOpen, Webhook } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@/components/common/Avatar";
import { Tooltip } from "@/components/common/Tooltip";
import { portalRoot } from "@/hooks/usePortalRoot";
import { useMediaSrc } from "@/lib/mediaLinks";
import type { HookContent } from "@/lib/webhookMessage";
import s from "./Webhook.module.css";

import { t } from "@/i18n";

/**
 * A webhook message's picture: the one it was sent with, through the media
 * proxy; else the webhook's own; else the letters of its name, as anyone
 * without a picture gets.
 */
export function HookAvatar({ hook, webhookId, size = 40 }: { hook: HookContent; webhookId: string; size?: number }) {
  const src = useMediaSrc(hook.avatar_proxy_url);
  const [broken, setBroken] = useState(false);
  if (hook.avatar_proxy_url && src && !broken) {
    return <img className={s.avatarImg} style={{ width: size, height: size }} src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(true)} />;
  }
  if (hook.avatar_proxy_url && src === undefined) {
    return <span className={s.avatarImg} style={{ width: size, height: size, display: "block" }} aria-hidden="true" />;
  }
  return <Avatar id={webhookId} avatarId={hook.avatar_id ?? null} name={hook.name} size={size} />;
}

/**
 * The tag beside a webhook's or an app's name, and the mark that says its
 * messages are not end-to-end encrypted.
 */
export function HookTags({ app = false }: { app?: boolean }) {
  const hint = app ? t("apps.notEncryptedHint") : t("webhook.notEncryptedHint");
  return (
    <>
      <span className={s.appTag} data-testid={app ? "app-tag" : "webhook-tag"}>{t("webhook.appTag")}</span>
      <Tooltip text={hint} side="top">
        <span className={s.plainIcon} tabIndex={0} role="img" aria-label={hint} data-testid="webhook-plain">
          <LockOpen size={14} />
        </span>
      </Tooltip>
    </>
  );
}

const GAP = 8;

/**
 * What a click on a webhook's name or picture opens: there is no person to
 * show a profile of, so a card says what the sender is, and that what it posts
 * is not end-to-end encrypted.
 */
export function HookPopout({ hook, webhookId, anchor, onClose }: { hook: HookContent; webhookId: string; anchor: HTMLElement; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const reposition = useCallback(() => {
    const box = card.current?.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    if (!box) return;
    if (!anchor.isConnected || a.bottom < 0 || a.top > window.innerHeight) {
      onClose();
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // beside the name where there is room, else below it
    let left = a.right + GAP;
    let top = a.top;
    if (left + box.width > vw - 4) {
      left = a.left;
      top = a.bottom + GAP;
    }
    setAt({ left: Math.max(4, Math.min(left, vw - box.width - 4)), top: Math.max(4, Math.min(top, vh - box.height - 4)) });
  }, [anchor, onClose]);
  useLayoutEffect(reposition, [reposition]);
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
    const down = (e: PointerEvent) => {
      const target = e.target as Node;
      if (card.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor, onClose, reposition]);
  return createPortal(
    <div ref={card} className={s.popout} role="dialog" aria-label={hook.name} tabIndex={-1} data-testid="webhook-popout" style={at ? { left: at.left, top: at.top } : { left: -9999, top: -9999 }}>
      <div className={s.popHead}>
        <HookAvatar hook={hook} webhookId={webhookId} size={56} />
        <div className={s.popNameRow}>
          <span className={s.popName} dir="auto">{hook.name}</span>
          <span className={s.appTag}>{t("webhook.appTag")}</span>
        </div>
      </div>
      <div className={s.popBody}>{hook.source === "github" ? t("webhook.popoutGitHub") : t("webhook.popoutBody")}</div>
      <div className={s.popNote}>
        <LockOpen size={16} />
        <span>{t("webhook.popoutNotEncrypted")}</span>
      </div>
      <div className={s.popNote}>
        <Webhook size={16} />
        <span>{t("webhook.popoutManage")}</span>
      </div>
    </div>,
    portalRoot(),
  );
}
