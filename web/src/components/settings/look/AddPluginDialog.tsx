import { useId, useState } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { formatList, t } from "@/i18n";
import { codeKey, lookCache } from "@/lib/look/cache";
import { FetchError, checkLink, fetchFailure, fetchText } from "@/lib/look/fetchText";
import { codeHash, shortHash } from "@/lib/look/hash";
import { byteLength, packText } from "@/lib/look/pack";
import { apiVersionOf, importPlugin, metaOf } from "@/lib/look/plugins/runtime";
import { readDeclaration, type Declaration } from "@/lib/look/plugins/declaration";
import { grantChange, permissionWords } from "@/lib/look/plugins/permissions";
import { MAX_PASTED_PLUGIN_BYTES, MAX_PASTED_TOTAL_BYTES, linkName, newLookId } from "@/lib/look/sanitize";
import type { PluginEntry } from "@/lib/look/types";
import { formatBytes } from "@/lib/time";
import { Caution } from "./Caution";
import { CodeEditor } from "./CodeEditor";
import { PermissionLedger } from "./PermissionLedger";
import s from "./Look.module.css";

type Source = "url" | "code";

/** The code as it was read for review, before anything of it has run. */
interface Review {
  text: string;
  link: string | null;
  hash: string;
  decl: Declaration;
}

/**
 * Adding a plugin, from a link or as pasted code, or changing a pasted one,
 * in two stages. First the link or the code. Then what it is and what it
 * asks for, read from its text without running any of it (declaration.ts),
 * with the warning and the box to tick; nothing is added, and none of its
 * code runs, until that box is ticked and Add is pressed. Installing is all or
 * nothing: a v2 plugin gets the whole list it was shown. The code is then
 * loaded once, so something that is not a plugin is caught before it is
 * saved, and the hash of exactly this code is what the plugin is pinned to.
 */
