import { useEffect } from "react";
import { useAuth } from "@/stores/auth";
import { typingUsers, useTyping } from "@/stores/typing";
import { useUsers, displayName } from "@/stores/users";
import { useBlockRules } from "@/lib/blocked";
import s from "./Chat.module.css";

import { t as tr_, Tr } from "@/i18n";
export function TypingBar({ channelId }: { channelId: string }) {
  const meId = useAuth((a) => a.me?.id);
  const byChannel = useTyping((t) => t.byChannel);
  const sweep = useTyping((t) => t.sweep);
  const users = useUsers((u) => u.byId);
  const rules = useBlockRules();
  useEffect(() => {
    const t = setInterval(() => sweep(), 2000);
    return () => clearInterval(t);
  }, [sweep]);
  // someone blocked is never shown typing (their events are dropped as they come; this covers the moment of blocking)
  const who = typingUsers(byChannel, channelId, meId).filter((id) => !rules.blocked.has(id)).map((id) => displayName(users[id]));
  if (who.length === 0) return <div className={s.typing} aria-hidden="true" />;
  let text: React.ReactNode;
  if (who.length === 1) text = <Tr id="chat.typingBar.oneTyping" values={{ a: <b dir="auto">{who[0]}</b> }} />;
  else if (who.length === 2) text = <Tr id="chat.typingBar.twoTyping" values={{ a: <b dir="auto">{who[0]}</b>, b: <b dir="auto">{who[1]}</b> }} />;
  else if (who.length === 3) text = <Tr id="chat.typingBar.threeTyping" values={{ a: <b dir="auto">{who[0]}</b>, b: <b dir="auto">{who[1]}</b>, c: <b dir="auto">{who[2]}</b> }} />;
  else text = <>{tr_("chat.typingBar.severalPeopleAreTyping")}</>;
  return (
    <div className={s.typing} aria-live="polite">
      <span className={s.dots}><i /><i /><i /></span>
      <span>{text}</span>
    </div>
  );
}
