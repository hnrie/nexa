import { api } from "./client";
import type { IceServer, Snowflake, VoiceState } from "./types";

export const voice = {
  ice(): Promise<{ ice_servers: IceServer[] }> {
    return api.request("GET", "/voice/ice");
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
