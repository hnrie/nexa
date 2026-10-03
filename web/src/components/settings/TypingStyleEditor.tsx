import { Dices, Plus, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/common/Button";
import { TextInput } from "@/components/common/TextInput";
import { StyledTyping, TypingEmoji } from "@/components/chat/TypingLine";
import { ExpressionPicker } from "@/components/pickers/ExpressionPicker";
import { t } from "@/i18n";
import { MAX_TYPING_EMOJI, MAX_TYPING_WORDS, presetLabel, surpriseStyle, TYPING_MOTIONS, TYPING_PRESETS, type TypingMotion, type TypingStyle } from "@/lib/typingStyle";
import s from "./TypingEditor.module.css";

const MOTION_LABELS: Record<TypingMotion, string> = { wave: "typing.motion.wave", pulse: "typing.motion.pulse", wiggle: "typing.motion.wiggle", still: "typing.motion.still" };

/** Nothing chosen is the plain style, which is stored as none. */
function tidy(style: TypingStyle): TypingStyle | null {
  return style.emoji.length === 0 && !style.preset && !style.words ? null : style;
}

/**
 * Settings, Profiles: how "is typing…" looks for you to everyone else. The
 * preview is the foot of a conversation as they see it; under it, up to
 * three emoji (the first one picked fills all three, to start from a whole
 * set), how they move, and the words after your name.
 */
export function TypingStyleEditor({ value, onChange, name }: { value: TypingStyle | null; onChange: (v: TypingStyle | null) => void; name: string }) {
  const [picker, setPicker] = useState<{ slot: number; at: DOMRect } | null>(null);
  // "Your Own" chosen before anything is written in it
  const [ownOpen, setOwnOpen] = useState(!!value?.words);
  const style: TypingStyle = value ?? { emoji: [], motion: "wave" };
  const wordsMode = style.words || ownOpen ? "own" : (style.preset ?? "");
  const change = (patch: Partial<TypingStyle>) => {
    const next: TypingStyle = { ...style, ...patch };
    if (!next.words) delete next.words;
    if (!next.preset || next.words) delete next.preset;
    onChange(tidy(next));
  };
  const pickEmoji = (slot: number, token: string) => {
    // the first emoji fills every slot, so there is a whole set to change from
    const emoji = style.emoji.length === 0 ? Array.from({ length: MAX_TYPING_EMOJI }, () => token) : style.emoji.map((e, i) => (i === slot ? token : e));
    if (slot >= style.emoji.length && style.emoji.length > 0) emoji.push(token);
    change({ emoji: emoji.slice(0, MAX_TYPING_EMOJI) });
  };
  const removeEmoji = (slot: number) => change({ emoji: style.emoji.filter((_, i) => i !== slot) });
  const noEmoji = style.emoji.length === 0;

  return (
    <div className={s.wrap}>
      <div className={s.stage} aria-hidden="true" data-testid="typing-preview">
        <div className={s.ghost}>
          <span className={s.ghostAvatar} />
          <span className={s.ghostLines}><i /><i /></span>
        </div>
        <div className={s.line}>
          <StyledTyping style={value} name={name} />
        </div>
        <div className={s.composer}>{t("typing.editor.composer")}</div>
      </div>

      <div>
        <p className={s.label} id="typing-emoji-label">{t("typing.editor.emoji")}</p>
        <div className={s.slots} role="group" aria-labelledby="typing-emoji-label">
          {Array.from({ length: MAX_TYPING_EMOJI }, (_, i) => {
            const token = style.emoji[i];
            const open = picker?.slot === i;
            return (
              <div key={i} className={s.slot}>
                <button
                  type="button"
                  className={s.slotBtn}
                  data-empty={!token || undefined}
                  data-open={open || undefined}
                  data-picker-toggle={open || undefined}
                  aria-label={token ? t("typing.editor.changeEmoji", { n: i + 1 }) : t("typing.editor.chooseEmoji", { n: i + 1 })}
                  onClick={(e) => setPicker(open ? null : { slot: token ? i : Math.min(i, style.emoji.length), at: e.currentTarget.getBoundingClientRect() })}
                  data-testid={`typing-slot-${i}`}
                >
                  {token ? <TypingEmoji token={token} className={s.slotGlyph} /> : <Plus size={20} aria-hidden="true" />}
                </button>
                {token ? (
                  <button type="button" className={s.slotClear} aria-label={t("typing.editor.removeEmoji", { n: i + 1 })} onClick={() => removeEmoji(i)}>
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className={s.label} id="typing-motion-label">{t("typing.editor.motion")}</p>
        <div className={s.pills} role="radiogroup" aria-labelledby="typing-motion-label">
          {TYPING_MOTIONS.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={style.motion === m} className={s.pill} disabled={noEmoji} onClick={() => change({ motion: m })} data-testid={`typing-motion-${m}`}>
              {t(MOTION_LABELS[m])}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className={s.label} id="typing-words-label">{t("typing.editor.words")}</p>
        <div className={s.pills} role="radiogroup" aria-labelledby="typing-words-label">
          <button type="button" role="radio" aria-checked={wordsMode === ""} className={s.pill} onClick={() => { setOwnOpen(false); change({ preset: "", words: "" }); }}>
            {presetLabel("")}
          </button>
          {TYPING_PRESETS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={wordsMode === p} className={s.pill} onClick={() => { setOwnOpen(false); change({ preset: p, words: "" }); }} data-testid={`typing-preset-${p}`}>
              {presetLabel(p)}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={wordsMode === "own"} className={s.pill} onClick={() => setOwnOpen(true)} data-testid="typing-own">
            {t("typing.editor.ownWords")}
          </button>
        </div>
        {wordsMode === "own" ? (
          <div className={s.own}>
            <TextInput
              value={style.words ?? ""}
              maxLength={MAX_TYPING_WORDS}
              placeholder={t("typing.editor.ownPlaceholder")}
              aria-label={t("typing.editor.ownWords")}
              autoFocus={!style.words}
              onChange={(e) => change({ words: e.target.value.replace(/\s+/g, " ").replace(/^\s/, ""), preset: "" })}
              data-testid="typing-own-input"
            />
          </div>
        ) : null}
      </div>

      <div className={s.actions}>
        <Button size="sm" variant="secondary" onClick={() => { setOwnOpen(false); onChange(surpriseStyle(value)); }} data-testid="typing-surprise">
          <Dices size={16} aria-hidden="true" /> {t("typing.editor.surprise")}
        </Button>
        {value ? (
          <Button size="sm" variant="ghost" onClick={() => { setOwnOpen(false); onChange(null); }} data-testid="typing-reset">
            <RotateCcw size={15} aria-hidden="true" /> {t("typing.editor.reset")}
          </Button>
        ) : null}
      </div>

      {picker ? (
        <ExpressionPicker
          anchor={picker.at}
          onClose={() => setPicker(null)}
          onEmoji={(e) => {
            pickEmoji(picker.slot, e.unicode);
            setPicker(null);
          }}
        />
      ) : null}
    </div>
  );
}
