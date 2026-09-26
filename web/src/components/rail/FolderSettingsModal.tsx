import { useId, useState, type CSSProperties } from "react";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { Field, TextInput } from "@/components/common/TextInput";
import { CustomColorIcon } from "@/components/settings/CustomColorIcon";
import { formatList, t } from "@/i18n";
import { createFolder, foldersOf, updateFolder, FOLDER_NAME_MAX } from "@/lib/railLayout";
import { useServers } from "@/stores/servers";
import { FolderFace } from "./FolderFace";
import { changeRail, currentRail } from "./railActions";
import s from "./FolderSettingsModal.module.css";

/** Colours to pick from, besides the accent (the default) and one of your own. */
export const FOLDER_COLORS = ["#5865f2", "#3d9e60", "#fdb833", "#da3e44", "#eb459f", "#1abc9c", "#e67e22", "#9b59b6", "#607d8b"];

/**
 * A folder's name and colour. With `folderId` it changes that folder; with
 * `serverIds` it makes a new one of those servers, where the first of them is.
 */
export function FolderSettingsModal({ onClose, folderId, serverIds }: { onClose: () => void; folderId?: string; serverIds?: string[] }) {
  const servers = useServers((st) => st.byId);
  // read once: the dialog edits what the folder was when it opened
  const [existing] = useState(() => (folderId ? (foldersOf(currentRail()).find((f) => f.id === folderId) ?? null) : null));
  const ids = existing ? existing.servers : (serverIds ?? []);
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState<string | null>(existing?.color ?? null);
  const group = `folder-colour-${useId()}`;
  const custom = !!color && !FOLDER_COLORS.includes(color);
  const serverNames = formatList(ids.map((id) => servers[id]?.server.name ?? "").filter(Boolean));
  const gone = !!folderId && !existing;

  const save = () => {
    if (existing) changeRail((l) => updateFolder(l, existing.id, { name, color }));
    else if (ids.length) changeRail((l) => createFolder(l, ids, { name, color }).layout);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={existing || gone ? t("organize.rail.folderSettings") : t("organize.rail.newFolderTitle")}
      width={480}
      onSubmit={save}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("chat.editMessage.cancel")}</Button>
          <Button onClick={save} disabled={gone} data-testid="folder-save">{existing ? t("chat.editMessage.save") : t("organize.rail.createFolder")}</Button>
        </>
      }
    >
      {gone ? (
        <p className={s.gone}>{t("organize.rail.folderGone")}</p>
      ) : (
        <div className={s.form}>
          <div className={s.top}>
            {/* the folder as the rail will show it, in the rail's own colour */}
            <div className={s.preview} style={{ "--folder": color ?? "var(--brand)" } as CSSProperties} aria-hidden="true">
              <span className={s.tile}>
                <FolderFace serverIds={ids} open={false} />
              </span>
            </div>
            <Field label={t("organize.rail.folderName")} hint={t("organize.rail.folderNameHint")} className={s.name}>
              <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={FOLDER_NAME_MAX} placeholder={serverNames} autoFocus dir="auto" data-testid="folder-name" />
            </Field>
          </div>
          <Field as="div" label={t("organize.rail.folderColour")}>
            <div className={s.swatches} role="radiogroup" aria-label={t("organize.rail.folderColour")}>
              <label className={s.swatch} data-on={color === null} style={{ background: "var(--brand)" }} title={t("organize.rail.accentColour")}>
                <input type="radio" name={group} checked={color === null} onChange={() => setColor(null)} aria-label={t("organize.rail.accentColour")} />
              </label>
              {FOLDER_COLORS.map((c, i) => (
                <label key={c} className={s.swatch} data-on={color === c} style={{ background: c }} title={c}>
                  <input type="radio" name={group} checked={color === c} onChange={() => setColor(c)} aria-label={t("server.roles.colourIndexOfCount", { index: i + 1, count: FOLDER_COLORS.length })} />
                </label>
              ))}
              <label className={s.swatch} data-on={custom} title={t("server.roles.customColour")}>
                <CustomColorIcon color={custom ? color : null} />
                <input type="color" value={color ?? "#8000ff"} onChange={(e) => setColor(e.target.value)} aria-label={t("server.roles.customColour")} data-testid="folder-custom-colour" />
              </label>
            </div>
          </Field>
        </div>
      )}
    </Modal>
  );
}

export default FolderSettingsModal;
