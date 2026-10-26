import { create } from "zustand";

/** Why a plan is being offered: something the account's plan stopped. */
export type UpsellReason = { kind: "file"; name: string; size: number } | { kind: "storage" } | { kind: "share" } | { kind: "effect" };

/** The offer on screen (components/support/Upsell.tsx draws it), or null. */
export const useUpsell = create<{ reason: UpsellReason | null }>()(() => ({ reason: null }));

/**
 * Offers a plan where the free one stopped something: a file too big, files
 * full, the Quality share, a name effect. The dialog says what stopped and
 * which plan would do it, with a way to the plans and a way out.
 */
export function offerPlan(reason: UpsellReason): void {
  useUpsell.setState({ reason });
}
