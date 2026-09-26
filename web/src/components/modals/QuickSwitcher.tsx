/**
 * Find or start a conversation (Ctrl+K): the one place to find anything.
 *
 * As you type it offers where to go (people, conversations, servers,
 * channels) and the newest messages that match, from everywhere. Enter, or
 * "See all results", searches: the results then fill the dialog with tabs for
 * messages, media, links and files, a sort, and the same chips, suggestions
 * and rows as the search above a conversation (components/search).
 */
import { ArrowLeft, CornerDownLeft, Hash, Search as SearchIcon, Server as ServerIcon, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { channels as channelsApi } from "@/api/channels";
import { ApiError } from "@/api/client";
import { Avatar } from "@/components/common/Avatar";
import { Modal } from "@/components/common/Modal";
import { SearchBox } from "@/components/common/SearchBox";
import { IndexStatus, useScopeProgress } from "@/components/search/IndexStatus";
import { QueryChips } from "@/components/search/QueryChips";
import { EVERYWHERE, useNames } from "@/components/search/scope";
import { MessageHit, SearchResults } from "@/components/search/SearchResults";
import { groupTitle, SearchSuggestions, SuggestionRow, useSuggestionKeys } from "@/components/search/SearchSuggestions";
import { suggestionChannels } from "@/components/search/SearchPanel";
import { partialAt, replacePiece, suggest, type Suggestion, type SuggestionGroup } from "@/components/search/suggest";
import { useSearch } from "@/components/search/useSearch";
import { useIsMobile } from "@/hooks/useIsMobile";
import { t } from "@/i18n";
import { channelDisplayName } from "@/lib/names";
import type { SearchDoc } from "@/search/doc";
import type { Sort, Tab } from "@/search/engine";
import { fold } from "@/search/text";
import { clearRecentSearches, rememberSearch } from "@/search/recent";
import { useAuth } from "@/stores/auth";
import { selectDMs, selectServerChannels, useChannels } from "@/stores/channels";
import { useRelationships } from "@/stores/relationships";
import { useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import ss from "@/components/search/Search.module.css";
import s from "./QuickSwitcher.module.css";

interface Place {
  id: string;
  kind: "dm" | "group" | "friend" | "channel" | "server";
  label: string;
  sub: string;
  avatarId: string | null;
  avatarKey: string;
  go: () => void;
}

/** How well a name matches what was typed: whole, its start, a word's start, inside it, or its letters in order. */
function score(hay: string, q: string): number {
  const h = fold(hay);
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  if (h.split(/[\s._-]+/).some((w) => w.startsWith(q))) return 60;
  if (h.includes(q)) return 50;
  let qi = 0;
  for (const c of h) if (qi < q.length && c === q[qi]) qi++;
  return qi === q.length ? 20 : -1;
}

/** Where to go: every conversation, server and channel, and friends there is no conversation with yet. */
function usePlaces(close: () => void): Place[] {
  const nav = useNavigate();
  const meId = useAuth((a) => a.me?.id);
  const channels = useChannels((c) => c.byId);
  const upsert = useChannels((c) => c.upsert);
  const users = useUsers((u) => u.byId);
  const rels = useRelationships((r) => r.byUser);
  const servers = useServers((st) => st.byId);
  return useMemo(() => {
    const out: Place[] = [];
    const go = (path: string) => () => {
      close();
      nav(path);
    };
    const withDM = new Set<string>();
    for (const ch of selectDMs(channels)) {
      const label = channelDisplayName(ch, users, meId);
      if (ch.type === "dm") {
        const other = ch.recipient_ids.find((id) => id !== meId) ?? "";
        withDM.add(other);
        out.push({ id: ch.id, kind: "dm", label, sub: `@${users[other]?.username ?? ""}`, avatarId: users[other]?.avatar_id ?? null, avatarKey: other, go: go(`/channels/@me/${ch.id}`) });
      } else {
        out.push({ id: ch.id, kind: "group", label, sub: t("chat.chatView.membersCount", { count: ch.recipient_ids.length }), avatarId: ch.icon_id, avatarKey: ch.id, go: go(`/channels/@me/${ch.id}`) });
      }
    }
    for (const r of Object.values(rels)) {
      if (r.type !== "friend" || withDM.has(r.user.id)) continue;
      out.push({
        id: `u${r.user.id}`,
        kind: "friend",
        label: r.nickname || r.user.display_name,
        sub: `@${r.user.username}`,
        avatarId: r.user.avatar_id,
        avatarKey: r.user.id,
        go: () => {
          close();
          void channelsApi
            .createDM([r.user.id])
            .then((ch) => {
              upsert(ch);
              nav(`/channels/@me/${ch.id}`);
            })
            .catch((err: unknown) => useUI.getState().toast(err instanceof ApiError ? err.message : t("modals.quickSwitcher.couldNotOpenTheConversation"), "error"));
        },
      });
    }
    for (const st of Object.values(servers)) {
      out.push({ id: `s${st.server.id}`, kind: "server", label: st.server.name, sub: t("search.switcher.server"), avatarId: st.server.icon_id, avatarKey: st.server.id, go: go(`/channels/${st.server.id}`) });
      for (const ch of selectServerChannels(channels, st.server.id)) {
        if (ch.type !== "text") continue;
        out.push({ id: ch.id, kind: "channel", label: ch.name, sub: st.server.name, avatarId: null, avatarKey: ch.id, go: go(`/channels/${st.server.id}/${ch.id}`) });
      }
    }
    return out;
  }, [channels, users, rels, servers, meId, nav, upsert, close]);
}

function PlaceIcon({ p }: { p: Place }) {
  if (p.kind === "channel") return <span className={s.glyph}><Hash size={18} /></span>;
  if (p.kind === "group" && !p.avatarId) return <span className={s.glyph}><Users size={18} /></span>;
  if (p.kind === "server") return p.avatarId ? <Avatar id={p.avatarKey} avatarId={p.avatarId} name={p.label} size={28} kind="icon" square /> : <span className={s.glyph}><ServerIcon size={18} /></span>;
  return <Avatar id={p.avatarKey} avatarId={p.avatarId} name={p.label} size={28} kind={p.kind === "group" ? "icon" : "avatar"} />;
}

type Option = { id: string; kind: "place"; place: Place } | { id: string; kind: "message"; doc: SearchDoc } | { id: string; kind: "all" } | { id: string; kind: "suggestion"; sg: Suggestion };

interface Section {
  key: string;
  title: string;
  action?: ReactNode;
  options: Option[];
  /** Said under the rows: why there are none yet. */
  note?: string;
}

export function QuickSwitcher() {
  const open = useUI((u) => u.quickSwitcher);
  const setOpen = useUI((u) => u.setQuickSwitcher);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUI.getState().quickSwitcher);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  if (!open) return null;
  return <Finder onClose={() => setOpen(false)} />;
}

function Finder({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const mobile = useIsMobile();
  const byId = useChannels((c) => c.byId);
  const names = useNames();
  const recent = useSettings((x) => x.settings.searchRecent);
  const [q, setQ] = useState("");
  const [caret, setCaret] = useState(0);
  /** Enter was pressed: the dialog shows the full results, in tabs. */
  const [searched, setSearched] = useState(false);
  const [tab, setTab] = useState<Tab>("messages");
  const [sort, setSort] = useState<Sort>("newest");
  const [dismissed, setDismissed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const listId = useId();
  const places = usePlaces(onClose);

  // Straight into the box, on a phone too: this dialog is for typing, and the
  // keyboard coming up is what someone who opened it wants. (A dialog's own
  // focus goes to the card on a touch screen, and autoFocus fires before the
  // dialog is in the page, so it is asked for once it is.)
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  // An empty box starts over; the choice of tab and order stays while it is open.
  useEffect(() => {
    if (!q.trim()) setSearched(false);
    setDismissed(false);
  }, [q]);

  const run = useSearch({ raw: q, scope: EVERYWHERE, tab: searched ? tab : "messages", sort: searched ? sort : "newest", names, ...(searched ? {} : { pageSize: 5 }) });
  const { st, p } = useScopeProgress(run.channels);
  const walking = p.done < p.total && st.mode !== "closed";
  const candidates = useMemo(() => suggestionChannels(byId, null), [byId]);
  const partial = useMemo(() => partialAt(q, Math.min(caret, q.length)), [q, caret]);
  const typingFilter = !!partial?.key;
  const groups = useMemo<SuggestionGroup[]>(() => {
    if (dismissed) return [];
    const all = suggest({ raw: q, caret: Math.min(caret, q.length), names, channels: candidates, nearby: [], recent, now: Date.now() });
    // an empty box offers the last searches, and the conversations below;
    // a plain word's people and conversations are already under "Jump to"
    if (!q.trim()) return all.filter((g) => g.kind === "recent");
    return searched ? all : all.filter((g) => g.kind !== "filters");
  }, [dismissed, q, caret, names, candidates, recent, searched]);

  const scored = useMemo(() => {
    if (!q.trim()) return places.filter((pl) => pl.kind === "dm" || pl.kind === "group").slice(0, 6).map((pl) => ({ pl, sc: 0 }));
    const hasFilters = run.parsed.tokens.some((tk) => tk.kind === "filter");
    const query = fold(run.parsed.terms.join(" ").replace(/^[@#]/, ""));
    if (!query || hasFilters) return [];
    return places
      .map((pl) => ({ pl, sc: Math.max(score(pl.label, query), score(pl.sub.replace(/^@/, ""), query) - 5) }))
      .filter((x) => x.sc >= 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 6);
  }, [places, q, run.parsed]);
  const matches = useMemo(() => scored.map((x) => x.pl), [scored]);
  // A name typed (its start, a word's start, inside it) is where Enter goes.
  // Letters that only happen to come in order in a long name are offered, but
  // Enter searches the words instead: "hello" is not a trip to #a-channel-with-a-long-name.
  const nameTyped = (scored[0]?.sc ?? 0) >= 50;

  const commit = useCallback(() => {
    if (!q.trim()) return;
    rememberSearch(q);
    setSearched(true);
    setDismissed(true);
  }, [q]);

  const pickSuggestion = useCallback((sg: Suggestion) => {
    setQ(sg.text);
    setCaret(sg.caret);
    // a recent search is searched again at once
    if (sg.kind === "recent") {
      rememberSearch(sg.text);
      setSearched(true);
      return;
    }
    requestAnimationFrame(() => {
      input.current?.focus({ preventScroll: true });
      input.current?.setSelectionRange(sg.caret, sg.caret);
    });
  }, []);
  const onDate = useCallback(
    (key: string, value: string) => {
      const piece = partialAt(q, Math.min(caret, q.length));
      if (!piece) return;
      const next = replacePiece(q, piece, `${key}:${value}`, true);
      pickSuggestion({ id: "date", kind: "date", text: next.text, caret: next.caret });
    },
    [q, caret, pickSuggestion],
  );

  const jump = useCallback(
    (d: SearchDoc) => {
      const ch = useChannels.getState().byId[d.c];
      if (!ch) return;
      rememberSearch(q);
      onClose();
      nav(ch.server_id ? `/channels/${ch.server_id}/${ch.id}/${d.id}` : `/channels/@me/${ch.id}/${d.id}`);
      useUI.getState().setJumpTo({ channelId: ch.id, messageId: d.id });
    },
    [q, onClose, nav],
  );

  // Before Enter everything is one list the arrow keys go through, in the
  // order it is drawn: suggestions, places, the messages found, "See all".
  const sections = useMemo<Section[]>(() => {
    if (searched) return [];
    const out: Section[] = groups.map((g) => ({
      key: g.kind,
      title: groupTitle(g.kind),
      ...(g.kind === "recent" ? { action: <button type="button" className={s.sectionAction} onMouseDown={(e) => e.preventDefault()} onClick={clearRecentSearches}>{t("search.suggest.clearRecent")}</button> } : {}),
      options: g.items.map((sg): Option => ({ id: `sg-${sg.id}`, kind: "suggestion", sg })),
    }));
    if (typingFilter) return out;
    if (matches.length) out.push({ key: "places", title: q.trim() ? t("search.switcher.jumpTo") : t("search.suggest.conversations"), options: matches.map((pl): Option => ({ id: `pl-${pl.id}`, kind: "place", place: pl })) });
    if (!run.empty) {
      const found = run.result.docs.slice(0, 5).map((d): Option => ({ id: `m-${d.id}`, kind: "message", doc: d }));
      out.push({
        key: "messages",
        title: t("search.tab.messages"),
        options: [...found, { id: "all", kind: "all" }],
        ...(found.length === 0 && !run.pending ? { note: walking ? t("search.switcher.noneYet") : t("search.none.messages") } : {}),
      });
    }
    return out;
  }, [searched, groups, typingFilter, matches, q, run.empty, run.result.docs, run.pending, walking]);
  const options = useMemo(() => sections.flatMap((sec) => sec.options), [sections]);
  const [active, setActive] = useState(-1);
  // A name typed lands on the place it names, so Enter goes there; words
  // typed land on nothing, so Enter searches them and brings up the tabs.
  // The same list worked out again (the index filling in) keeps its row.
  const optionSig = options.map((o) => o.id).join("\n");
  const firstIsPlace = options[0]?.kind === "place" && nameTyped;
  useEffect(() => setActive(q.trim() && !typingFilter && firstIsPlace ? 0 : -1), [optionSig, q, typingFilter, firstIsPlace]);
  const choose = (o: Option | undefined) => {
    if (!o || o.kind === "all") return commit();
    if (o.kind === "suggestion") return pickSuggestion(o.sg);
    if (o.kind === "place") return o.place.go();
    jump(o.doc);
  };
  const domId = (o: Option) => `${listId}-${o.id}`;

  // after Enter the suggestions float over the results, as above a conversation
  const floating = searched ? groups : [];
  const sk = useSuggestionKeys(floating, pickSuggestion, () => setDismissed(true));

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (searched) {
      if (sk.key(e)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "ArrowDown") {
        const first = body.current?.querySelector<HTMLElement>("[data-result], [data-tile]");
        if (first) {
          e.preventDefault();
          first.focus();
        }
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (options.length === 0) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a < 0 ? (step > 0 ? 0 : options.length - 1) : (a + step + options.length) % options.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active >= 0 ? options[active] : undefined);
    } else if (e.key === "Tab" && !e.shiftKey && active >= 0 && options[active]?.kind === "suggestion") {
      e.preventDefault();
      choose(options[active]);
    }
  };
  const activeDom = searched ? (sk.activeId ? `${listId}-float-${sk.activeId}` : undefined) : active >= 0 && options[active] ? domId(options[active]!) : undefined;

  const row = (o: Option): ReactNode => {
    switch (o.kind) {
      case "suggestion":
        return <SuggestionRow item={o.sg} names={names} onDate={onDate} />;
      case "place":
        return (
          <>
            <PlaceIcon p={o.place} />
            <span className={s.label} dir="auto">{o.place.kind === "channel" ? o.place.label : o.place.label}</span>
            <span className={s.sub} dir="auto">
              {o.place.kind === "friend" ? (
                <>
                  <UserPlus size={14} aria-hidden="true" /> {t("search.switcher.startConversation")}
                </>
              ) : (
                o.place.sub
              )}
            </span>
          </>
        );
      case "message":
        return <MessageHit doc={o.doc} needles={run.needles} names={names} showWhere dated={false} onJump={jump} asOption />;
      case "all":
        return (
          <>
            <span className={s.glyph}><SearchIcon size={18} /></span>
            <span className={s.label}>{run.result.counts.messages > 5 ? t("search.switcher.seeAll", { count: run.result.counts.messages }) : t("search.switcher.searchAll")}</span>
            <span className={s.sub} aria-hidden="true"><CornerDownLeft size={14} /></span>
          </>
        );
    }
  };

  let content: ReactNode;
  if (searched) {
    content = (
      <div className={ss.panelBody}>
        {floating.length ? <SearchSuggestions groups={floating} active={sk.active} listId={`${listId}-float`} names={names} onPick={pickSuggestion} onHover={sk.setActive} onDate={onDate} /> : null}
        <SearchResults run={run} tab={tab} onTab={setTab} sort={sort} onSort={setSort} names={names} onJump={jump} scoped={false} walking={walking} />
      </div>
    );
  } else {
    let index = -1;
    content = (
      <div className={s.list} role="listbox" id={listId} aria-label={t("search.switcher.label")}>
        {sections.map((sec) => (
          <div key={sec.key} className={s.section} role="group" aria-label={sec.title}>
            <div className={s.sectionHead}>
              <span aria-hidden="true">{sec.title}</span>
              {sec.action}
            </div>
            {sec.options.map((o) => {
              index += 1;
              const at = index;
              const kind = o.kind === "suggestion" ? o.sg.kind : o.kind;
              return (
                <div
                  key={o.id}
                  id={domId(o)}
                  role="option"
                  aria-selected={at === active}
                  data-active={at === active || undefined}
                  data-kind={kind}
                  className={s.option}
                  // the box keeps focus (and the keyboard stays up on a phone)
                  onMouseDown={(e) => kind !== "pickDate" && e.preventDefault()}
                  // a pointer that moves chooses; rows sliding under a still one do not
                  onMouseMove={() => active !== at && setActive(at)}
                  onClick={() => kind !== "pickDate" && choose(o)}
                  data-testid={o.kind === "place" ? "switcher-place" : o.kind === "message" ? "switcher-hit" : o.kind === "all" ? "switcher-all" : "switcher-suggestion"}
                >
                  {row(o)}
                </div>
              );
            })}
            {sec.note ? <p className={s.note}>{sec.note}</p> : null}
          </div>
        ))}
        {q.trim() && sections.length === 0 ? <p className={s.note}>{t("search.switcher.nothing")}</p> : null}
        {!q.trim() ? <p className={s.tip}>{t("search.switcher.tip")}</p> : null}
      </div>
    );
  }

  return (
    <Modal open onClose={onClose} width={760} bare className={[s.top, searched ? s.tall : "", mobile ? s.full : ""].join(" ")} ariaLabel={t("sidebar.dMSidebar.findOrStartAConversation")}>
      <div className={s.box} data-testid="switcher" data-searched={searched || undefined}>
        <div className={s.inputRow}>
          {mobile ? (
            <button type="button" className={s.back} aria-label={t("search.panel.close")} onClick={onClose}>
              <ArrowLeft size={22} />
            </button>
          ) : null}
          <SearchBox
            ref={input}
            className={s.field}
            value={q}
            onChange={(v) => {
              setQ(v);
              setCaret(v.length);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? q.length)}
            placeholder={t("search.switcher.placeholder")}
            aria-label={t("sidebar.dMSidebar.findOrStartAConversation")}
            data-testid="switcher-input"
            dir="auto"
            role="combobox"
            aria-expanded={searched ? floating.length > 0 : options.length > 0}
            aria-controls={searched ? (floating.length ? `${listId}-float` : undefined) : listId}
            aria-autocomplete="list"
            aria-activedescendant={activeDom}
            onKeyDown={keys}
            onEscape={onClose}
          />
        </div>
        <QueryChips raw={q} parsed={run.parsed} resolved={run.resolved} names={names} onChange={setQ} />
        <div ref={body} className={s.body}>{content}</div>
        <div className={s.foot}>
          {!mobile && !searched ? <span className={s.hints}>{t("search.switcher.hints")}</span> : null}
          <IndexStatus channels={run.channels} scope={EVERYWHERE} />
        </div>
      </div>
    </Modal>
  );
}
