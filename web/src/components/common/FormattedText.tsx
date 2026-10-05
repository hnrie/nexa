import { Eye, EyeOff, Type } from "lucide-react";
import { Suspense, useState } from "react";
import { t } from "@/i18n";
import { lazyPage } from "@/lib/lazyChunk";
import { useRenderCtx } from "@/lib/markdownCtx";
import { Markdown } from "@/markdown";
import { TextArea } from "./TextInput";
import s from "./FormattedText.module.css";

const loadFormatEditor = () => import("@/components/composer/format/FormatEditor");
const FormatEditor = lazyPage(loadFormatEditor);

/**
 * A box for words that are shown formatted (a channel's topic, a server's
 * description): typed with markdown or put together in the formatting
 * editor, with how it will look a tap away.
 */
export function FormattedText({ value, onChange, max, placeholder, title, rows = 4, serverId, testId }: { value: string; onChange: (v: string) => void; max: number; placeholder?: string; title: string; rows?: number; serverId?: string | undefined; testId?: string }) {
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const ctx = useRenderCtx(serverId);
  return (
    <div className={s.wrap}>
      {preview ? (
        <div className={s.preview} data-testid={testId ? `${testId}-preview` : undefined}>
          {value.trim() ? <Markdown source={value} ctx={ctx} /> : <span className={s.empty}>{t("format.field.nothing")}</span>}
        </div>
      ) : (
        <TextArea value={value} onChange={(e) => onChange(e.target.value.slice(0, max))} maxLength={max} placeholder={placeholder} rows={rows} data-markdown="" data-testid={testId} />
      )}
      <div className={s.tools}>
        <button type="button" className={s.tool} onClick={() => setEditing(true)} onPointerEnter={() => void loadFormatEditor().catch(() => undefined)}>
          <Type size={16} aria-hidden="true" />
          {t("format.field.format")}
        </button>
        <button type="button" className={s.tool} aria-pressed={preview} onClick={() => setPreview((v) => !v)}>
          {preview ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          {preview ? t("format.field.edit") : t("format.field.preview")}
        </button>
        <span className={s.count} aria-live="polite">{t("format.field.left", { count: max - value.length })}</span>
      </div>
      {editing ? (
        <Suspense fallback={null}>
          <FormatEditor
            initial={value}
            title={title}
            max={max}
            placeholder={placeholder ?? ""}
            onClose={() => setEditing(false)}
            onInsert={(md) => {
              onChange(md.slice(0, max));
              setEditing(false);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
