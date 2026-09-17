/**
 * "Drag to Upload", over the whole window.
 *
 * A file dragged anywhere over the app goes to the conversation that is open,
 * so the drop target is the window rather than the message box — which is the
 * part people could not see. While a file is over the app the page dims and
 * this says where the file is going; dropping it anywhere sends it there.
 *
 * Browsers fire dragenter and dragleave for every element the pointer crosses,
 * so a plain pair of handlers flickers. Counting enters against leaves gives
 * one clean "the drag is over the window" signal.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Upload } from "lucide-react";
import { usePortalRoot } from "@/hooks/usePortalRoot";
import { NexaMark } from "@/components/common/Brand";
import { t } from "@/i18n";
import s from "./DropOverlay.module.css";

const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes("Files");

/** Whether this drag belongs to something with its own drop zone. */
function ownsTheDrop(el: Element | null): boolean {
  return !!el?.closest("[data-drop-zone], [role=dialog], [data-modal-layer]");
}

export function DropOverlay({ name, hash, onFiles, disabled }: {
  /** What the file is going to: a channel name, or the person you are talking to. */
  name: string;
  /** Whether to write it as #name, the way a channel reads. */
  hash: boolean;
  onFiles: (files: FileList) => void;
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const root = usePortalRoot();
  // the handlers live for the life of the window; the current callback does not
  const latest = useRef({ onFiles, disabled });
  latest.current = { onFiles, disabled };

  useEffect(() => {
    const reset = () => {
      depth.current = 0;
      setOver(false);
    };
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || latest.current.disabled) return;
      depth.current += 1;
      if (!ownsTheDrop(e.target instanceof Element ? e.target : null)) setOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current -= 1;
      if (depth.current <= 0) reset();
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // without this the browser opens the file in place of the app
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = latest.current.disabled ? "none" : "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      const target = e.target instanceof Element ? e.target : null;
      if (ownsTheDrop(target) || e.defaultPrevented) {
        reset();
        return;
      }
      e.preventDefault();
      reset();
      if (latest.current.disabled) return;
      if (e.dataTransfer?.files.length) latest.current.onFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
    };
  }, []);

  if (!over) return null;
  return createPortal(
    <div className={s.scrim} data-testid="drop-overlay" aria-hidden="true">
      <div className={s.card}>
        <div className={s.art}>
          <NexaMark size={44} className={s.mark} />
          <span className={s.badge}><Upload size={20} /></span>
        </div>
        <div className={s.title}>{t("composer.dropOverlay.dragToUpload")}</div>
        <div className={s.where}>{hash ? `#${name}` : name}</div>
      </div>
    </div>,
    root,
  );
}
