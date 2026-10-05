import { api } from "./client";
import type { Envelope } from "@/crypto/message";
import type { Follow, Snowflake } from "./types";

/** A published copy as the publisher's app seals it for one follow. */
export interface SealedCopy {
  v: 2;
  key: string;
  iv: string;
  ct: string;
}

export const follows = {
  /** Follows an announcement channel into a channel this account manages webhooks in. */
  create(sourceId: Snowflake, body: { target_channel_id: Snowflake; public_key: string; secret: Envelope }): Promise<Follow> {
    return api.request("POST", `/channels/${sourceId}/followers`, body);
  },
  /** The keys a publisher seals copies to, and nothing about where they go. */
  keys(sourceId: Snowflake): Promise<{ followers: { id: Snowflake; public_key: string }[] }> {
    return api.request("GET", `/channels/${sourceId}/followers`);
  },
  /** What a channel follows, with each follow's sealed key. */
  into(channelId: Snowflake): Promise<Follow[]> {
    return api.request("GET", `/channels/${channelId}/follows`);
  },
  forServer(serverId: Snowflake): Promise<Follow[]> {
    return api.request("GET", `/servers/${serverId}/follows`);
  },
  reseal(followId: Snowflake, secret: Envelope): Promise<void> {
    return api.request<void>("PUT", `/follows/${followId}/secret`, { secret });
  },
  remove(followId: Snowflake): Promise<void> {
    return api.request<void>("DELETE", `/follows/${followId}`);
  },
  publish(sourceId: Snowflake, messageId: Snowflake, copies: { follow_id: Snowflake; ciphertext: SealedCopy }[]): Promise<{ published: boolean; copies: number }> {
    return api.request("POST", `/channels/${sourceId}/messages/${messageId}/crosspost`, { copies });
  },
};
