import { api } from "./client";
import type { KeyEpoch, KeyFlags, KeyGrant, KeyNeed, Snowflake } from "./types";

export interface GrantUpload {
  conv_id: Snowflake;
  epoch: number;
  user_id: Snowflake;
  wrapped_key: string;
}

export const keys = {
  grants(): Promise<KeyGrant[]> {
    return api.request<KeyGrant[]>("GET", "/keys/grants");
  },
  needs(): Promise<KeyNeed[]> {
    return api.request<KeyNeed[]>("GET", "/keys/needs");
  },
  putGrants(list: GrantUpload[]): Promise<{ inserted: number }> {
    return api.request("POST", "/keys/grants", list);
  },
  createEpoch(conv_id: Snowflake, reason?: string): Promise<{ conv_id: Snowflake; epoch: number; user_ids: Snowflake[] }> {
    return api.request("POST", "/keys/epochs", { conv_id, reason: reason ?? "" });
  },
  epochs(conv_id: Snowflake): Promise<{ epochs: KeyEpoch[]; flags: KeyFlags; entitled: Snowflake[] }> {
    return api.request("GET", "/keys/epochs", undefined, { query: { conv_id } });
  },
};
