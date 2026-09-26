import { Pencil, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { TextInput } from "@/components/common/TextInput";
import { NoMatches } from "../NoMatches";
import { expressions as expressionsApi } from "@/api/expressions";
import type { Emoji } from "@/api/types";
import { emojiUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { P } from "@/lib/perms";
import { useExpressions } from "@/stores/expressions";
import { describeError } from "@/lib/errors";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import st from "@/components/settings/Settings.module.css";
import s from "../ServerSettings.module.css";
import p from "../PackEditor.module.css";
import { promptText } from "@/components/modals/PromptModal";

import { t } from "@/i18n";
const ACCEPT = "image/png,image/gif,image/webp,image/jpeg";
const NO_EMOJI: Emoji[] = [];

function slug(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "emoji";
}

/** Server settings → Emoji: upload static or animated emoji, no cap, usable by anyone anywhere. */
export default function EmojiPage({ serverId }: { serverId: string }) {
  const server = useServers((x) => x.byId[serverId]);
  const emojis = useExpressions((x) => x.emojis[serverId]) ?? NO_EMOJI;
  const setEmojis = useExpressions((x) => x.setEmojis);
  const users = useUsers((u) => u.byId);
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [q, setQ] = useState("");
  const manage = canI(server, P.MANAGE_EMOJIS);

  const upload = async (files: FileList | File[]) => {
    setBusy(true);
    let added = 0;
    // names given earlier in this batch count as taken too, so party.gif and party.png don't collide
    const used = new Set(emojis.map((e) => e.name));
    try {
      for (const f of Array.from(files)) {
        if (!ACCEPT.split(",").includes(f.type)) {
          toast(t("server.emoji.mustBeAnImage", { name: f.name }), "error");
          continue;
        }
        if (f.size > 2 * 1024 * 1024) {
          toast(t("server.emoji.isLargerThan2Mb", { name: f.name }), "error");
          continue;
        }
        let name = slug(f.name);
        for (let i = 2; used.has(name); i++) name = `${slug(f.name).slice(0, 29)}_${i}`;
        used.add(name);
        try {
          await expressionsApi.uploadEmoji(serverId, name, f);
          added++;
        } catch (err) {
          toast(`${f.name}: ${describeError(err, t("server.emoji.uploadFailedFor", { name: f.name }))}`, "error");
        }
      }
      setEmojis(serverId, await expressionsApi.emojis(serverId));
      if (added) toast(t("server.emoji.emojiAddedCount", { count: added }), "success");
    } catch (err) {
      // Re-reading the list after an upload can fail on its own, and with only
      // a `finally` here that became an unhandled rejection: the spinner
      // stopped and the grid stayed as it was.
      toast(describeError(err, t("server.emoji.theEmojiListCouldNotBe")), "error");
    } finally {
      setBusy(false);
    }
  };
  const rename = async (e: Emoji) => {
    const next = await promptText(t("server.emoji.renameEmoji"), { label: t("server.emoji.emojiName"), hint: t("server.emoji.lettersNumbersAndUnderscores"), initial: e.name, maxLength: 32 }, t("server.packEditor.rename"));
    if (next === null || next.trim() === e.name) return;
    try {
      await expressionsApi.renameEmoji(serverId, e.id, next.trim());
      setEmojis(serverId, await expressionsApi.emojis(serverId));
    } catch (err) {
      toast(describeError(err, t("server.packEditor.couldNotRename")), "error");
    }
  };
  const remove = (e: Emoji) =>
    openModal("confirm", {
      title: t("server.emoji.deleteNamed", { name: e.name }),
      body: t("server.emoji.messagesThatUsedItWillShow"),
      confirmLabel: t("server.emoji.deleteEmoji"),
      danger: true,
      onConfirm: async () => {
        await expressionsApi.deleteEmoji(serverId, e.id);
        setEmojis(serverId, await expressionsApi.emojis(serverId));
      },
    });

  const query = q.trim().toLowerCase().replace(/^:|:$/g, "");
  const found = query ? emojis.filter((e) => e.name.toLowerCase().includes(query)) : emojis;
  const animated = found.filter((e) => e.animated);
  const still = found.filter((e) => !e.animated);
  const section = (label: string, list: Emoji[]) =>
    list.length === 0 ? null : (
      <>
        <h3 className={st.h5}>{t("server.emoji.sectionCount", { label, count: list.length })}</h3>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr><th style={{ width: 56 }}>{t("server.emoji.image")}</th><th>{t("modals.subchat.name")}</th><th>{t("server.emoji.uploadedBy")}</th>{manage ? <th /> : null}</tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} data-emoji-id={e.id}>
                  <td><img src={emojiUrl(e.blob_id, e.animated, 32)} alt={`:${e.name}:`} width={32} height={32} style={{ objectFit: "contain" }} /></td>
                  <td className={s.code}>:{e.name}:</td>
                  <td>{displayName(users[e.creator_id])}</td>
                  {manage ? (
                    <td style={{ textAlign: "end" }}>
                      {/* side by side: the sticker grid's round overlay buttons, borrowed here, stacked one over the other */}
                      <span className={s.rowActions}>
                        <button className={s.iconBtn} title={t("server.packEditor.rename")} aria-label={t("server.packEditor.rename")} onClick={() => void rename(e)}><Pencil size={16} /></button>
                        <button className={s.iconBtn} data-danger="true" title={t("chat.messageItem.delete")} aria-label={t("server.emoji.deleteEmoji")} onClick={() => remove(e)}><Trash2 size={16} /></button>
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );

  return (
    <>
      <h2 className={st.title}>{t("modals.customStatus.emoji")}</h2>
      <p className={st.hint}>{t("server.emoji.addUpToAsManyEmoji")}</p>
      {manage ? (
        <>
          {/* A button, as the sticker packs' drop zone is: a div with an onClick could not be reached from the keyboard. */}
          <button
            type="button"
            className={p.dropzone}
            style={{ display: "block", width: "100%" }}
            data-over={over}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}
            data-drop-zone
          >
            <Upload size={20} /> {busy ? t("server.emoji.uploading") : t("server.emoji.dropImagesHere")}
          </button>
          <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} data-testid="emoji-file" />
        </>
      ) : null}
      {emojis.length === 0 ? <p className={st.hint} style={{ marginTop: 16 }}>{t("server.emoji.noCustomEmojiYet")}</p> : null}
      {emojis.length > 0 ? (
        <div className={s.searchRow} style={{ marginTop: 16 }}>
          <TextInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("server.emoji.searchEmoji")} aria-label={t("server.emoji.searchEmoji")} />
        </div>
      ) : null}
      {emojis.length > 0 && found.length === 0 ? <NoMatches query={q} onClear={() => setQ("")} /> : null}
      {section(t("server.emoji.emoji"), still)}
      {section(t("server.emoji.animatedEmoji"), animated)}
      {manage ? <div style={{ marginTop: 16 }}><Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} loading={busy}>{t("server.emoji.uploadEmoji")}</Button></div> : null}
    </>
  );
}
