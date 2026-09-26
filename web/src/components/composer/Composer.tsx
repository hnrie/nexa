import { CirclePlus, SendHorizontal, Smile, X, Eye, EyeOff, Trash2, Timer, Type, File as FileIcon } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type SyntheticEvent } from "react";
import { lazyPage } from "@/lib/lazyChunk";
import type { Channel } from "@/api/types";
import { gateway } from "@/gateway/session";
import { formatBytes } from "@/lib/time";
import { favoriteFile } from "@/lib/gifFavorites";
import { fitsUploadLimit, stage, uploadLimit, type Staged } from "@/lib/attachments";
import { useAuth } from "@/stores/auth";
import { useMessages } from "@/stores/messages";
import { useRelationships } from "@/stores/relationships";
import { usePaneScope } from "@/components/shell/paneScope";
import { useSettings } from "@/stores/settings";
import { useSelection } from "@/stores/selection";
import { DropOverlay } from "./DropOverlay";
import { useUI } from "@/stores/ui";
import { canEdit } from "@/components/chat/messageMenu";
import { useUsers } from "@/stores/users";
import { canI, rolesByPosition, useServers } from "@/stores/servers";
import { useChannels } from "@/stores/channels";
import { slowmodeRemaining, useSlowmode } from "@/stores/slowmode";
import { P } from "@/lib/perms";
import { ExpressionPicker } from "@/components/pickers/ExpressionPicker";
import { GifPicker } from "@/components/pickers/GifPicker";
import { StickerPicker } from "@/components/pickers/StickerPicker";
import { emojiToken, searchCustomEmoji, searchPackEmoji, useExpressions } from "@/stores/expressions";
import { expressions as expressionsApi } from "@/api/expressions";
import { extractUrls } from "@/markdown";
import { emojiLoaded, loadEmoji, preloadEmoji, searchEmoji, withTone } from "@/components/pickers/emojiIndex";
import { channelDisplayName } from "@/lib/names";
import { Autocomplete, type AcItem, AC_LIST_ID, acOptionId } from "./Autocomplete";
import { commands, runCommand } from "./commands";
import { rankPeople, recentSpeakers } from "./rankPeople";
import { servers as serversApi } from "@/api/servers";
import { useShownName } from "@/components/chat/useShownName";
import { createLinkPreviews } from "./linkPreviews";
import { mentionScope, sendMessage, sendWithFiles, type SendOptions } from "./send";
import { extractMentions } from "./mentions";
import { useUploads } from "@/stores/uploads";
import { useAutosize } from "./useAutosize";
import type { RefObject } from "react";
import s from "./Composer.module.css";

import { t as tr_, Tr } from "@/i18n";
import { formatShortDuration } from "@/lib/time";
import { MAX_MESSAGE_LENGTH, pasteOverflows, tooLong, tooLongMessage } from "./limit";
import { MessageCounter } from "./MessageCounter";
import { applyWrap, formatShortcut } from "./wrapShortcut";
/** How many files one message carries. */
const MAX_FILES = 10;
// a stable empty tray, so a conversation with nothing in it does not re-render on every change to another
const NO_FILES: Staged[] = [];
const TYPING_INTERVAL = 8000;
/** How long Send waits for link previews that are still on their way. */
const PREVIEW_WAIT = 1500;

/**
 * Saves a draft only once the account's settings are in. Before that the store
 * holds the defaults, and a draft written into them would be lost on load.
 */
function saveDraft(channelId: string, text: string): void {
  const st = useSettings.getState();
  if (st.loaded) st.setDraft(channelId, text);
}

type AcKind = "user" | "emoji" | "command" | "channel";

/** What the box has to say above itself, until it is dealt with. */
type Notice = { kind: "long"; text: string; start: number; end: number } | { kind: "files"; dropped: string[] };

