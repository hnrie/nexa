import { useMediaAnimation } from "@/lib/mediaAnimation";
import { Hash, ImagePlus, SmilePlus, Volume2 } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { channels as channelsApi } from "@/api/channels";
import type { Channel } from "@/api/types";
import { iconUrl } from "@/api/users";
import { Button } from "@/components/common/Button";
import { ImageCropModal } from "@/components/common/ImageCropModal";
import { ChannelGlyph } from "@/components/common/ChannelGlyph";
import { CHANNEL_ICONS, channelIconName } from "@/components/common/channelIcons";
import { Tooltip } from "@/components/common/Tooltip";
import { ExpressionPicker } from "@/components/pickers/ExpressionPicker";
import { t } from "@/i18n";
import { parseGlyph } from "@/lib/channelGlyph";
import { useExpressions } from "@/stores/expressions";
import { useUI } from "@/stores/ui";
import { describeError } from "@/lib/errors";
import p from "./ChannelIconPicker.module.css";

interface Props {
  channel: Channel;
  /** The icon as edited so far: "" for the default. */
  value: string;
  onChange: (glyph: string) => void;
  /** What the group of icons is called: the field's own caption. */
  label: string;
  /** A picture was uploaded for the channel (saved at once, as a role's icon is). */
  onUploaded: (channel: Channel) => void;
}

/** The value that stands for the channel's uploaded picture while it is being edited. */
export const PICTURE = "picture";

function Tile({ checked, label, onSelect, children, testId }: { checked: boolean; label: string; onSelect: () => void; children: ReactNode; testId?: string }) {
  return (
    <Tooltip text={label} side="top">
      <button type="button" role="radio" aria-checked={checked} aria-label={label} tabIndex={checked ? 0 : -1} className={p.tile} onClick={onSelect} data-testid={testId}>
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * The icon a channel wears in place of its # or speaker: the default, one of
 * the app's line icons, or an emoji (this server's own custom emoji
 * included). A radio group: arrows move through it and pick as they go, as
 * any set of radio buttons does; nothing is saved until the page is.
 */
export function ChannelIconPicker({ channel, value, onChange, label, onUploaded }: Props) {
  useMediaAnimation();
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const toast = useUI((u) => u.toast);
  const upload = async (blob: Blob, area: { x: number; y: number; w: number; h: number } | null) => {
    setUploading(true);
    try {
      onUploaded(await channelsApi.uploadIcon(channel.id, blob, area));
      toast(t("server.channelIcon.pictureSaved"), "success");
    } catch (err) {
      toast(describeError(err, t("server.channelIcon.pictureFailed")), "error");
    } finally {
      setUploading(false);
    }
  };
  const grid = useRef<HTMLDivElement>(null);
  const g = parseGlyph(value);
  // the emoji last picked here keeps its tile, so going to an icon and back is one click
  const [emoji, setEmoji] = useState<string | null>(g && g.kind !== "icon" ? value : null);
  const custom = useExpressions((x) => (g?.kind === "custom" && channel.server_id ? x.emojis[channel.server_id]?.find((e) => e.id === g.id) : undefined));
  const emojiShown = g && g.kind !== "icon" ? value : emoji;
  const emojiLabel = (raw: string) => {
    const e = parseGlyph(raw);
    if (e?.kind === "emoji") return e.text;
    return custom ? `:${custom.name}:` : t("server.channelIcon.chooseEmoji");
  };
  const isCategory = channel.type === "category";
  const noneChecked = value !== PICTURE && (!g || (g.kind === "icon" && !CHANNEL_ICONS[g.name]));

  // Arrows move through the tiles and pick as they go, a row at a time up and
  // down; left and right follow the reading direction.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tiles = [...(grid.current?.querySelectorAll<HTMLButtonElement>("[role=radio]") ?? [])];
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const cols = Math.max(1, getComputedStyle(grid.current!).gridTemplateColumns.split(" ").length);
    const rtl = document.documentElement.dir === "rtl";
    const step: Record<string, number> = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: cols, ArrowUp: -cols, Home: -at, End: tiles.length - 1 - at };
    const by = step[e.key];
    if (by === undefined) return;
    e.preventDefault();
    const next = tiles[Math.min(tiles.length - 1, Math.max(0, at + by))];
    next?.focus();
    next?.click();
  };

  return (
    <div className={p.picker}>
      <div ref={grid} className={p.grid} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} data-testid="channel-icon-grid">
        <Tile checked={noneChecked} label={isCategory ? t("server.channelIcon.none") : t("server.channelIcon.default")} onSelect={() => onChange("")} testId="channel-icon-default">
          {channel.type === "voice" ? <Volume2 size={20} /> : isCategory ? <span className={p.none} aria-hidden="true" /> : <Hash size={20} />}
        </Tile>
        {channel.icon_id ? (
          <Tile checked={value === PICTURE} label={t("server.channelIcon.picture")} onSelect={() => onChange(PICTURE)} testId="channel-icon-picture">
            <img className={p.picture} src={iconUrl(channel.icon_id, 22) ?? undefined} alt="" draggable={false} />
          </Tile>
        ) : null}
        {emojiShown ? (
          <Tile checked={value === emojiShown} label={emojiLabel(emojiShown)} onSelect={() => onChange(emojiShown)} testId="channel-icon-emoji">
            <ChannelGlyph channel={{ type: "text", server_id: channel.server_id, glyph: emojiShown }} size={22} />
          </Tile>
        ) : null}
        {Object.entries(CHANNEL_ICONS).map(([name, Icon]) => (
          <Tile key={name} checked={value === `icon:${name}`} label={channelIconName(name)} onSelect={() => onChange(`icon:${name}`)} testId={`channel-icon-${name}`}>
            <Icon size={20} />
          </Tile>
        ))}
      </div>
      <div className={p.actions}>
        <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => file.current?.click()} data-testid="channel-icon-upload">
          <ImagePlus size={16} aria-hidden="true" /> {t("server.channelIcon.uploadPicture")}
        </Button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) setCrop(f);
          }}
          data-testid="channel-icon-file"
        />
        <Button type="button" size="sm" variant="secondary" onClick={(e) => setPicker(picker ? null : e.currentTarget.getBoundingClientRect())} data-picker-toggle={picker ? "" : undefined} data-testid="channel-icon-choose-emoji">
          <SmilePlus size={16} aria-hidden="true" /> {t("server.channelIcon.chooseEmoji")}
        </Button>
        {value ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange("")} data-testid="channel-icon-remove">{t("server.channelIcon.removeIcon")}</Button>
        ) : null}
      </div>
      {crop ? (
        <ImageCropModal
          file={crop}
          aspect={1}
          maxSize={256}
          title={t("server.channelIcon.cropPicture")}
          serverCrop
          onClose={() => setCrop(null)}
          onDone={({ blob, crop: area }) => {
            setCrop(null);
            void upload(blob, area ?? null);
          }}
        />
      ) : null}
      {picker ? (
        <ExpressionPicker
          anchor={picker}
          serverId={channel.server_id}
          onlyServer
          onClose={() => setPicker(null)}
          onEmoji={(pick) => {
            const next = pick.custom ? `custom:${pick.custom.id}` : `emoji:${pick.unicode}`;
            setEmoji(next);
            onChange(next);
            setPicker(null);
          }}
        />
      ) : null}
    </div>
  );
}
