import { create } from "zustand";
import { billing as billingApi } from "@/api/billing";
import type { Billing } from "@/api/types";

interface BillingState {
  /** The account's side of its subscription, once read; null before. */
  billing: Billing | null;
  loading: boolean;
  /** Reads it again; what the Support page shows and what billing_update asks for. */
  load: () => Promise<void>;
  clear: () => void;
}

export const useBilling = create<BillingState>()((set, get) => ({
  billing: null,
  loading: false,
  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      set({ billing: await billingApi.get() });
    } finally {
      set({ loading: false });
    }
  },
  clear: () => set({ billing: null, loading: false }),
}));
