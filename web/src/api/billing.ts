import { api } from "./client";
import type { Billing, Snowflake } from "./types";

/** Subscriptions (api/billing.go): buying goes to Stripe Checkout, managing to Stripe's portal. */
export const billing = {
  get(): Promise<Billing> {
    return api.request<Billing>("GET", "/billing");
  },
  /** The address of a Checkout page for the plan. */
  checkout(plan: "supporter" | "pro", period: "month" | "year"): Promise<{ url: string }> {
    return api.request("POST", "/billing/checkout", { plan, period });
  },
  /** The address of the portal, where a plan is changed or cancelled. */
  portal(): Promise<{ url: string }> {
    return api.request("POST", "/billing/portal");
  },
  /** The address of a Checkout page for a month or a year of a plan, paid once, for someone else. */
  gift(to: Snowflake, plan: "supporter" | "pro", period: "month" | "year"): Promise<{ url: string }> {
    return api.request("POST", "/billing/gift", { to, plan, period });
  },
  boost(serverId: Snowflake): Promise<void> {
    return api.request<void>("POST", "/billing/boosts", { server_id: serverId });
  },
  unboost(boostId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/billing/boosts/${boostId}`);
  },
};
