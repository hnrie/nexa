import { PersonName } from "@/components/common/PersonName";
import { useMemo, useState } from "react";
import type { Relationship } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { SearchBox } from "@/components/common/SearchBox";
import { Toggle } from "@/components/common/Toggle";
import { unblockUser, useBusyWith } from "@/lib/friendship";
import { useRelationships } from "@/stores/relationships";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import s from "./Settings.module.css";
import b from "./BlockedPage.module.css";

import { t, translator } from "@/i18n";

/** A search box once the list is long enough to need one. */
const SEARCH_FROM = 8;

/**
 * Everyone this account has blocked, with a way to unblock each, and the two
 * choices about their messages that the block dialog offers, so either can be
 * turned off again later.
 */
export default function BlockedPage() {
  const rels = useRelationships((r) => r.byUser);
  const blocking = useSettings((st) => st.settings.blocking);
  const patch = useSettings((st) => st.patch);
  const [query, setQuery] = useState("");
  const blocked = useMemo(() => {
    let collator: Intl.Collator;
    try {
      collator = new Intl.Collator(translator().locale, { sensitivity: "base", numeric: true });
    } catch {
      collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    }
    return Object.values(rels)
      .filter((r) => r.type === "blocked")
      .sort((x, y) => collator.compare(x.user.display_name, y.user.display_name) || collator.compare(x.user.username, y.user.username));
  }, [rels]);
  const q = query.trim().toLowerCase().replace(/^@/, "");
  const shown = q ? blocked.filter((r) => r.user.display_name.toLowerCase().includes(q) || r.user.username.includes(q)) : blocked;

  return (
    <>
      <h2 className={s.title}>{t("people.blockedPage.title")}</h2>
      <p className={s.hint}>{t("people.blockedPage.intro")}</p>

      <h3 data-setting="blockedMessages" className={s.h5}>{t("people.blockedPage.messagesHeading")}</h3>
      <Toggle
        checked={blocking.hideMessages}
        onChange={(v) => patch({ blocking: { hideMessages: v, hideReplies: v && blocking.hideReplies } })}
        label={t("people.block.hideMessages")}
        description={t("people.block.hideMessagesHint")}
      />
      <Toggle
        checked={blocking.hideMessages && blocking.hideReplies}
        disabled={!blocking.hideMessages}
        onChange={(v) => patch({ blocking: { hideMessages: blocking.hideMessages, hideReplies: v } })}
        label={t("people.block.hideReplies")}
        description={t("people.block.hideRepliesHint")}
      />
      <p className={s.hint}>{t("people.blockedPage.quiet")}</p>

      <div className={b.listHead}>
        <h3 className={s.h5}>{t("people.blockedPage.listHeading", { count: blocked.length })}</h3>
        {blocked.length >= SEARCH_FROM ? (
          <SearchBox className={b.search} value={query} onChange={setQuery} placeholder={t("chat.chat.search")} aria-label={t("people.blockedPage.search")} data-testid="blocked-search" />
        ) : null}
      </div>
      {blocked.length === 0 ? (
        <p className={b.empty} data-testid="blocked-empty">{t("friends.youHaveNotBlockedAnyone")}</p>
      ) : shown.length === 0 ? (
        <div className={s.noMatches}>
          <span className={s.hint}>{t("friends.nobodyHereMatches", { query: query.trim() })}</span>
          <Button size="sm" variant="secondary" onClick={() => setQuery("")}>{t("friends.clearTheSearch")}</Button>
        </div>
      ) : (
        <ul className={b.list} data-testid="blocked-list">
          {shown.map((r) => (
            <BlockedRow key={r.user.id} rel={r} />
          ))}
        </ul>
      )}
    </>
  );
}

function BlockedRow({ rel }: { rel: Relationship }) {
  // the newest picture and name this device has, over the ones the block was made with
  const user = useUsers((u) => u.byId[rel.user.id]) ?? rel.user;
  const busy = useBusyWith(rel.user.id);
  const name = displayName(user);
  return (
    <li className={b.row} data-user={user.username}>
      <button type="button" className={b.who} onClick={() => useUI.getState().openModal("profile", { userId: user.id })} aria-haspopup="dialog">
        <Avatar id={user.id} avatarId={user.avatar_id} name={name} size={32} />
        <span className={b.names}>
          <PersonName user={user} className={b.name} dir="auto">{name}</PersonName>
          <span className={b.username}>{user.username}</span>
        </span>
      </button>
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void unblockUser(user.id)} aria-label={t("people.blockedPage.unblockName", { name })} data-testid="blocked-unblock">
        {t("friends.unblock")}
      </Button>
    </li>
  );
}
