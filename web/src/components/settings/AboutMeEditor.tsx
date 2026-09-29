import { Smile, Type } from "lucide-react";
import { Suspense, useRef, useState } from "react";
import { SpellLines, useSpellActive } from "@/components/common/SpellLines";
import { extractMentions, humanizeMentions, type MentionScope } from "@/components/composer/mentions";
import { mentionScope } from "@/components/composer/send";
import { closeShortcode, typedColon } from "@/components/composer/shortcodeTyping";
import { applyWrap, formatShortcut } from "@/components/composer/wrapShortcut";
import { ExpressionPicker } from "@/components/pickers/ExpressionPicker";
import { lazyPage } from "@/lib/lazyChunk";
import { useSettings } from "@/stores/settings";
import s from "./AboutMeEditor.module.css";

import { t } from "@/i18n";

const loadFormatEditor = () => import("@/components/composer/format/FormatEditor");
const FormatEditor = lazyPage(loadFormatEditor);

/** The custom emoji an About Me can show: any this account can use whose name is not a standard emoji's. */
function aboutScope(): MentionScope {
  const scope = mentionScope("");
  return { emoji: scope.emoji, isShortcode: scope.isShortcode };
}

/** An About Me as it is saved: each custom emoji's :name: made into the emoji, as sending a message does. @names stay words. */
export function aboutToSave(text: string): string {
  return extractMentions(text, {}, aboutScope()).text;
}

/** An About Me as it is written: its custom emoji back to their :name:, where that name brings the same emoji back. */
export function aboutToEdit(saved: string): string {
  const scope = aboutScope();
  return humanizeMentions(saved, {}, { emoji: (token, name) => extractMentions(`:${name}:`, {}, scope).text === token });
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  max: number;
  placeholder: string;
  label: string;
}

/**
 * The About Me box, written the way a message is: Ctrl+B, I and U, a :name:
 * that becomes its emoji as its closing colon goes in, the emoji picker, the
 * formatting editor, Nexa's spell checker and a right-click menu with
 * formatting in it. What it holds is markdown, which a profile shows with the
 * same renderer as a message.
 */
export function AboutMeEditor({ value, onChange, max, placeholder, label }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const tone = useSettings((st) => st.settings.skinTone);
  const spellcheck = useSettings((st) => st.settings.spellcheck !== false);
  const ownSpelling = useSpellActive();
  const [formatting, setFormatting] = useState(false);
  const [picker, setPicker] = useState<DOMRect | null>(null);

  /** Puts words in over the selection, where the caret was, and leaves the caret after them. */
  const insert = (words: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const next = (value.slice(0, start) + words + value.slice(end)).slice(0, max);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(start + words.length, start + words.length);
    });
  };

  return (
    <div className={s.box} data-testid="about-me-editor">
      <textarea
        ref={ref}
        className={s.ta}
        value={value}
        rows={6}
        maxLength={max}
        placeholder={placeholder}
        aria-label={label}
        spellCheck={spellcheck && !ownSpelling}
        data-spell={ownSpelling ? "" : undefined}
        data-markdown=""
        onChange={(e) => {
          // a :name: typed out in full becomes its emoji as its closing colon goes in, as in the message box
          const el = e.currentTarget;
          const closed = typedColon(e.nativeEvent) ? closeShortcode(el.value, el.selectionStart ?? el.value.length, tone) : null;
          if (!closed) return onChange(el.value);
          onChange(closed.value);
          requestAnimationFrame(() => ref.current?.setSelectionRange(closed.caret, closed.caret));
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          const marker = formatShortcut(e);
          if (marker) {
            e.preventDefault();
            applyWrap(e.currentTarget, marker);
          }
        }}
      />
      <SpellLines target={ref} text={value} />
      <div className={s.tools}>
        <button
          type="button"
          className={s.tool}
          data-on={formatting}
          aria-label={t("composer.format.open")}
          title={t("composer.format.open")}
          onClick={() => setFormatting(true)}
          onPointerEnter={() => void loadFormatEditor().catch(() => undefined)}
          data-testid="about-format-open"
        >
          <Type size={20} />
        </button>
        <button
          type="button"
          className={s.tool}
          data-on={!!picker}
          data-picker-toggle={picker ? "" : undefined}
          aria-label={t("composer.composer.selectEmoji")}
          title={t("composer.composer.selectEmoji")}
          onClick={(e) => {
            // measured now: the event is gone by the time the state updates
            const at = e.currentTarget.getBoundingClientRect();
            setPicker((open) => (open ? null : at));
          }}
          data-testid="about-emoji-open"
        >
          <Smile size={20} />
        </button>
      </div>
      {picker ? (
        <ExpressionPicker
          anchor={picker}
          onClose={() => setPicker(null)}
          onEmoji={(em) => {
            // a custom emoji goes in as its :name: when that name brings back this very emoji
            const custom = /^<a?:(\w+):\d+>$/.exec(em.unicode);
            const short = custom ? `:${custom[1]}:` : null;
            insert((short && aboutToSave(short) === em.unicode ? short : em.unicode) + " ");
          }}
        />
      ) : null}
      {formatting ? (
        <Suspense fallback={null}>
          <FormatEditor
            initial={value}
            placeholder={placeholder}
            title={t("settings.profile.formatAboutMe")}
            max={max}
            onClose={() => {
              setFormatting(false);
              requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
            }}
            onInsert={(md) => {
              setFormatting(false);
              onChange(md.slice(0, max));
              requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
