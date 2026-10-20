/**
 * What a call's permissions let this person do in it. A server's voice
 * channel answers by its roles and overwrites; a DM call or a guest's call
 * lets them do everything. The server holds the same rules (voice_glue.go,
 * sfu_handlers.go); these keep the app from offering what it would refuse.
 */
import { P } from "@/lib/perms";
import { useChannels } from "@/stores/channels";
import { canI, useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { useVoice } from "@/stores/voice";

function allows(channelId: string | null | undefined, need: bigint): boolean {
  if (!channelId) return true;
  const serverId = useChannels.getState().byId[channelId]?.server_id;
  if (!serverId) return true;
  return canI(useServers.getState().byId[serverId], need, channelId);
}

/** Whether this person may turn on a camera or share a screen here (Video). */
export function mayStream(channelId: string | null | undefined): boolean {
  return allows(channelId, P.STREAM);
}

/** Whether this person may talk as Priority Speaker here: only in a server's voice channel that allows it. */
export function mayBePriority(channelId: string): boolean {
  return !!useChannels.getState().byId[channelId]?.server_id && allows(channelId, P.PRIORITY_SPEAKER);
}

/** Whether a channel lets this person talk by voice activity; without Use Voice Activity they must push to talk. */
export function allowsVoiceActivity(channelId: string | null | undefined): boolean {
  return allows(channelId, P.USE_VAD);
}

/** Whether push to talk is in force: chosen in settings, or required by the call's channel. */
export function pushToTalkOn(): boolean {
  return useSettings.getState().settings.voice.mode === "ptt" || !allowsVoiceActivity(useVoice.getState().mine?.channel_id);
}

/** mayStream for the call this device is in, redrawn when roles or channels change. */
export function useMayStream(): boolean {
  const channelId = useVoice((v) => v.mine?.channel_id ?? null);
  useServers((x) => x.byId);
  useChannels((x) => x.byId);
  return mayStream(channelId);
}

/** pushToTalkOn, redrawn when it changes. */
export function usePushToTalkOn(): boolean {
  const mode = useSettings((x) => x.settings.voice.mode);
  const channelId = useVoice((v) => v.mine?.channel_id ?? null);
  useServers((x) => x.byId);
  useChannels((x) => x.byId);
  return mode === "ptt" || !allowsVoiceActivity(channelId);
}
