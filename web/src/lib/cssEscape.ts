/**
 * A value made safe to put inside a quoted attribute selector. Browsers have
 * CSS.escape; the test environment does not, and what it needs there — the
 * quote and the backslash escaped — is all a quoted value needs anyway.
 */
export function cssValue(v: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(v);
  return v.replace(/["\\]/g, "\\$&");
}
