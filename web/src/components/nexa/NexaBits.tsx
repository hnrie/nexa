import { PersonName } from "@/components/common/PersonName";
import { BadgeCheck } from "lucide-react";
import type { Person } from "@/api/moderation";
import { Avatar } from "@/components/common/Avatar";
import { NexaMark } from "@/components/common/Brand";
import { personName } from "@/lib/moderation";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import s from "./Nexa.module.css";

/** Nexa's avatar: the brand mark on the brand colour, in a circle like anyone's. */
export function NexaAvatar({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span className={[s.nexaAvatar, className ?? ""].join(" ")} style={{ width: size, height: size }} aria-hidden="true">
      <NexaMark size={Math.round(size * 0.58)} />
    </span>
  );
}

/** Marks the official system account, so a look-alike name cannot pass for it. */
export function OfficialBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={s.official} title={t("nexa.officialTooltip")} data-compact={compact || undefined}>
      <BadgeCheck size={compact ? 12 : 13} aria-hidden="true" />
      {compact ? <span className="visually-hidden">{t("nexa.official")}</span> : <span>{t("nexa.official")}</span>}
    </span>
  );
}

/**
 * Someone the moderation views name — the moderator who acted, whoever wrote
 * a line — as an avatar and a name that opens their profile.
 */
export function PersonChip({ person, id, size = 20, withUsername = false }: { person: Person | undefined; id: string; size?: number; withUsername?: boolean }) {
  const openModal = useUI((u) => u.openModal);
  const name = personName(person);
  const gone = !person || person.deleted;
  const body = (
    <>
      <Avatar id={id} avatarId={person?.avatar_id ?? null} name={name} size={size} />
      <PersonName userId={gone ? null : id} user={gone ? null : person} className={s.personName}>{name}</PersonName>
      {withUsername && person && !person.deleted ? <span className={s.personUser}>@{person.username}</span> : null}
    </>
  );
  if (gone) return <span className={s.person}>{body}</span>;
  return (
    <button type="button" className={[s.person, s.personLink].join(" ")} onClick={() => openModal("profile", { userId: id })} title={t("nexa.viewProfile")}>
      {body}
    </button>
  );
}