/** The word being typed at the caret, when it asks for suggestions: @someone, #channel (in a server), :emoji or a /command. */
function acToken(text: string, caret: number, channels: boolean): { kind: AcKind; query: string; start: number } | null {
  const before = text.slice(0, caret);
  // names in any script: someone called Émile or سارة is found by typing their name
  const m = /(?:^|\s)(@[\p{L}\p{N}_.-]*|#[\p{L}\p{N}_-]*|:[\w+-]{2,}|^\/\w*)$/iu.exec(before);
  if (!m) return null;
  const token = m[1]!;
  const start = caret - token.length;
  if (token.startsWith("@")) return { kind: "user", query: token.slice(1).toLowerCase(), start };
  if (token.startsWith("#")) return channels ? { kind: "channel", query: token.slice(1).toLowerCase(), start } : null;
  if (token.startsWith(":")) return { kind: "emoji", query: token.slice(1).toLowerCase(), start };
  if (start === 0 && token.startsWith("/")) return { kind: "command", query: token.slice(1).toLowerCase(), start };
  return null;
}

/** Matches that start with what was typed come before ones that only contain it. */
function byPrefix(query: string, ...names: string[]): number {
  return names.some((n) => n.toLowerCase().startsWith(query)) ? 0 : 1;
}


const loadFormatEditor = () => import("./format/FormatEditor");
/** The formatting editor is its own download, fetched when the pointer comes near its button. */
const FormatEditor = lazyPage(loadFormatEditor);
function preloadFormatEditor(): void {
  void loadFormatEditor().catch(() => undefined);
}

/** A phone-sized touch screen, where Return starts a new line. */
function phoneKeyboard(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse) and (max-width: 767px)").matches;
}
export function Composer({ channel }: { channel: Channel }) {
  const { focused: paneFocused } = usePaneScope();
  const me = useAuth((a) => a.me);
  const users = useUsers((u) => u.byId);
  const rels = useRelationships((r) => r.byUser);
  const replyTo = useUI((u) => u.replyTo);
  const setReplyTo = useUI((u) => u.setReplyTo);
  const setEditing = useUI((u) => u.setEditing);
  const toast = useUI((u) => u.toast);
  const drafts = useSettings((st) => st.settings.drafts);
  const settingsLoaded = useSettings((st) => st.loaded);
  const tone = useSettings((st) => st.settings.skinTone);
  const spellcheck = useSettings((st) => st.settings.spellcheck !== false);
  const msgs = useMessages((m) => m.channels[channel.id]);
  const serverState = useServers((st) => (channel.server_id ? st.byId[channel.server_id] : undefined));
  const isServer = !!channel.server_id;
  const canSend = !isServer || canI(serverState, P.SEND_MESSAGES, channel.id);
  const canAttach = !isServer || canI(serverState, P.ATTACH_FILES, channel.id);
  const canEveryone = !isServer || canI(serverState, P.MENTION_EVERYONE, channel.id);
  const bypassSlowmode = isServer && canI(serverState, P.MANAGE_MESSAGES, channel.id);
  const slow = useSlowmode();
  const [now, setNow] = useState(() => Date.now());
  const remaining = channel.slowmode_seconds > 0 && !bypassSlowmode ? slowmodeRemaining(slow, channel.id, channel.slowmode_seconds, now) : 0;
  // the emoji set loads in a quiet moment, so the picker and :shortcodes: never wait for it
  useEffect(() => preloadEmoji(), []);
  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [remaining]);
  const [text, setText] = useState(() => drafts[channel.id] ?? "");
  // this conversation's tray, which keeps going up while the box is elsewhere
  const files = useUploads((u) => u.trays[channel.id]) ?? NO_FILES;
  const [picker, setPicker] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [ac, setAc] = useState<{ items: AcItem[]; index: number; start: number; kind: AcKind } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<{ channelId: string; text: string } | null>(null);
  // Whether the text in the box was typed here rather than restored from the draft.
  const touched = useRef(false);
  // What the box holds right now, for a send that finishes after the user moved on.
  const textRef = useRef(text);
  textRef.current = text;
  const channelRef = useRef(channel.id);
  channelRef.current = channel.id;
  const lastSelect = useRef("");
  /** A message that looked like a command the app does not have, sent once already: the second time it goes as it is. */
  const sendAsIs = useRef<string | null>(null);
  // Link previews are made by the sender (so recipients never fetch the
  // address) and ride inside the encrypted payload. They are asked for when
  // the message is sent, never while it is typed: a link in a draft that is
  // abandoned, or pasted in the wrong box and deleted, is nobody's business,
  // which is what the setting promises.
  const linkPreviews = useSettings((st) => st.settings.linkPreviews);
  const [previews] = useState(createLinkPreviews);
  /** Something the box has to say: a paste too long for a message, files that did not fit. */
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const open = () => setPicker(true);
    window.addEventListener("ec:open-emoji", open);
    return () => window.removeEventListener("ec:open-emoji", open);
  }, []);
  useEffect(() => {
    const onInsert = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail !== "string") return;
      const ta = taRef.current;
      const caret = ta?.selectionStart ?? text.length;
      const end = ta?.selectionEnd ?? caret;
      const next = text.slice(0, caret) + detail + text.slice(end);
      touched.current = true;
      setText(next);
      persistDraft(next);
      setTimeout(() => {
        ta?.focus();
        ta?.setSelectionRange(caret + detail.length, caret + detail.length);
      }, 0);
    };
    window.addEventListener("ec:insert-text", onInsert);
    return () => window.removeEventListener("ec:insert-text", onInsert);
  });
  useAutosize(taRef, text, Math.floor((typeof window !== "undefined" ? window.innerHeight : 800) * 0.5));
  useKeepFocused(taRef, paneFocused);

  const name = channelDisplayName(channel, users, me?.id);
  const placeholder = channel.type === "dm" ? tr_("composer.composer.messageUser", { name }) : isServer ? tr_("composer.composer.messageChannel", { name }) : tr_("composer.composer.messageGroup", { name });

  useEffect(() => {
    if (lastTyping.current) {
      lastTyping.current = 0;
      gateway()?.sendTypingStop(channel.id);
    }
    touched.current = false;
    setText(useSettings.getState().settings.drafts[channel.id] ?? "");
    setAc(null);
    setNotice(null);
    setFormatting(false);
    // On a touch screen a focus right after the tap that opened the conversation raises the keyboard over it.
    // In a split, only the pane you are actually in may take the caret.
    if (paneFocused && window.matchMedia?.("(pointer: fine)")?.matches) setTimeout(() => taRef.current?.focus(), 0);
    return () => {
      // the last words typed before leaving are still waiting on the save timer
      if (draftTimer.current) {
        clearTimeout(draftTimer.current);
        draftTimer.current = null;
        const p = pendingDraft.current;
        if (p) saveDraft(p.channelId, p.text);
      }
      pendingDraft.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  const persistDraft = useCallback((value: string) => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const p = { channelId: channel.id, text: value };
    pendingDraft.current = p;
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      pendingDraft.current = null;
      saveDraft(p.channelId, p.text);
    }, 600);
  }, [channel.id]);

  // The box can open before the account's settings arrive: show the saved
  // draft once they do, or save what was typed meanwhile.
  useEffect(() => {
    if (!settingsLoaded) return;
    if (touched.current) persistDraft(textRef.current);
    else setText(useSettings.getState().settings.drafts[channelRef.current] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);

  const refreshAc = useCallback((value: string, caret: number) => {
    const tok = acToken(value, caret, !!serverState);
    if (!tok) return setAc(null);
    let items: AcItem[] = [];
    if (tok.kind === "user") {
      const pool = new Map<string, typeof users[string]>();
      if (serverState) {
        for (const id of Object.keys(serverState.members)) if (users[id]) pool.set(id, users[id]!);
      } else {
        // DMs and group DMs only suggest the people in the conversation, never
        // the whole friends list: a ping to someone outside cannot notify them.
        for (const id of channel.recipient_ids) {
          const rel = rels[id];
          const u = users[id] ?? (rel?.type === "friend" ? rel.user : undefined);
          if (u) pool.set(id, u);
        }
      }
      const q = tok.query;
      const nick = (id: string) => serverState?.members[id]?.nickname ?? "";
      // who spoke here lately, newest first, leads each group of matches
      const here = useMessages.getState().channels[channel.id];
      const authors = here ? here.ids.slice(-100).reverse().map((id) => here.byId[id]?.author_id ?? "") : [];
      const people = rankPeople(q, [...pool.values()], nick, recentSpeakers(authors, me?.id));
      items = people.slice(0, 8).map((u) => ({ kind: "user", user: u }));
      // A big server's members arrive a page at a time, so whoever is not
      // loaded yet is asked of the server by name, and the list follows.
      if (serverState && !serverState.membersComplete && q.length >= 2 && people.length < 8) searchMembers(serverState.server.id, q);
      // Roles anyone may ping, or every role for those who may ping @everyone.
      // @everyone itself is not a role here: it has its own row.
      if (serverState) {
        const roles = rolesByPosition(serverState)
          .filter((r) => r.id !== serverState.server.id && (r.mentionable || canEveryone) && (!q || r.name.toLowerCase().includes(q)))
          .sort((a, b) => byPrefix(q, a.name) - byPrefix(q, b.name))
          .slice(0, 5);
        for (const role of roles) items.push({ kind: "role", role });
      }
      if (canEveryone && isServer && "everyone".startsWith(q)) items.unshift({ kind: "command", name: "everyone", desc: tr_("composer.composer.notifyEveryoneWhoCanSeeThis") });
      if (canEveryone && isServer && q && "here".startsWith(q)) items.unshift({ kind: "command", name: "here", desc: tr_("composer.composer.notifyEveryoneOnlineInThisChannel") });
    } else if (tok.kind === "channel") {
      const q = tok.query;
      const all = useChannels.getState().byId;
      items = Object.values(all)
        .filter((c) => c.server_id === channel.server_id && c.type === "text" && (!q || c.name.toLowerCase().includes(q)) && canI(serverState, P.VIEW_CHANNEL, c.id))
        .sort((a, b) => byPrefix(q, a.name) - byPrefix(q, b.name) || a.position - b.position)
        .slice(0, 8)
        .map((c) => ({ kind: "channel", channel: c, category: c.parent_id ? all[c.parent_id]?.name : undefined }));
    } else if (tok.kind === "emoji") {
      // Re-read from the box rather than reusing the keystroke that started
      // the load: by the time the set arrives the text may be gone, or belong
      // to another channel, and picking an entry would splice at the old offset.
      if (!emojiLoaded()) {
        const forChannel = channelRef.current;
        void loadEmoji().then(
          () => {
            const ta = taRef.current;
            if (!ta || channelRef.current !== forChannel) return;
            refreshAc(ta.value, ta.selectionStart ?? ta.value.length);
          },
          () => undefined,
        );
      }
      const ex = useExpressions.getState();
      // this server's own emoji first: its :name: is the one a message here gets
      const sid = channel.server_id;
      const others = Object.fromEntries(Object.entries(ex.emojis).filter(([id]) => id !== sid));
      const own = sid ? searchCustomEmoji({ [sid]: ex.emojis[sid] ?? [] }, tok.query, 4) : [];
      const custom = [...own, ...searchCustomEmoji(others, tok.query, 4 - own.length)].map((e) => ({ kind: "customEmoji" as const, emoji: e }));
      const fromPacks = searchPackEmoji(ex.packs, tok.query, 4 - Math.min(custom.length, 4)).map((r) => ({
        kind: "customEmoji" as const,
        emoji: { id: r.sticker.id, server_id: "", name: r.sticker.name, blob_id: r.sticker.blob_id, animated: r.sticker.animated, creator_id: r.sticker.creator_id, created_at: r.sticker.created_at },
      }));
      const all = [...custom, ...fromPacks];
      items = [...all, ...searchEmoji(tok.query, Math.max(2, 8 - all.length)).map((e) => ({ kind: "emoji" as const, entry: e }))];
    } else {
      items = commands().filter((c) => c.name.startsWith(tok.query)).map((c) => ({ kind: "command", name: c.name, desc: c.desc }));
    }
    setAc(items.length ? { items, index: 0, start: tok.start, kind: tok.kind } : null);
    // serverState, canEveryone and isServer are read above and change on their
    // own: without them a role that just granted @everyone, or members that
    // arrived after this was built, never showed up in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, rels, channel.id, channel.recipient_ids, channel.server_id, serverState, canEveryone, isServer, me?.id]);

  /** Asks the server for members by name, once per name, a moment after the typing stops. */
  const asked = useRef(new Set<string>());
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchMembers = (serverId: string, q: string) => {
    const key = `${serverId}:${q}`;
    if (asked.current.has(key)) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      asked.current.add(key);
      serversApi
        .members(serverId, { q, limit: 8 })
        .then((res) => {
          useUsers.getState().upsert(res.users);
          useServers.getState().upsertMembers(serverId, res.members);
          // the list follows, if the same name is still being typed
          const ta = taRef.current;
          if (ta && channelRef.current === channel.id) refreshAcRef.current(ta.value, ta.selectionStart ?? ta.value.length);
        })
        .catch(() => asked.current.delete(key));
    }, 250);
  };
  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);
  const refreshAcRef = useRef(refreshAc);
  refreshAcRef.current = refreshAc;

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    touched.current = true;
    setText(value);
    persistDraft(value);
    const caret = e.target.selectionStart ?? value.length;
    lastSelect.current = `${caret}:${e.target.selectionEnd}:${value}`;
    refreshAc(value, caret);
    const now = Date.now();
    if (value.trim() && now - lastTyping.current > TYPING_INTERVAL) {
      lastTyping.current = now;
      gateway()?.sendTyping(channel.id);
    } else if (!value.trim() && lastTyping.current) {
      // clearing the box stops the indicator for everyone else at once
      lastTyping.current = 0;
      gateway()?.sendTypingStop(channel.id);
    }
  };

  // Arrow keys and clicks move the caret without a change event; the popup must follow it or pick into the wrong place.
  const onSelect = (e: SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const caret = el.selectionStart ?? el.value.length;
    const key = `${caret}:${el.selectionEnd}:${el.value}`;
    if (key === lastSelect.current) return;
    lastSelect.current = key;
    if (!ac) return;
    if (el.selectionEnd !== caret) setAc(null);
    else refreshAc(el.value, caret);
  };

  const insertAt = (start: number, end: number, insert: string) => {
    const next = text.slice(0, start) + insert + text.slice(end);
    touched.current = true;
    setText(next);
    persistDraft(next);
    setAc(null);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      const pos = start + insert.length;
      el.setSelectionRange(pos, pos);
    });
  };

  /**
   * A custom emoji as it reads in the box: its :name:, when sending that
   * name brings back this very emoji (this server's own, or a name nothing
   * else answers to), and its raw token otherwise, which is never wrong.
   */
  const emojiText = (token: string, name: string): string => {
    const short = `:${name}:`;
    return extractMentions(short, {}, mentionScope(channel.id)).text === token ? short : token;
  };

  const pickAc = (i: number) => {
    if (!ac) return;
    const it = ac.items[i];
    if (!it) return;
    const caret = taRef.current?.selectionStart ?? text.length;
    if (it.kind === "user") insertAt(ac.start, caret, `@${it.user.username} `);
    else if (it.kind === "role") insertAt(ac.start, caret, `@${it.role.name} `);
    else if (it.kind === "channel") insertAt(ac.start, caret, `#${it.channel.name} `);
    else if (it.kind === "command" && ac.kind === "user") insertAt(ac.start, caret, `@${it.name} `);
    else if (it.kind === "emoji") insertAt(ac.start, caret, `${withTone(it.entry, tone)} `);
    else if (it.kind === "customEmoji") insertAt(ac.start, caret, `${emojiText(emojiToken(it.emoji), it.emoji.name)} `);
    else insertAt(ac.start, caret, `/${it.name} `);
  };

  const addFiles = (list: FileList | File[]) => {
    if (!canAttach) {
      toast(tr_("composer.composer.noUploadPermission"), "error");
      return;
    }
    const staged: Staged[] = [];
    for (const f of Array.from(list)) {
      const max = uploadLimit();
      if (!fitsUploadLimit(f.size)) {
        const gb = max / (1024 * 1024 * 1024);
        toast(tr_("composer.composer.overServerLimit", { name: f.name, limit: gb >= 1 ? tr_("composer.composer.gigabytes", { n: Math.round(gb * 10) / 10 }) : tr_("composer.composer.megabytes", { n: Math.round(max / (1024 * 1024)) }) }), "error");
        continue;
      }
      staged.push(stage(f));
    }
    if (!staged.length) return;
    // Files past the limit are let go (their previews with them), and the box
    // says which, right above the files, until it is dismissed: a toast at the
    // top of the window was gone before anyone saw it, and named nobody.
    const room = Math.max(0, MAX_FILES - (useUploads.getState().trays[channel.id]?.length ?? 0));
    const dropped = staged.slice(room);
    for (const f of dropped) if (f.preview) URL.revokeObjectURL(f.preview);
    setNotice(dropped.length ? { kind: "files", dropped: dropped.map((f) => f.name) } : null);
    const kept = staged.slice(0, room);
    if (kept.length) useUploads.getState().add(channel.id, kept);
  };

  /** A paste would take the box past the limit: it goes in only if asked, or goes as a file. */
  const pasteAnyway = (n: Extract<Notice, { kind: "long" }>) => {
    setNotice(null);
    insertAt(n.start, n.end, n.text);
  };
  const pasteAsFile = (n: Extract<Notice, { kind: "long" }>) => {
    setNotice(null);
    // the name every chat app gives it, in every language
    addFiles([new File([n.text], "message.txt", { type: "text/plain" })]);
  };

  /** Empties the box for a send: what is typed from here on is the next message. */
  const clearForSend = (channelId: string) => {
    setText("");
    if (lastTyping.current) {
      lastTyping.current = 0;
      gateway()?.sendTypingStop(channelId);
    }
    // a pending save must not bring the sent words back
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    pendingDraft.current = null;
    saveDraft(channelId, "");
  };

  /**
   * The reply this conversation's next message answers, for a message sent
   * any way at all — typed, a GIF, a sticker — and the reply bar closes with
   * it. Nothing when the bar belongs to another conversation.
   */
  const takeReply = (): Pick<SendOptions, "replyTo" | "ping"> => {
    // read now, not from this render: a picker's callback can outlive it
    const current = useUI.getState().replyTo;
    const reply = current && current.channelId === channel.id ? current : null;
    if (!reply) return {};
    setReplyTo(null);
    return { replyTo: reply.messageId, ping: reply.ping };
  };

  /** Sends what the box holds, or what the formatting editor made; false when it did not go. */
  const send = (raw: string = text): boolean => {
    if (remaining > 0) {
      toast(tr_("composer.composer.slowModeOnSeconds", { seconds: remaining }), "error");
      return false;
    }
    let body = raw.trim();
    if (tooLong(body)) {
      toast(tooLongMessage(), "error");
      return false;
    }
    const cmd = runCommand(body);
    if (cmd.kind === "plugin") {
      // a plugin's command: the box empties at once, and whatever it answers is sent as the message
      const channelId = channel.id;
      const opts: SendOptions = takeReply();
      clearForSend(channelId);
      void cmd.run(channelId).then((out) => {
        if (!out) return;
        if (tooLong(out)) return toast(tooLongMessage(), "error");
        sendMessage(channelId, out, opts).catch(() => undefined);
      });
      return true;
    }
    if (cmd.kind === "command") body = cmd.text;
    else if (cmd.kind === "empty") {
      toast(tr_("composer.composer.commandNeedsText", { name: cmd.name }), "error");
      return false;
    } else if (cmd.kind === "unknown" && sendAsIs.current !== body) {
      // Not published on the first try: "/ban someone" used to land in the
      // channel for all to read. Sent again unchanged, it goes as a message.
      sendAsIs.current = body;
      toast(tr_("composer.composer.noSuchCommand", { name: cmd.name }), "info");
      return false;
    }
    sendAsIs.current = null;
    if (!body && files.length === 0) return false;
    const channelId = channel.id;
    const opts: SendOptions = takeReply();
    // The box empties now rather than when the send is through, so anything
    // typed while it goes (files can take a while) is the next message and is
    // never mixed up with this one. The message shows in the list at once;
    // one with files goes out once they are up, and nothing waits for it.
    clearForSend(channelId);
    // previews still on their way are waited for alongside the uploads, so a link pasted just before Send keeps its card
    if (linkPreviews) {
      const urls = extractUrls(body);
      if (urls.length) opts.embeds = previews.embedsFor(urls, PREVIEW_WAIT);
    }
    // a message that cannot be sent stays in the list, marked, with Retry
    if (files.length) sendWithFiles(channelId, body, useUploads.getState().take(channelId), opts).catch(() => undefined);
    else sendMessage(channelId, body, opts).catch(() => undefined);
    return true;
  };

  /** The formatting editor's markdown in place of what the box held, the caret at its end. */
  const replaceText = (value: string) => {
    touched.current = true;
    setText(value);
    persistDraft(value);
    setAc(null);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(value.length, value.length);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Keys pressed while an input method is composing (Japanese, Chinese,
    // Korean…) belong to it: Enter confirms the word, arrows pick one. Safari
    // sends that Enter after composition ends, marked only by keyCode 229.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // Ctrl/Cmd+B, I, U: the selection in bold, italics or underline, as markdown
    const marker = formatShortcut(e);
    if (marker) {
      e.preventDefault();
      applyWrap(e.currentTarget, marker);
      return;
    }
    if (ac) {
      if (e.key === "ArrowDown") { e.preventDefault(); setAc({ ...ac, index: (ac.index + 1) % ac.items.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setAc({ ...ac, index: (ac.index - 1 + ac.items.length) % ac.items.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickAc(ac.index); return; }
      if (e.key === "Escape") { e.preventDefault(); setAc(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      // On a phone Return starts a new line and the button sends, as in
      // every messaging app there; a tablet or a computer sends on Enter.
      if (!phoneKeyboard()) {
        e.preventDefault();
        void send();
      }
      return;
    }
    if (e.key === "Escape") {
      if (replyTo) setReplyTo(null);
      else if (picker) setPicker(false);
      return;
    }
    // plain ↑ only: Alt+↑ steps to another conversation (Shortcuts)
    if (e.key === "ArrowUp" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && text === "" && me && msgs) {
      // the newest message of one's own that can be edited — one this device
      // could not decrypt cannot, or the edit would replace it with nothing
      const mine = [...msgs.ids].reverse().find((id) => { const m = msgs.byId[id]; return !!m && canEdit(m); });
      if (mine) {
        e.preventDefault();
        setEditing({ channelId: channel.id, messageId: mine });
      }
    }
  };

  // Files land on the conversation that is open, wherever they are dropped;
  // DropOverlay owns the window handlers and says where the file is going.
  const takeFiles = useRef<((list: FileList) => void) | null>(null);
  takeFiles.current = canSend ? addFiles : null;

  const selecting = useSelection((x) => x.channelId) !== null;
  const replyTarget = useMemo(() => (replyTo && replyTo.channelId === channel.id ? msgs?.byId[replyTo.messageId] : undefined), [replyTo, msgs, channel.id]);
  const replyName = useShownName(channel.id, replyTarget?.author_id);

  if (!canSend) {
    return (
      <div className={s.wrap}>
          {paneFocused ? <DropOverlay name={name} hash={!!channel.server_id} onFiles={() => {}} disabled /> : null}
        <div className={[s.box, s.locked].join(" ")} data-testid="composer-locked">{tr_("composer.composer.youDoNotHavePermissionTo")}</div>
      </div>
    );
  }

  return (
    <div className={s.wrap}>
      {/* One pane takes a dropped file, the one in focus: every pane's box
          listened to the whole window, so the first one mounted took every
          drop while all of them drew their scrim. */}
      {paneFocused ? <DropOverlay name={name} hash={!!channel.server_id} onFiles={(list) => takeFiles.current?.(list)} disabled={!canSend || selecting} /> : null}
      {ac ? <Autocomplete kind={ac.kind} items={ac.items} index={ac.index} onHover={(i) => setAc({ ...ac, index: i })} onPick={pickAc} tone={tone} /> : null}
      {formatting ? (
        <Suspense fallback={null}>
          <FormatEditor
            initial={text}
            placeholder={placeholder}
            canSend={remaining <= 0}
            onClose={() => {
              setFormatting(false);
              requestAnimationFrame(() => taRef.current?.focus({ preventScroll: true }));
            }}
            onInsert={(md) => {
              setFormatting(false);
              replaceText(md);
            }}
            onSend={(md) => {
              const sent = send(md);
              if (sent) setFormatting(false);
              return sent;
            }}
          />
        </Suspense>
      ) : null}
      {picker ? (
        <ExpressionPicker
          onClose={() => setPicker(false)}
          onEmoji={(em) => {
            const caret = taRef.current?.selectionStart ?? text.length;
            // a custom emoji shows as its :name: when that name sends this very emoji
            const custom = /^<a?:(\w+):\d+>$/.exec(em.unicode);
            insertAt(caret, taRef.current?.selectionEnd ?? caret, (custom ? emojiText(em.unicode, custom[1]!) : em.unicode) + " ");
          }}
          serverId={channel.server_id}
          gifs={<GifPicker onPick={(g) => {
            setPicker(false);
            if (g.att) {
              // an uploaded favourite: stage its decrypted bytes, then it goes
              // up and out exactly like a file just chosen
              void favoriteFile({ url: g.url, w: g.w, h: g.h, att: g.att })
                .then(({ blob, name, type }) => addFiles([new File([blob], name, { type })]))
                .catch(() => toast(tr_("composer.composer.uploadFailed"), "error"));
              return;
            }
            if (remaining > 0) return toast(tr_("composer.composer.slowModeOnSeconds", { seconds: remaining }), "error");
            const opts: SendOptions = { ...takeReply(), embeds: [{ url: g.url, type: "gif", image: g.url, ...(g.w ? { image_w: g.w } : {}), ...(g.h ? { image_h: g.h } : {}) }] };
            void sendMessage(channel.id, g.url, opts);
          }} />}
          stickers={<StickerPicker serverId={channel.server_id} onPick={({ sticker }) => {
            setPicker(false);
            if (remaining > 0) return toast(tr_("composer.composer.slowModeOnSeconds", { seconds: remaining }), "error");
            // The send settles first so a failed send never lands in recents;
            // the row updates at once here and again over the gateway, which
            // is what carries it to the account's other devices.
            void sendMessage(channel.id, "", { ...takeReply(), sticker: { id: sticker.id, blob: sticker.blob_id, name: sticker.name, ...(sticker.width ? { w: sticker.width } : {}), ...(sticker.height ? { h: sticker.height } : {}), animated: sticker.animated, format: sticker.format } })
              .then(() => {
                useExpressions.getState().noteRecent(sticker);
                void expressionsApi.touchRecentSticker(sticker.id).catch(() => undefined);
              })
              .catch(() => undefined);
          }} />}
        />
      ) : null}
      {notice ? (
        <div className={s.notice} role="status" data-testid="composer-notice">
          <span className={s.noticeText}>
            {notice.kind === "long"
              ? tr_("composer.composer.pasteTooLong", { count: MAX_MESSAGE_LENGTH })
              : notice.dropped.length === 1
                ? tr_("composer.composer.fileLeftOut", { max: MAX_FILES, name: notice.dropped[0]! })
                : tr_("composer.composer.filesLeftOut", { max: MAX_FILES, name: notice.dropped[0]!, count: notice.dropped.length - 1 })}
          </span>
          {notice.kind === "long" ? (
            <span className={s.noticeActions}>
              {canAttach ? <button type="button" className={s.noticeMain} onClick={() => pasteAsFile(notice)}>{tr_("composer.composer.attachAsFile")}</button> : null}
              <button type="button" className={s.noticeAlt} onClick={() => pasteAnyway(notice)}>{tr_("composer.composer.pasteAnyway")}</button>
            </span>
          ) : null}
          <button type="button" className={[s.closeBtn, s.noticeClose].join(" ")} aria-label={tr_("composer.composer.dismiss")} onClick={() => setNotice(null)}><X size={16} /></button>
        </div>
      ) : null}
      {replyTarget ? (
        <div className={s.replyBar}>
          <span className={s.replyWho}><Tr id="composer.replyingTo" values={{ name: <b dir="auto">{replyName}</b> }} /></span>
          <span className={s.replyBtns}>
            {replyTarget.author_id !== me?.id ? (
              <button className={s.pingBtn} data-on={replyTo?.ping} aria-pressed={!!replyTo?.ping} aria-label={tr_("composer.composer.replyPing")} title={tr_("composer.composer.replyPing")} onClick={() => replyTo && setReplyTo({ ...replyTo, ping: !replyTo.ping })}>{replyTo?.ping ? tr_("composer.composer.pingOn") : tr_("composer.composer.pingOff")}</button>
            ) : null}
            <button className={s.closeBtn} aria-label={tr_("composer.composer.cancelReply")} onClick={() => setReplyTo(null)}><X size={16} /></button>
          </span>
        </div>
      ) : null}
      {files.length ? (
        // how many are attached, of how many fit, above a strip that scrolls sideways
        <div className={s.trayWrap}>
          <div className={s.trayHead}>
            <span>{tr_("composer.composer.trayCount", { count: files.length, max: MAX_FILES })}</span>
            <span className={s.traySize}>{formatBytes(files.reduce((n, f) => n + f.file.size, 0))}</span>
          </div>
        <div className={s.tray}>
          {files.map((f) => (
            <div key={f.id} className={s.card}>
              <div className={s.thumb} data-spoiler={f.spoiler}>
                {f.preview && f.file.type.startsWith("image/") ? <img src={f.preview} alt="" /> : f.preview ? <video src={f.preview} muted /> : <FileIcon size={26} aria-hidden="true" />}
              </div>
              <div className={s.fname} title={f.name}>{f.name}</div>
              <div className={s.fsize}>{formatBytes(f.file.size)}</div>
              <div className={s.cardBtns}>
                <button className={s.cardBtn} data-on={f.spoiler} aria-pressed={f.spoiler} aria-label={tr_("composer.composer.spoilerNamed", { name: f.name })} title={tr_("composer.composer.spoiler")} onClick={() => useUploads.getState().update(channel.id, [f.id], { spoiler: !f.spoiler })}>{f.spoiler ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                <button className={[s.cardBtn, s.del].join(" ")} aria-label={tr_("composer.composer.removeNamed", { name: f.name })} title={tr_("composer.composer.remove")} onClick={() => { useUploads.getState().remove(channel.id, [f.id]); setNotice((n) => (n?.kind === "files" ? null : n)); }}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
        </div>
      ) : null}
      <div className={s.box}>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        {canAttach ? <button className={s.attach} aria-label={tr_("composer.composer.uploadAFile")} onClick={() => fileRef.current?.click()}><CirclePlus size={24} /></button> : <span className={s.attachSpacer} />}
        <textarea
          data-composer=""
          // a screen reader hears the suggestions and which one Enter takes
          aria-autocomplete="list"
          aria-expanded={!!ac}
          aria-controls={ac ? AC_LIST_ID : undefined}
          aria-activedescendant={ac ? acOptionId(ac.index) : undefined}
          ref={taRef}
          className={s.ta}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onSelect={onSelect}
          onBlur={() => setAc(null)}
          onPaste={(e) => {
            const cd = e.clipboardData;
            const pasted = cd.getData("text/plain");
            // Cells from a spreadsheet or lines from a document come with a
            // picture of themselves; the words are what was meant. A picture
            // copied from a page comes with markup that is only the picture.
            const html = cd.getData("text/html");
            const wordsToo = !!pasted.trim() && !!html && html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "").trim() !== "";
            if (cd.files.length && !wordsToo) {
              // without permission any text on the clipboard still pastes
              if (canAttach) e.preventDefault();
              addFiles(cd.files);
              return;
            }
            // Past the limit a paste is not cut short (the box has no maxLength,
            // which used to throw the rest away): it waits, offered as a file.
            const el = e.currentTarget;
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? start;
            if (pasteOverflows(el.value, start, end, pasted)) {
              e.preventDefault();
              setNotice({ kind: "long", text: pasted, start, end });
            }
          }}
          placeholder={placeholder}
          rows={1}
          spellCheck={spellcheck}
          aria-label={placeholder}
        />
        <div className={s.btns}>
          <button type="button" className={s.iconBtn} data-on={formatting} aria-label={tr_("composer.format.open")} title={tr_("composer.format.open")} onClick={() => setFormatting(true)} onPointerEnter={preloadFormatEditor} onFocus={preloadFormatEditor} data-testid="format-open"><Type size={22} /></button>
          <button className={s.iconBtn} data-on={picker} data-picker-toggle={picker || undefined} aria-label={tr_("composer.composer.selectEmoji")} onClick={() => setPicker((v) => !v)}><Smile size={24} /></button>
          <button className={[s.iconBtn, s.send, s.sendMobile].join(" ")} aria-label={tr_("composer.composer.sendMessage")} onClick={() => void send()} disabled={remaining > 0 || (!text.trim() && files.length === 0)}><SendHorizontal size={22} /></button>
        </div>
      </div>
      <MessageCounter text={text} className={s.counter} />
      {channel.slowmode_seconds > 0 && !bypassSlowmode ? (
        <span className={s.slowmode} data-active={remaining > 0} title={tr_("composer.composer.slowModeIsEnabled")}>
          <Timer size={14} /> {remaining > 0 ? formatShortDuration(remaining) : tr_("composer.composer.slowModeIsEnabled")}
        </span>
      ) : null}
    </div>
  );
}

/** True for anything that wants the keyboard for itself. */
function wantsKeyboard(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

/** Somewhere else on the page is holding the keyboard on purpose. */
function inOwnLayer(el: Element | null): boolean {
  return !!el?.closest("[role=dialog], [data-modal-layer], [role=menu], [role=listbox]");
}

/**
 * Keeps the message box ready to type in. Clicking around the app puts the
 * caret back, and a letter typed with nothing else taking it lands in the box
 * rather than nowhere. Another text field, a dialog or a picker keeps what it
 * takes until you click away from it.
 *
 * Only the box of the pane in focus does this: with two conversations side by
 * side both boxes listened, the second one mounted won every time, and words
 * meant for the conversation being read went to the other one.
 */
export function useKeepFocused(ref: RefObject<HTMLTextAreaElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    // On a touch screen this would summon the keyboard over and over.
    if (typeof window === "undefined" || !window.matchMedia?.("(pointer: fine)").matches) return;
    const focus = () => {
      const ta = ref.current;
      if (!ta || ta.disabled || document.activeElement === ta) return;
      ta.focus({ preventScroll: true });
    };
    const onPointerUp = (e: globalThis.PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as Element | null;
      if (wantsKeyboard(target) || inOwnLayer(target)) return;
      if (document.getSelection()?.toString()) return;
      if (wantsKeyboard(document.activeElement) && inOwnLayer(document.activeElement)) return;
      focus();
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      // Only a letter, digit or sign that would be typed. Space and Enter press
      // the focused button, and Backspace is not writing: taken from a button
      // they typed a space into the draft, or deleted from it, and the button
      // never went off.
      if (e.key.length !== 1 || e.key === " ") return;
      if (wantsKeyboard(document.activeElement) || inOwnLayer(document.activeElement)) return;
      if (document.querySelector("[role=dialog], [data-modal-layer]")) return;
      focus();
    };
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, enabled]);
}
