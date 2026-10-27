import { useMediaAnimation } from "@/lib/mediaAnimation";
import { Sparkles } from "lucide-react";
import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { servers as serversApi } from "@/api/servers";
import type { ServerTagPreview, WornTag } from "@/api/types";
import { bannerUrl, iconUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { Popout } from "@/components/common/Popout";
import { Spinner } from "@/components/common/Spinner";
import { InviteView, type InviteTarget } from "@/components/invite/InviteView";
import { t } from "@/i18n";
import { acceptInvite } from "@/lib/joinInvite";
import { describeError } from "@/lib/errors";
import { tagColorCss, tagIcon, tagImageUrl } from "@/lib/serverTags";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import s from "./ServerTag.module.css";

type Size = "sm" | "md" | "lg";
const BADGE_PX: Record<Size, number> = { sm: 10, md: 12, lg: 18 };

/** A tag's badge: one of the icons every server has, or the server's own picture. */
export function TagBadge({ badge, size }: { badge: string; size: Size }) {
  const [failed, setFailed] = useState(false);
  const url = tagImageUrl(badge, BADGE_PX[size]);
  if (url && !failed) {
    return (
      <span className={s.badge} aria-hidden="true">
        <img className={s.badgeImg} src={url} alt="" draggable={false} onError={() => setFailed(true)} />
      </span>
    );
  }
  // a picture that has gone, or a badge from a newer app, falls back to the sparkle every tag starts with
  const Icon = tagIcon(badge) ?? Sparkles;
  return (
    <span className={s.badge} aria-hidden="true">
      <Icon />
    </span>
  );
}

/**
 * A server tag beside someone's name. With `open` it is a button: pressed, it
 * shows the server the tag is from.
 */
export function ServerTagChip({ tag, size = "md", open = true }: { tag: Pick<WornTag, "text" | "badge" | "color"> & { server_id?: string }; size?: Size; open?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const style = { "--tag": tagColorCss(tag.color) } as CSSProperties;
  const label = t("serverTag.chipLabel", { tag: tag.text });
  const content = (
    <>
      <TagBadge badge={tag.badge} size={size} />
      <span className={s.text} dir="auto">{tag.text}</span>
    </>
  );
  if (!open || !tag.server_id) {
    return (
      <span className={s.chip} data-size={size} style={style} title={label} data-testid="server-tag">
        {content}
      </span>
    );
  }
  const serverId = tag.server_id;
  return (
    <>
      <button
        type="button"
        className={s.chip}
        data-size={size}
        style={style}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(e: MouseEvent<HTMLButtonElement>) => {
          // inside a message or a list row, the press is the tag's alone
          e.stopPropagation();
          setAnchor(anchor ? null : e.currentTarget);
        }}
        data-testid="server-tag"
      >
        {content}
      </button>
      {anchor ? <ServerTagPopout serverId={serverId} tag={tag} anchor={anchor} onClose={() => setAnchor(null)} /> : null}
    </>
  );
}

/** What a server's tag looked like the last time it was asked for, for a minute. */
const previews = new Map<string, { at: number; data: Promise<ServerTagPreview | null> }>();
function loadPreview(id: string, fresh = false): Promise<ServerTagPreview | null> {
  const hit = previews.get(id);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.data;
  const data = serversApi.tagPreview(id).catch(() => {
    previews.delete(id);
    return null;
  });
  previews.set(id, { at: Date.now(), data });
  return data;
}

/**
 * The server a tag is from, drawn as an invite draws one: its banner, its
 * name, who is here and what it is about. From there a member goes to it and
 * can put its tag on, and anyone else joins, when the server lets people
 * join from its tag.
 */
function ServerTagPopout({ serverId, tag, anchor, onClose }: { serverId: string; tag: Pick<WornTag, "text" | "badge" | "color">; anchor: HTMLElement; onClose: () => void }) {
  useMediaAnimation();
  const nav = useNavigate();
  const toast = useUI((u) => u.toast);
  const me = useAuth((a) => a.me);
  const setMe = useAuth((a) => a.setMe);
  const [preview, setPreview] = useState<ServerTagPreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadPreview(serverId).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [serverId]);
  const wearing = me?.server_tag?.server_id === serverId;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(describeError(err, t("serverTag.couldNotChange")), "error");
    } finally {
      setBusy(false);
    }
  };
  const wear = (on: boolean) =>
    run(async () => {
      setMe(await serversApi.wearTag(on ? serverId : null));
      toast(on ? t("serverTag.nowWearing", { tag: tag.text }) : t("serverTag.tookOff"), "success");
    });
  const join = (code: string) =>
    run(async () => {
      const to = await acceptInvite(code, "");
      onClose();
      nav(to);
    });

  let body: React.ReactNode;
  if (preview === undefined) {
    body = (
      <div className={s.pending}>
        <Spinner label={t("chat.pins.loading")} />
      </div>
    );
  } else if (preview === null) {
    body = <p className={s.gone}>{t("serverTag.gone")}</p>;
  } else {
    const sv = preview.server;
    const target: InviteTarget = { kind: "server", id: sv.id, name: sv.name, description: sv.description, icon: iconUrl(sv.icon_id, 56), banner: bannerUrl(sv.banner_id, 432), online: sv.online_count, members: sv.member_count };
    const action = preview.member ? (
      preview.can_wear && !wearing ? (
        <Button size="sm" loading={busy} onClick={() => void wear(true)} data-testid="tag-wear">{t("serverTag.wear")}</Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => { onClose(); nav(`/channels/${sv.id}`); }}>{t("serverTag.goToServer")}</Button>
      )
    ) : preview.invite ? (
      <Button size="sm" variant="positive" loading={busy} onClick={() => void join(preview.invite!)} data-testid="tag-join">{t("invite.joinServer")}</Button>
    ) : null;
    body = (
      <InviteView target={target} variant="card" lead={<span className={s.lead}><ServerTagChip tag={preview.tag} size="lg" open={false} /></span>} actions={action}>
        {wearing ? (
          <p className={s.wearing}>
            <span>{t("serverTag.youWearIt")}</span>
            <button type="button" className={s.linkBtn} onClick={() => void wear(false)} disabled={busy}>{t("serverTag.takeOff")}</button>
          </p>
        ) : !preview.member && !preview.invite ? (
          <p className={s.wearing}>{t("serverTag.notJoinable")}</p>
        ) : preview.member && preview.can_wear === false ? (
          <p className={s.wearing}>{t("serverTag.keptToRoles")}</p>
        ) : null}
      </InviteView>
    );
  }
  return (
    <Popout anchor={anchor} onClose={onClose} label={t("serverTag.popoutLabel", { tag: tag.text })} className={s.pop} prefer="below" testId="tag-popout">
      {body}
    </Popout>
  );
}

/** Forgets what a server's tag looked like, after it changed here. */
export function forgetTagPreview(serverId: string): void {
  previews.delete(serverId);
}
