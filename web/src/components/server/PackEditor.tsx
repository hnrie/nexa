import { Check, Copy, Pencil, Star, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { ApiError } from "@/api/client";
import { expressions as expressionsApi } from "@/api/expressions";
import type { Sticker, StickerPack } from "@/api/types";
import { packImageUrl } from "@/stores/expressions";
import { Button } from "@/components/common/Button";
import { Field, TextArea, TextInput } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { StickerView } from "@/components/stickers/StickerView";
import { LazySticker } from "@/components/stickers/StickerTile";
import { canRemovePack, confirmRemovePack } from "@/lib/packRemoval";
import { useReorder } from "@/hooks/useReorder";
import { describeError } from "@/lib/errors";
import { useAuth } from "@/stores/auth";
import { useExpressions } from "@/stores/expressions";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { button, defineMenu } from "@/lib/contextMenus/registry";

/** A sticker's menu in its pack: moving it up or down, as dragging does. */
const stickerOrderMenu = defineMenu<{ moves: ContextMenuItem[] }>("stickerOrder", [[button("moveSticker", ({ moves }) => moves)]]);
import { copyText } from "@/lib/copyText";
import { unlessUnsaved } from "@/stores/unsaved";
import { SaveBar } from "./SettingsLayer";
import s from "./PackEditor.module.css";
import { promptFields } from "@/components/modals/PromptModal";

import { t } from "@/i18n";
const ACCEPT_IMAGE = "image/png,image/gif,image/webp,image/apng";
const ACCEPT_STICKER = `${ACCEPT_IMAGE},video/webm,.tgs`;
const MAX_STICKER = 5 * 1024 * 1024;

export function packCover(p: StickerPack): Sticker | undefined {
  return p.stickers.find((st) => st.id === p.cover_sticker_id) ?? p.stickers[0];
}

/** "3 stickers", "1 sticker", "12 emoji", in the reader's language. */
export function packCount(p: StickerPack): string {
  const count = p.stickers.length;
  return (p.kind ?? "sticker") === "emoji" ? t("server.packEditor.emojiCount", { count }) : t("server.packEditor.stickerCount", { count });
}

export function packUrl(id: string): string {
  return `${window.location.origin}/stickers/pack/${id}`;
}

interface Props {
  packs: StickerPack[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  canManage: (p: StickerPack) => boolean;
  /** Packs the user installed and may remove from the list itself. */
  canRemove?: (p: StickerPack) => boolean;
  onCreate?: (() => void) | undefined;
  createLabel?: string;
  emptyText?: string;
}

/** Pack list on the left, the selected pack's editor on the right. */
export function PackEditor({ packs, selectedId, onSelect, canManage, canRemove, onCreate, createLabel = t("server.packEditor.createPack"), emptyText = t("server.packEditor.noPacksYet") }: Props) {
  const selected = packs.find((p) => p.id === selectedId) ?? packs[0] ?? null;
  return (
    <div className={s.layout}>
      <div className={s.list}>
        {/* Opening another pack, or a new one, drops the open one's editor: with unsaved edits in it, it asks first (the save bar shakes). */}
        {onCreate ? <Button size="sm" variant="secondary" onClick={unlessUnsaved(onCreate)} style={{ marginBottom: 8 }} data-testid="create-pack">{createLabel}</Button> : null}
        {packs.length === 0 ? <div className={s.empty}>{emptyText}</div> : null}
        {packs.map((p) => {
          const cover = packCover(p);
          const removable = canRemove?.(p) ?? false;
          return (
            <div key={p.id} className={s.packItem}>
              <button className={s.packRow} data-selected={selected?.id === p.id} aria-current={selected?.id === p.id ? "true" : undefined} data-removable={removable || undefined} onClick={selected?.id === p.id ? undefined : unlessUnsaved(() => onSelect(p.id))} data-pack={p.id}>
                <span className={s.cover}>{cover ? <StickerView format={cover.format} src={packImageUrl(p, cover)} alt="" /> : p.name.slice(0, 1).toUpperCase()}</span>
                <span className={s.packText}>
                  <span className={s.packName}>{p.name}</span>
                  <span className={s.packSub}>{packCount(p)}{removable ? " · " + t("settings.stickers.installedTag") : p.public ? " · " + t("settings.stickers.publicTag") : ""}</span>
                </span>
              </button>
              {removable ? (
                <button className={s.packRemove} aria-label={t("pickers.stickerPicker.removeName", { name: p.name })} title={t("server.packEditor.removePack")} onClick={() => confirmRemovePack(p, () => { if (selected?.id === p.id) onSelect(null); })}>
                  <X size={16} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className={s.editor}>{selected ? <PackDetail key={selected.id} pack={selected} manage={canManage(selected)} onDeleted={() => onSelect(null)} /> : null}</div>
    </div>
  );
}

function PackDetail({ pack, manage, onDeleted }: { pack: StickerPack; manage: boolean; onDeleted: () => void }) {
  const meId = useAuth((a) => a.me?.id);
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
  const [pending, setPending] = useState<{ file: File; name: string; tags: string; preview: string; format?: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // previews stay alive while they are staged: each is revoked when it is removed or uploaded, and the rest on unmount
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);
  const dirty = name !== pack.name || description !== pack.description;
  const isEmoji = (pack.kind ?? "sticker") === "emoji";
  const noun = isEmoji ? "emoji" : "sticker";
  const maxBytes = isEmoji ? 2 * 1024 * 1024 : MAX_STICKER;

  const save = async () => {
    setBusy(true);
    try {
      const saved = await expressionsApi.patchPack(pack.id, { ...(name !== pack.name ? { name } : {}), ...(description !== pack.description ? { description } : {}) });
      upsertPack(saved);
      // the server tidies whitespace, so show what it kept or the save bar never goes away
      setName(saved.name);
      setDescription(saved.description);
      toast(t("server.packEditor.packSaved"), "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("server.packEditor.couldNotSaveThePack"), "error");
    } finally {
      setBusy(false);
    }
  };
  // one change at a time: pressed again while one is on its way (or waits on a captcha), it waits
  const [publicBusy, setPublicBusy] = useState(false);
  const setPublic = async (v: boolean) => {
    if (publicBusy) return;
    setPublicBusy(true);
    try {
      upsertPack(await expressionsApi.patchPack(pack.id, { public: v }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("server.packEditor.couldNotChangeVisibility"), "error");
    } finally {
      setPublicBusy(false);
    }
  };
  const stage = (files: FileList | File[]) => {
    const list: typeof pending = [];
    // A .tgs file usually arrives with no usable MIME type, so it is
    // recognised by its extension; video stickers arrive as video/webm.
    // Emoji packs take pictures only, in either case.
    const accept = isEmoji ? ACCEPT_IMAGE : ACCEPT_STICKER;
    for (const f of Array.from(files)) {
      const tgs = f.name.toLowerCase().endsWith(".tgs");
      const format = f.type === "video/webm" ? "webm" : tgs ? "tgs" : undefined;
      if (!accept.split(",").includes(f.type) && !(format && !isEmoji)) {
        toast(t(isEmoji ? "server.packEditor.mustBeAnImage" : "server.packEditor.stickersMustBeImages", { name: f.name }), "error");
        continue;
      }
      if (f.size > maxBytes) {
        toast(t("server.packEditor.isLargerThan", { name: f.name, megabytes: Math.round(maxBytes / (1024 * 1024)) }), "error");
        continue;
      }
      const base = f.name.replace(/\.[a-z0-9]+$/i, "");
      const clean = isEmoji ? base.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) : base.slice(0, 30);
      list.push({ file: f, name: clean || noun, tags: "", preview: URL.createObjectURL(f), ...(format ? { format } : {}) });
    }
    setPending((cur) => [...cur, ...list]);
  };
  const unstage = (preview: string) => {
    URL.revokeObjectURL(preview);
    setPending((cur) => cur.filter((x) => x.preview !== preview));
  };
  const uploadAll = async () => {
    setBusy(true);
    // each upload leaves the list as soon as it is in, so a retry after a failure only sends what is left,
    // and files staged while this runs stay staged
    const batch = pending;
    let done = 0;
    try {
      for (const p of batch) {
        await expressionsApi.uploadSticker(pack.id, p.name.trim() || "sticker", p.tags.trim(), p.file);
        unstage(p.preview);
        done++;
      }
      upsertPack(await expressionsApi.pack(pack.id));
      toast(t(isEmoji ? "server.packEditor.emojiAdded" : "server.packEditor.stickersAdded", { count: done }), "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("composer.composer.uploadFailed"), "error");
      upsertPack(await expressionsApi.pack(pack.id).catch(() => pack));
    } finally {
      setBusy(false);
    }
  };
  const rename = async (st: Sticker) => {
    const values = await promptFields({
      title: isEmoji ? t("server.packEditor.editEmoji") : t("server.packEditor.editSticker"),
      fields: [
        { key: "name", label: t("modals.subchat.name"), initial: st.name, maxLength: 30 },
        { key: "tags", label: t("server.packEditor.tags"), hint: t("server.packEditor.spaceSeparatedUsedBySearch"), initial: st.tags, maxLength: 200 },
      ],
    });
    if (!values) return;
    const next = values["name"] ?? "";
    const tags = values["tags"] ?? "";
    void expressionsApi
      .patchSticker(pack.id, st.id, { name: next.trim().slice(0, 30) || st.name, tags: tags.trim().slice(0, 200) })
      .then(() => expressionsApi.pack(pack.id))
      .then(upsertPack)
      .catch((err) => toast(err instanceof ApiError ? err.message : t("server.packEditor.couldNotRename"), "error"));
  };
  const remove = (st: Sticker) =>
    openModal("confirm", {
      title: t("server.packEditor.deleteNamed", { name: st.name }),
      body: t("server.packEditor.thisStickerIsRemovedFromThe"),
      confirmLabel: t("server.packEditor.deleteSticker"),
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
      toast(err instanceof ApiError ? err.message : t("server.packEditor.couldNotSetTheCover"), "error");
    }
  };
  /** Sends a whole new order, which is what the endpoint takes. */
  const applyOrder = async (list: Sticker[]): Promise<boolean> => {
    try {
      upsertPack(await expressionsApi.setStickerPositions(pack.id, list.map((x, i) => ({ id: x.id, position: i }))));
      return true;
    } catch (err) {
      toast(describeError(err, t("server.packEditor.couldNotReorder")), "error");
      return false;
    }
  };
  // Stickers are a grid, so "earlier" and "later" rather than up and down.
  const reorder = useReorder({
    ids: pack.stickers.map((x) => x.id),
    axis: "grid",
    name: (id) => pack.stickers.find((x) => x.id === id)?.name ?? "",
    canMove: () => manage,
    move: (id, delta) => {
      const at = pack.stickers.findIndex((x) => x.id === id);
      const to = at + delta;
      if (at < 0 || to < 0 || to >= pack.stickers.length) return false;
      const list = [...pack.stickers];
      const [moving] = list.splice(at, 1);
      list.splice(to, 0, moving!);
      return applyOrder(list);
    },
  });

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
    await applyOrder(list);
  };
  const copyLink = () => {
    void copyText(packUrl(pack.id)).then((ok) => {
      if (!ok) {
        useUI.getState().toast(t("common.copyFailed"), "error");
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const toggleInstall = async () => {
    if (pack.installed && canRemovePack(pack, meId)) {
      confirmRemovePack(pack, onDeleted);
      return;
    }
    setBusy(true);
    try {
      if (pack.installed) {
        await expressionsApi.uninstall(pack.id);
        if (!pack.server_id) removePack(pack.id);
        else upsertPack({ ...pack, installed: false });
      } else upsertPack(await expressionsApi.install(pack.id));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("server.packEditor.couldNotChangeThePack"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className={s.head}>
        <div className={s.headText}>
          <h3 className={s.title}>{pack.name}</h3>
          <span className={s.sub}>{isEmoji ? t("server.packEditor.emojiCount", { count: pack.stickers.length }) : t("server.packEditor.stickerCount", { count: pack.stickers.length })} · {pack.public ? t("server.packEditor.publicAnyoneWithTheLink") : t("server.packEditor.privateOnlyYouCanSeeIt")}{pack.server_id ? ` · ${t("server.packEditor.serverPack")}` : ""}</span>
        </div>
        <div className={s.actions}>
          {!manage ? <Button size="sm" variant={pack.installed ? "secondary" : "primary"} loading={busy} onClick={() => void toggleInstall()}>{pack.installed ? t("server.packEditor.remove") : t("server.packEditor.install")}</Button> : null}
          {manage ? (
            <Button size="sm" variant="danger" onClick={() => openModal("confirm", { title: t("server.packEditor.deleteNamed", { name: pack.name }), body: t("server.packEditor.everyoneWhoInstalledThisPackLoses"), confirmLabel: t("server.packEditor.deletePack"), danger: true, onConfirm: async () => { await expressionsApi.deletePack(pack.id); removePack(pack.id); onDeleted(); } })}>
              <Trash2 size={14} /> {t("server.packEditor.deletePack")}
            </Button>
          ) : null}
        </div>
      </div>
      {manage ? (
        <>
          <Field label={t("server.packEditor.packName")} required>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} data-testid="pack-name" />
          </Field>
          <div style={{ height: 12 }} />
          <Field label={t("server.packEditor.description")} hint={t("server.packEditor.shownWhenPeopleFindThePack")}>
            <TextArea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 500))} maxLength={500} />
          </Field>
          <div style={{ height: 12 }} />
          <Toggle checked={pack.public} disabled={publicBusy} onChange={(v) => void setPublic(v)} label={t("server.packEditor.publicPack")} description={t("server.packEditor.anyoneWithTheLinkCanInstall")} />
          {pack.public ? (
            <div className={s.linkRow}>
              <TextInput readOnly value={packUrl(pack.id)} onFocus={(e) => e.currentTarget.select()} />
              <Button size="sm" variant={copied ? "positive" : "secondary"} onClick={copyLink}>{copied ? <><Check size={14} /> {t("modals.groupInvite.copied")}</> : <><Copy size={14} /> {t("server.packEditor.copyLink")}</>}</Button>
            </div>
          ) : null}
          {/* A real button, not a div with an onClick: the file input inside is
              `hidden`, so neither it nor the box around it could be reached
              without a pointer, and the Upload button below only appears once
              something has already been staged. */}
          <button
            type="button"
            className={s.dropzone}
            // a button shrink-wraps where the div it replaced filled the column
            style={{ display: "block", width: "100%" }}
            data-over={over}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) stage(e.dataTransfer.files); }}
            data-drop-zone
          >
            <Upload size={20} /> {t("server.packEditor.dropFilesHereOrClickTo", { size: Math.round(maxBytes / (1024 * 1024)) })}{isEmoji ? ` ${t("server.packEditor.emojiNamesAreLettersNumbersAnd")}` : ` ${t("server.packEditor.stickerFormatsNote")}`}
          </button>
          <input ref={fileRef} type="file" accept={isEmoji ? ACCEPT_IMAGE : ACCEPT_STICKER} multiple hidden onChange={(e) => { if (e.target.files) stage(e.target.files); e.target.value = ""; }} data-testid="sticker-file" />
          {pending.map((p) => (
            <div key={p.preview} className={s.pending}>
              <StickerView format={p.format} src={p.preview} alt="" />
              <TextInput value={p.name} maxLength={30} placeholder={t("modals.subchat.name")} onChange={(e) => setPending((cur) => cur.map((x) => (x.preview === p.preview ? { ...x, name: e.target.value } : x)))} data-testid="sticker-name" />
              {isEmoji ? null : <TextInput value={p.tags} maxLength={200} placeholder={t("server.packEditor.tagsSpaceSeparated")} onChange={(e) => setPending((cur) => cur.map((x) => (x.preview === p.preview ? { ...x, tags: e.target.value } : x)))} />}
              <Button size="sm" variant="ghost" onClick={() => unstage(p.preview)}>{t("composer.composer.remove")}</Button>
            </div>
          ))}
          {pending.length ? <div style={{ marginTop: 8 }}><Button size="sm" loading={busy} onClick={() => void uploadAll()} data-testid="upload-stickers">{isEmoji ? t("server.packEditor.uploadEmojiCount", { count: pending.length }) : t("server.packEditor.uploadStickerCount", { count: pending.length })}</Button></div> : null}
        </>
      ) : pack.description ? <p className={s.sub}>{pack.description}</p> : null}
      {manage && pack.stickers.length > 1 ? <p className={s.sub} style={{ margin: "8px 0 0" }}>{reorder.hint}</p> : null}
      {reorder.live}
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
            onKeyDown={reorder.onKeyDown(st.id)}
            onContextMenu={(e) => {
              if (stickerOrderMenu.open({ moves: reorder.menuItems(st.id) }, { x: e.clientX, y: e.clientY, label: st.name })) e.preventDefault();
            }}
            data-reorder-id={st.id}
            tabIndex={manage ? -1 : undefined}
          >
            {pack.cover_sticker_id === st.id ? <span className={s.coverBadge}>{t("server.packEditor.cover")}</span> : null}
            <LazySticker sticker={st} pack={pack} alt={st.name} className={s.cellImg} />
            <span className={s.cellName} title={st.name}>{st.name}</span>
            <span className={s.cellTags} title={st.tags}>{st.tags}</span>
            {manage ? (
              <span className={s.cellBtns}>
                <button className={s.cellBtn} title={t("server.packEditor.setAsCover")} aria-label={t("server.packEditor.setAsCover")} onClick={() => void setCover(st)}><Star size={14} /></button>
                <button className={s.cellBtn} title={t("server.packEditor.rename")} aria-label={t("server.packEditor.rename")} onClick={() => rename(st)}><Pencil size={14} /></button>
                <button className={s.cellBtn} title={t("chat.messageItem.delete")} aria-label={t("server.packEditor.deleteSticker")} data-danger="true" onClick={() => remove(st)}><Trash2 size={14} /></button>
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {pack.stickers.length === 0 ? <div className={s.empty}>{manage ? t(isEmoji ? "server.packEditor.addYourFirstEmoji" : "server.packEditor.addYourFirstSticker") : t("pickers.stickerPicker.thisPackIsEmpty")}</div> : null}
      {manage ? <SaveBar dirty={dirty} busy={busy} onReset={() => { setName(pack.name); setDescription(pack.description); }} onSave={() => void save()} /> : null}
    </div>
  );
}
