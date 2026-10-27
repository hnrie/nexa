import { PersonName } from "@/components/common/PersonName";
import { FileUp, LockOpen, Plus, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { apps as appsApi, type CommandApp, type CommandChoice, type CommandOption, type InteractionFile } from "@/api/apps";
import type { Channel } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { entityLabel, type EntityKind } from "@/components/apps/entityChoices";
import { t } from "@/i18n";
import {
  OPT_ATTACHMENT,
  OPT_BOOLEAN,
  OPT_CHANNEL,
  OPT_INTEGER,
  OPT_MENTIONABLE,
  OPT_NUMBER,
  OPT_ROLE,
  OPT_STRING,
  OPT_USER,
  choiceName,
  nestOptions,
  optionDescription,
  optionName,
  type CommandLeaf,
} from "@/lib/apps";
import { describeError } from "@/lib/errors";
import { choicesOf, interact } from "@/lib/interactions";
import { channelsFor, findMembers, peopleFor, rolesFor } from "@/lib/pickables";
import { displayName } from "@/stores/users";
import { emojiLoaded, loadEmoji, withTone } from "@/components/pickers/emojiIndex";
import { emojiToken } from "@/stores/expressions";
import { Autocomplete, type AcItem } from "./Autocomplete";
import { emojiSuggestionItems } from "./emojiSuggestions";
import s from "./Composer.module.css";

/**
 * A command of an app being filled in, in the message box. Picking one from
 * the suggestions turns the box into the command and a slot for each of its
 * options: the ones it needs at once, the others offered after them. A slot
 * takes what its option asks for (words, a number, yes or no, a person, a
 * role, a channel, a file); what can be picked is suggested above the box as
 * it is typed, the app's own suggestions too. Tab picks a suggestion, Enter
 * sends, Escape (or the command's X) leaves the command. What is sent goes to the app as it is,
 * not end-to-end encrypted, and the box says so.
 */

export interface Slot {
  opt: CommandOption;
  /** What is typed in it. */
  text: string;
  /** What was picked for it (a choice, a person, a role, a channel), with the words it shows as. */
  value?: string | number | boolean;
  label?: string;
  file?: InteractionFile;
  uploading?: boolean;
  error?: string;
}

interface Mode {
  app: CommandApp;
  leaf: CommandLeaf;
  slots: Slot[];
  focus: number;
}

/** What a slot's option asks someone to pick, for the suggestions. */
function entityOf(o: CommandOption): EntityKind | null {
  return o.type === OPT_USER ? "user" : o.type === OPT_ROLE ? "role" : o.type === OPT_MENTIONABLE ? "mentionable" : o.type === OPT_CHANNEL ? "channel" : null;
}

const numeric = (o: CommandOption) => o.type === OPT_INTEGER || o.type === OPT_NUMBER;

/** What is wrong with a slot, in words, or nothing. */
export function slotProblem(slot: Slot): string | undefined {
  const o = slot.opt;
  const text = slot.text.trim();
  if (o.type === OPT_ATTACHMENT) return slot.file ? undefined : t("apps.command.needsFile");
  if (entityOf(o)) return slot.value !== undefined ? undefined : t("apps.command.pickFromList");
  if (o.type === OPT_BOOLEAN) return slot.value !== undefined ? undefined : t("apps.command.pickYesNo");
  if (o.choices?.length) return slot.value !== undefined ? undefined : t("apps.command.pickFromList");
  if (slot.value !== undefined) return undefined;
  if (!text) return o.required ? t("apps.command.required") : undefined;
  if (numeric(o)) {
    const n = Number(text);
    if (!Number.isFinite(n) || (o.type === OPT_INTEGER && !/^-?\d+$/.test(text))) return o.type === OPT_INTEGER ? t("apps.command.wholeNumber") : t("apps.command.number");
    if (o.min_value !== undefined && n < o.min_value) return t("apps.command.atLeast", { n: o.min_value });
    if (o.max_value !== undefined && n > o.max_value) return t("apps.command.atMost", { n: o.max_value });
    return undefined;
  }
  const len = [...text].length;
  if (o.min_length !== undefined && len < o.min_length) return t("apps.command.tooShort", { count: o.min_length });
  if (o.max_length !== undefined && len > o.max_length) return t("apps.command.tooLong", { count: o.max_length });
  return undefined;
}

/** A slot's value as the app is sent it, or undefined when it has none. */
export function slotValue(slot: Slot): unknown {
  const o = slot.opt;
  if (o.type === OPT_ATTACHMENT) return slot.file?.id;
  if (slot.value !== undefined) return slot.value;
  const text = slot.text.trim();
  if (!text) return undefined;
  if (numeric(o)) return Number(text);
  return text;
}

/** A filled slot's option, for the request; the one being typed in can go as typed, for suggestions. */
function filled(slots: Slot[], focused?: number): { name: string; value: unknown; focused?: boolean }[] {
  const out: { name: string; value: unknown; focused?: boolean }[] = [];
  slots.forEach((slot, i) => {
    if (i === focused) {
      out.push({ name: slot.opt.name, value: slot.text, focused: true });
      return;
    }
    const v = slotValue(slot);
    if (v !== undefined && !slotProblem(slot)) out.push({ name: slot.opt.name, value: v });
  });
  return out;
}

export interface CommandModeApi {
  active: boolean;
  start: (app: CommandApp, leaf: CommandLeaf) => void;
  /** The command and its slots, in place of the text box. */
  box: ReactNode;
  /** Suggestions for the slot being filled, or what the option asks for, above the box. */
  list: ReactNode;
  /** Sends the command; false when something is missing, which the slot then says. */
  submit: () => boolean;
  /** Puts an emoji the picker chose into the option being written (false when none takes words). */
  insert: (text: string) => boolean;
}

/** What follows a ":" at the end of a text option's words (two letters or more), or null. */
function emojiQuery(slot: Slot): string | null {
  if (slot.opt.type !== OPT_STRING || slot.value !== undefined || slot.opt.choices?.length) return null;
  const m = /(?:^|\s):([\w+-]{2,32})$/.exec(slot.text);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * The message box's command mode. `onLeave` gets the text the box should hold
 * once the command is left: "/name" when its first slot was backspaced
 * through, nothing when it was sent or put away.
 */
export function useCommandMode(channel: Channel, opts: { onLeave: (text: string) => void; tone: number }): CommandModeApi {
  const [mode, setModeState] = useState<Mode | null>(null);
  const [ac, setAc] = useState<{ items: AcItem[]; index: number } | null>(null);
  const [appChoices, setAppChoices] = useState<CommandChoice[] | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, rerender] = useState(0);
  const modeRef = useRef(mode);
  // the ref changes with the state, at once: keys come faster than renders
  const setMode = useCallback((next: Mode | null | ((m: Mode | null) => Mode | null)) => {
    const value = typeof next === "function" ? next(modeRef.current) : next;
    modeRef.current = value;
    setModeState(value);
  }, []);
  /** The slot to put the caret in once the box has drawn it (the trailing one past the last slot too). */
  const wantFocus = useRef(-1);
  const [focusTick, setFocusTick] = useState(0);
  // the whole command is taken (Ctrl+A), for Backspace to clear it
  const [allSelected, setAllSelected] = useState(false);
  const allSelectedRef = useRef(false);
  allSelectedRef.current = allSelected;
  useLayoutEffect(() => {
    const i = wantFocus.current;
    if (i < 0) return;
    wantFocus.current = -1;
    inputs.current[i]?.focus({ preventScroll: true });
  }, [focusTick, mode]);

  // another conversation: the command stays with the one it was for
  useEffect(() => {
    setMode(null);
    setAc(null);
  }, [channel.id, setMode]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const focusSlot = useCallback((i: number) => {
    wantFocus.current = i;
    setFocusTick((n) => n + 1);
  }, []);

  const start = useCallback(
    (app: CommandApp, leaf: CommandLeaf) => {
      const slots = leaf.options.filter((o) => o.required).map((opt) => ({ opt, text: "" }));
      setMode({ app, leaf, slots, focus: 0 });
      setAc(null);
      setAppChoices(null);
      // the first slot, or the caret after the command when it takes nothing
      focusSlot(0);
    },
    [focusSlot, setMode],
  );

  const leave = useCallback(
    (text: string) => {
      setMode(null);
      setAc(null);
      opts.onLeave(text);
    },
    [opts, setMode],
  );

  /** The suggestions for a slot, for what is typed in it. */
  const suggestions = useCallback(
    (slot: Slot, fromApp: CommandChoice[] | null): AcItem[] => {
      const o = slot.opt;
      // ":name" at the end of an option's words offers emoji, as in the message box
      const emoji = emojiQuery(slot);
      if (emoji !== null) {
        if (!emojiLoaded()) void loadEmoji().then(() => rerender((n) => n + 1), () => undefined);
        return emojiSuggestionItems(emoji, channel.server_id);
      }
      const q = slot.text.trim().toLowerCase();
      const entity = entityOf(o);
      if (entity) {
        const out: AcItem[] = [];
        if (entity === "user" || entity === "mentionable") for (const u of peopleFor(channel.id, q, 8)) out.push({ kind: "user", user: u });
        if (entity === "role" || entity === "mentionable") for (const r of rolesFor(channel.id, q, 8)) out.push({ kind: "role", role: r });
        if (entity === "channel") for (const c of channelsFor(channel.id, q, o.channel_types, 8)) out.push({ kind: "channel", channel: c });
        return out;
      }
      if (o.type === OPT_BOOLEAN) {
        return [
          { kind: "choice", name: t("apps.command.true"), value: true },
          { kind: "choice", name: t("apps.command.false"), value: false },
        ].filter((c) => !q || c.name.toLowerCase().startsWith(q)) as AcItem[];
      }
      const list = o.autocomplete ? (fromApp ?? []) : (o.choices ?? []).filter((c) => !q || choiceName(c).toLowerCase().includes(q));
      return list.slice(0, 25).map((c) => ({ kind: "choice", name: o.autocomplete ? c.name : choiceName(c), value: c.value }));
    },
    [channel.id],
  );

  /** Asks the app for suggestions for what is being typed, a moment after the typing stops. */
  const askApp = useCallback(
    (m: Mode, index: number) => {
      if (timer.current) clearTimeout(timer.current);
      const id = ++seq.current;
      timer.current = setTimeout(() => {
        void interact(
          { type: 4, application_id: m.app.id, channel_id: channel.id, data: { id: m.leaf.command.id, options: nestOptions(m.leaf.path, filled(m.slots, index)) } },
          { quiet: true },
        ).then((o) => {
          if (id !== seq.current) return;
          const cur = modeRef.current;
          const slot = cur?.slots[cur.focus];
          if (!cur || cur.focus !== index || !slot) return;
          const choices = choicesOf(o);
          setAppChoices(choices);
          const items = suggestions(slot, choices);
          setAc(items.length ? { items, index: 0 } : null);
        });
      }, 250);
    },
    [channel.id, suggestions],
  );

  /** The suggestions follow the slot in focus and what is typed in it. */
  const refresh = useCallback(
    (m: Mode) => {
      const slot = m.slots[m.focus];
      if (!slot) return setAc(null);
      if (slot.opt.autocomplete) {
        setAppChoices(null);
        askApp(m, m.focus);
      }
      if (entityOf(slot.opt)) void findMembers(channel.id, slot.text).then(() => rerender((n) => n + 1));
      const items = suggestions(slot, slot.opt.autocomplete ? appChoices : null);
      setAc(items.length ? { items, index: 0 } : null);
    },
    [askApp, suggestions, channel.id, appChoices],
  );

  const update = (i: number, patch: Partial<Slot>, refreshAfter = true) => {
    const m = modeRef.current;
    if (!m) return;
    const slots = m.slots.map((slot, j) => (j === i ? { ...slot, ...patch } : slot));
    const next = { ...m, slots, focus: i };
    setMode(next);
    if (refreshAfter) refresh(next);
  };

  const pick = (i: number, it: AcItem) => {
    const m = modeRef.current;
    if (!m) return;
    let value: string | number | boolean;
    let label: string;
    if (it.kind === "user") {
      value = it.user.id;
      label = `@${displayName(it.user)}`;
    } else if (it.kind === "role") {
      value = it.role.id;
      label = `@${it.role.name}`;
    } else if (it.kind === "channel") {
      value = it.channel.id;
      label = `#${it.channel.name}`;
    } else if (it.kind === "choice") {
      value = it.value;
      label = it.name;
    } else if (it.kind === "emoji" || it.kind === "customEmoji") {
      // the ":name" typed becomes the emoji itself, as a message carries it
      const slot = m.slots[i]!;
      const typed = emojiQuery(slot);
      const glyph = it.kind === "emoji" ? withTone(it.entry, opts.tone) : emojiToken(it.emoji);
      const text = typed === null ? slot.text + glyph : slot.text.slice(0, slot.text.length - typed.length - 1) + glyph;
      update(i, { text, error: undefined }, false);
      setAc(null);
      focusSlot(i);
      return;
    } else return;
    const slots = m.slots.map((slot, j) => (j === i ? { ...slot, value, label, text: "", error: undefined } : slot));
    // on to the next slot still empty, if there is one
    const nextEmpty = slots.findIndex((slot, j) => j > i && slotValue(slot) === undefined);
    const focus = nextEmpty >= 0 ? nextEmpty : i;
    setMode({ ...m, slots, focus });
    setAc(null);
    if (nextEmpty >= 0) {
      focusSlot(nextEmpty);
      refresh({ ...m, slots, focus });
    } else {
      // every slot it needs is filled: the caret goes to the end, where Enter sends
      focusSlot(slots.length);
    }
  };

  const addOption = (opt: CommandOption) => {
    const m = modeRef.current;
    if (!m) return;
    const slots = [...m.slots, { opt, text: "" }];
    const next = { ...m, slots, focus: slots.length - 1 };
    setMode(next);
    focusSlot(slots.length - 1);
    refresh(next);
  };

  const removeSlot = (i: number) => {
    const m = modeRef.current;
    if (!m) return;
    const slots = m.slots.filter((_, j) => j !== i);
    const focus = Math.max(0, i - 1);
    setMode({ ...m, slots, focus });
    setAc(null);
    focusSlot(focus);
  };

  const submit = (): boolean => {
    const m = modeRef.current;
    if (!m) return false;
    const problems = m.slots.map(slotProblem);
    const first = problems.findIndex(Boolean);
    if (first >= 0) {
      setMode({ ...m, slots: m.slots.map((slot, j) => ({ ...slot, error: problems[j] })), focus: first });
      focusSlot(first);
      return false;
    }
    if (m.slots.some((slot) => slot.uploading)) return false;
    const options = filled(m.slots);
    void interact({ type: 2, application_id: m.app.id, channel_id: channel.id, data: { id: m.leaf.command.id, options: nestOptions(m.leaf.path, options) } });
    leave("");
    return true;
  };

  /**
   * Ctrl+A (Cmd+A on a Mac) takes the whole command when the caret is not in
   * words of an option, or a second time once an option's words are all
   * taken; Backspace or Delete then clears it, and typing replaces it.
   * Returns whether the key was handled here.
   */
  const wholeCommandKey = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    const el = e.currentTarget;
    const text = typeof el.value === "string" ? el.value : "";
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a") {
      const allTaken = text.length === 0 || (el.selectionStart === 0 && el.selectionEnd === text.length);
      if (!allTaken) return false;
      e.preventDefault();
      setAllSelected(true);
      return true;
    }
    if (!allSelectedRef.current) return false;
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      setAllSelected(false);
      leave("");
      return true;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setAllSelected(false);
      leave(e.key);
      return true;
    }
    if (!["Shift", "Control", "Meta", "Alt"].includes(e.key)) setAllSelected(false);
    return false;
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    const m = modeRef.current;
    if (!m || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (wholeCommandKey(e)) return;
    const slot = m.slots[i]!;
    if (ac) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAc({ ...ac, index: (ac.index + 1) % ac.items.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAc({ ...ac, index: (ac.index - 1 + ac.items.length) % ac.items.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const it = ac.items[ac.index];
        if (it) pick(i, it);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAc(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      leave("");
      return;
    }
    if (e.key === "Backspace" && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
      if (slot.value !== undefined || slot.file) {
        e.preventDefault();
        update(i, { value: undefined, label: undefined, file: undefined });
        return;
      }
      if (!slot.text) {
        e.preventDefault();
        if (!slot.opt.required) removeSlot(i);
        else if (i > 0) focusSlot(i - 1);
        // back through the first slot: the command goes back to being words
        else leave(`/${m.leaf.label}`);
      }
    }
  };

  /** Keys at the end of the command, past its slots: the caret's place when it takes nothing. */
  const onTailKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const m = modeRef.current;
    if (!m || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (wholeCommandKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      leave("");
    } else if (e.key === "Backspace") {
      e.preventDefault();
      if (m.slots.length) focusSlot(m.slots.length - 1);
      else leave(`/${m.leaf.label}`);
    }
  };

  const takeFile = async (i: number, file: File) => {
    update(i, { uploading: true, error: undefined }, false);
    try {
      const sent = await appsApi.sendFile(file);
      update(i, { uploading: false, file: sent }, false);
    } catch (err) {
      update(i, { uploading: false, error: describeError(err, t("apps.form.fileFailed")) }, false);
    }
  };

  const filePick = useRef<number>(-1);
  const box: ReactNode = mode ? (
    <div
      className={s.cmdBox}
      role="group"
      aria-label={t("apps.command.label", { command: mode.leaf.label })}
      data-testid="command-box"
      data-all-selected={allSelected || undefined}
      onPointerDown={() => setAllSelected(false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAllSelected(false);
      }}
    >
      <span className={s.cmdHead}>
        <Avatar id={mode.app.id} avatarId={mode.app.bot.avatar_id} name={mode.app.name} size={20} />
        <span className={s.cmdName} dir="auto">/{mode.leaf.label}</span>
        {/* a way out that needs no keyboard: on a touch screen there is no Escape */}
        <button type="button" className={s.slotRemove} aria-label={t("apps.command.close")} title={t("apps.command.close")} onClick={() => leave("")} data-testid="command-close">
          <X size={14} />
        </button>
      </span>
      {mode.slots.map((slot, i) => {
        const o = slot.opt;
        const name = optionName(o);
        const picked = slot.label ?? (slot.value !== undefined ? entityLabel(channel.id, String(slot.value)) : undefined);
        return (
          <span key={o.name} className={s.slot} data-focused={mode.focus === i || undefined} data-invalid={slot.error ? true : undefined} title={slot.error} data-testid={`slot-${o.name}`}>
            <span className={s.slotName}>{name}</span>
            {o.type === OPT_ATTACHMENT ? (
              <button
                type="button"
                className={s.slotFile}
                ref={(el) => {
                  if (el) inputs.current[i] = el as unknown as HTMLInputElement;
                }}
                onClick={() => {
                  filePick.current = i;
                  fileInput.current?.click();
                }}
                onKeyDown={(e) => onKey(i, e as unknown as KeyboardEvent<HTMLInputElement>)}
              >
                <FileUp size={14} aria-hidden="true" />
                {slot.uploading ? t("apps.command.uploading") : slot.file ? slot.file.filename : t("apps.command.chooseFile")}
              </button>
            ) : picked !== undefined ? (
              <span className={s.slotValue}>
                <span dir="auto">{o.type === OPT_USER && slot.value ? <PersonName userId={String(slot.value)} serverId={channel.server_id}>{picked}</PersonName> : picked}</span>
                <input
                  ref={(el) => {
                    if (el) inputs.current[i] = el;
                  }}
                  className={s.slotGhost}
                  value=""
                  aria-label={name}
                  onChange={(e) => update(i, { value: undefined, label: undefined, text: e.target.value })}
                  onKeyDown={(e) => onKey(i, e)}
                  onFocus={() => {
                    if (modeRef.current?.focus !== i) setMode((m) => (m ? { ...m, focus: i } : m));
                  }}
                />
              </span>
            ) : (
              <span className={s.slotGrow} data-value={slot.text}>
                <input
                  ref={(el) => {
                    if (el) inputs.current[i] = el;
                  }}
                  value={slot.text}
                  size={1}
                  inputMode={numeric(o) ? (o.type === OPT_INTEGER ? "numeric" : "decimal") : undefined}
                  aria-label={name}
                  aria-description={optionDescription(o)}
                  aria-invalid={slot.error ? true : undefined}
                  onChange={(e) => update(i, { text: e.target.value, error: undefined })}
                  onKeyDown={(e) => onKey(i, e)}
                  onFocus={() => {
                    const m = modeRef.current;
                    if (m && m.focus !== i) {
                      const next = { ...m, focus: i };
                      setMode(next);
                      refresh(next);
                    } else if (m) refresh(m);
                  }}
                  onBlur={() => setTimeout(() => setAc((cur) => (document.activeElement?.closest(`.${s.cmdBox}`) ? cur : null)), 120)}
                />
              </span>
            )}
            {!o.required ? (
              <button type="button" className={s.slotRemove} aria-label={t("apps.command.removeOption", { name })} onClick={() => removeSlot(i)}>
                <X size={12} />
              </button>
            ) : null}
          </span>
        );
      })}
      {mode.leaf.options
        .filter((o) => !o.required && !mode.slots.some((slot) => slot.opt.name === o.name))
        .map((o) => (
          <button key={o.name} type="button" className={s.cmdAdd} onClick={() => addOption(o)} title={optionDescription(o)} data-testid={`add-option-${o.name}`}>
            <Plus size={12} aria-hidden="true" />
            {optionName(o)}
          </button>
        ))}
      <input
        ref={(el) => {
          if (el) inputs.current[mode.slots.length] = el;
        }}
        className={s.cmdTail}
        value=""
        aria-label={t("apps.command.label", { command: mode.leaf.label })}
        onChange={() => undefined}
        onKeyDown={onTailKey}
        onFocus={() => setAc(null)}
      />
      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && filePick.current >= 0) void takeFile(filePick.current, f);
          e.target.value = "";
        }}
      />
    </div>
  ) : null;

  const focused = mode ? mode.slots[mode.focus] : undefined;
  const hint = focused ? (
    <span className={s.cmdHint}>
      <b>{optionName(focused.opt)}</b>
      <span>{focused.error ?? optionDescription(focused.opt)}</span>
    </span>
  ) : mode ? (
    <span className={s.cmdHint}>
      <span>{mode.leaf.description}</span>
    </span>
  ) : null;
  const list: ReactNode = mode ? (
    ac ? (
      <Autocomplete serverId={channel.server_id} docked kind="command" items={ac.items} index={ac.index} onHover={(i) => setAc({ ...ac, index: i })} onPick={(i) => { const it = ac.items[i]; if (it) pick(mode.focus, it); }} tone={opts.tone} heading={focused ? `${optionName(focused.opt)}: ${optionDescription(focused.opt)}` : undefined} />
    ) : (
      <div className={[s.cmdBar, s.docked].join(" ")} data-invalid={focused?.error ? true : undefined}>
        {hint}
        <span className={s.cmdPlain}>
          <LockOpen size={13} aria-hidden="true" />
          {t("apps.command.notEncrypted", { app: mode.app.name })}
        </span>
      </div>
    )
  ) : null;

  /** Puts what the emoji picker chose into the option being written; false when the caret is in none that takes words. */
  const insert = (text: string): boolean => {
    const m = modeRef.current;
    const slot = m?.slots[m.focus];
    if (!m || !slot || slot.opt.type !== OPT_STRING || slot.value !== undefined) return false;
    const el = inputs.current[m.focus];
    const at = el && typeof el.selectionStart === "number" ? el.selectionStart : slot.text.length;
    const end = el && typeof el.selectionEnd === "number" ? el.selectionEnd : at;
    update(m.focus, { text: slot.text.slice(0, at) + text + slot.text.slice(end), error: undefined }, false);
    focusSlot(m.focus);
    return true;
  };

  return { active: !!mode, start, box, list, submit, insert };
}
