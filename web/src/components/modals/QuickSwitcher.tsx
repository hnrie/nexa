import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { channels as channelsApi } from "@/api/channels";
import { Avatar } from "@/components/common/Avatar";
import { Modal } from "@/components/common/Modal";
import { channelDisplayName } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { selectDMs, useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import s from "./QuickSwitcher.module.css";

interface Item {
  id: string;
  kind: "dm" | "friend";
  label: string;
  sub: string;
  avatarId: string | null;
  userId: string;
  go: () => void;
}

function score(hay: string, q: string): number {
  const h = hay.toLowerCase();
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  if (h.includes(q)) return 50;
  let qi = 0;
  for (const c of h) if (qi < q.length && c === q[qi]) qi++;
  return qi === q.length ? 20 : -1;
}

export function QuickSwitcher() {
  const open = useUI((u) => u.quickSwitcher);
  const setOpen = useUI((u) => u.setQuickSwitcher);
  const nav = useNavigate();
  const meId = useAuth((a) => a.me?.id);
  const channels = useChannels((c) => c.byId);
  const upsert = useChannels((c) => c.upsert);
  const users = useUsers((u) => u.byId);
  const rels = useRelationships((r) => r.byUser);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUI.getState().quickSwitcher);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const dmUsers = new Set<string>();
    for (const ch of selectDMs(channels)) {
      const label = channelDisplayName(ch, users, meId);
      const other = ch.type === "dm" ? (ch.recipient_ids.find((id) => id !== meId) ?? "") : "";
      if (other) dmUsers.add(other);
      out.push({ id: ch.id, kind: "dm", label, sub: ch.type === "dm" ? `@${users[other]?.username ?? ""}` : `${ch.recipient_ids.length} members`, avatarId: ch.type === "dm" ? (users[other]?.avatar_id ?? null) : ch.icon_id, userId: other || ch.id, go: () => nav(`/channels/@me/${ch.id}`) });
    }
    for (const r of Object.values(rels)) {
      if (r.type !== "friend" || dmUsers.has(r.user.id)) continue;
      out.push({ id: "u" + r.user.id, kind: "friend", label: r.user.display_name, sub: `@${r.user.username}`, avatarId: r.user.avatar_id, userId: r.user.id, go: () => void channelsApi.createDM([r.user.id]).then((ch) => { upsert(ch); nav(`/channels/@me/${ch.id}`); }) });
    }
    const query = q.trim().toLowerCase().replace(/^@/, "");
    if (!query) return out.slice(0, 10);
    return out
      .map((it) => ({ it, sc: Math.max(score(it.label, query), score(it.sub.replace(/^@/, ""), query)) }))
      .filter((x) => x.sc >= 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 10)
      .map((x) => x.it);
  }, [channels, users, rels, meId, q, nav, upsert]);

  if (!open) return null;
  const choose = (it: Item | undefined) => {
    if (!it) return;
    setOpen(false);
    it.go();
  };
  return (
    <Modal open onClose={() => setOpen(false)} width={560} bare>
      <div className={s.box}>
        <input
          ref={inputRef}
          className={s.input}
          value={q}
          placeholder="Where would you like to go?"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((v) => Math.min(items.length - 1, v + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((v) => Math.max(0, v - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); choose(items[sel]); }
          }}
        />
        <div className={s.list}>
          {items.length === 0 ? <div className={s.empty}>No matches.</div> : null}
          {items.map((it, i) => (
            <button key={it.id} className={s.item} data-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => choose(it)}>
              <Avatar id={it.userId} avatarId={it.avatarId} name={it.label} size={24} />
              <span className={s.label}>{it.label}</span>
              <span className={s.sub}>{it.sub}</span>
            </button>
          ))}
        </div>
        <div className={s.foot}><b>↑↓</b> navigate <b>↵</b> select <b>esc</b> dismiss</div>
      </div>
    </Modal>
  );
}
