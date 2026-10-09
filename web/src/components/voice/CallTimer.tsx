import { useRef } from "react";
import { useNow } from "@/hooks/useNow";
import { callSeconds, callSince } from "@/lib/callTimer";
import { serverNow } from "@/lib/serverClock";
import { formatDuration } from "@/lib/time";
import { useVoice } from "@/stores/voice";
import { formatCallLength } from "@/voice/callSummary";
import s from "./Voice.module.css";

import { t } from "@/i18n";

/**
 * How long the call in a channel has been going, "12:04", ticking once a
 * second on the clock every timer on screen shares. Nothing while nobody is in
 * the call. While this device's own call to it is reconnecting the time holds
 * still and greys, since nothing is getting through. `pill` sets it in the
 * small tag a call's line uses; plain, it is just the digits.
 */
export function CallTimer({ channelId, pill, className }: { channelId: string; pill?: boolean; className?: string }) {
  const since = useVoice((v) => callSince(v.byChannel, channelId));
  const held = useVoice((v) => v.connection === "reconnecting" && v.mine?.channel_id === channelId);
  const now = useNow(since !== null && !held);
  const last = useRef(now);
  if (!held) last.current = now;
  if (since === null) return null;
  const secs = callSeconds(since, serverNow(last.current));
  return (
    <time
      className={[s.callTimer, className].filter(Boolean).join(" ")}
      data-pill={pill || undefined}
      data-held={held || undefined}
      dateTime={`PT${secs}S`}
      data-testid="call-timer"
    >
      <span aria-hidden="true">{formatDuration(secs)}</span>
      <span className="visually-hidden">{t("voice.callTimer.label", { length: formatCallLength(secs) })}</span>
    </time>
  );
}
