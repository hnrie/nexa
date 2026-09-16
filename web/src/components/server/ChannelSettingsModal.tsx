import { Hash, Lock, Plus, Trash2, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { servers as serversApi } from "@/api/servers";
import type { Channel, Overwrite } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { Select } from "@/components/common/Select";
import { Field, TextArea, TextInput } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { memberName } from "@/lib/names";
import { P, has, isPrivateChannel, parsePerm, permString } from "@/lib/perms";
import { useChannels } from "@/stores/channels";
import { useKeys } from "@/stores/keys";
import { canI, rolesByPosition, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import st from "@/components/settings/Settings.module.css";
import { OverwriteGrid } from "./PermissionGrid";
import { SaveBar, SettingsLayer, type NavGroup } from "./SettingsLayer";
import s from "./ServerSettings.module.css";

import { t as tr_ } from "@/i18n";
const SLOWMODE = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];

function slowLabel(v: number): string {
  if (v === 0) return "Off";
  if (v < 60) return `${v}s`;
  if (v < 3600) return `${v / 60}m`;
  return `${v / 3600}h`;
}

export default function ChannelSettingsModal({ onClose, channelId, page: initial }: { onClose: () => void; channelId: string; page?: string | undefined }) {
  const channel = useChannels((c) => c.byId[channelId]);
  const [page, setPage] = useState(initial ?? "overview");
  const nav = useNavigate();
  useEffect(() => {
    if (!channel) onClose();
  }, [channel, onClose]);
  if (!channel || !channel.server_id) return null;
  const isCat = channel.type === "category";
  const groups: NavGroup[] = [
    { head: (isCat ? "" : "#") + channel.name, items: [{ id: "overview", label: "Overview" }, { id: "permissions", label: "Permissions" }] },
    { head: "", items: [{ id: "delete", label: isCat ? "Delete Category" : "Delete Channel", danger: true }] },
  ];
  return (
    <SettingsLayer label={tr_("server.channelSettings.channelSettings")} groups={groups} page={page} setPage={setPage} onClose={onClose}>
      {page === "permissions" ? <PermissionsPage channel={channel} serverId={channel.server_id} /> : page === "delete" ? <DeletePage channel={channel} onDone={() => { onClose(); nav(`/channels/${channel.server_id}`); }} /> : <OverviewPage channel={channel} />}
    </SettingsLayer>
  );
}

function OverviewPage({ channel }: { channel: Channel }) {
  const upsert = useChannels((c) => c.upsert);
  const toast = useUI((u) => u.toast);
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [slow, setSlow] = useState(channel.slowmode_seconds);
  const [nsfw, setNsfw] = useState(channel.nsfw);
  const [limit, setLimit] = useState(channel.user_limit);
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setName(channel.name);
    setTopic(channel.topic);
    setSlow(channel.slowmode_seconds);
    setNsfw(channel.nsfw);
    setLimit(channel.user_limit);
  };
  const dirty = name !== channel.name || topic !== channel.topic || slow !== channel.slowmode_seconds || nsfw !== channel.nsfw || limit !== channel.user_limit;
  const save = async () => {
    setBusy(true);
    try {
      const body: Parameters<typeof serversApi.patchChannel>[1] = {};
      if (name !== channel.name) body.name = name;
      if (topic !== channel.topic) body.topic = topic;
      if (slow !== channel.slowmode_seconds) body.slowmode_seconds = slow;
      if (nsfw !== channel.nsfw) body.nsfw = nsfw;
      if (limit !== channel.user_limit) body.user_limit = limit;
      const ch = await serversApi.patchChannel(channel.id, body);
      upsert(ch);
      // the server tidies names and topics (text channel names become lowercase-with-dashes), so show what it kept
      setName(ch.name);
      setTopic(ch.topic);
      setSlow(ch.slowmode_seconds);
      setNsfw(ch.nsfw);
      setLimit(ch.user_limit);
      toast("Channel saved.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save the channel.", "error");
    } finally {
      setBusy(false);
    }
  };
  const isText = channel.type === "text";
  return (
    <>
      <h2 className={st.title}>{tr_("server.channelSettings.overview")}</h2>
      <div className={st.form}>
        <Field label={channel.type === "category" ? "Category name" : "Channel name"} required>
          <div className={s.iconInput}>
            {channel.type === "text" ? <Hash size={16} /> : channel.type === "voice" ? <Volume2 size={16} /> : null}
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} data-testid="channel-settings-name" {...(isText ? { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } : {})} />
          </div>
        </Field>
        {isText ? (
          <Field label={tr_("server.channelSettings.channelTopic")} hint={`${1024 - topic.length} characters left`}>
            <TextArea value={topic} onChange={(e) => setTopic(e.target.value.slice(0, 1024))} placeholder={tr_("server.channelSettings.letEveryoneKnowHowToUse")} maxLength={1024} />
          </Field>
        ) : null}
        {isText ? (
          <Field label={tr_("server.channelSettings.slowmode")} hint={tr_("server.channelSettings.membersWillBeRestrictedToSending")}>
            <Select value={slow} onChange={(e) => setSlow(Number(e.target.value))}>
              {SLOWMODE.map((v) => <option key={v} value={v}>{slowLabel(v)}</option>)}
            </Select>
          </Field>
        ) : null}
        {isText ? <Toggle checked={nsfw} onChange={setNsfw} label={tr_("server.channelSettings.ageRestrictedChannel")} description={tr_("server.channelSettings.usersWillNeedToConfirmThey")} /> : null}
        {channel.type === "voice" ? (
          <Field label={`User limit — ${limit === 0 ? "No limit" : `${limit} users`}`} hint={tr_("server.channelSettings.limitHowManyPeopleCanJoin")}>
            <input type="range" className={st.slider} min={0} max={99} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          </Field>
        ) : null}
      </div>
      <SaveBar dirty={dirty} busy={busy} onReset={reset} onSave={() => void save()} />
    </>
  );
}

