/**
 * The screen a locked subchat shows until its password is typed. It is asked
 * for once per sign-in; the server will not hand over the messages before it.
 */
import { Lock } from "lucide-react";
import { useState } from "react";
import { ApiError } from "@/api/client";
import type { Channel } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { unlockSubchat } from "@/lib/subchatLock";
import s from "./Chat.module.css";

import { t } from "@/i18n";
export function LockedChannel({ channel, onUnlocked }: { channel: Channel; onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlockSubchat(channel.id, password);
      setPassword("");
      onUnlocked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("chat.lockedChannel.thatCouldNotBeCheckedTry"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.lockedWrap} data-testid="locked-subchat">
      <form
        className={s.lockedCard}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <span className={s.lockedIcon}><Lock size={28} /></span>
        <h2 className={s.lockedTitle}>{channel.name}</h2>
        <p className={s.lockedText}>{t("chat.lockedChannel.thisSubchatAsksForItsPassword")}</p>
        <Field label={t("chat.lockedChannel.password")} error={error ?? undefined}>
          <TextInput type="password" value={password} autoFocus autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} data-testid="subchat-password" />
        </Field>
        <Button type="submit" block loading={busy} disabled={!password} data-testid="subchat-unlock">{t("chat.lockedChannel.open")}</Button>
      </form>
    </div>
  );
}
