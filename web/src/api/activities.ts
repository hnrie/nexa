import type { Activity } from "./types";
import type { RpcActivity } from "@/lib/desktopBridge";
import { api } from "./client";

export const activities = {
  /** How these activities will look to others, named and with their art, shown to nobody. */
  preview(list: Partial<RpcActivity>[]): Promise<Activity[]> {
    return api.request<Activity[]>("POST", "/activities/preview", { activities: list });
  },
};
