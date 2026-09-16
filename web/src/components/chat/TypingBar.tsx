import { useEffect } from "react";
import { useAuth } from "@/stores/auth";
import { typingUsers, useTyping } from "@/stores/typing";
import { useUsers, displayName } from "@/stores/users";
import s from "./Chat.module.css";

import { t as tr_ } from "@/i18n";
export function TypingBar({ channelId }: { channelId: string }) {
  const meId = useAuth((a) => a.me?.id);
  const byChannel = useTyping((t) => t.byChannel);
  const sweep = useTyping((t) => t.sweep);
  const users = useUsers((u) => u.byId);
  useEffect(() => {
    const t = setInterval(() => sweep(), 2000);
    return () => clearInterval(t);
  }, [sweep]);
  const who = typingUsers(byChannel, channelId, meId).map((id) => displayName(users[id]));
  if (who.length === 0) return <div className={s.typing} aria-hidden="true" />;
  let text: React.ReactNode;
  if (who.length === 1) text = <><b>{who[0]}</b> {tr_("chat.typingBar.isTyping")}</>;
  else if (who.length === 2) text = <><b>{who[0]}</b> and <b>{who[1]}</b> {tr_("chat.typingBar.areTyping")}</>;
  else if (who.length === 3) text = <><b>{who[0]}</b>, <b>{who[1]}</b>, and <b>{who[2]}</b> {tr_("chat.typingBar.areTyping")}</>;
  else text = <>{tr_("chat.typingBar.severalPeopleAreTyping")}</>;
  return (
    <div className={s.typing} aria-live="polite">
      <span className={s.dots}><i /><i /><i /></span>
      <span>{text}</span>
    </div>
  );
}
