import { StickerView } from "@/components/stickers/StickerView";
import { Fragment } from "react";
import { api } from "@/api/client";
import { useBugFileURL } from "@/lib/bugMedia";
import { t } from "@/i18n";
import s from "./Reports.module.css";
const LABELS: Record<string, string> = {
  avatar_id: "avatar",
  banner_id: "banner",
  icon_id: "icon",
  cover_blob_id: "image",
  blob_id: "image",
  status_text: "status",
  status_emoji: "status",
  discovery_category: "discovery",
  discovery_tags: "tags",
  server_profile: "server_profile",
};
export function ReportSnapshot({
  snapshot,
  kind,
  saved = false,
}: {
  snapshot: Record<string, unknown>;
  kind: string;
  saved?: boolean;
}) {
  return (
    <dl className={s.snapshot}>
      {Object.entries(snapshot).map(([name, value]) => {
        const key = `reports.part.${LABELS[name] ?? name}`;
        const translated = t(key);
        const label =
          translated === key ? name.replaceAll("_", " ") : translated;
        const mediaKind =
          name === "avatar_id"
            ? "avatar"
            : name === "banner_id"
              ? "banner"
              : name === "icon_id"
                ? "icon"
                : name === "cover_blob_id"
                  ? "sticker"
                  : name === "blob_id"
                    ? kind === "emoji"
                      ? "emoji"
                      : "sticker"
                    : null;
        return (
          <Fragment key={name}>
            <dt>{label}</dt>
            <dd>
              {mediaKind && typeof value === "string" ? (
                saved ? (
                  <SavedPicture
                    id={value}
                    label={label}
                    format={String(
                      snapshot[
                        name === "cover_blob_id" ? "cover_format" : "format"
                      ] ?? "",
                    )}
                  />
                ) : (
                  <img
                    src={api.url(`/media/${mediaKind}/${value}`)}
                    alt={label}
                    loading="lazy"
                  />
                )
              ) : value === null ? (
                t("reports.unspecified")
              ) : Array.isArray(value) ? (
                value
                  .map((v) =>
                    typeof v === "object" ? JSON.stringify(v) : String(v),
                  )
                  .join(", ")
              ) : typeof value === "object" ? (
                <details>
                  <summary>{label}</summary>
                  <ReportSnapshot
                    snapshot={value as Record<string, unknown>}
                    kind={kind}
                    saved={saved}
                  />
                </details>
              ) : (
                String(value)
              )}
            </dd>
          </Fragment>
        );
      })}
    </dl>
  );
}
function SavedPicture({
  id,
  label,
  format,
}: {
  id: string;
  label: string;
  format: string;
}) {
  const { url, failed, retry } = useBugFileURL(id, undefined, true, "reports");
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <StickerView
        src={url}
        alt={label}
        format={format}
        style={{ width: 160, height: 120, objectFit: "contain" }}
      />
    </a>
  ) : (
    <button onClick={retry}>
      {failed ? t("reports.failed") : t("reports.loading")}
    </button>
  );
}
