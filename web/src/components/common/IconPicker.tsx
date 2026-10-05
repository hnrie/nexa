import { ImagePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ImageCropModal } from "./ImageCropModal";
import s from "./IconPicker.module.css";

import { t } from "@/i18n";
export interface PickedIcon {
  file: File;
  crop: { x: number; y: number; w: number; h: number } | null;
}

interface Props {
  /** The icon there is now, if any. */
  currentUrl: string | null;
  /** A picked file waiting to be saved, with the part framed; null to keep the current one. */
  picked: PickedIcon | null;
  onPick: (picked: PickedIcon) => void;
  /** Takes the icon away (a picked one, or the current one); left out where there is nothing to remove. */
  onRemove?: () => void;
  /** What the icon stands for, shown while there is none. */
  initials: string;
  label: string;
  disabled?: boolean;
  square?: boolean;
  testId?: string;
}

/**
 * A round (or rounded-square) icon to click and upload: the file goes whole
 * with the part framed, and the server cuts it so a moving picture keeps
 * moving.
 */
export function IconPicker({ currentUrl, picked, onPick, onRemove, initials, label, disabled = false, square = false, testId }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!picked) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(picked.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [picked]);

  const shown = preview ?? currentUrl;
  return (
    <div className={s.wrap}>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        data-testid={testId ? `${testId}-file` : undefined}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setCrop(f);
          e.target.value = "";
        }}
      />
      <button type="button" className={s.icon} data-square={square || undefined} disabled={disabled} aria-label={label} onClick={() => input.current?.click()} data-testid={testId}>
        {shown ? <img src={shown} alt="" draggable={false} /> : <span className={s.initials}>{initials}</span>}
        {!disabled ? (
          <span className={s.overlay} aria-hidden="true">
            <ImagePlus size={20} />
            <span>{shown ? t("settings.security.change") : t("common.iconPicker.upload")}</span>
          </span>
        ) : null}
      </button>
      {shown && onRemove && !disabled ? (
        <button type="button" className={s.remove} aria-label={t("common.iconPicker.removeIcon")} onClick={onRemove}><X size={14} /></button>
      ) : null}
      {crop ? (
        <ImageCropModal
          file={crop}
          aspect={1}
          round={!square}
          maxSize={1024}
          title={t("common.iconPicker.cropTheIcon")}
          serverCrop
          onClose={() => setCrop(null)}
          onDone={({ blob, crop: area }) => {
            setCrop(null);
            onPick({ file: new File([blob], "icon" + (blob.type === "image/png" ? ".png" : ""), { type: blob.type }), crop: area ?? null });
          }}
        />
      ) : null}
    </div>
  );
}