type Target = { id: string; type: "role" | "member"; name: string; color?: string | undefined };

function PermissionsPage({ channel, serverId }: { channel: Channel; serverId: string }) {
  const server = useServers((x) => x.byId[serverId]);
  const users = useUsers((u) => u.byId);
  const upsert = useChannels((c) => c.upsert);
  const toast = useUI((u) => u.toast);
  const overwrites = useMemo(() => channel.overwrites ?? [], [channel.overwrites]);
  const [selected, setSelected] = useState<string>(serverId);
  const [adding, setAdding] = useState<"role" | "member" | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = canI(server, P.MANAGE_ROLES, channel.id) || canI(server, P.MANAGE_CHANNELS, channel.id);
  // a selection whose overwrite is gone (removed elsewhere, or never added) falls back to @everyone, like the list does
  const current: Overwrite | undefined = overwrites.find((o) => o.target_id === selected) ?? overwrites.find((o) => o.target_id === serverId);
  const [allow, setAllow] = useState<bigint>(current ? parsePerm(current.allow) : 0n);
  const [deny, setDeny] = useState<bigint>(current ? parsePerm(current.deny) : 0n);
  useEffect(() => {
    const list = channel.overwrites ?? [];
    const cur = list.find((o) => o.target_id === selected) ?? list.find((o) => o.target_id === serverId);
    setAllow(cur ? parsePerm(cur.allow) : 0n);
    setDeny(cur ? parsePerm(cur.deny) : 0n);
  }, [selected, serverId, channel.overwrites]);

  if (!server) return null;
  const targets: Target[] = [];
  const roleOf = (id: string) => server.roles[id];
  targets.push({ id: serverId, type: "role", name: "@everyone" });
  for (const ow of overwrites) {
    if (ow.target_id === serverId) continue;
    if (ow.target_type === "role") {
      const r = roleOf(ow.target_id);
      if (r) targets.push({ id: r.id, type: "role", name: r.name, color: r.color ? `#${r.color.toString(16).padStart(6, "0")}` : undefined });
    } else {
      const m = server.members[ow.target_id];
      targets.push({ id: ow.target_id, type: "member", name: memberName(m?.nickname, users[ow.target_id]) });
    }
  }
  const selectedTarget = targets.find((t) => t.id === selected) ?? targets[0]!;
  const dirty = allow !== (current ? parsePerm(current.allow) : 0n) || deny !== (current ? parsePerm(current.deny) : 0n);
  const isPrivate = isPrivateChannel(serverId, overwrites);
  const wantPrivate = selectedTarget.id === serverId ? has(deny, P.VIEW_CHANNEL) : isPrivate;

  const refresh = async () => upsert(await serversApi.channels(serverId));

  const save = async (a = allow, d = deny, targetId = selectedTarget.id, type = selectedTarget.type): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await serversApi.putOverwrite(channel.id, targetId, { type, allow: permString(a & ~d), deny: permString(d) });
      await refresh();
      if (res.key_actions?.needs_own_key) {
        // the channel just became private: give it its own key so only its viewers ever hold one
        await useKeys.getState().ensureConvKey(channel.id);
        await refresh();
      }
      toast("Permissions saved.", "success");
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save permissions.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const remove = async (targetId: string) => {
    setBusy(true);
    try {
      await serversApi.deleteOverwrite(channel.id, targetId);
      await refresh();
      if (selected === targetId) setSelected(serverId);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not remove the overwrite.", "error");
    } finally {
      setBusy(false);
    }
  };
  const add = async (targetId: string, type: "role" | "member") => {
    setAdding(null);
    setQuery("");
    // a private channel's new target starts with View Channel allowed, so adding someone actually lets them in
    const a = isPrivate ? P.VIEW_CHANNEL : 0n;
    if (await save(a, 0n, targetId, type)) setSelected(targetId);
  };

  const candidateRoles = rolesByPosition(server).filter((r) => r.id !== serverId && !overwrites.some((o) => o.target_id === r.id));
  const q = query.trim().toLowerCase();
  const candidateMembers = Object.values(server.members)
    .filter((m) => !overwrites.some((o) => o.target_id === m.user_id))
    .map((m) => ({ id: m.user_id, name: memberName(m.nickname, users[m.user_id]), username: users[m.user_id]?.username ?? "" }))
    .filter((m) => !q || m.name.toLowerCase().includes(q) || m.username.includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 12);

  return (
    <>
      <h2 className={st.title}>{tr_("server.channelSettings.permissions")}</h2>
      <p className={st.hint}>Use permissions to customise who can do what in this {channel.type === "category" ? "category" : "channel"}. {isPrivate ? "This channel is private: only the roles and members listed here can see it, and it has its own encryption key." : ""}</p>
      <div className={s.permLayout}>
        <div className={s.permList}>
          <div className={s.permListHead}>
            <span>{tr_("server.channelSettings.rolesMembers")}</span>
            {editable ? (
              <span className={s.permAdd}>
                <button className={s.smallBtn} onClick={() => setAdding(adding === "role" ? null : "role")} title={tr_("server.channelSettings.addRole")}><Plus size={14} /> {tr_("server.channelSettings.role")}</button>
                <button className={s.smallBtn} onClick={() => setAdding(adding === "member" ? null : "member")} title={tr_("server.channelSettings.addMember")}><Plus size={14} /> {tr_("server.channelSettings.member")}</button>
              </span>
            ) : null}
          </div>
          {adding === "role" ? (
            <div className={s.picker}>
              {candidateRoles.length === 0 ? <div className={s.pickerEmpty}>{tr_("server.channelSettings.everyRoleAlreadyHasAnOverwrite")}</div> : null}
              {candidateRoles.map((r) => (
                <button key={r.id} className={s.pickerRow} onClick={() => void add(r.id, "role")}>
                  <span className={s.dot} style={{ background: r.color ? `#${r.color.toString(16).padStart(6, "0")}` : "var(--text-muted)" }} />
                  {r.name}
                </button>
              ))}
            </div>
          ) : null}
          {adding === "member" ? (
            <div className={s.picker}>
              <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr_("server.channelSettings.searchMembers")} autoFocus />
              {candidateMembers.map((m) => (
                <button key={m.id} className={s.pickerRow} onClick={() => void add(m.id, "member")}>
                  <Avatar id={m.id} avatarId={users[m.id]?.avatar_id ?? null} name={m.name} size={20} />
                  <span>{m.name}</span>
                  <span className={s.muted}>@{m.username}</span>
                </button>
              ))}
            </div>
          ) : null}
          {targets.map((t) => (
            <div key={t.id} className={s.permTarget} data-selected={t.id === selectedTarget.id}>
              <button className={s.permTargetBtn} onClick={() => setSelected(t.id)} data-target={t.id}>
                {t.type === "role" ? <span className={s.dot} style={{ background: t.color ?? "var(--text-muted)" }} /> : <Avatar id={t.id} avatarId={users[t.id]?.avatar_id ?? null} name={t.name} size={20} />}
                <span className={s.permTargetName}>{t.name}</span>
              </button>
              {editable && t.id !== serverId ? (
                <button className={s.permRemove} aria-label={tr_("server.channelSettings.removeOverwrite")} onClick={() => void remove(t.id)} disabled={busy}><X size={14} /></button>
              ) : null}
            </div>
          ))}
        </div>
        <div className={s.permEditor}>
          {selectedTarget.id === serverId ? (
            <div className={s.privateRow}>
              <Toggle
                checked={wantPrivate}
                disabled={!editable}
                onChange={(on) => {
                  if (on) setDeny(deny | P.VIEW_CHANNEL), setAllow(allow & ~P.VIEW_CHANNEL);
                  else setDeny(deny & ~P.VIEW_CHANNEL);
                }}
                label={tr_("modals.createChannel.privateChannel")}
                description={tr_("server.channelSettings.onlySelectedMembersAndRolesCan")}
              />
              {wantPrivate ? <span className={s.lockNote}><Lock size={14} /> {tr_("server.channelSettings.addRolesOrMembersOnThe")}</span> : null}
            </div>
          ) : null}
          <OverwriteGrid allow={allow} deny={deny} editable={editable} channelType={channel.type as "text" | "voice" | "category"} onChange={(a, d) => { setAllow(a); setDeny(d); }} />
          <SaveBar dirty={dirty} busy={busy} onReset={() => { setAllow(current ? parsePerm(current.allow) : 0n); setDeny(current ? parsePerm(current.deny) : 0n); }} onSave={() => void save()} />
        </div>
      </div>
    </>
  );
}

function DeletePage({ channel, onDone }: { channel: Channel; onDone: () => void }) {
  const remove = useChannels((c) => c.remove);
  const toast = useUI((u) => u.toast);
  const [busy, setBusy] = useState(false);
  const isCat = channel.type === "category";
  const go = async () => {
    setBusy(true);
    try {
      await serversApi.deleteChannel(channel.id);
      remove(channel.id);
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete.", "error");
      setBusy(false);
    }
  };
  return (
    <>
      <h2 className={st.title}>{isCat ? "Delete Category" : "Delete Channel"}</h2>
      <p className={st.hint}>{isCat ? `Deleting '${channel.name}' keeps the channels inside it; they move to the top of the channel list.` : `Are you sure you want to delete #${channel.name}? Every message in it is deleted for everyone. This cannot be undone.`}</p>
      <div style={{ marginTop: 24 }}>
        <Button variant="danger" loading={busy} onClick={() => void go()} data-testid="delete-channel"><Trash2 size={16} /> {isCat ? "Delete Category" : "Delete Channel"}</Button>
      </div>
    </>
  );
}
