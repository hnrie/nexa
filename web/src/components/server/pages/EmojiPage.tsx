import { Pencil, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { expressions as expressionsApi } from "@/api/expressions";
import type { Emoji } from "@/api/types";
import { emojiUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { P } from "@/lib/perms";
import { useExpressions } from "@/stores/expressions";
import { canI, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import st from "@/components/settings/Settings.module.css";
import s from "../ServerSettings.module.css";
import p from "../PackEditor.module.css";

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
  const manage = canI(server, P.MANAGE_EMOJIS);

  const upload = async (files: FileList | File[]) => {
    setBusy(true);
    let added = 0;
    try {
      for (const f of Array.from(files)) {
        if (!ACCEPT.split(",").includes(f.type)) {
          toast(`${f.name}: emoji must be PNG, GIF, WebP or JPEG.`, "error");
          continue;
        }
        if (f.size > 2 * 1024 * 1024) {
          toast(`${f.name} is larger than 2 MB.`, "error");
          continue;
        }
        let name = slug(f.name);
        for (let i = 2; emojis.some((e) => e.name === name); i++) name = `${slug(f.name).slice(0, 29)}_${i}`;
        try {
          await expressionsApi.uploadEmoji(serverId, name, f);
          added++;
        } catch (err) {
          toast(err instanceof ApiError ? `${f.name}: ${err.message}` : `${f.name}: upload failed.`, "error");
        }
      }
      setEmojis(serverId, await expressionsApi.emojis(serverId));
      if (added) toast(added === 1 ? "Emoji added." : `${added} emoji added.`, "success");
    } finally {
      setBusy(false);
    }
  };
  const rename = async (e: Emoji) => {
    const next = window.prompt("Emoji name (letters, numbers, underscores)", e.name);
    if (next === null || next.trim() === e.name) return;
    try {
      await expressionsApi.renameEmoji(serverId, e.id, next.trim());
      setEmojis(serverId, await expressionsApi.emojis(serverId));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not rename.", "error");
    }
  };
  const remove = (e: Emoji) =>
    openModal("confirm", {
      title: `Delete :${e.name}:`,
      body: "Messages that used it will show the name instead.",
      confirmLabel: "Delete Emoji",
      danger: true,
      onConfirm: async () => {
        await expressionsApi.deleteEmoji(serverId, e.id);
        setEmojis(serverId, await expressionsApi.emojis(serverId));
      },
    });

  const animated = emojis.filter((e) => e.animated);
  const still = emojis.filter((e) => !e.animated);
  const section = (label: string, list: Emoji[]) =>
    list.length === 0 ? null : (
      <>
        <h5 className={st.h5}>{label} — {list.length}</h5>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr><th style={{ width: 56 }}>Image</th><th>Name</th><th>Uploaded by</th>{manage ? <th /> : null}</tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} data-emoji-id={e.id}>
                  <td><img src={emojiUrl(e.blob_id, e.animated, 32)} alt={`:${e.name}:`} width={32} height={32} style={{ objectFit: "contain" }} /></td>
                  <td className={s.code}>:{e.name}:</td>
                  <td>{displayName(users[e.creator_id])}</td>
                  {manage ? (
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className={p.cellBtn} style={{ background: "transparent", color: "var(--text-muted)" }} title="Rename" aria-label="Rename" onClick={() => void rename(e)}><Pencil size={16} /></button>
                      <button className={p.cellBtn} style={{ background: "transparent", color: "var(--text-muted)" }} title="Delete" aria-label="Delete emoji" onClick={() => remove(e)}><Trash2 size={16} /></button>
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
      <h2 className={st.title}>Emoji</h2>
      <p className={st.hint}>Add up to as many emoji as you want, static or animated. Everyone can use them in every channel and DM, no subscription required. Names must be 2–32 letters, numbers or underscores.</p>
      {manage ? (
        <div
          className={p.dropzone}
          data-over={over}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}
        >
          <Upload size={20} /> {busy ? "Uploading…" : "Drop images here or click to upload (PNG, GIF, WebP, JPEG; 2 MB each; 512×512 or smaller works best)."}
          <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} data-testid="emoji-file" />
        </div>
      ) : null}
      {emojis.length === 0 ? <p className={st.hint} style={{ marginTop: 16 }}>No custom emoji yet.</p> : null}
      {section("Emoji", still)}
      {section("Animated emoji", animated)}
      {manage ? <div style={{ marginTop: 16 }}><Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} loading={busy}>Upload Emoji</Button></div> : null}
    </>
  );
}
