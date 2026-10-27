import { Fragment, type ReactNode } from "react";
import { PersonName } from "@/components/common/PersonName";
import { Tr, translator } from "@/i18n";
import type { Values } from "@/i18n/core";
import { displayName } from "@/stores/users";
import type { PublicUser } from "@/api/types";

/** Identity fragments for action modules that keep their translation strings outside JSX. */
export function personNode(userId: string | null | undefined, name: ReactNode, serverId?: string | null) {
  return <PersonName userId={userId} serverId={serverId}>{name}</PersonName>;
}

export function personText(id: string, userId: string | null | undefined, name: ReactNode, values: Values = {}, serverId?: string | null) {
  return <Tr id={id} values={{ ...values, name: personNode(userId, name, serverId) }} />;
}

/** The same locale-aware conjunctions as formatList, retaining one styled fragment per person. */
export function personList(users: PublicUser[], serverId?: string | null): ReactNode {
  try {
    const parts = new Intl.ListFormat(translator().locale, { type: "conjunction", style: "narrow" }).formatToParts(users.map((user) => displayName(user)));
    let index = 0;
    return parts.map((part, i) => <Fragment key={i}>{part.type === "element" ? personNode(users[index++]!.id, part.value, serverId) : part.value}</Fragment>);
  } catch {
    return users.map((user, i) => <Fragment key={user.id}>{i ? ", " : ""}{personNode(user.id, displayName(user), serverId)}</Fragment>);
  }
}

/** Rich fallback prose only when the error formatter did not supply a specific error. */
export function personError(text: string, fallback: string, richFallback: ReactNode): ReactNode {
  return text === fallback ? richFallback : text;
}
