/**
 * The screen a locked subchat shows until its password is typed. It is asked
 * for once per sign-in; the server will not hand over the messages before it.
 */
import { Lock } from "lucide-react";
import { useState } from "react";
import type { Channel } from "@/api/types";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { describeError } from "@/lib/errors";
import { unlockSubchat } from "@/lib/subchatLock";
import s from "./Chat.module.css";

import { t } from "@/i18n";
export function LockedChannel({ channel, onUnlocked, checkFailed, onRecheck }: { channel: Channel; onUnlocked: () => void; checkFailed?: boolean; onRecheck?: () => void }) {
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
      setError(describeError(err, t("chat.lockedChannel.thatCouldNotBeCheckedTry")));
    } finally {
      setBusy(false);
    }
  };
  // A check that never got an answer is not a password anyone can type: asking
  // for one would hide a subchat this sign-in may already have opened.
  if (checkFailed) {
    return (
      <div className={s.lockedWrap} data-testid="locked-subchat">
        <div className={s.lockedCard}>
          <span className={s.lockedIcon}><Lock size={28} /></span>
          <h2 className={s.lockedTitle}>{channel.name}</h2>
          <p className={s.lockedText}>{t("chat.lockedChannel.thatCouldNotBeCheckedTry")}</p>
          <Button block onClick={onRecheck} data-testid="subchat-recheck">{t("chat.messageList.tryAgain")}</Button>
        </div>
      </div>
    );
  }
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
