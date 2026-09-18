/**
 * Where the reader actually is, for code that is not the message list.
 *
 * Marking a message read is only honest when the reader could have seen it:
 * the list has to reach the present *and* be at the bottom of it. MessageList
 * is the only thing that knows both, and its own ack effect says so; but the
 * dispatcher has to answer the same question for a message arriving over the
 * socket. It is kept here rather than in a store because it changes with every
 * scroll event, and waking every subscriber of a store that often is a cost
 * with no reader.
 */
let present: string | null = null;

/** Called by the message list; null whenever the reader is anywhere but the newest message. */
export function setReadingPresent(channelId: string | null): void {
  present = channelId;
}

/** Whether this channel's list is showing the newest message, scrolled to it. */
export function readingPresent(channelId: string): boolean {
  return present === channelId;
}
