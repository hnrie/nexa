import { ChevronLeft, Copy, Download, Info, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/common/Button";
import { Field, TextInput } from "@/components/common/TextInput";
import { t } from "@/i18n";
import { copyText } from "@/lib/copyText";
import { contrastIssues } from "@/lib/look/contrast";
import { MAX_THEME_NAME, exportTheme, resolveCustom } from "@/lib/look/customTheme";
import { deriveTheme } from "@/lib/look/derive";
import { useLookDraft } from "@/lib/look/draft";
import type { CustomTheme } from "@/lib/look/types";
import { useSettings } from "@/stores/settings";
import { unlessUnsaved, useHoldUnsaved, useUnsaved } from "@/stores/unsaved";
import { useUI } from "@/stores/ui";
import settings from "../Settings.module.css";
import { AdvancedEditor } from "./AdvancedEditor";
import { SimpleEditor } from "./SimpleEditor";
import { ThemeSpecimen } from "./ThemeSpecimen";
import { useCustomThemes } from "./ThemeGallery";
import s from "./Look.module.css";

type Tab = "simple" | "advanced";

/** A file name made from a theme's name: letters, digits and dashes. */
function fileName(name: string): string {
  const slug = name.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${slug || "theme"}.nexa-theme.json`;
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Making or changing a custom theme. The whole app wears the theme while it
 * is open, so every page behind this one is the preview, and the specimen
 * beside it shows the parts of a conversation the settings never do. Nothing
 * is kept until Save; leaving with changes shakes the save bar, as every
 * settings page does.
 */
export function ThemeBuilder({ initial, isNew, onClose }: { initial: CustomTheme; isNew: boolean; onClose: () => void }) {
  const patch = useSettings((x) => x.patch);
  const theme = useSettings((x) => x.settings.theme);
  const accent = useSettings((x) => x.settings.accent);
  const pair = useSettings((x) => x.settings.systemThemes);
  const customs = useCustomThemes();
  const toast = useUI((u) => u.toast);
  const [draft, setDraft] = useState<CustomTheme>(initial);
  const [saved, setSaved] = useState<CustomTheme>(initial);
  const [fresh, setFresh] = useState(isNew);
  const [tab, setTab] = useState<Tab>(initial.source.kind === "simple" && Object.keys(initial.overrides).length === 0 ? "simple" : "advanced");
  // the simple colours last used, so Advanced can go back to them after trying a preset
  const lastSimple = useRef<CustomTheme["source"] | null>(initial.source.kind === "simple" ? initial.source : null);
  if (draft.source.kind === "simple") lastSimple.current = draft.source;
  const ids = useId();

  const resolved = useMemo(() => resolveCustom(draft), [draft]);
  const simpleColours = draft.source.kind === "simple" ? draft.source : null;
  const derived = useMemo(() => (simpleColours ? deriveTheme(simpleColours) : null), [simpleColours]);
  const issues = useMemo(() => contrastIssues(resolved.tokens), [resolved.tokens]);
  const dirty = fresh || JSON.stringify(draft) !== JSON.stringify(saved);

  // The app wears the draft, a frame at a time while a picker is dragged.
  const setDraftTheme = useLookDraft((d) => d.setTheme);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDraftTheme({ tokens: resolved.tokens, scheme: resolved.scheme, id: draft.id }));
    return () => cancelAnimationFrame(frame);
  }, [resolved, draft.id, setDraftTheme]);
  useEffect(() => () => setDraftTheme(null), [setDraftTheme]);

  useHoldUnsaved(dirty);
  const nudge = useUnsaved((u) => u.nudge);
  const [calm] = useState(nudge);

  const save = () => {
    const next = { ...draft, name: draft.name.trim().slice(0, MAX_THEME_NAME) || t("settings.themeBuilder.untitled") };
    const list = customs.some((c) => c.id === next.id) ? customs.map((c) => (c.id === next.id ? next : c)) : [...customs, next];
    // saving is choosing: the theme on screen stays on screen
    patch({ customThemes: list, theme: next.id });
    setDraft(next);
    setSaved(next);
    setFresh(false);
    toast(t("settings.themeBuilder.saved"), "success");
  };

  const remove = () =>
    useUI.getState().openModal("confirm", {
      title: t("settings.themeBuilder.deleteTitle", { name: saved.name || t("settings.themeBuilder.untitled") }),
      body: t("settings.themeBuilder.deleteBody"),
      confirmLabel: t("settings.themeBuilder.delete"),
      danger: true,
      onConfirm: () => {
        const gone = saved.id;
        patch({
          customThemes: customs.filter((c) => c.id !== gone),
          ...(theme === gone ? { theme: "dark" } : {}),
          ...(pair.dark === gone || pair.light === gone ? { systemThemes: { dark: pair.dark === gone ? "dark" : pair.dark, light: pair.light === gone ? "light" : pair.light } } : {}),
        });
        // nothing is left to be unsaved about
        setSaved(draft);
        setFresh(false);
        setTimeout(onClose, 0);
      },
    });

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next: Tab = e.key === "Home" ? "simple" : e.key === "End" ? "advanced" : tab === "simple" ? "advanced" : "simple";
    setTab(next);
    document.getElementById(`${ids}-tab-${next}`)?.focus();
  };

  const toSimple = () => {
    // Simple works from a few colours; a theme built on a preset brings its own over
    if (draft.source.kind === "simple") return setTab("simple");
    const tk = resolved.tokens;
    setDraft({ ...draft, source: lastSimple.current?.kind === "simple" ? lastSimple.current : { kind: "simple", background: tk["bg-raised"], accent: tk.brand, text: null, scheme: resolved.scheme } });
    setTab("simple");
  };

  return (
    <>
      <div className={s.backRow}>
        <button type="button" className={s.backBtn} onClick={unlessUnsaved(onClose)} aria-label={t("server.settingsLayer.backTo", { name: t("settings.appearance.appearance") })} data-testid="builder-back">
          <ChevronLeft size={18} className={settings.flip} aria-hidden="true" />
          {t("settings.appearance.appearance")}
        </button>
      </div>
      <h2 className={settings.title}>{fresh ? t("settings.themeBuilder.titleNew") : t("settings.themeBuilder.titleEdit")}</h2>
      <div className={s.builderHead}>
        <Field label={t("settings.themeBuilder.name")}>
          <TextInput value={draft.name} maxLength={MAX_THEME_NAME} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("settings.themeBuilder.untitled")} dir="auto" data-testid="builder-name" />
        </Field>
        <div className={s.tabs} role="tablist" aria-label={t("settings.themeBuilder.modeLabel")}>
          {(["simple", "advanced"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`${ids}-tab-${k}`}
              className={s.tab}
              aria-selected={tab === k}
              aria-controls={`${ids}-panel`}
              tabIndex={tab === k ? 0 : -1}
              onClick={() => (k === "simple" ? toSimple() : setTab("advanced"))}
              onKeyDown={onTabKey}
              data-testid={`builder-tab-${k}`}
            >
              {k === "simple" ? t("settings.themeBuilder.simple") : t("settings.themeBuilder.advanced")}
            </button>
          ))}
        </div>
      </div>
      {accent ? (
        <div className={s.notice}>
          <Info size={16} aria-hidden="true" />
          <p className={s.noticeBody}>{t("settings.themeBuilder.accentOverride")}</p>
          <Button className={s.noticeAction} variant="secondary" size="sm" onClick={() => patch({ accent: null })}>
            {t("settings.themeBuilder.useThemeAccent")}
          </Button>
        </div>
      ) : null}
      <div className={s.builder}>
        <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${tab}`}>
          {tab === "simple" && simpleColours && derived ? (
            <SimpleEditor
              value={simpleColours}
              derived={derived}
              onChange={(v) => setDraft({ ...draft, source: { kind: "simple", ...v } })}
              handSet={Object.keys(draft.overrides).length}
              onClearHandSet={() => setDraft({ ...draft, overrides: {} })}
            />
          ) : (
            <AdvancedEditor theme={draft} tokens={resolved.tokens} issues={issues} onChange={setDraft} lastSimple={lastSimple.current} />
          )}
        </div>
        <aside className={s.builderSide} aria-label={t("settings.themeBuilder.preview")}>
          <ThemeSpecimen tokens={resolved.tokens} />
          <p className={s.specCaption}>{t("settings.themeBuilder.previewHint")}</p>
        </aside>
      </div>
      <div className={s.builderFoot}>
        <Button variant="secondary" size="sm" onClick={() => download(fileName(draft.name), exportTheme(draft))} data-testid="builder-export">
          <Download size={15} aria-hidden="true" /> {t("settings.themeBuilder.export")}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void copyText(exportTheme(draft)).then((ok) => toast(ok ? t("settings.themeBuilder.copied") : t("common.copyFailed"), ok ? "success" : "error"))} data-testid="builder-copy">
          <Copy size={15} aria-hidden="true" /> {t("settings.themeBuilder.copy")}
        </Button>
        {fresh ? null : (
          <Button className={s.push} variant="ghost" size="sm" onClick={remove} data-testid="builder-delete">
            <Trash2 size={15} aria-hidden="true" /> {t("settings.themeBuilder.delete")}
          </Button>
        )}
      </div>
      {dirty ? (
        <div key={nudge} className={[settings.saveBar, nudge !== calm ? settings.shake : ""].join(" ")} role="status" data-testid="save-bar">
          <span className={settings.saveText}>{fresh ? t("settings.themeBuilder.unsavedNew") : t("settings.themeBuilder.unsaved")}</span>
          <span className={[settings.saveBtns, s.touchBar].join(" ")}>
            <Button variant="ghost" onClick={fresh ? onClose : () => setDraft(saved)} data-testid="builder-discard">
              {fresh ? t("settings.themeBuilder.discard") : t("settings.themeBuilder.reset")}
            </Button>
            <Button variant="positive" onClick={save} data-testid="save">
              {t("settings.themeBuilder.save")}
            </Button>
          </span>
        </div>
      ) : null}
    </>
  );
}
