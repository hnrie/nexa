import { Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "@/components/common/Spinner";
import { lazyPage } from "@/lib/lazyChunk";
import { P } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { canI, useServers } from "@/stores/servers";
import { useChannels } from "@/stores/channels";
import { SettingsLayer, type NavGroup } from "./SettingsLayer";

import { t } from "@/i18n";
const OverviewPage = lazyPage(() => import("./pages/ServerOverviewPage"));
const ServerTagPage = lazyPage(() => import("./pages/ServerTagPage"));
const RolesPage = lazyPage(() => import("./pages/RolesPage"));
const MembersPage = lazyPage(() => import("./pages/MembersPage"));
const BansPage = lazyPage(() => import("./pages/BansPage"));
const InvitesPage = lazyPage(() => import("./pages/InvitesPage"));
const AuditLogPage = lazyPage(() => import("./pages/AuditLogPage"));
const EncryptionPage = lazyPage(() => import("./pages/EncryptionPage"));
const EmojiPage = lazyPage(() => import("./pages/EmojiPage"));
const ServerStickersPage = lazyPage(() => import("./pages/ServerStickersPage"));
const IntegrationsPage = lazyPage(() => import("./pages/IntegrationsPage"));
const DeleteServerPage = lazyPage(() => import("./pages/DeleteServerPage"));
const AutomodPage = lazyPage(() => import("./pages/automod/AutomodPage"));
const DiscoverySettingsPage = lazyPage(() => import("./pages/DiscoverySettingsPage"));
const SafetyPage = lazyPage(() => import("./pages/SafetyPage"));

export default function ServerSettingsModal({ onClose, serverId, page: initial }: { onClose: () => void; serverId: string; page?: string | undefined }) {
  const st = useServers((x) => x.byId[serverId]);
  const meId = useAuth((a) => a.me?.id);
  const nav = useNavigate();
  const owner = !!st && st.server.owner_id === meId;
  const pages: { id: string; label: string; ok: boolean; group: number; danger?: boolean }[] = [
    { id: "overview", label: t("server.channelSettings.overview"), ok: canI(st, P.MANAGE_SERVER), group: 0 },
    { id: "tag", label: t("serverTag.page.title"), ok: canI(st, P.MANAGE_SERVER), group: 0 },
    { id: "roles", label: t("server.members.roles"), ok: canI(st, P.MANAGE_ROLES), group: 0 },
    { id: "emoji", label: t("modals.customStatus.emoji"), ok: true, group: 0 },
    { id: "stickers", label: t("pickers.expressionPicker.stickers"), ok: true, group: 0 },
    // its apps for whoever manages the server, its webhooks for whoever manages them somewhere
    { id: "integrations", label: t("integrations.title"), ok: canI(st, P.MANAGE_SERVER) || canI(st, P.MANAGE_WEBHOOKS) || Object.values(useChannels.getState().byId).some((c) => c.server_id === serverId && c.type === "text" && canI(st, P.MANAGE_WEBHOOKS, c.id)), group: 0 },
    { id: "encryption", label: t("server.encryption.encryption"), ok: true, group: 0 },
    { id: "discovery", label: t("discovery.title"), ok: canI(st, P.MANAGE_SERVER), group: 0 },
    { id: "members", label: t("server.serverSettings.members"), ok: true, group: 1 },
    { id: "invites", label: t("server.invites.invites"), ok: canI(st, P.MANAGE_SERVER), group: 1 },
    { id: "bans", label: t("server.serverSettings.bans"), ok: canI(st, P.BAN_MEMBERS), group: 1 },
    { id: "automod", label: t("automod.title"), ok: canI(st, P.MANAGE_SERVER) || canI(st, P.VIEW_AUDIT_LOG), group: 1 },
    { id: "safety", label: t("safety.title"), ok: canI(st, P.MANAGE_SERVER), group: 1 },
    { id: "audit", label: t("server.auditLog.auditLog"), ok: canI(st, P.VIEW_AUDIT_LOG), group: 1 },
    { id: "delete", label: t("server.deleteServer.deleteServer"), ok: owner, group: 2, danger: true },
  ];
  const allowed = pages.filter((p) => p.ok);
  const [page, setPage] = useState(initial && allowed.some((p) => p.id === initial) ? initial : (allowed[0]?.id ?? "members"));
  useEffect(() => {
    if (!st) onClose();
  }, [st, onClose]);
  if (!st) return null;
  const groups: NavGroup[] = [
    { head: st.server.name, items: allowed.filter((p) => p.group === 0).map((p) => ({ id: p.id, label: p.label })) },
    { head: t("server.serverSettings.moderation"), items: allowed.filter((p) => p.group === 1).map((p) => ({ id: p.id, label: p.label })) },
  ];
  if (owner) groups.push({ head: "", items: [{ id: "delete", label: t("server.deleteServer.deleteServer"), danger: true }] });
  const body =
    page === "overview" ? <OverviewPage serverId={serverId} /> :
    page === "tag" ? <ServerTagPage serverId={serverId} /> :
    page === "roles" ? <RolesPage serverId={serverId} /> :
    page === "members" ? <MembersPage serverId={serverId} /> :
    page === "bans" ? <BansPage serverId={serverId} /> :
    page === "invites" ? <InvitesPage serverId={serverId} /> :
    page === "audit" ? <AuditLogPage serverId={serverId} /> :
    page === "automod" ? <AutomodPage serverId={serverId} /> :
    page === "discovery" ? <DiscoverySettingsPage serverId={serverId} /> :
    page === "safety" ? <SafetyPage serverId={serverId} go={setPage} /> :
    page === "emoji" ? <EmojiPage serverId={serverId} /> :
    page === "stickers" ? <ServerStickersPage serverId={serverId} /> :
    page === "integrations" ? <IntegrationsPage serverId={serverId} /> :
    page === "delete" ? <DeleteServerPage serverId={serverId} onDone={() => { onClose(); nav("/channels/@me"); }} /> :
    <EncryptionPage serverId={serverId} />;
  return (
    <SettingsLayer label={t("server.serverSettings.serverSettings")} groups={groups} page={page} setPage={setPage} onClose={onClose} startOnList={!initial}>
      {/* A blank panel on a slow link is indistinguishable from a crash. */}
      <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner label={t("chat.pins.loading")} /></div>}>{body}</Suspense>
    </SettingsLayer>
  );
}
