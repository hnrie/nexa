import { ReportSnapshot } from "./ReportSnapshot";
import { useEffect, useRef, useState } from "react";
import {
  REPORT_KINDS,
  REPORT_REASONS,
  reports,
  type ReportKind,
  type ReportTarget,
} from "@/api/reports";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Select } from "@/components/common/Select";
import { Field, TextArea, TextInput } from "@/components/common/TextInput";
import { describeError } from "@/lib/errors";
import type { ReportContext } from "@/lib/reporting";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import s from "./Reports.module.css";

export default function ReportModal({
  context = {},
  onClose,
}: {
  context?: ReportContext;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<ReportKind>(context.kind ?? "other");
  const [id, setId] = useState(context.id ?? "");
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const [part, setPart] = useState(context.part ?? "whole");
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("harassment");
  const [description, setDescription] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const filePicker = useRef<HTMLInputElement>(null);
  const sendLock = useRef(false);
  const uploadCache = useRef(new Map<File, { id: string; name: string }>());
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setTarget(null);
    setError("");
    if (kind !== "other" && !/^\d{1,20}$/.test(id)) return;
    const controller = new AbortController();
    setLoading(true);
    reports
      .target(kind, id || "0", context.serverId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setTarget(value);
        setPart((previous) =>
          value.parts.includes(previous) ? previous : value.parts[0]!,
        );
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setError(describeError(err, t("reports.failed")));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [kind, id, context.serverId]);
  const evidence = context.evidence ?? [];
  const selectedText = selected
    .map((i) => evidence[i]?.text ?? "")
    .filter(Boolean)
    .concat(excerpt.trim() ? [excerpt] : [])
    .join("\n\n");
  const valid =
    !!target &&
    description.trim().length >= 3 &&
    (part !== "custom" || !!custom.trim()) &&
    selectedText.length <= 16000;
  const send = async () => {
    if (!valid || sendLock.current || !target) return;
    sendLock.current = true;
    setBusy(true);
    setError("");
    try {
      const uploaded = [];
      for (const file of files) {
        let result = uploadCache.current.get(file);
        if (!result) {
          const f = await reports.upload(file);
          result = { id: f.id, name: file.name };
          uploadCache.current.set(file, result);
        }
        uploaded.push(result);
      }
      const result = await reports.send({
        request_id: requestId.current,
        target_kind: kind,
        target_id: target.id,
        ...(context.serverId ? { server_id: context.serverId } : {}),
        part,
        custom_part: custom,
        reason,
        description,
        excerpt: selectedText,
        files: uploaded,
      });
      setReceipt(result.report.id);
      useUI.getState().toast(t("reports.sent"), "success");
    } catch (err) {
      setError(describeError(err, t("reports.failed")));
    } finally {
      sendLock.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={receipt ? t("reports.sent") : t("reports.report")}
      width={620}
      closeOnOverlay={!busy}
      closeButton={!busy}
      swipe={!busy}
      footer={
        <Button
          onClick={receipt ? onClose : () => void send()}
          disabled={!receipt && !valid}
          loading={busy}
        >
          {receipt ? t("reports.close") : t("reports.send")}
        </Button>
      }
    >
      <div className={s.form} data-testid="content-report-form">
        {receipt ? (
          <>
            <p>{t("reports.receipt")}</p>
            <p className={s.meta}>{receipt}</p>
          </>
        ) : (
          <>
            <p className={s.notice}>{t("reports.privacy")}</p>
            {!context.kind && (
              <Field label={t("reports.target")}>
                <Select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as ReportKind);
                    setId("");
                    setSelected([]);
                  }}
                  disabled={busy}
                >
                  {REPORT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`reports.kind.${k}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {!context.id && kind !== "other" && (
              <Field label={t("reports.targetId")}>
                <TextInput
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  maxLength={20}
                  inputMode="numeric"
                  disabled={busy}
                />
              </Field>
            )}
            {context.kind && <strong>{t(`reports.kind.${kind}`)}</strong>}
            {target && (
              <Field label={t("reports.part")}>
                <Select
                  value={part}
                  onChange={(e) => setPart(e.target.value)}
                  disabled={busy}
                >
                  {target.parts.map((p) => (
                    <option key={p} value={p}>
                      {t(`reports.part.${p}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {part === "custom" && (
              <Field label={t("reports.customPart")} required>
                <TextInput
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  maxLength={120}
                  disabled={busy}
                />
              </Field>
            )}
            <Field label={t("reports.reason")}>
              <Select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
              >
                {REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`reports.reason.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("reports.description")}
              required
              hint={t("reports.descriptionHint")}
            >
              <TextArea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={4000}
                rows={4}
                disabled={busy}
              />
            </Field>
            {evidence.length > 0 && (
              <fieldset className={s.evidence}>
                <legend>{t("reports.chooseEvidence")}</legend>
                <p className={s.meta}>{t("reports.selectedOnly")}</p>
                {evidence.map((item, i) => (
                  <label key={i} className={s.check}>
                    <input
                      type="checkbox"
                      checked={selected.includes(i)}
                      disabled={busy}
                      onChange={(e) =>
                        setSelected((old) =>
                          e.target.checked
                            ? [...old, i]
                            : old.filter((n) => n !== i),
                        )
                      }
                    />
                    <span>
                      <strong>{item.label}</strong>
                      <pre className={s.preview}>{item.text}</pre>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <Field label={t("reports.excerpt")} hint={t("reports.excerptHint")}>
              <TextArea
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                maxLength={16000}
                rows={3}
                disabled={busy}
              />
            </Field>
            <Field
              as="div"
              label={t("reports.files")}
              hint={t("reports.filesHint")}
            >
              <div>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => filePicker.current?.click()}
                >
                  {t("reports.files")}
                </Button>
                <input
                  ref={filePicker}
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/webm"
                  multiple
                  disabled={busy}
                  onChange={(e) => {
                    const added = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (
                      files.length + added.length > 5 ||
                      [...files, ...added].reduce((sum, f) => sum + f.size, 0) >
                        100 * 1024 * 1024 ||
                      added.some(
                        (f) =>
                          f.size >
                          (f.type.startsWith("image/") ? 10 : 50) * 1024 * 1024,
                      )
                    ) {
                      setError(t("reports.filesHint"));
                      return;
                    }
                    setFiles((old) => [...old, ...added]);
                  }}
                />
              </div>
            </Field>
            {files.map((f, i) => (
              <div key={i} className={s.actions}>
                <span>{f.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setFiles((old) => old.filter((_, n) => n !== i))
                  }
                >
                  {t("reports.remove")}
                </Button>
              </div>
            ))}
            {target && Object.keys(target.snapshot).length > 0 && (
              <details>
                <summary>{t("reports.sharedDetails")}</summary>
                <p className={s.meta}>{t("reports.snapshotHint")}</p>
                <ReportSnapshot snapshot={target.snapshot} kind={kind} />
              </details>
            )}
            {loading && <p role="status">{t("reports.loading")}</p>}
            {selectedText.length > 16000 && (
              <p className={s.error} role="alert">
                {t("reports.evidenceTooLong")}
              </p>
            )}
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