export function AddPluginDialog({ initial, editing, pastedElsewhere, taken, onClose, onSave }: { initial: Source; editing?: { entry: PluginEntry; code: string }; pastedElsewhere: number; taken: string[]; onClose: () => void; onSave: (entry: PluginEntry) => void }) {
  const [source, setSource] = useState<Source>(editing ? "code" : initial);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState(editing?.code ?? "");
  const [review, setReview] = useState<Review | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const size = byteLength(code);
  const tooBig = size > MAX_PASTED_PLUGIN_BYTES;
  const overTotal = pastedElsewhere + size > MAX_PASTED_TOTAL_BYTES;
  const had = editing && Array.isArray(editing.entry.permissions) ? editing.entry.permissions : null;

  /** To the second stage: the code fetched or taken from the box, and read. */
  const toReview = async () => {
    if (busy) return;
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
      setAgree(false);
      setReview({ text, link, hash: codeHash(text), decl: readDeclaration(text) });
    } catch (err) {
      setError(err instanceof FetchError ? fetchFailure(err.reason, err.status) : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** What the reviewed code would be granted: the list it shows, all of it; for new code, what it still asks for and what it asks for anew. */
  const asked = review?.decl.permissions ?? [];
  const change = had ? grantChange(had, asked) : null;

  const add = async () => {
    if (!review || !agree || busy) return;
    setError(null);
    setBusy(true);
    try {
      // agreed to: only now does any of its code run
      const plugin = await importPlugin(review.text);
      const meta = metaOf(plugin, review.link ? linkName(review.link) : t("look.plugins.pastedName"));
      if (review.link) await lookCache.put(codeKey(review.hash), { text: review.text, fetchedAt: Date.now() });
      const v2 = apiVersionOf(plugin) === 2;
      onSave({
        id: editing?.entry.id ?? newLookId(),
        source: review.link ? "url" : "code",
        url: review.link,
        code: review.link ? null : await packText(review.text),
        hash: review.hash,
        enabled: true,
        settings: editing?.entry.settings ?? {},
        meta,
        addedAt: editing?.entry.addedAt ?? Date.now(),
        ...(v2 ? { permissions: change ? [...change.keep, ...change.added] : asked } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const decl = review?.decl;
  const shownName = decl?.name || (review?.link ? linkName(review.link) : t("look.plugins.pastedName"));

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? t("look.plugins.editTitle") : t("look.plugins.addTitle")}
      width={560}
      onSubmit={() => void (review ? add() : toReview())}
      footer={
        review ? (
          <>
            <Button variant="ghost" onClick={() => { setReview(null); setError(null); }} data-testid="plugin-back">
              {t("look.plugins.back")}
            </Button>
            <Button variant="danger" onClick={() => void add()} disabled={!agree} loading={busy} data-testid="plugin-add">
              {editing ? t("look.plugins.saveCode") : t("look.plugins.addButton")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("look.common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void toReview()} disabled={source === "url" ? !url.trim() : !code.trim() || tooBig || overTotal} loading={busy} data-testid="plugin-continue">
              {t("look.plugins.continue")}
            </Button>
          </>
        )
      }
    >
      {review && decl ? (
        <div className={s.dialogBody} data-testid="plugin-review">
          <div className={s.reviewHead}>
            <span className={s.reviewName}>
              <span dir="auto">{shownName}</span>
              {decl.version ? <span className={s.reviewVersion} dir="ltr">{decl.version}</span> : null}
            </span>
            {decl.author ? <span className={s.reviewSub} dir="auto">{t("look.plugins.by", { author: decl.author })}</span> : null}
            {decl.description ? <span className={s.reviewDesc} dir="auto">{decl.description}</span> : null}
            <span className={s.reviewFingerprint} title={t("look.plugins.fingerprintHint")}>{t("look.plugins.fingerprint", { hash: shortHash(review.hash) })}</span>
          </div>
          {decl.apiVersion === 2 ? (
            <>
              <div className={s.ledger}>
                <h3 className={s.groupTitle}>{t("look.plugins.permsHeading")}</h3>
                {decl.permissions === null ? (
                  <p className={s.ledgerNote} data-testid="plugin-perms-unwritten">{t("look.plugins.permsUnwritten")}</p>
                ) : decl.permissions.length === 0 ? (
                  <p className={s.ledgerNote} data-testid="plugin-perms-none">{t("look.plugins.permsNone")}</p>
                ) : (
                  <>
                    {change ? (change.added.length ? <p className={s.ledgerNote}>{t("look.plugins.editMore")}</p> : null) : <p className={s.ledgerNote}>{t("look.plugins.permsLead")}</p>}
                    <PermissionLedger permissions={decl.permissions} fresh={change ? new Set(change.added) : undefined} testId="plugin-perms" />
                  </>
                )}
                {change?.dropped.length ? <p className={s.ledgerNote}>{t("look.plugins.updateLess", { list: formatList(change.dropped.map((p) => permissionWords(p).name)) })}</p> : null}
              </div>
              <Caution level="danger" testId="plugin-caution">
                <p>{t("look.plugins.notSandbox")}</p>
              </Caution>
            </>
          ) : (
            <Caution level="danger" testId="plugin-caution">
              <p>
                <strong>{t("look.plugins.cautionLead")}</strong> {t("look.plugins.v1Warning")}
              </p>
            </Caution>
          )}
          {error ? <p className={s.dialogError} role="alert">{error}</p> : null}
          <label className={s.consent} data-level="danger">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="plugin-agree" />
            <span>{t("look.plugins.consent")}</span>
          </label>
        </div>
      ) : (
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
              <CodeEditor value={code} onChange={(v) => { setCode(v); setError(null); }} label={t("look.plugins.codeLabel")} placeholder={"export default {\n  name: \"Hello\",\n  apiVersion: 2,\n  permissions: [\"ui.write\"],\n  start(api) {\n    api.ui.toast(\"Hello\");\n  },\n};\n"} testId="plugin-code" minHeight={200} />
              <div className={s.editorFoot}>
                <span data-over={tooBig || overTotal ? "" : undefined}>{t("look.css.size", { size: formatBytes(size), max: formatBytes(MAX_PASTED_PLUGIN_BYTES) })}</span>
              </div>
              {error ? <p className={s.dialogError} role="alert">{error}</p> : null}
            </div>
          )}
          <Caution level="danger" testId="plugin-caution-source">
            <p>
              <strong>{t("look.plugins.cautionLead")}</strong> {t("look.plugins.cautionBody")}
            </p>
          </Caution>
        </div>
      )}
    </Modal>
  );
}
