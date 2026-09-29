import { useMemo } from "react";
import type { UnfurlResult } from "@/api/types";
import { RenderNodes, flattenInline, parse, type Node, type RenderCtx } from "@/markdown";
import { hookText } from "@/lib/webhookMessage";
import { pollWords } from "@/lib/poll";
import type { DecryptedMessage } from "@/stores/messages";
import { isOnlyMediaLinks } from "./mediaLinks";

import { t } from "@/i18n";

/**
 * What a reply shows of the message it answers: its words on one line with
 * their formatting kept (bold, underline, colour, emoji and the rest, laid
 * flat by flattenInline), or, for a message with no words to show, what it
 * holds, said in a few.
 */
export function useReplyWords(target: DecryptedMessage | undefined): { nodes: Node[] | null; text: string } {
  const payload = target?.payload;
  const hook = target?.hook;
  const failed = !!target?.decryptError;
  return useMemo(() => {
    const mediaOnly = !!payload?.t && isOnlyMediaLinks(payload.t, (payload.embeds ?? []) as UnfurlResult[]);
    const words = payload?.t && !mediaOnly ? payload.t : hook && !payload?.att?.length ? hookText(hook) : "";
    const nodes = words ? flattenInline(parse(words)) : [];
    if (nodes.length) return { nodes, text: "" };
    // a poll's words are its question and answers
    if (payload?.poll) return { nodes: null, text: pollWords(payload.poll).replace(/\n/g, " ").slice(0, 200) };
    if (payload?.att?.length || mediaOnly || payload?.sticker) return { nodes: null, text: t("chat.messageItem.clickToSeeAttachment") };
    return { nodes: null, text: failed ? t("chat.messageItem.encryptedMessage") : "" };
  }, [payload, hook, failed]);
}

/** The words of useReplyWords, drawn: nothing in them takes a click of its own (RenderCtx.inert). */
export function ReplyWords({ words, ctx }: { words: { nodes: Node[] | null; text: string }; ctx: RenderCtx }) {
  const inert = useMemo(() => ({ ...ctx, inert: true }), [ctx]);
  return words.nodes ? <RenderNodes nodes={words.nodes} ctx={inert} /> : <>{words.text}</>;
}
