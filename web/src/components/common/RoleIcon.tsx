import { emojiUrl, iconUrl } from "@/api/users";
import type { RoleIconInfo } from "@/lib/roleLook";
import { Twemoji } from "./Twemoji";

/** A role's picture beside a name, named for the role it stands for. */
export function RoleIcon({ icon, size = 18 }: { icon: RoleIconInfo; size?: number }) {
  const style = { width: size, height: size, flex: "none", objectFit: "contain" as const, verticalAlign: "middle", display: "inline-block" };
  if (icon.kind === "image") {
    const url = iconUrl(icon.id, size);
    return url ? <img src={url} alt={icon.name} title={icon.name} style={style} loading="lazy" decoding="async" draggable={false} /> : null;
  }
  if (icon.kind === "custom") return <img src={emojiUrl(icon.id, false, size)} alt={icon.name} title={icon.name} style={style} loading="lazy" decoding="async" draggable={false} />;
  return (
    <span role="img" aria-label={icon.name} title={icon.name} style={{ ...style, fontSize: size * 0.9, lineHeight: `${size}px`, textAlign: "center" }}>
      <Twemoji text={icon.text} title="" />
    </span>
  );
}
