import { MessageItem } from "@/components/chat/MessageItem";
import type { DecryptedMessage } from "@/lib/decrypt";
import { Markdown } from "@/markdown";
import { useRenderCtx } from "@/lib/markdownCtx";
import { ReportSnapshot } from "./ReportSnapshot";
import { useEffect, useRef, useState } from "react";
import {
  REPORT_KINDS,
  REPORT_REASONS,
  reports,
  type ReportKind,
  type ReportTarget,
  type ReportedMessage,
} from "@/api/reports";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Select } from "@/components/common/Select";
import { Field, TextArea, TextInput } from "@/components/common/TextInput";
import { describeError } from "@/lib/errors";
import { fullReportedMessage, type ReportContext } from "@/lib/reporting";
import { messages } from "@/api/messages";
import { decryptForStore } from "@/lib/decrypt";
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
  const renderCtx = useRenderCtx();
  const [kind, setKind] = useState<ReportKind>(context.kind ?? "other");
  const [id, setId] = useState(context.id ?? "");
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const part = kind === "other" ? "custom" : "whole";

  const [reason, setReason] = useState("harassment");
  const [description, setDescription] = useState("");
  const custom = kind === "other" ? description.slice(0, 120) : "";
  const [message, setMessage] = useState<ReportedMessage | null>(null);
  const [preview, setPreview] = useState<DecryptedMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const sendLock = useRef(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setTarget(null);
    setLoading(false);
    setMessage(null);
    setPreview(null);
    setError("");
    if (kind !== "other" && !/^\d{1,20}$/.test(id)) return;
    const controller = new AbortController();
    setLoading(true);
    reports
      .target(kind, id || "0", context.serverId, controller.signal)
      .then(async (value) => {
        if (kind === "message") {
          const opened = await decryptForStore(
            await messages.get(String(value.snapshot.channel_id), value.id),
          );
          if (controller.signal.aborted) return;
          const full = fullReportedMessage(opened);
          if (!full) throw new Error(t("reports.messageUnavailable"));
          setMessage(full);
          setPreview(opened);
        }
        if (!controller.signal.aborted) setTarget(value);
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
  const selectedText =
    kind === "message"
      ? ""
      : (context.evidence ?? []).map((item) => item.text).join("\n\n");
  const valid =
    !!target &&
    (kind !== "message" || !!message) &&
    description.trim().length >= 3 &&
    (part !== "custom" || !!custom.trim()) &&
    selectedText.length <= 16000;
  const send = async () => {
    if (!valid || sendLock.current || !target) return;
    sendLock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await reports.send({
        request_id: requestId.current,
        ...(kind === "message" && message ? { message } : {}),
        target_kind: kind,
        target_id: target.id,
        ...(context.serverId ? { server_id: context.serverId } : {}),
        part,
        custom_part: custom,
        reason,
        description,
        excerpt: selectedText,
        files: [],
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
            {kind !== "message" && (
              <p className={s.notice}>{t("reports.privacy")}</p>
            )}
            {!context.kind && (
              <Field label={t("reports.target")}>
                <Select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as ReportKind);
                    setId("");
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
            {context.kind && kind !== "message" && (
              <strong>{t(`reports.kind.${kind}`)}</strong>
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
            {kind === "message" && preview && (
              <div
                className={s.chatPreview}
                ref={(el) => el?.setAttribute("inert", "")}
              >
                <MessageItem msg={preview} groupStart preview />
              </div>
            )}
            {kind === "message" && (
              <p className={s.notice}>{t("reports.fullMessageNotice")}</p>
            )}
            {kind !== "message" && target && (
              <ReportSnapshot snapshot={target.snapshot} kind={kind} compact />
            )}
            {kind !== "message" &&
              context.evidence?.map((item, i) => (
                <Markdown key={i} source={item.text} ctx={renderCtx} />
              ))}
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
