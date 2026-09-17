import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { t } from "@/i18n";

interface Props {
  text: string;
  /** Rendered size in pixels. */
  size?: number;
  className?: string;
  label?: string;
}

/**
 * A QR code drawn as one SVG path, so it stays crisp at any size and needs no
 * canvas. Error correction is M: enough to survive a phone camera at an angle.
 */
export function QrCode({ text, size = 184, className, label = t("common.qrCode.qrCode") }: Props) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [text]);
  // Four modules of quiet zone on every side, as the spec requires.
  const quiet = 4;
  const span = count + quiet * 2;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={span} height={span} fill="#fff" />
      <g transform={`translate(${quiet} ${quiet})`} fill="#000">
        <path d={path} />
      </g>
    </svg>
  );
}
