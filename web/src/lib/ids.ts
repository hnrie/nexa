/** Snowflake helpers. Ids are decimal strings; compare them as BigInt, never as strings. */
export const ID_EPOCH = 1767225600000;

export function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : 1;
}

export function idGreater(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  return compareIds(a, b) > 0;
}

export function idTime(id: string): number {
  try {
    return Number(BigInt(id) >> 22n) + ID_EPOCH;
  } catch {
    return 0;
  }
}

let tmpCounter = 0;
export function tmpId(): string {
  tmpCounter += 1;
  return `tmp-${Date.now()}-${tmpCounter}`;
}

export function nonce(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
