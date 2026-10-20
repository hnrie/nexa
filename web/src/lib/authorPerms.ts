/**
 * What the author of a message may do in its channel, as a reader's app works
 * it out. Some permissions cover what is sealed inside a message, where the
 * server cannot look (emoji and stickers from outside the server), so every
 * app holds them when it draws someone else's message, as Discord's server
 * holds them when it reads one.
 */
import type { DecryptedMessage } from "@/lib/decrypt";
import { useChannels } from "@/stores/channels";
import { channelPerms, type ServerState } from "@/stores/servers";
import { has } from "./perms";

/**
 * Whether a message's author holds a permission in its channel: null when
 * this device cannot tell (not a server channel, an app's or a webhook's
 * message, or the author's roles not loaded), which readers take as yes.
 */
export function authorHas(st: ServerState | undefined, msg: Pick<DecryptedMessage, "channel_id" | "author_id" | "hook">, need: bigint): boolean | null {
  if (!st || msg.hook) return null;
  if (useChannels.getState().byId[msg.channel_id]?.server_id !== st.server.id) return null;
  if (st.server.owner_id !== msg.author_id && !st.members[msg.author_id]) return null;
  return has(channelPerms(st, msg.channel_id, msg.author_id), need);
}
