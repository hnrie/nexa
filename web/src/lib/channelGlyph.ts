/**
 * A server channel's own icon, as the server stores it: one of the app's line
 * icons ("icon:megaphone"), an emoji ("emoji:🎉"), or one of the server's
 * custom emoji ("custom:<emoji id>"). None, or anything this build cannot
 * read, is the default # or speaker.
 */
export type Glyph = { kind: "icon"; name: string } | { kind: "emoji"; text: string } | { kind: "custom"; id: string };

export function parseGlyph(raw: string | null | undefined): Glyph | null {
  if (!raw) return null;
  const at = raw.indexOf(":");
  if (at <= 0) return null;
  const kind = raw.slice(0, at);
  const value = raw.slice(at + 1);
  if (!value) return null;
  if (kind === "icon" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) return { kind: "icon", name: value };
  if (kind === "emoji") return { kind: "emoji", text: value };
  if (kind === "custom" && /^\d{1,20}$/.test(value)) return { kind: "custom", id: value };
  return null;
}

export function glyphString(g: Glyph | null): string {
  if (!g) return "";
  if (g.kind === "icon") return `icon:${g.name}`;
  if (g.kind === "emoji") return `emoji:${g.text}`;
  return `custom:${g.id}`;
}

/**
 * A channel as plain text, where no picture can go (a notification's title):
 * its emoji and its name when its icon is an emoji, "#name" otherwise.
 */
export function channelLabel(channel: { name: string; glyph?: string | undefined }): string {
  const g = parseGlyph(channel.glyph);
  return g?.kind === "emoji" ? `${g.text} ${channel.name}` : `#${channel.name}`;
}
