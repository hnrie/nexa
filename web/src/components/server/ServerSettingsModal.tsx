import { Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { lazyPage } from "@/lib/lazyChunk";
import { P } from "@/lib/perms";
import { useAuth } from "@/stores/auth";
import { canI, useServers } from "@/stores/servers";
import { SettingsLayer, type NavGroup } from "./SettingsLayer";

import { t } from "@/i18n";
const OverviewPage = lazyPage(() => import("./pages/ServerOverviewPage"));
const RolesPage = lazyPage(() => import("./pages/RolesPage"));
const MembersPage = lazyPage(() => import("./pages/MembersPage"));
const BansPage = lazyPage(() => import("./pages/BansPage"));
const InvitesPage = lazyPage(() => import("./pages/InvitesPage"));
const AuditLogPage = lazyPage(() => import("./pages/AuditLogPage"));
const EncryptionPage = lazyPage(() => import("./pages/EncryptionPage"));
const EmojiPage = lazyPage(() => import("./pages/EmojiPage"));
const ServerStickersPage = lazyPage(() => import("./pages/ServerStickersPage"));
const DeleteServerPage = lazyPage(() => import("./pages/DeleteServerPage"));

export default function ServerSettingsModal({ onClose, serverId, page: initial }: { onClose: () => void; serverId: string; page?: string | undefined }) {
  const st = useServers((x) => x.byId[serverId]);
  const meId = useAuth((a) => a.me?.id);
  const nav = useNavigate();
  const owner = !!st && st.server.owner_id === meId;
  const pages: { id: string; label: string; ok: boolean; group: number; danger?: boolean }[] = [
    { id: "overview", label: "Overview", ok: canI(st, P.MANAGE_SERVER), group: 0 },
    { id: "roles", label: "Roles", ok: canI(st, P.MANAGE_ROLES), group: 0 },
    { id: "emoji", label: "Emoji", ok: true, group: 0 },
    { id: "stickers", label: "Stickers", ok: true, group: 0 },
    { id: "encryption", label: "Encryption", ok: true, group: 0 },
    { id: "members", label: "Members", ok: true, group: 1 },
    { id: "invites", label: "Invites", ok: canI(st, P.MANAGE_SERVER), group: 1 },
    { id: "bans", label: "Bans", ok: canI(st, P.BAN_MEMBERS), group: 1 },
    { id: "audit", label: "Audit Log", ok: canI(st, P.VIEW_AUDIT_LOG), group: 1 },
    { id: "delete", label: "Delete Server", ok: owner, group: 2, danger: true },
  ];
  const allowed = pages.filter((p) => p.ok);
  const [page, setPage] = useState(initial && allowed.some((p) => p.id === initial) ? initial : (allowed[0]?.id ?? "members"));
  useEffect(() => {
    if (!st) onClose();
  }, [st, onClose]);
  if (!st) return null;
  const groups: NavGroup[] = [
    { head: st.server.name, items: allowed.filter((p) => p.group === 0).map((p) => ({ id: p.id, label: p.label })) },
    { head: "Moderation", items: allowed.filter((p) => p.group === 1).map((p) => ({ id: p.id, label: p.label })) },
  ];
  if (owner) groups.push({ head: "", items: [{ id: "delete", label: "Delete Server", danger: true }] });
  const body =
    page === "overview" ? <OverviewPage serverId={serverId} /> :
    page === "roles" ? <RolesPage serverId={serverId} /> :
    page === "members" ? <MembersPage serverId={serverId} /> :
    page === "bans" ? <BansPage serverId={serverId} /> :
    page === "invites" ? <InvitesPage serverId={serverId} /> :
    page === "audit" ? <AuditLogPage serverId={serverId} /> :
    page === "emoji" ? <EmojiPage serverId={serverId} /> :
    page === "stickers" ? <ServerStickersPage serverId={serverId} /> :
    page === "delete" ? <DeleteServerPage serverId={serverId} onDone={() => { onClose(); nav("/channels/@me"); }} /> :
    <EncryptionPage serverId={serverId} />;
  return (
    <SettingsLayer label={t("server.serverSettings.serverSettings")} groups={groups} page={page} setPage={setPage} onClose={onClose}>
      <Suspense fallback={null}>{body}</Suspense>
    </SettingsLayer>
  );
}
