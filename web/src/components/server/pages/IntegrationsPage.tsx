import { PersonName } from "@/components/common/PersonName";
import { FollowedChannels } from "@/components/follows/FollowedChannels";
import { ChevronDown, ChevronRight, Copy, LockOpen, Plus, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { webhooks as webhooksApi, type WebhookPatch } from "@/api/webhooks";
import type { Webhook } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { ImageCropModal } from "@/components/common/ImageCropModal";
import { LoadError } from "@/components/common/LoadError";
import { Select } from "@/components/common/Select";
import { Spinner } from "@/components/common/Spinner";
import { Field, TextInput } from "@/components/common/TextInput";
import { dispatchHooks } from "@/gateway/dispatch";
import type { GatewayEvent } from "@/gateway/events";
import { copyAndSay } from "@/lib/copyText";
import { describeError } from "@/lib/errors";
import { P } from "@/lib/perms";
import { formatShortDate } from "@/lib/time";
import { useChannels } from "@/stores/channels";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import st from "@/components/settings/Settings.module.css";
import { isolate } from "../bidi";
import { SaveBar } from "../SettingsLayer";
import s from "./Integrations.module.css";
import { AppsSection } from "./AppsSection";

import { t, Tr } from "@/i18n";

/** What someone changed on one webhook and has not saved. */
interface Draft {
  name?: string;
  channel?: string;
  /** Image data for a new picture, or null to take the picture away. */
  avatar?: string | null;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

/** A name for a new webhook that none of the others has yet: "Webhook", "Webhook 2", ... */
export function freshName(base: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/**
 * Server settings, Integrations: the server's webhooks, or with a channel
 * only that channel's (channel settings). A webhook is a secret link other
 * programs post messages to: each can be named, given a picture, moved to
 * another channel, have its link copied, or be deleted. Only channels where
 * this account may manage webhooks are listed.
 */
export default function IntegrationsPage({ serverId, channelId }: { serverId: string; channelId?: string }) {
  const server = useServers((x) => x.byId[serverId]);
  const channels = useChannels((c) => c.byId);
  const users = useUsers((u) => u.byId);
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const [list, setList] = useState<Webhook[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [crop, setCrop] = useState<{ id: string; file: File } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickFor = useRef<string | null>(null);

  // the text channels this account may put a webhook in
  const targets = useMemo(
    () =>
      Object.values(channels)
        .filter((c) => c.server_id === serverId && c.type === "text" && canI(server, P.MANAGE_WEBHOOKS, c.id))
        .sort((a, b) => a.position - b.position),
    [channels, serverId, server],
  );

  // the server's apps are its managers'; webhooks are for whoever may manage them in some channel
  const manageApps = !channelId && canI(server, P.MANAGE_SERVER);
  const manageHooks = !!channelId || canI(server, P.MANAGE_WEBHOOKS) || targets.length > 0;

  const load = useCallback(async () => {
    try {
      const got = channelId ? await webhooksApi.forChannel(channelId) : await webhooksApi.forServer(serverId);
      setList(got);
      setFailed(false);
    } catch {
      setList(null);
      setFailed(true);
    }
  }, [serverId, channelId]);

  useEffect(() => {
    if (!manageHooks) return;
    void load();
    const hook = (e: GatewayEvent) => {
      if (e.t === "webhooks_update" && e.d.server_id === serverId) void load();
    };
    dispatchHooks.onUnhandled.push(hook);
    return () => {
      dispatchHooks.onUnhandled.splice(dispatchHooks.onUnhandled.indexOf(hook), 1);
    };
  }, [load, serverId, attempt, manageHooks]);

  const create = async () => {
    const target = channelId ?? targets[0]?.id;
    if (!target) return;
    setCreating(true);
    try {
      const made = await webhooksApi.create(target, freshName(t("integrations.defaultName"), (list ?? []).map((w) => w.name)));
      setList((cur) => [...(cur ?? []), made]);
      setOpen(made.id);
      toast(t("integrations.created", { name: made.name }), "success");
    } catch (err) {
      toast(describeError(err, t("integrations.couldNotCreate")), "error");
    } finally {
      setCreating(false);
    }
  };

  const dirtyIds = Object.keys(drafts).filter((id) => {
    const d = drafts[id]!;
    const w = list?.find((x) => x.id === id);
    if (!w) return false;
    return (d.name !== undefined && d.name.trim() !== w.name) || (d.channel !== undefined && d.channel !== w.channel_id) || d.avatar !== undefined;
  });

  const save = async () => {
    setBusy(true);
    try {
      for (const id of dirtyIds) {
        const d = drafts[id]!;
        const w = list!.find((x) => x.id === id)!;
        const patch: WebhookPatch = {};
        if (d.name !== undefined && d.name.trim() !== w.name) patch.name = d.name.trim();
        if (d.channel !== undefined && d.channel !== w.channel_id) patch.channel_id = d.channel;
        if (d.avatar !== undefined) patch.avatar = d.avatar;
        const updated = await webhooksApi.update(id, patch);
        // one moved out of the channel on show here goes from the list
        setList((cur) => (channelId && updated.channel_id !== channelId ? (cur ?? []).filter((x) => x.id !== id) : (cur ?? []).map((x) => (x.id === id ? updated : x))));
        setDrafts((cur) => {
          const next = { ...cur };
          delete next[id];
          return next;
        });
      }
      toast(t("integrations.saved"), "success");
    } catch (err) {
      toast(describeError(err, t("integrations.couldNotSave")), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = (w: Webhook) =>
    openModal("confirm", {
      title: t("integrations.deleteTitle", { name: w.name }),
      body: t("integrations.deleteBody"),
      confirmLabel: t("integrations.deleteWebhook"),
      danger: true,
      onConfirm: async () => {
        await webhooksApi.remove(w.id);
        setList((cur) => (cur ?? []).filter((x) => x.id !== w.id));
        setDrafts((cur) => {
          const next = { ...cur };
          delete next[w.id];
          return next;
        });
      },
    });

  const edit = (id: string, patch: Draft) => setDrafts((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));

  const canCreate = channelId ? targets.some((c) => c.id === channelId) : targets.length > 0;

  return (
    <>
      <h2 className={st.title}>{t("integrations.title")}</h2>
      {manageApps ? <AppsSection serverId={serverId} /> : null}
      {manageHooks ? (
        <>
          <h3 className={st.h5}>{t("integrations.webhooks")}</h3>
          <p className={st.hint} style={{ marginTop: -6 }}>{t("integrations.intro")}</p>
          <div className={s.notice}>
            <LockOpen size={16} aria-hidden="true" />
            <span>{t("integrations.notEncrypted")}</span>
          </div>
          <div className={s.bar}>
            <Button size="sm" onClick={() => void create()} loading={creating} disabled={!canCreate} data-testid="webhook-new">
              <Plus size={16} /> {t("integrations.newWebhook")}
            </Button>
          </div>
          {list === null && !failed ? <Spinner label={t("integrations.loading")} /> : null}
          {failed ? <LoadError message={t("integrations.couldNotLoad")} onRetry={() => setAttempt((n) => n + 1)} /> : null}
          {list && list.length === 0 ? (
            <div className={s.empty}>
              <WebhookIcon size={28} aria-hidden="true" />
              <span>{t("integrations.none")}</span>
            </div>
          ) : null}
          <div className={s.list}>
            {list?.map((w) => {
              const d = drafts[w.id] ?? {};
              const expanded = open === w.id;
              const name = d.name ?? w.name;
              const channel = d.channel ?? w.channel_id;
              const creator = w.user ? (users[w.user.id] ? displayName(users[w.user.id]) : w.user.display_name || w.user.username) : null;
              const avatarPreview = d.avatar === undefined ? null : d.avatar;
              return (
                <div key={w.id} className={s.card} data-open={expanded} data-testid="webhook-card">
                  <button type="button" className={s.head} onClick={() => setOpen(expanded ? null : w.id)} aria-expanded={expanded}>
                    {avatarPreview ? <img className={s.avatar} src={avatarPreview} alt="" /> : d.avatar === null ? <Avatar id={w.id} avatarId={null} name={name} size={40} /> : <Avatar id={w.id} avatarId={w.avatar} name={name} size={40} />}
                    <span className={s.headText}>
                      <span className={s.name} dir="auto">{name}</span>
                      <span className={s.meta}>
                        {channels[w.channel_id] ? <bdi>#{channels[w.channel_id]!.name}</bdi> : null}
                        {creator ? <> · {<Tr id="integrations.createdBy" values={{ name: <PersonName user={w.user}>{creator}</PersonName>, date: formatShortDate(w.created_at) }} />}</> : <> · {t("integrations.createdOn", { date: formatShortDate(w.created_at) })}</>}
                      </span>
                    </span>
                    {expanded ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
                  </button>
                  {expanded ? (
                    <div className={s.body}>
                      <div className={s.avatarCol}>
                        {avatarPreview ? <img className={s.bigAvatar} src={avatarPreview} alt="" /> : <Avatar id={w.id} avatarId={d.avatar === null ? null : w.avatar} name={name} size={80} />}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            pickFor.current = w.id;
                            fileRef.current?.click();
                          }}
                        >
                          {t("integrations.uploadImage")}
                        </Button>
                        {(w.avatar && d.avatar !== null) || avatarPreview ? (
                          <Button size="sm" variant="ghost" onClick={() => edit(w.id, { avatar: w.avatar ? null : undefined })}>{t("integrations.removeImage")}</Button>
                        ) : null}
                      </div>
                      <div className={s.fields}>
                        <Field label={t("integrations.name")} required>
                          <TextInput value={name} maxLength={80} onChange={(e) => edit(w.id, { name: e.target.value })} data-testid="webhook-name" />
                        </Field>
                        {channelId ? null : (
                          <Field label={t("integrations.channel")}>
                            <Select value={channel} onChange={(e) => edit(w.id, { channel: e.target.value })} data-testid="webhook-channel">
                              {!targets.some((c) => c.id === channel) && channels[channel] ? <option value={channel}>{isolate(`#${channels[channel]!.name}`)}</option> : null}
                              {targets.map((c) => (
                                <option key={c.id} value={c.id}>{isolate(`#${c.name}`)}</option>
                              ))}
                            </Select>
                          </Field>
                        )}
                        <div className={s.actions}>
                          <Button size="sm" variant="secondary" disabled={!w.url} onClick={() => w.url && copyAndSay(w.url, t("integrations.urlCopied"))} data-testid="webhook-copy">
                            <Copy size={15} /> {t("integrations.copyUrl")}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => remove(w)} data-testid="webhook-delete">
                            <Trash2 size={15} /> {t("integrations.deleteWebhook")}
                          </Button>
                        </div>
                        <p className={s.tip}>{t("integrations.formatsTip")}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              const id = pickFor.current;
              if (f && id) setCrop({ id, file: f });
              e.target.value = "";
            }}
          />
          {crop ? (
            <ImageCropModal
              file={crop.file}
              aspect={1}
              round
              maxSize={512}
              title={t("integrations.cropImage")}
              onClose={() => setCrop(null)}
              onDone={({ blob }) => {
                const id = crop.id;
                setCrop(null);
                void blobToDataURL(blob).then((data) => edit(id, { avatar: data }));
              }}
            />
          ) : null}
          <FollowedChannels serverId={serverId} channelId={channelId} />
        </>
      ) : null}
      <SaveBar
        dirty={dirtyIds.length > 0}
        busy={busy}
        onReset={() => setDrafts({})}
        onSave={() => {
          if (dirtyIds.some((id) => !(drafts[id]?.name ?? "x").trim())) {
            toast(t("integrations.nameRequired"), "error");
            return;
          }
          void save();
        }}
      />
    </>
  );
}
