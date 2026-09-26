import { MSG_FLAG_COMPONENTS_V2, MSG_FLAG_SUPPRESS_EMBEDS } from "@/api/types";
import type { DecryptedMessage } from "@/stores/messages";
import { Embeds } from "../Embeds";
import { HookComponents } from "./HookComponents";
import { HookPoll } from "./HookPoll";
import { RichEmbeds } from "./RichEmbeds";

/**
 * What a webhook message shows under its text and files: its embeds, the
 * previews of its links, its components and its poll. A message whose embeds
 * were hidden shows neither kind of embed.
 */
export function HookBody({ msg, from }: { msg: DecryptedMessage; from: string }) {
  const hook = msg.hook;
  if (!hook) return null;
  const suppressed = (msg.flags & MSG_FLAG_SUPPRESS_EMBEDS) !== 0;
  const v2 = (msg.flags & MSG_FLAG_COMPONENTS_V2) !== 0;
  return (
    <>
      {!suppressed && !v2 ? <RichEmbeds hook={hook} /> : null}
      {!suppressed && !v2 && hook.link_embeds.length ? <Embeds list={hook.link_embeds} /> : null}
      <HookComponents hook={hook} v2={v2} from={from} />
      {hook.poll && !v2 ? <HookPoll poll={hook.poll} tally={msg.poll_results} channelId={msg.channel_id} messageId={msg.id} /> : null}
    </>
  );
}
