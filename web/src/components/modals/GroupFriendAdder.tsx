import { personText, personError } from "@/lib/personText";
import { PersonName } from "@/components/common/PersonName";
import { Check } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/common/Button";
import { TextInput } from "@/components/common/TextInput";
import { dmOpenError } from "@/lib/errors";
import { addFriendToGroup, friendsToAdd } from "@/lib/groupAdd";
import { useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { JoinRequestButton, useJoinRequests } from "./JoinRequestButton";
import s from "./GroupAdd.module.css";

import { t } from "@/i18n";

/**
 * The caller's friends who are not in the group yet, each with an Add button,
 * or, for a friend who joins groups only from an invite link, Send Join
 * Request: that sends them `joinLink`'s link in a direct message. Someone
 * added, or sent the link, stays in the list, marked Added or Sent, until the
 * menu closes: nothing moves under the pointer, and the keyboard stays where
 * it was.
 */
export function GroupFriendAdder({ channelId, joinLink }: { channelId: string; joinLink: () => Promise<string> }) {
  const rels = useRelationships((r) => r.byUser);
  const users = useUsers((u) => u.byId);
  const members = useChannels((c) => c.byId[channelId]?.recipient_ids);
  const toast = useUI((u) => u.toast);
  const headingId = useId();
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState<string[]>([]);
  const [said, setSaid] = useState<{ n: number; text: React.ReactNode } | null>(null);
  const say = (text: React.ReactNode) => setSaid((cur) => ({ n: (cur?.n ?? 0) + 1, text }));
  const requests = useJoinRequests(channelId, joinLink, (name, id) => say(personText("groupAdd.joinRequest.sentTo", id, name)));
  // whoever was sent the link and has joined with it since stays too, marked Sent
  const kept = useMemo(() => [...added, ...requests.sent], [added, requests.sent]);
  const memberIds = useMemo(() => (members ?? []).filter((id) => !kept.includes(id)), [members, kept]);
  const shown = useMemo(() => friendsToAdd(rels, users, memberIds, q), [rels, users, memberIds, q]);
  const anyFriends = useMemo(() => Object.values(rels).some((r) => r.type === "friend"), [rels]);
  const anyToAdd = useMemo(() => (q ? friendsToAdd(rels, users, memberIds, "").length > 0 : shown.length > 0), [q, rels, users, memberIds, shown.length]);

  const add = async (id: string, name: string) => {
    if (busy.includes(id) || added.includes(id)) return;
    setBusy((b) => [...b, id]);
    try {
      await addFriendToGroup(channelId, id);
      setAdded((a) => [...a, id]);
      say(personText("modals.groupInvite.nowInGroup", id, name));
    } catch (err) {
      toast(personError(dmOpenError(err, t("modals.groupInvite.couldNotAddName", { name })), t("modals.groupInvite.couldNotAddName", { name }), personText("modals.groupInvite.couldNotAddName", id, name)), "error");
    } finally {
      setBusy((b) => b.filter((x) => x !== id));
    }
  };

  const empty = !anyFriends ? t("modals.groupInvite.noFriendsYet") : !anyToAdd ? t("modals.groupInvite.allFriendsHere") : shown.length === 0 ? t("modals.createDM.noFriendsMatch") : "";
  return (
    <section className={s.adder} aria-labelledby={headingId} data-testid="group-add-friends">
      <h3 id={headingId} className={s.heading}>
        {t("chat.chat.addFriends")}
      </h3>
      {anyToAdd ? <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("modals.groupInvite.searchFriends")} aria-label={t("modals.groupInvite.searchFriends")} data-testid="group-add-search" /> : null}
      {empty ? <p className={s.empty}>{empty}</p> : null}
      {shown.length > 0 ? (
        <ul className={s.list} aria-labelledby={headingId}>
          {shown.map((c) => {
            const id = c.user.id;
            const name = c.nickname || c.user.display_name || c.user.username;
            const done = added.includes(id);
            return (
              <li key={id} className={s.row} data-testid="group-add-row" data-user={c.user.username}>
                <Avatar id={id} avatarId={c.user.avatar_id} name={name} size={32} />
                <span className={s.text}>
                  <PersonName user={c.user} className={s.name} dir="auto">
                    {name}
                  </PersonName>
                  <span className={s.user}>{c.user.username}</span>
                </span>
                {(c.linkOnly || requests.stateOf(id) === "sent") && !done ? (
                  <JoinRequestButton name={name} state={requests.stateOf(id)} onSend={() => void requests.send(id, name)} />
                ) : (
                  // the same button before and after, so focus stays on it; it
                  // is never disabled outright, which would drop the focus
                  <Button
                    size="sm"
                    variant={done ? "ghost" : "secondary"}
                    className={s.addBtn}
                    aria-label={done ? t("modals.groupInvite.addedName", { name }) : t("modals.groupInvite.addName", { name })}
                    aria-disabled={done || undefined}
                    aria-busy={busy.includes(id) || undefined}
                    onClick={done ? undefined : () => void add(id, name)}
                    data-testid="group-add-button"
                  >
                    {done ? (
                      <>
                        <Check size={14} aria-hidden="true" />
                        {t("modals.groupInvite.added")}
                      </>
                    ) : (
                      t("modals.groupInvite.add")
                    )}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="visually-hidden" role="status">
        {said ? <span key={said.n}>{said.text}</span> : null}
      </div>
    </section>
  );
}
