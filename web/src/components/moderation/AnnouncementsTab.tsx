import { Eye, Megaphone, PenLine, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { moderation as modApi, type Announcement, type People } from "@/api/moderation";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { Field, TextArea, TextInput } from "@/components/common/TextInput";
import { NexaAvatar, PersonChip } from "@/components/nexa/NexaBits";
import { describeError } from "@/lib/errors";
import { useRenderCtx } from "@/lib/markdownCtx";
import { fullDate } from "@/lib/moderation";
import { formatTimestamp } from "@/lib/time";
import { Markdown } from "@/markdown";
import { useModEvents } from "@/stores/moderation";
import { useUI } from "@/stores/ui";
import { t } from "@/i18n";
import m from "./Moderation.module.css";

const MAX_TITLE = 120;
const MAX_BODY = 4000;

/**
 * Messages to everyone on the instance, sent through Nexa. Each lands in every
 * account's Nexa conversation with the name of whoever wrote it, and can be
 * taken back; the log keeps both.
 */
export function AnnouncementsTab() {
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const ctx = useRenderCtx();
  const [list, setList] = useState<Announcement[] | null>(null);
  const [people, setPeople] = useState<People>({});
  const [recipients, setRecipients] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    modApi
      .announcements()
      .then((r) => {
        setList(r.announcements);
        setPeople(r.people);
        setRecipients(r.recipients);
      })
      .catch(() => setList([]));
  }, []);

  useModEvents((e) => {
    if (e.type === "announcement") {
      setPeople((p) => ({ ...p, ...e.people }));
      setList((cur) => (cur && !cur.some((a) => a.id === e.announcement.id) ? [e.announcement, ...cur] : cur));
    }
    if (e.type === "announcement_gone") setList((cur) => cur?.filter((a) => a.id !== e.id) ?? cur);
  });

  const bodyLength = [...body].length;
  const titleLength = [...title].length;
  const ready = body.trim().length > 0 && bodyLength <= MAX_BODY && titleLength <= MAX_TITLE;

  const send = async () => {
    setBusy(true);
    try {
      const r = await modApi.announce(title.trim(), body.trim());
      setPeople((p) => ({ ...p, ...r.people }));
      setList((cur) => (cur && !cur.some((a) => a.id === r.announcement.id) ? [r.announcement, ...cur] : cur));
      setTitle("");
      setBody("");
      setPreviewing(false);
      toast(t("moderation.ann.sent"), "success");
    } catch (err) {
      toast(describeError(err, t("moderation.failed")), "error");
    } finally {
      setBusy(false);
    }
  };

  const confirmSend = () =>
    openModal("confirm", {
      title: t("moderation.ann.confirmTitle"),
      body: t("moderation.ann.confirmBody", { count: recipients }),
      confirmLabel: t("moderation.ann.send"),
      onConfirm: send,
    });

  const retract = (a: Announcement) =>
    openModal("confirm", {
      title: t("moderation.ann.retractTitle"),
      body: t("moderation.ann.retractBody"),
      confirmLabel: t("moderation.ann.retract"),
      danger: true,
      onConfirm: async () => {
        try {
          await modApi.retract(a.id);
          setList((cur) => cur?.filter((x) => x.id !== a.id) ?? cur);
          toast(t("moderation.ann.retracted"), "success");
        } catch (err) {
          toast(describeError(err, t("moderation.failed")), "error");
        }
      },
    });

  return (
    <div className={m.scroll} data-testid="announcements-tab">
      <div className={m.annLayout}>
        <section className={m.panel} aria-labelledby="ann-compose">
          <h2 className={m.panelTitle} id="ann-compose">
            <Megaphone size={18} aria-hidden="true" />
            {t("moderation.ann.new")}
          </h2>
          <p className={m.panelHint}>{t("moderation.ann.hint", { count: recipients })}</p>
          <div className={m.annForm}>
            <Field label={t("moderation.ann.titleLabel")} hint={titleLength > MAX_TITLE - 20 ? `${titleLength}/${MAX_TITLE}` : undefined}>
              <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("moderation.ann.titlePlaceholder")} maxLength={MAX_TITLE + 10} data-testid="ann-title" />
            </Field>
            {previewing ? (
              <div className={m.preview} aria-label={t("moderation.ann.preview")}>
                {body.trim() ? <Markdown source={body} ctx={ctx} /> : <span className={m.logDetail}>{t("moderation.ann.nothingYet")}</span>}
              </div>
            ) : (
              <Field label={t("moderation.ann.bodyLabel")} hint={t("moderation.ann.bodyHint")}>
                <TextArea className={m.annBody} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("moderation.ann.bodyPlaceholder")} maxLength={MAX_BODY + 50} data-testid="ann-body" />
              </Field>
            )}
            <div className={m.annFooter}>
              <Button size="sm" variant="ghost" onClick={() => setPreviewing((v) => !v)}>
                {previewing ? <PenLine size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />} {previewing ? t("moderation.ann.edit") : t("moderation.ann.preview")}
              </Button>
              <span className={m.grow} />
              <span className={m.logDetail} data-over={bodyLength > MAX_BODY || undefined}>
                {bodyLength}/{MAX_BODY}
              </span>
              <Button size="sm" disabled={!ready} loading={busy} onClick={confirmSend} data-testid="ann-send">
                <Send size={15} aria-hidden="true" /> {t("moderation.ann.send")}
              </Button>
            </div>
          </div>
        </section>

        <section aria-labelledby="ann-history">
          <h2 className={m.panelTitle} id="ann-history" style={{ marginBottom: 12 }}>
            {t("moderation.ann.history")}
          </h2>
          {list === null ? (
            <Spinner label={t("chat.pins.loading")} />
          ) : list.length === 0 ? (
            <div className={m.empty}>
              <Megaphone size={36} aria-hidden="true" />
              <span className={m.emptyTitle}>{t("moderation.ann.none")}</span>
            </div>
          ) : (
            <div className={m.annList}>
              {list.map((a) => (
                <article key={a.id} className={m.annCard} data-testid="ann-card">
                  <div className={m.annHead}>
                    <NexaAvatar size={28} />
                    <h3 className={m.annTitle}>{a.title || t("moderation.ann.untitled")}</h3>
                    <Button size="sm" variant="ghost" onClick={() => retract(a)} aria-label={t("moderation.ann.retract")} title={t("moderation.ann.retract")}>
                      <Trash2 size={15} aria-hidden="true" />
                    </Button>
                  </div>
                  <div className={m.annText}>
                    <Markdown source={a.body} ctx={ctx} />
                  </div>
                  <div className={m.annMeta}>
                    <span>{t("nexa.postedBy")}</span>
                    <PersonChip id={a.author_id} person={people[a.author_id]} size={18} withUsername />
                    <span>·</span>
                    <time title={fullDate(a.created_at)}>{formatTimestamp(a.created_at)}</time>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
