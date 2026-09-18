import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { channels as channelsApi } from "@/api/channels";
import { ApiError } from "@/api/client";
import { Avatar } from "@/components/common/Avatar";
import { Modal } from "@/components/common/Modal";
import { SearchSuggestions } from "@/components/search/SearchSuggestions";
import { channelDisplayName } from "@/lib/names";
import { highlight, isEmptyQuery, parseQuery, search } from "@/lib/search";
import { formatTimestamp } from "@/lib/time";
import { useAuth } from "@/stores/auth";
import { selectDMs, selectServerChannels, useChannels } from "@/stores/channels";
import { useMessages } from "@/stores/messages";
import { useServers } from "@/stores/servers";
import { useRelationships } from "@/stores/relationships";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import s from "./QuickSwitcher.module.css";

import { t } from "@/i18n";
interface Item {
  id: string;
  kind: "dm" | "friend" | "channel" | "server";
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
  const servers = useServers((st) => st.byId);
  const messageStore = useMessages((m) => m.channels);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  /** Jumping somewhere, or looking through what has been said. */
  const [mode, setMode] = useState<"go" | "messages">("go");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setMode("go");
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
    for (const st of Object.values(servers)) {
      out.push({ id: "s" + st.server.id, kind: "server", label: st.server.name, sub: "Server", avatarId: null, userId: st.server.id, go: () => nav(`/channels/${st.server.id}`) });
      for (const ch of selectServerChannels(channels, st.server.id)) {
        if (ch.type !== "text") continue;
        out.push({ id: ch.id, kind: "channel", label: `#${ch.name}`, sub: st.server.name, avatarId: null, userId: ch.id, go: () => nav(`/channels/${st.server.id}/${ch.id}`) });
      }
    }
    for (const r of Object.values(rels)) {
      if (r.type !== "friend" || dmUsers.has(r.user.id)) continue;
      out.push({ id: "u" + r.user.id, kind: "friend", label: r.user.display_name, sub: `@${r.user.username}`, avatarId: r.user.avatar_id, userId: r.user.id, go: () => void channelsApi.createDM([r.user.id]).then((ch) => { upsert(ch); nav(`/channels/@me/${ch.id}`); }).catch((err: unknown) => useUI.getState().toast(err instanceof ApiError ? err.message : t("modals.quickSwitcher.couldNotOpenTheConversation"), "error")) });
    }
    const query = q.trim().toLowerCase().replace(/^[@#]/, "");
    if (!query) return out.slice(0, 10);
    const onlyChannels = q.trim().startsWith("#");
    return out
      .filter((it) => !onlyChannels || it.kind === "channel")
      .map((it) => ({ it, sc: Math.max(score(it.label.replace(/^#/, ""), query), score(it.sub.replace(/^@/, ""), query)) }))
      .filter((x) => x.sc >= 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 10)
      .map((x) => x.it);
  }, [channels, users, rels, servers, meId, q, nav, upsert]);

  // Everything this device has decrypted, wherever it came from. The server
  // holds only ciphertext, so this is the whole index there can be.
  const parsed = useMemo(() => parseQuery(q), [q]);
  const channelNames = useMemo(() => Object.fromEntries(Object.values(channels).map((c) => [c.id, c.name.toLowerCase()])), [channels]);
  const hits = useMemo(() => {
    if (mode !== "messages" || isEmptyQuery(parsed)) return [];
    const all = Object.values(messageStore).flatMap((c) => Object.values(c.byId));
    return search(all, parsed, { users, channelNames, ...(meId ? { meId } : {}) }, 40);
  }, [mode, parsed, messageStore, users, channelNames, meId]);
  const searchable = useMemo(() => Object.values(channels).filter((c) => c.type === "text" || c.type === "dm" || c.type === "group_dm" || c.type === "subchat"), [channels]);

  if (!open) return null;
  const choose = (it: Item | undefined) => {
    if (!it) return;
    setOpen(false);
    it.go();
  };
  const openMessage = (channelId: string, messageId: string) => {
    const ch = channels[channelId];
    if (!ch) return;
    setOpen(false);
    nav(ch.server_id ? `/channels/${ch.server_id}/${ch.id}/${messageId}` : `/channels/@me/${ch.id}/${messageId}`);
    useUI.getState().setJumpTo({ channelId, messageId });
  };
  const count = mode === "messages" ? hits.length : items.length;
  // The arrow-key selection used to live only in `data-selected`, which is a
  // background colour and nothing else: a screen reader following Ctrl+K heard
  // a text box and silence. The input is the combobox, the rows are its
  // options, and `aria-activedescendant` names the one the arrows are on
  // without ever moving focus out of the box being typed into.
  const listId = "qs-list";
  const optionId = (i: number) => `qs-opt-${i}`;
  const switchMode = (next: "go" | "messages") => {
    setMode(next);
    setSel(0);
    inputRef.current?.focus();
  };
  return (
    <Modal open onClose={() => setOpen(false)} width={560} bare className={s.top} ariaLabel={t("modals.quickSwitcher.quickSwitcher")}>
      <div className={s.box}>
        <div className={s.tabs} role="tablist" aria-label={t("modals.quickSwitcher.quickSwitcher")}>
          <button role="tab" aria-selected={mode === "go"} {...(count > 0 ? { "aria-controls": listId } : {})} tabIndex={mode === "go" ? 0 : -1} data-on={mode === "go"} onClick={() => switchMode("go")} onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); switchMode("messages"); } }} data-testid="switcher-mode-go">{t("modals.quickSwitcher.jumpTo")}</button>
          <button role="tab" aria-selected={mode === "messages"} {...(count > 0 ? { "aria-controls": listId } : {})} tabIndex={mode === "messages" ? 0 : -1} data-on={mode === "messages"} onClick={() => switchMode("messages")} onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); switchMode("go"); } }} data-testid="switcher-mode-messages">{t("modals.quickSwitcher.messages")}</button>
        </div>
        <div className={s.inputRow}>
          <input
            ref={inputRef}
            className={s.input}
            value={q}
            placeholder={mode === "messages" ? t("modals.quickSwitcher.searchEverythingYouCanRead") : t("modals.quickSwitcher.whereWouldYouLikeToGo")}
            data-testid="switcher-input"
            role="combobox"
            aria-expanded={count > 0}
            {...(count > 0 ? { "aria-controls": listId } : {})}
            aria-autocomplete="list"
            aria-activedescendant={count > 0 ? optionId(sel) : undefined}
            aria-label={mode === "messages" ? t("modals.quickSwitcher.searchEverythingYouCanRead") : t("modals.quickSwitcher.whereWouldYouLikeToGo")}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((v) => Math.min(count - 1, v + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((v) => Math.max(0, v - 1)); }
              // Tab used to be the mode switch, which left the two tabs, the
              // clear button and every result row permanently out of reach:
              // Tab only ever toggled the mode. Ctrl+Tab and the Left/Right
              // arrows on the tabs do that job now, and Tab does its own.
              else if (e.key === "Tab" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setMode((m) => (m === "go" ? "messages" : "go")); setSel(0); }
              else if (e.key === "Enter") {
                e.preventDefault();
                if (mode === "messages") { const m = hits[sel]; if (m) openMessage(m.channel_id, m.id); }
                else choose(items[sel]);
              }
            }}
          />
          {q ? <button className={s.clear} aria-label={t("modals.quickSwitcher.clear")} onClick={() => { setQ(""); setSel(0); inputRef.current?.focus(); }} data-testid="switcher-clear">×</button> : null}
        </div>
        {mode === "messages" ? <SearchSuggestions query={q} users={users} channels={searchable} onPick={(next) => { setQ(next); setSel(0); inputRef.current?.focus(); }} /> : null}
        {/* Only a list with something in it is a listbox; an empty one with a
            sentence inside would be a listbox whose children are not options. */}
        <div className={s.list} {...(count > 0 ? { id: listId, role: "listbox", "aria-label": mode === "messages" ? t("modals.quickSwitcher.messages") : t("modals.quickSwitcher.jumpTo") } : {})}>
          {mode === "go" ? (
            <>
              {items.length === 0 ? <div className={s.empty}>{t("modals.quickSwitcher.noMatches")}</div> : null}
              {items.map((it, i) => (
                <button key={it.id} id={optionId(i)} role="option" aria-selected={i === sel} tabIndex={-1} className={s.item} data-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => choose(it)}>
                  {it.kind === "channel" ? <span className={s.hash}>#</span> : <Avatar id={it.userId} avatarId={it.avatarId} name={it.label.replace(/^#/, "")} size={24} />}
                  <span className={s.label}>{it.kind === "channel" ? it.label.slice(1) : it.label}</span>
                  <span className={s.sub}>{it.sub}</span>
                </button>
              ))}
            </>
          ) : (
            <>
              {isEmptyQuery(parsed) ? <div className={s.empty}>{t("modals.quickSwitcher.typeToSearchEverythingThisDevice")} <b>from:me</b> {t("modals.quickSwitcher.findsWhatYouSent")}</div> : null}
              {!isEmptyQuery(parsed) && hits.length === 0 ? <div className={s.empty}>{t("modals.quickSwitcher.nothingMatchedOpenAConversationAnd")}</div> : null}
              {hits.map((m, i) => {
                const ch = channels[m.channel_id];
                const author = users[m.author_id];
                return (
                  <button key={m.id} id={optionId(i)} role="option" aria-selected={i === sel} tabIndex={-1} className={s.hit} data-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => openMessage(m.channel_id, m.id)} data-testid="switcher-hit">
                    <Avatar id={m.author_id} avatarId={author?.avatar_id ?? null} name={author?.display_name ?? "?"} size={24} />
                    <span className={s.hitBody}>
                      <span className={s.hitHead}>
                        <b>{author?.display_name ?? t("modals.quickSwitcher.unknown")}</b>
                        <span className={s.sub}>{ch ? (ch.server_id ? `#${ch.name}` : channelDisplayName(ch, users, meId)) : ""} · {formatTimestamp(m.created_at)}</span>
                      </span>
                      <span className={s.hitText}>
                        {m.payload?.t ? highlight(m.payload.t, parsed).map((r, k) => (r.hit ? <mark key={k}>{r.text}</mark> : <span key={k}>{r.text}</span>)) : m.payload?.sticker ? t("chat.messageItem.sticker") : m.payload?.att?.length ? t("modals.quickSwitcher.filesCount", { count: m.payload.att.length }) : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
        <div className={s.foot}>{t("modals.quickSwitcher.keyHints")}</div>
      </div>
    </Modal>
  );
}
