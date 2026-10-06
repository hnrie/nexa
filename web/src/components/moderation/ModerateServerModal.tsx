import { Compass, X } from "lucide-react";
import { useState } from "react";
import { moderation as modApi, type ModServer, type Person, type ServerField, type StaffCase } from "@/api/moderation";
import { bannerUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { TextArea } from "@/components/common/TextInput";
import { profileTheme } from "@/lib/avatarColor";
import { describeError } from "@/lib/errors";
import { fieldLabel, personName, previewText } from "@/lib/moderation";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import { ServerIcon } from "./ProfileSheet";
import { ServerTagChip } from "@/components/servertag/ServerTagChip";
import m from "./Moderation.module.css";

const MAX_REASON = 1000;
const FIELDS: ServerField[] = ["icon", "banner", "name", "description", "tag", "discovery"];

/**
 * Taking down parts of what a server shows everyone: its icon, banner, name,
 * description or tag, or its place on Discover. The reason goes to the
 * server's owner, word for word, with the moderator's name, and opens a case
 * they can answer in.
 */
export function ModerateServerModal({ server, owner, preset, onClose, onDone }: { server: ModServer; owner: Person | undefined; preset?: ServerField[] | undefined; onClose: () => void; onDone: (c: StaffCase) => void }) {
  const toast = useUI((u) => u.toast);
  // Discover can only be taken from a server listed there and not hidden already
  const empty: Record<ServerField, boolean> = { icon: !server.icon_id, banner: !server.banner_id, name: false, description: !server.description, tag: !server.tag, discovery: !server.discoverable || !!server.discovery_hidden };
  const [fields, setFields] = useState<ServerField[]>((preset ?? []).filter((f) => !empty[f]));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = reason.trim();
  const reasonOk = [...trimmed].length >= 3 && [...reason].length <= MAX_REASON;
  const ready = fields.length > 0 && reasonOk;
  const ownerName = personName(owner);

  const toggle = (f: ServerField) => setFields((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await modApi.actOnServer(server.id, { fields: FIELDS.filter((f) => fields.includes(f)), reason: trimmed });
      toast(t("moderation.servers.done", { number: r.case.number, name: server.name }), "success");
      onDone(r.case);
      onClose();
    } catch (err) {
      setError(describeError(err, t("moderation.failed")));
    } finally {
      setBusy(false);
    }
  };

  const preview = (f: ServerField) => {
    switch (f) {
      case "icon":
        return server.icon_id ? <ServerIcon id={server.id} iconId={server.icon_id} name={server.name} size={32} /> : null;
      case "tag":
        return server.tag ? <ServerTagChip tag={{ server_id: server.id, text: server.tag.text, badge: server.tag.badge, color: server.tag.color ?? null }} open={false} /> : null;
      case "banner":
        return <span className={m.bannerPreview} style={server.banner_id ? { backgroundImage: `url(${bannerUrl(server.banner_id, 160)})` } : { background: profileTheme(null, null, server.id) }} aria-hidden="true" />;
      case "discovery":
        return <Compass size={22} aria-hidden="true" />;
      default:
        return null;
    }
  };
  const value = (f: ServerField) => {
    if (f === "discovery") return server.discovery_hidden ? t("moderation.servers.discoveryHeld") : server.discoverable ? t("moderation.servers.discoveryListed") : t("moderation.servers.discoveryNotListed");
    if (empty[f]) return t("moderation.form.none");
    if (f === "name") return server.name;
    if (f === "description") return previewText(server.description);
    if (f === "tag") return server.tag?.text ?? "";
    return f === "icon" ? t("moderation.servers.iconSet") : t("moderation.form.bannerSet");
  };
  const quick = [t("moderation.quick.hateful"), t("moderation.quick.impersonation"), t("moderation.quick.spam"), t("moderation.quick.harassment"), t("moderation.quick.explicit"), t("moderation.servers.quickScam")];

  return (
    <Modal open onClose={onClose} bare width={620} ariaLabel={t("moderation.servers.moderateNamed", { name: server.name })}>
      <div className={m.modal} data-testid="moderate-server-modal">
        <div className={m.modalTop}>
          <ServerIcon id={server.id} iconId={server.icon_id} name={server.name} size={40} />
          <div style={{ minWidth: 0 }}>
            <h2 className={m.modalTitle}>{t("moderation.servers.moderateTitle")}</h2>
            <div className={m.modalTarget}>
              <span dir="auto">{server.name}</span>
              <span>{t("moderation.servers.ownedBy", { name: ownerName })}</span>
            </div>
          </div>
          <button type="button" className={m.modalClose} onClick={onClose} aria-label={t("chat.attachments.close")}>
            <X size={20} />
          </button>
        </div>

        <div className={m.modalScroll}>
          <div className={m.section}>
            <span className={m.sectionLabel}>{t("moderation.servers.whatToTake")}</span>
            <div className={m.choiceRow}>
              {FIELDS.map((f) => (
                <label key={f} className={m.pick} data-checked={fields.includes(f)} data-disabled={empty[f]} data-testid={`server-field-${f}`}>
                  <input type="checkbox" checked={fields.includes(f)} disabled={empty[f]} onChange={() => toggle(f)} />
                  {preview(f)}
                  <span className={m.pickText}>
                    <span className={m.pickName}>{fieldLabel(f)}</span>
                    <span className={m.pickValue} title={f === "description" ? server.description : undefined} dir="auto">{value(f)}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className={m.note}>{t("moderation.servers.takeNote")}</p>
            {fields.includes("discovery") ? <p className={m.note}>{t("moderation.servers.discoveryNote")}</p> : null}
          </div>

          <div className={m.section}>
            <label className={m.section}>
              <span className={m.sectionLabel}>{t("moderation.form.reason")}</span>
              <TextArea className={m.reasonBox} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("moderation.servers.reasonPlaceholder")} maxLength={MAX_REASON + 50} data-testid="moderate-server-reason" />
            </label>
            <div className={m.quick}>
              {quick.map((q) => (
                <button key={q} type="button" onClick={() => setReason((r) => (r.trim() ? `${r.trim()} ${q}` : q))}>
                  {q}
                </button>
              ))}
            </div>
            <div className={m.reasonMeta}>
              <span>{t("moderation.servers.reasonVisible", { name: ownerName })}</span>
              {[...reason.trim()].length < 3 ? <span data-short="">{t("moderation.form.reasonTooShort", { min: 3 })}</span> : <span>{[...reason].length}/{MAX_REASON}</span>}
            </div>
          </div>
          {error ? (
            <p className={m.danger} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className={m.modalFoot}>
          <span className={m.summary}>{t("moderation.servers.notifies", { name: ownerName })}</span>
          <span className={m.grow} />
          <Button variant="ghost" onClick={onClose}>
            {t("moderation.cancel")}
          </Button>
          <Button variant="primary" disabled={!ready} loading={busy} onClick={() => void submit()} data-testid="moderate-server-submit">
            {t("moderation.servers.submit", { count: fields.length || 1 })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
