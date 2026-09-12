import { storage } from "@/lib/storage";

/** The last channel opened per server, so the rail returns you where you were. */
export function lastChannelOf(serverId: string): string | null {
  return storage.get(`lastChannel:${serverId}`);
}

export function rememberChannel(serverId: string, channelId: string): void {
  storage.set(`lastChannel:${serverId}`, channelId);
}
