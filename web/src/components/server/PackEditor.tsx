import { Check, Copy, Pencil, Star, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { ApiError } from "@/api/client";
import { expressions as expressionsApi } from "@/api/expressions";
import type { Sticker, StickerPack } from "@/api/types";
import { stickerUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { Field, TextArea, TextInput } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { useExpressions } from "@/stores/expressions";
import { useUI } from "@/stores/ui";
import { SaveBar } from "./SettingsLayer";
import s from "./PackEditor.module.css";

const ACCEPT = "image/png,image/gif,image/webp,image/apng";
const MAX_STICKER = 5 * 1024 * 1024;

export function packCover(p: StickerPack): Sticker | undefined {
  return p.stickers.find((st) => st.id === p.cover_sticker_id) ?? p.stickers[0];
}

export function packUrl(id: string): string {
  return `${window.location.origin}/stickers/pack/${id}`;
}

interface Props {
  packs: StickerPack[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  canManage: (p: StickerPack) => boolean;
  onCreate?: (() => void) | undefined;
  createLabel?: string;
  emptyText?: string;
}

/** Pack list on the left, the selected pack's editor on the right. */
export function PackEditor({ packs, selectedId, onSelect, canManage, onCreate, createLabel = "Create Pack", emptyText = "No packs yet." }: Props) {
  const selected = packs.find((p) => p.id === selectedId) ?? packs[0] ?? null;
  return (
    <div className={s.layout}>
      <div className={s.list}>
        {onCreate ? <Button size="sm" variant="secondary" onClick={onCreate} style={{ marginBottom: 8 }} data-testid="create-pack">{createLabel}</Button> : null}
        {packs.length === 0 ? <div className={s.empty}>{emptyText}</div> : null}
        {packs.map((p) => {
          const cover = packCover(p);
          return (
            <button key={p.id} className={s.packRow} data-selected={selected?.id === p.id} onClick={() => onSelect(p.id)} data-pack={p.id}>
              <span className={s.cover}>{cover ? <img src={stickerUrl(cover.blob_id)} alt="" /> : p.name.slice(0, 1).toUpperCase()}</span>
              <span className={s.packText}>
                <span className={s.packName}>{p.name}</span>
                <span className={s.packSub}>{p.stickers.length} sticker{p.stickers.length === 1 ? "" : "s"}{p.public ? " · public" : ""}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className={s.editor}>{selected ? <PackDetail key={selected.id} pack={selected} manage={canManage(selected)} onDeleted={() => onSelect(null)} /> : null}</div>
    </div>
  );
}

function PackDetail({ pack, manage, onDeleted }: { pack: StickerPack; manage: boolean; onDeleted: () => void }) {
  const upsertPack = useExpressions((x) => x.upsertPack);
  const removePack = useExpressions((x) => x.removePack);
  const toast = useUI((u) => u.toast);
  const openModal = useUI((u) => u.openModal);
  const [name, setName] = useState(pack.name);
  const [description, setDescription] = useState(pack.description);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState<{ file: File; name: string; tags: string; preview: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => pending.forEach((p) => URL.revokeObjectURL(p.preview)), [pending]);
  const dirty = name !== pack.name || description !== pack.description;

  const save = async () => {
    setBusy(true);
    try {
      upsertPack(await expressionsApi.patchPack(pack.id, { ...(name !== pack.name ? { name } : {}), ...(description !== pack.description ? { description } : {}) }));
      toast("Pack saved.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save the pack.", "error");
    } finally {
      setBusy(false);
    }
  };
  const setPublic = async (v: boolean) => {
    try {
      upsertPack(await expressionsApi.patchPack(pack.id, { public: v }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not change visibility.", "error");
    }
  };
  const stage = (files: FileList | File[]) => {
    const list: typeof pending = [];
    for (const f of Array.from(files)) {
      if (!ACCEPT.split(",").includes(f.type)) {
        toast(`${f.name}: stickers must be PNG, APNG, GIF or WebP.`, "error");
        continue;
      }
      if (f.size > MAX_STICKER) {
        toast(`${f.name} is larger than 5 MB.`, "error");
        continue;
      }
      list.push({ file: f, name: f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 30) || "sticker", tags: "", preview: URL.createObjectURL(f) });
    }
    setPending((cur) => [...cur, ...list]);
  };
  const uploadAll = async () => {
    setBusy(true);
    try {
      for (const p of pending) {
        await expressionsApi.uploadSticker(pack.id, p.name.trim() || "sticker", p.tags.trim(), p.file);
      }
      upsertPack(await expressionsApi.pack(pack.id));
      setPending([]);
      toast(pending.length === 1 ? "Sticker added." : `${pending.length} stickers added.`, "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Upload failed.", "error");
      upsertPack(await expressionsApi.pack(pack.id).catch(() => pack));
    } finally {
      setBusy(false);
    }
  };
  const rename = (st: Sticker) => {
    const next = window.prompt("Sticker name", st.name);
    if (next === null) return;
    const tags = window.prompt("Tags (space separated, used by search)", st.tags);
    if (tags === null) return;
    void expressionsApi
      .patchSticker(pack.id, st.id, { name: next.trim().slice(0, 30) || st.name, tags: tags.trim().slice(0, 200) })
      .then(() => expressionsApi.pack(pack.id))
      .then(upsertPack)
      .catch((err) => toast(err instanceof ApiError ? err.message : "Could not rename.", "error"));
  };
  const remove = (st: Sticker) =>
    openModal("confirm", {
      title: `Delete '${st.name}'`,
      body: "This sticker is removed from the pack for everyone.",
      confirmLabel: "Delete Sticker",
      danger: true,
      onConfirm: async () => {
        await expressionsApi.deleteSticker(pack.id, st.id);
        upsertPack(await expressionsApi.pack(pack.id));
      },
    });
  const setCover = async (st: Sticker) => {
    try {
      upsertPack(await expressionsApi.patchPack(pack.id, { cover_sticker_id: st.id }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not set the cover.", "error");
    }
  };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    const d = drag;
    const at = drop;
    setDrag(null);
    setDrop(null);
    if (!d || !at || d === at.id) return;
    const list = pack.stickers.filter((x) => x.id !== d);
    const moving = pack.stickers.find((x) => x.id === d);
    if (!moving) return;
    const idx = list.findIndex((x) => x.id === at.id) + (at.after ? 1 : 0);
    list.splice(idx, 0, moving);
    try {
      upsertPack(await expressionsApi.setStickerPositions(pack.id, list.map((x, i) => ({ id: x.id, position: i }))));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not reorder.", "error");
    }
  };
  const copyLink = () => {
    void navigator.clipboard?.writeText(packUrl(pack.id)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const toggleInstall = async () => {
    setBusy(true);
    try {
      if (pack.installed) {
        await expressionsApi.uninstall(pack.id);
        if (!pack.server_id) removePack(pack.id);
        else upsertPack({ ...pack, installed: false });
      } else upsertPack(await expressionsApi.install(pack.id));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not change the pack.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className={s.head}>
        <div className={s.headText}>
          <h3 className={s.title}>{pack.name}</h3>
          <span className={s.sub}>{pack.stickers.length} sticker{pack.stickers.length === 1 ? "" : "s"} · {pack.public ? "Public: anyone with the link can install it" : "Private: only you can see it"}{pack.server_id ? " · Server pack" : ""}</span>
        </div>
        <div className={s.actions}>
          {!manage ? <Button size="sm" variant={pack.installed ? "secondary" : "primary"} loading={busy} onClick={() => void toggleInstall()}>{pack.installed ? "Remove" : "Install"}</Button> : null}
          {manage ? (
            <Button size="sm" variant="danger" onClick={() => openModal("confirm", { title: `Delete '${pack.name}'`, body: "Everyone who installed this pack loses it. This cannot be undone.", confirmLabel: "Delete Pack", danger: true, onConfirm: async () => { await expressionsApi.deletePack(pack.id); removePack(pack.id); onDeleted(); } })}>
              <Trash2 size={14} /> Delete Pack
            </Button>
          ) : null}
        </div>
      </div>
      {manage ? (
        <>
          <Field label="Pack name" required>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} data-testid="pack-name" />
          </Field>
          <div style={{ height: 12 }} />
          <Field label="Description" hint="Shown when people find the pack.">
            <TextArea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 500))} maxLength={500} />
          </Field>
          <div style={{ height: 12 }} />
          <Toggle checked={pack.public} onChange={(v) => void setPublic(v)} label="Public pack" description="Anyone with the link can install a public pack, and it shows up in Discover." />
          {pack.public ? (
            <div className={s.linkRow}>
              <TextInput readOnly value={packUrl(pack.id)} onFocus={(e) => e.currentTarget.select()} />
              <Button size="sm" variant={copied ? "positive" : "secondary"} onClick={copyLink}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}</Button>
            </div>
          ) : null}
          <div
            className={s.dropzone}
            data-over={over}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) stage(e.dataTransfer.files); }}
          >
            <Upload size={20} /> Drop PNG, APNG, GIF or WebP files here or click to choose (5 MB each, no limit on how many).
            <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { if (e.target.files) stage(e.target.files); e.target.value = ""; }} data-testid="sticker-file" />
          </div>
          {pending.map((p, i) => (
            <div key={p.preview} className={s.pending}>
              <img src={p.preview} alt="" />
              <TextInput value={p.name} maxLength={30} placeholder="Name" onChange={(e) => setPending((cur) => cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} data-testid="sticker-name" />
              <TextInput value={p.tags} maxLength={200} placeholder="Tags (space separated)" onChange={(e) => setPending((cur) => cur.map((x, j) => (j === i ? { ...x, tags: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" onClick={() => setPending((cur) => cur.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          {pending.length ? <div style={{ marginTop: 8 }}><Button size="sm" loading={busy} onClick={() => void uploadAll()} data-testid="upload-stickers">Upload {pending.length} sticker{pending.length === 1 ? "" : "s"}</Button></div> : null}
        </>
      ) : pack.description ? <p className={s.sub}>{pack.description}</p> : null}
      <div className={s.grid}>
        {pack.stickers.map((st) => (
          <div
            key={st.id}
            className={s.cell}
            data-sticker={st.id}
            data-dragging={drag === st.id}
            data-drop={drop?.id === st.id ? (drop.after ? "after" : "before") : undefined}
            draggable={manage}
            onDragStart={(e) => { if (!manage) return e.preventDefault(); setDrag(st.id); e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(e) => { if (!drag || drag === st.id) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDrop({ id: st.id, after: e.clientX > r.left + r.width / 2 }); }}
            onDrop={(e) => void onDrop(e)}
            onDragEnd={() => { setDrag(null); setDrop(null); }}
          >
            {pack.cover_sticker_id === st.id ? <span className={s.coverBadge}>Cover</span> : null}
            <img className={s.cellImg} src={stickerUrl(st.blob_id)} alt={st.name} loading="lazy" draggable={false} />
            <span className={s.cellName} title={st.name}>{st.name}</span>
            <span className={s.cellTags} title={st.tags}>{st.tags}</span>
            {manage ? (
              <span className={s.cellBtns}>
                <button className={s.cellBtn} title="Set as cover" aria-label="Set as cover" onClick={() => void setCover(st)}><Star size={14} /></button>
                <button className={s.cellBtn} title="Rename" aria-label="Rename" onClick={() => rename(st)}><Pencil size={14} /></button>
                <button className={s.cellBtn} title="Delete" aria-label="Delete sticker" data-danger="true" onClick={() => remove(st)}><Trash2 size={14} /></button>
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {pack.stickers.length === 0 ? <div className={s.empty}>{manage ? "Add your first sticker above." : "This pack is empty."}</div> : null}
      {manage ? <SaveBar dirty={dirty} busy={busy} onReset={() => { setName(pack.name); setDescription(pack.description); }} onSave={() => void save()} /> : null}
    </div>
  );
}
