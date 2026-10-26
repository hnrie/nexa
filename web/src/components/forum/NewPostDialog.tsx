import { File as FileIcon, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import type { Channel } from "@/api/types";
import { Button } from "@/components/common/Button";
import { FormattedText } from "@/components/common/FormattedText";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { AutomodNotice } from "@/components/composer/AutomodNotice";
import { MAX_MESSAGE_LENGTH } from "@/components/composer/limit";
import { t } from "@/i18n";
import { fitsUploadLimit, stage, type Staged } from "@/lib/attachments";
import { myPlan, planForFile } from "@/lib/plans";
import { offerPlan } from "@/stores/upsell";
import { startForumPost } from "@/lib/forumPost";
import { P } from "@/lib/perms";
import { formatBytes } from "@/lib/time";
import { useAutomodNotices } from "@/stores/automodNotices";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import srv from "@/components/server/ServerSettings.module.css";
import s from "./Forum.module.css";

const MAX_POST_TAGS = 5;
const MAX_POST_FILES = 10;

/**
 * Starting a post: its title, the tags it is filed under, and what it says,
 * with files. The post goes up with its first message, which is sealed for
 * the post itself once it exists.
 */
export function NewPostDialog({ forum, onClose }: { forum: Channel; onClose: () => void }) {
  const nav = useNavigate();
  const st = useServers((x) => (forum.server_id ? x.byId[forum.server_id] : undefined));
  const tags = forum.forum?.tags ?? [];
  const mod = canI(st, P.MANAGE_THREADS, forum.id);
  const canAttach = canI(st, P.ATTACH_FILES, forum.id);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [applied, setApplied] = useState<string[]>([]);
  const [files, setFiles] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const notice = useAutomodNotices((n) => n.byChannel[forum.id]);
  const handed = useRef(false);
  // the previews of files never posted go with the dialog
  useEffect(
    () => () => {
      if (handed.current) return;
      setFiles((cur) => {
        for (const f of cur) if (f.preview) URL.revokeObjectURL(f.preview);
        return cur;
      });
    },
    [],
  );

  const addFiles = async (list: FileList) => {
    const picked: Staged[] = [];
    for (const f of Array.from(list)) {
      if (!fitsUploadLimit(f.size, forum.id)) {
        if (planForFile(f.size) && myPlan() !== "pro") offerPlan({ kind: "file", name: f.name, size: f.size });
        else useUI.getState().toast(t("forum.post.fileTooBig", { name: f.name }), "error");
        continue;
      }
      picked.push(await stage(f));
    }
    setFiles((cur) => [...cur, ...picked].slice(0, MAX_POST_FILES));
  };

  const post = async () => {
    const name = title.trim();
    const body = text.trim();
    setProblem(null);
    if (!name) return setProblem(t("forum.post.needTitle"));
    if (!body && files.length === 0) return setProblem(t("forum.post.needWords"));
    if (forum.forum?.require_tag && applied.length === 0) return setProblem(t("forum.post.needTag"));
    setBusy(true);
    try {
      // AutoMod reads it before anything goes: a post it stops never goes up
      const thread = await startForumPost(forum, { name, body, appliedTags: applied, files });
      if (!thread) return;
      handed.current = true;
      onClose();
      nav(`/channels/${forum.server_id}/${thread.id}`);
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : t("forum.post.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("forum.newPostIn", { name: forum.name })}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
          <Button onClick={() => void post()} loading={busy} disabled={!title.trim()} data-testid="forum-post-submit">{t("forum.post.submit")}</Button>
        </>
      }
    >
      <div className={s.form}>
        {notice ? <AutomodNotice notice={notice} onDismiss={() => useAutomodNotices.getState().dismiss(forum.id)} /> : null}
        <Field label={t("forum.post.title")} required>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} autoFocus placeholder={t("forum.post.titlePlaceholder")} data-testid="forum-post-title" />
        </Field>
        {tags.length ? (
          <Field as="div" label={forum.forum?.require_tag ? t("forum.post.tagsRequired") : t("forum.post.tags")} hint={t("forum.post.tagsHint", { count: MAX_POST_TAGS })}>
            <div className={srv.tagPick}>
              {tags.map((tg) => {
                const on = applied.includes(tg.id);
                return (
                  <button key={tg.id} type="button" className={srv.tagChip} aria-pressed={on} disabled={(tg.moderated && !mod) || (!on && applied.length >= MAX_POST_TAGS)} title={tg.moderated && !mod ? t("forum.post.moderatedTag") : undefined} onClick={() => setApplied(on ? applied.filter((x) => x !== tg.id) : [...applied, tg.id])}>
                    {tg.emoji ? <span aria-hidden="true">{tg.emoji}</span> : null}
                    <span dir="auto">{tg.name}</span>
                  </button>
                );
              })}
            </div>
          </Field>
        ) : null}
        <Field as="div" label={t("forum.post.message")}>
          <FormattedText value={text} onChange={setText} max={MAX_MESSAGE_LENGTH} rows={6} placeholder={t("forum.post.messagePlaceholder")} title={t("forum.post.message")} serverId={forum.server_id ?? undefined} testId="forum-post-text" />
        </Field>
        {canAttach ? (
          <div className={s.files}>
            {files.map((f) => (
              <div key={f.id} className={s.fileCard}>
                {f.preview && f.file.type.startsWith("image/") ? <img src={f.preview} alt="" /> : <FileIcon size={20} aria-hidden="true" />}
                <span className={s.fileName} dir="auto">{f.name}</span>
                <span className={s.fileSize}>{formatBytes(f.file.size)}</span>
                <button type="button" className={s.fileRemove} aria-label={t("composer.composer.removeNamed", { name: f.name })} onClick={() => {
                  if (f.preview) URL.revokeObjectURL(f.preview);
                  setFiles((cur) => cur.filter((x) => x.id !== f.id));
                }}>
                  <X size={14} />
                </button>
              </div>
            ))}
            {files.length < MAX_POST_FILES ? (
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                <Paperclip size={16} aria-hidden="true" /> {t("forum.post.addFiles")}
              </Button>
            ) : null}
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
          </div>
        ) : null}
        {problem ? <p className={s.problem} role="alert">{problem}</p> : null}
      </div>
    </Modal>
  );
}
