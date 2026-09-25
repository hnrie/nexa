import { CirclePlus, SendHorizontal, Smile, X, Eye, EyeOff, Trash2, Timer, File as FileIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type SyntheticEvent } from "react";
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
import { commands, applyCommand } from "./commands";
import { createLinkPreviews } from "./linkPreviews";
import { sendMessage, sendWithFiles, type SendOptions } from "./send";
import { useUploads } from "@/stores/uploads";
import { useAutosize } from "./useAutosize";
import type { RefObject } from "react";
import s from "./Composer.module.css";

import { t as tr_, Tr } from "@/i18n";
import { formatShortDuration } from "@/lib/time";
const MAX_LEN = 4000;
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
  const linkPreviews = useSettings((st) => st.settings.linkPreviews);
  const [previews] = useState(createLinkPreviews);
  const unfurlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Link previews are generated by the sender (so recipients never fetch the URL) and ride inside the encrypted payload.
  useEffect(() => {
    if (!linkPreviews) return;
    if (unfurlTimer.current) clearTimeout(unfurlTimer.current);
    unfurlTimer.current = setTimeout(() => {
      for (const url of extractUrls(text)) previews.start(url);
    }, 600);
  }, [text, linkPreviews, previews]);

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
  useKeepFocused(taRef);

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
      items = [...pool.values()]
        .filter((u) => !q || u.username.includes(q) || u.display_name.toLowerCase().includes(q) || nick(u.id).toLowerCase().includes(q))
        .sort((a, b) => byPrefix(q, a.username, a.display_name, nick(a.id)) - byPrefix(q, b.username, b.display_name, nick(b.id)))
        .slice(0, 8)
        .map((u) => ({ kind: "user", user: u }));
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
  }, [users, rels, channel.recipient_ids, channel.server_id, serverState, canEveryone, isServer]);

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
    else if (it.kind === "customEmoji") insertAt(ac.start, caret, `${emojiToken(it.emoji)} `);
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
    // Files past the limit used to be dropped without a word, and their
    // previews stayed resident for the life of the tab.
    const room = Math.max(0, MAX_FILES - (useUploads.getState().trays[channel.id]?.length ?? 0));
    for (const f of staged.slice(room)) if (f.preview) URL.revokeObjectURL(f.preview);
    if (staged.length > room) toast(tr_("composer.composer.atMostFilesPerMessage", { count: MAX_FILES }), "error");
    const kept = staged.slice(0, room);
    if (kept.length) useUploads.getState().add(channel.id, kept);
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

  const send = () => {
    if (remaining > 0) return toast(tr_("composer.composer.slowModeOnSeconds", { seconds: remaining }), "error");
    let body = text.trim();
    if (body.length > MAX_LEN) return toast(tr_("composer.composer.messagesAreLimitedTo", { count: MAX_LEN }), "error");
    const expanded = applyCommand(body);
    if (expanded !== null) body = expanded;
    if (!body && files.length === 0) return;
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
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Keys pressed while an input method is composing (Japanese, Chinese,
    // Korean…) belong to it: Enter confirms the word, arrows pick one. Safari
    // sends that Enter after composition ends, marked only by keyCode 229.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
  const counterOn = text.length > MAX_LEN - 200;

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
      {picker ? (
        <ExpressionPicker
          onClose={() => setPicker(false)}
          onEmoji={(em) => {
            const caret = taRef.current?.selectionStart ?? text.length;
            insertAt(caret, taRef.current?.selectionEnd ?? caret, em.unicode + " ");
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
      {replyTarget ? (
        <div className={s.replyBar}>
          <span className={s.replyWho}><Tr id="composer.replyingTo" values={{ name: <b>{users[replyTarget.author_id]?.display_name ?? tr_("names.unknownUser")}</b> }} /></span>
          <span className={s.replyBtns}>
            {replyTarget.author_id !== me?.id ? (
              <button className={s.pingBtn} data-on={replyTo?.ping} aria-pressed={!!replyTo?.ping} aria-label={tr_("composer.composer.replyPing")} title={tr_("composer.composer.replyPing")} onClick={() => replyTo && setReplyTo({ ...replyTo, ping: !replyTo.ping })}>{replyTo?.ping ? tr_("composer.composer.pingOn") : tr_("composer.composer.pingOff")}</button>
            ) : null}
            <button className={s.closeBtn} aria-label={tr_("composer.composer.cancelReply")} onClick={() => setReplyTo(null)}><X size={16} /></button>
          </span>
        </div>
      ) : null}
      {files.length ? (
        <div className={s.tray}>
          {files.map((f) => (
            <div key={f.id} className={s.card}>
              <div className={s.thumb} data-spoiler={f.spoiler}>
                {f.preview && f.file.type.startsWith("image/") ? <img src={f.preview} alt="" /> : f.preview ? <video src={f.preview} muted /> : <FileIcon size={26} aria-hidden="true" />}
              </div>
              <div className={s.fname} title={f.name}>{f.name}</div>
              <div className={s.fsize}>{formatBytes(f.file.size)}</div>
              <div className={s.cardBtns}>
                <button className={s.cardBtn} data-on={f.spoiler} title={tr_("composer.composer.spoiler")} onClick={() => useUploads.getState().update(channel.id, [f.id], { spoiler: !f.spoiler })}>{f.spoiler ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                <button className={[s.cardBtn, s.del].join(" ")} title={tr_("composer.composer.remove")} onClick={() => useUploads.getState().remove(channel.id, [f.id])}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
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
            if (!e.clipboardData.files.length) return;
            // without permission any text on the clipboard still pastes
            if (canAttach) e.preventDefault();
            addFiles(e.clipboardData.files);
          }}
          placeholder={placeholder}
          rows={1}
          spellCheck={spellcheck}
          maxLength={MAX_LEN + 500}
          aria-label={placeholder}
        />
        <div className={s.btns}>
          <button className={s.iconBtn} data-on={picker} data-picker-toggle={picker || undefined} aria-label={tr_("composer.composer.selectEmoji")} onClick={() => setPicker((v) => !v)}><Smile size={24} /></button>
          <button className={[s.iconBtn, s.send, s.sendMobile].join(" ")} aria-label={tr_("composer.composer.sendMessage")} onClick={() => void send()} disabled={remaining > 0 || (!text.trim() && files.length === 0)}><SendHorizontal size={22} /></button>
        </div>
      </div>
      {counterOn ? <span className={s.counter} data-over={text.length > MAX_LEN}>{MAX_LEN - text.length}</span> : null}
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
 * caret back, and a key pressed with nothing else focused lands in the box
 * rather than nowhere. Another text field, a dialog or a picker keeps what it
 * takes until you click away from it.
 */
function useKeepFocused(ref: RefObject<HTMLTextAreaElement | null>): void {
  useEffect(() => {
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
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1 && e.key !== "Backspace") return;
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
  }, [ref]);
}
