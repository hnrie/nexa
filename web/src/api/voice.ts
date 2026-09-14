import { api } from "./client";
import type { IceServer, Snowflake, VoiceState } from "./types";

export interface SfuDescription {
  type: "offer" | "answer";
  sdp: string;
}

export interface SfuPulled {
  mid?: string;
  user_id: Snowflake;
  kind: string;
  /** The pulled track's tag, as voice states carry it. */
  tag?: string;
  error?: string;
}

export const voice = {
  /** sfu says calls go through Cloudflare Realtime on this server. */
  /** guests says whether this server takes guests in calls through links. */
  ice(): Promise<{ ice_servers: IceServer[]; sfu?: boolean; guests?: boolean }> {
    return api.request("GET", "/voice/ice");
  },
  sfuSession(signal?: AbortSignal): Promise<{ session_id: string }> {
    return api.request("POST", "/voice/sfu/session", undefined, { signal });
  },
  sfuPublish(body: { session_id: string; offer: SfuDescription; tracks: { mid: string; kind: string; bitrate?: number }[] }, signal?: AbortSignal): Promise<{ answer: SfuDescription | null; failed: number }> {
    return api.request("POST", "/voice/sfu/publish", body, { signal });
  },
  sfuSubscribe(body: { session_id: string; tracks: { user_id: Snowflake; kind: string }[] }, signal?: AbortSignal): Promise<{ offer: SfuDescription | null; renegotiate: boolean; tracks: SfuPulled[] }> {
    return api.request("POST", "/voice/sfu/subscribe", body, { signal });
  },
  sfuRenegotiate(body: { session_id: string; description: SfuDescription }, signal?: AbortSignal): Promise<{ description: SfuDescription | null }> {
    return api.request("PUT", "/voice/sfu/renegotiate", body, { signal });
  },
  sfuClose(body: { session_id: string; mids: string[]; offer?: SfuDescription }, signal?: AbortSignal): Promise<{ answer: SfuDescription | null; renegotiate: boolean }> {
    return api.request("PUT", "/voice/sfu/close", body, { signal });
  },
  participants(channelId: Snowflake): Promise<VoiceState[]> {
    return api.request<VoiceState[]>("GET", `/channels/${channelId}/voice`);
  },
  decline(channelId: Snowflake): Promise<void> {
    return api.request<void>("POST", `/channels/${channelId}/call/decline`);
  },
  moderate(serverId: Snowflake, userId: Snowflake, body: { mute?: boolean; deaf?: boolean; channel_id?: Snowflake | null }): Promise<VoiceState | void> {
    return api.request("PATCH", `/servers/${serverId}/members/${userId}/voice`, body);
  },
};
