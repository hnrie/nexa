import { useId, useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { t } from "@/i18n";
import { codeKey, lookCache } from "@/lib/look/cache";
import { FetchError, checkLink, fetchFailure, fetchText } from "@/lib/look/fetchText";
import { codeHash } from "@/lib/look/hash";
import { byteLength, packText } from "@/lib/look/pack";
import { apiVersionOf, importPlugin, metaOf } from "@/lib/look/plugins/runtime";
import { readDeclaration } from "@/lib/look/plugins/declaration";
import type { NexaPlugin } from "@/lib/look/plugins/api";
import { grantChange } from "@/lib/look/plugins/permissions";
import { MAX_PASTED_PLUGIN_BYTES, MAX_PASTED_TOTAL_BYTES, linkName, newLookId } from "@/lib/look/sanitize";
import type { PluginEntry } from "@/lib/look/types";
import { formatBytes } from "@/lib/time";
import { Caution } from "./Caution";
import { CodeEditor } from "./CodeEditor";
import s from "./Look.module.css";

type Source = "url" | "code";

/**
 * Adding a plugin, from a link or as pasted code, or changing a pasted one.
 * The warning says in plain words what a plugin can do, and nothing is added
 * until the box under it is ticked. The code is fetched and loaded once here,
 * so a link that is not a plugin is caught before it is saved, and the hash of
 * exactly this code is what the plugin is pinned to.
 */
/**
 * What a v2 plugin is granted as it is added: installing is all or nothing,
 * so the whole list it asks for. New code for a plugin keeps what it had and
 * still asks for, and drops what it no longer asks for; what it asks for anew
 * waits until the person has said yes to it. A v1 plugin asks for nothing.
 */
function grantsFor(plugin: NexaPlugin, code: string, had: PluginEntry | undefined): Pick<PluginEntry, "permissions"> {
  if (apiVersionOf(plugin) !== 2) return {};
  // what is granted is what the code says in writing, the list the person is shown (declaration.ts)
  const asked = readDeclaration(code).permissions ?? [];
  if (had && Array.isArray(had.permissions)) return { permissions: grantChange(had.permissions, asked).keep };
  return { permissions: asked };
}

export function AddPluginDialog({ initial, editing, pastedElsewhere, taken, onClose, onSave }: { initial: Source; editing?: { entry: PluginEntry; code: string }; pastedElsewhere: number; taken: string[]; onClose: () => void; onSave: (entry: PluginEntry) => void }) {
  const [source, setSource] = useState<Source>(editing ? "code" : initial);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState(editing?.code ?? "");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const size = byteLength(code);
  const tooBig = size > MAX_PASTED_PLUGIN_BYTES;
  const overTotal = pastedElsewhere + size > MAX_PASTED_TOTAL_BYTES;

  const add = async () => {
    if (!agree || busy) return;
    setError(null);
    let text = code;
    let link: string | null = null;
    if (source === "url") {
      const checked = checkLink(url);
      if (!checked) return setError(t("look.fetch.https"));
      if (taken.includes(checked.href)) return setError(t("look.plugins.alreadyAdded"));
      link = checked.href;
    } else {
      if (!code.trim()) return setError(t("look.plugins.pasteEmpty"));
      if (tooBig) return setError(t("look.plugins.pasteTooBig", { max: formatBytes(MAX_PASTED_PLUGIN_BYTES) }));
      if (overTotal) return setError(t("look.plugins.pasteTotal", { max: formatBytes(MAX_PASTED_TOTAL_BYTES) }));
    }
    setBusy(true);
    try {
      if (link) text = await fetchText(link);
      const plugin = await importPlugin(text);
      const hash = codeHash(text);
      const meta = metaOf(plugin, link ? linkName(link) : t("look.plugins.pastedName"));
      if (link) await lookCache.put(codeKey(hash), { text, fetchedAt: Date.now() });
      onSave({
        id: editing?.entry.id ?? newLookId(),
        source: link ? "url" : "code",
        url: link,
        code: link ? null : await packText(text),
        hash,
        enabled: true,
        settings: editing?.entry.settings ?? {},
        meta,
        addedAt: editing?.entry.addedAt ?? Date.now(),
        ...grantsFor(plugin, text, editing?.entry),
      });
    } catch (err) {
      setError(err instanceof FetchError ? fetchFailure(err.reason, err.status) : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? t("look.plugins.editTitle") : t("look.plugins.addTitle")}
      width={560}
      onSubmit={() => void add()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("look.common.cancel")}
          </Button>
          <Button variant="danger" onClick={() => void add()} disabled={!agree || (source === "url" ? !url.trim() : !code.trim() || tooBig || overTotal)} loading={busy} data-testid="plugin-add">
            {editing ? t("look.plugins.saveCode") : t("look.plugins.addButton")}
          </Button>
        </>
      }
    >
      <div className={s.dialogBody}>
        {editing ? null : (
          <div className={s.segment} role="radiogroup" aria-label={t("look.plugins.sourceLabel")}>
            {(["url", "code"] as const).map((k) => (
              <label key={k}>
                <input type="radio" name={`${ids}-source`} checked={source === k} onChange={() => { setSource(k); setError(null); }} data-testid={`plugin-source-${k}`} />
                {k === "url" ? t("look.plugins.fromLink") : t("look.plugins.fromPaste")}
              </label>
            ))}
          </div>
        )}
        {source === "url" ? (
          <Field label={t("look.plugins.linkLabel")} error={error} hint={t("look.plugins.linkHint")}>
            <TextInput value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }} type="url" inputMode="url" placeholder="https://" autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="ltr" data-testid="plugin-url" />
          </Field>
        ) : (
          <div>
            <CodeEditor value={code} onChange={(v) => { setCode(v); setError(null); }} label={t("look.plugins.codeLabel")} placeholder={"export default {\n  name: \"Hello\",\n  start(api) {\n    api.toast(\"Hello\");\n  },\n};\n"} testId="plugin-code" minHeight={200} />
            <div className={s.editorFoot}>
              <span data-over={tooBig || overTotal ? "" : undefined}>{t("look.css.size", { size: formatBytes(size), max: formatBytes(MAX_PASTED_PLUGIN_BYTES) })}</span>
            </div>
            {error ? <p className={s.dialogError} role="alert">{error}</p> : null}
          </div>
        )}
        <Caution level="danger" testId="plugin-caution">
          <p>
            <strong>{t("look.plugins.cautionLead")}</strong> {t("look.plugins.cautionBody")}
          </p>
        </Caution>
        <label className={s.consent} data-level="danger">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="plugin-agree" />
          <span>{t("look.plugins.consent")}</span>
        </label>
      </div>
    </Modal>
  );
}
