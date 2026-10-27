import { useMediaAnimation } from "@/lib/mediaAnimation";
import { Megaphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import { follows as followsApi } from "@/api/follows";
import type { Follow } from "@/api/types";
import { iconUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { LoadError } from "@/components/common/LoadError";
import { dispatchHooks } from "@/gateway/dispatch";
import type { GatewayEvent } from "@/gateway/events";
import { t } from "@/i18n";
import { forgetFollows } from "@/lib/follows";
import { formatShortDate } from "@/lib/time";
import { useChannels } from "@/stores/channels";
import { useUI } from "@/stores/ui";
import st from "@/components/settings/Settings.module.css";
import s from "@/components/server/pages/Integrations.module.css";

/**
 * The announcement channels a server follows: where each one's posts land,
 * and the way to stop following it.
 */
export function FollowedChannels({ serverId, channelId }: { serverId: string; channelId?: string | undefined }) {
  useMediaAnimation();
  const channels = useChannels((c) => c.byId);
  const [list, setList] = useState<Follow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const all = channelId ? await followsApi.into(channelId) : await followsApi.forServer(serverId);
      setList(all);
    } catch {
      setFailed(true);
    }
  }, [serverId, channelId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const hook = (e: GatewayEvent) => {
      if (e.t === "follows_update" && (!channelId || e.d.channel_id === channelId) && channels[e.d.channel_id]?.server_id === serverId) void load();
    };
    dispatchHooks.onUnhandled.push(hook);
    return () => {
      dispatchHooks.onUnhandled.splice(dispatchHooks.onUnhandled.indexOf(hook), 1);
    };
  }, [serverId, channelId, channels, load]);
  const unfollow = (f: Follow) =>
    useUI.getState().openModal("confirm", {
      title: t("follows.unfollowTitle"),
      body: t("follows.unfollowBody", { source: `${f.source_server_name} #${f.source_channel_name}` }),
      confirmLabel: t("follows.unfollow"),
      danger: true,
      onConfirm: async () => {
        try {
          await followsApi.remove(f.id);
          forgetFollows(f.target_id);
          setList((cur) => cur?.filter((x) => x.id !== f.id) ?? null);
        } catch (err) {
          useUI.getState().toast(err instanceof ApiError ? err.message : t("follows.unfollowFailed"), "error");
        }
      },
    });
  return (
    <>
      <h3 className={st.h5}>{t("follows.followed")}</h3>
      <p className={st.hint} style={{ marginBottom: 10 }}>{t("follows.followedHint")}</p>
      {failed ? <LoadError message={t("follows.loadFailed")} onRetry={() => void load()} /> : null}
      {list && list.length === 0 ? (
        <div className={s.empty}>
          <Megaphone size={24} aria-hidden="true" />
          <span>{t("follows.none")}</span>
        </div>
      ) : null}
      {list?.length ? (
        <div className={s.list} style={{ paddingBottom: 24 }}>
          {list.map((f) => {
            const icon = iconUrl(f.source_server_icon_id, 40);
            return (
              <div key={f.id} className={s.card} data-testid="follow-row">
                <div className={s.head} style={{ cursor: "default" }}>
                  {icon ? <img src={icon} alt="" width={40} height={40} style={{ borderRadius: 12 }} /> : <Megaphone size={22} aria-hidden="true" />}
                  <span className={s.headText}>
                    <span className={s.name} dir="auto">{f.source_server_name} #{f.source_channel_name}</span>
                    <span className={s.meta}>{t("follows.into", { channel: channels[f.target_id]?.name ?? "?", date: formatShortDate(f.created_at) })}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => unfollow(f)}>{t("follows.unfollow")}</Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
