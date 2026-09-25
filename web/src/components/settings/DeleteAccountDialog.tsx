import { useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import type { PurgeCounts } from "@/api/moderation";
import { users as usersApi } from "@/api/users";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Spinner } from "@/components/common/Spinner";
import { Field, TextInput } from "@/components/common/TextInput";
import { formatBytes } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import { t, translator } from "@/i18n";
import { formatNumber } from "@/i18n/core";
import s from "./Settings.module.css";

/**
 * Deleting your own account: what goes, counted, before the password that
 * confirms it. Everything the account made goes — messages everywhere, files,
 * the servers and group chats it owns, and its direct message conversations,
 * for both people in them — and nothing can bring it back.
 */
export function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const logout = useAuth((a) => a.logout);
  const toast = useUI((u) => u.toast);
  const [counts, setCounts] = useState<PurgeCounts | null | "failed">(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    usersApi
      .deletePreview()
      .then((c) => alive && setCounts(c))
      .catch(() => alive && setCounts("failed"));
    return () => {
      alive = false;
    };
  }, []);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const { deriveAuthKey, deriveMaster } = await import("@/crypto/kdf");
      const { b64 } = await import("@/crypto/bytes");
      const { acceptServerKdf } = await import("@/lib/serverKdf");
      const bundle = await usersApi.myKeys();
      const master = await deriveMaster(password, b64.dec(bundle.kdf_salt), acceptServerKdf(bundle.kdf_params));
      await usersApi.deleteMe(b64.enc(deriveAuthKey(master)));
      await logout();
    } catch (err) {
      // closed already, with the rest still going: there is nothing left to sign in to
      if (err instanceof ApiError && err.code === "delete_incomplete") {
        toast(err.message, "info");
        await logout();
        return;
      }
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : t("modals.confirm.somethingWentWrong"));
      setBusy(false);
    }
  };

  // counts in the app's language, not the browser's
  const n = (v: number) => formatNumber(v, translator().locale);
  const rows: { label: string; value: string }[] = [];
  if (counts && counts !== "failed") {
    const leaving = Math.max(0, counts.servers - counts.owned_servers) + Math.max(0, counts.groups - counts.owned_groups);
    if (counts.messages) rows.push({ label: t("settings.account.purge.messages"), value: n(counts.messages) });
    if (counts.attachments) rows.push({ label: t("settings.account.purge.files"), value: `${n(counts.attachments)} · ${formatBytes(counts.attachment_bytes)}` });
    if (counts.owned_servers) rows.push({ label: t("settings.account.purge.ownedServers"), value: n(counts.owned_servers) });
    if (counts.owned_groups) rows.push({ label: t("settings.account.purge.ownedGroups"), value: n(counts.owned_groups) });
    if (counts.direct_messages) rows.push({ label: t("settings.account.purge.dms"), value: n(counts.direct_messages) });
    if (counts.reactions) rows.push({ label: t("settings.account.purge.reactions"), value: n(counts.reactions) });
    if (counts.packs) rows.push({ label: t("settings.account.purge.packs"), value: n(counts.packs) });
    if (leaving) rows.push({ label: t("settings.account.purge.leaves"), value: n(leaving) });
  }
  // whatever else there is or is not, the account itself goes
  if (counts !== null) rows.push({ label: t("settings.account.purge.profile"), value: "" });

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={t("settings.account.deleteAccount")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("chat.editMessage.cancel")}
          </Button>
          <Button variant="danger" loading={busy} disabled={!password} onClick={() => void confirm()} data-testid="delete-account-confirm">
            {t("settings.account.deleteAccount")}
          </Button>
        </>
      }
    >
      <div className={s.form}>
        <p className={s.hint} style={{ margin: 0 }}>
          {t("settings.account.purge.title")}
        </p>
        {counts === null ? (
          <div className={s.purgeLoading}>
            <Spinner size={22} />
          </div>
        ) : (
          <ul className={s.purgeList} data-testid="delete-account-counts">
            {rows.map((r) => (
              <li key={r.label}>
                <span>{r.label}</span>
                <span className={s.purgeCount}>{r.value}</span>
              </li>
            ))}
          </ul>
        )}
        <p className={s.hint} style={{ margin: 0 }}>
          {t("settings.account.purge.note")}
        </p>
        {error ? (
          <p className={s.hint} style={{ color: "var(--text-danger)", margin: 0 }} role="alert">
            {error}
          </p>
        ) : null}
        <Field label={t("chat.lockedChannel.password")} required>
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && password && !busy) void confirm();
            }}
            autoComplete="current-password"
            autoFocus
            data-testid="delete-account-password"
          />
        </Field>
      </div>
    </Modal>
  );
}
