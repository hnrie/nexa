// Consent lasts only for this page session and this invite, never another account.
import { useAuth } from "@/stores/auth";
const confirmed = new Set<string>();
const key = (code: string) => `${useAuth.getState().me?.id ?? "visitor"}:${code}`;
export function clearInviteAge(): void { confirmed.clear(); }
export function confirmInviteAge(code: string): void { confirmed.add(key(code)); }
export function inviteConsentQuery(code: string): Record<string, string> { return confirmed.has(key(code)) ? { nsfw: "1" } : {}; }
