const PALETTE = ["#5865f2", "#3d9e60", "#fdb833", "#da3e44", "#eb459f", "#82838b"];

export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? PALETTE[0]!;
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = Array.from(trimmed)[0] ?? "?";
  return first.toUpperCase();
}

/** The CSS background for a profile banner area: a gradient when two colours are set. */
export function profileTheme(primary: number | null | undefined, secondary: number | null | undefined, fallbackId?: string): string {
  const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
  if (primary !== null && primary !== undefined && secondary !== null && secondary !== undefined) {
    return `linear-gradient(135deg, ${hex(primary)} 0%, ${hex(secondary)} 100%)`;
  }
  if (primary !== null && primary !== undefined) return hex(primary);
  return fallbackId ? avatarColor(fallbackId) : "var(--brand)";
}
