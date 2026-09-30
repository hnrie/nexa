/**
 * How a call's voices are encoded: Opus with DTX, at a higher bitrate than
 * the browser picks on its own.
 *
 * DTX: a voice that voice activity, push to talk or mute has silenced
 * (voiceSend.ts) goes on sending, but only a packet every 400 ms, so a pause
 * costs about what not sending at all did, and the timestamps stay in step.
 *
 * The bitrate: browsers encode a voice at 32 kbps unless told otherwise, which
 * is thin next to what people are used to hearing from a call. 48 kbps
 * sounds full, and with DTX a call still sends less than the SFU's meter
 * counts for it (64 kbps a voice, internal/realtime/meter.go).
 *
 * An encoder takes both from the other side's description, which says what
 * that side would like to receive. So they are written into every remote
 * description before it is applied, offers as well as answers: each exchange
 * applies the parameters again, and one without them would switch DTX off.
 */

/** The bitrate a voice is sent at, in bits per second. */
export const VOICE_BITRATE = 48_000;

const WANTED: Record<string, string> = { usedtx: "1", maxaveragebitrate: String(VOICE_BITRATE) };

/** An fmtp line's parameters with ours set, in the order they came. */
function withOurs(params: string): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of params.split(";")) {
    const p = part.trim();
    if (!p) continue;
    const key = p.split("=")[0]!.trim().toLowerCase();
    if (key in WANTED) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${key}=${WANTED[key]}`);
    } else out.push(p);
  }
  for (const [key, value] of Object.entries(WANTED)) if (!seen.has(key)) out.push(`${key}=${value}`);
  return out.join(";");
}

/** A description with every Opus payload type of every audio section asking for DTX and our bitrate. */
export function tuneOpus(sdp: string): string {
  if (!/opus\/48000/i.test(sdp)) return sdp;
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(eol);
  const out: string[] = [];
  // per media section: the Opus payload types it maps, and those it gave an fmtp line
  let opus = new Map<string, number>();
  let tuned = new Set<string>();
  const closeSection = () => {
    // an Opus mapping with no fmtp line of its own gets one, just after it
    const missing = [...opus].filter(([pt]) => !tuned.has(pt)).sort((a, b) => b[1] - a[1]);
    for (const [pt, at] of missing) out.splice(at + 1, 0, `a=fmtp:${pt} ${withOurs("")}`);
    opus = new Map();
    tuned = new Set();
  };
  for (const line of lines) {
    if (line.startsWith("m=")) closeSection();
    const map = /^a=rtpmap:(\d+) opus\/48000/i.exec(line);
    if (map) {
      out.push(line);
      opus.set(map[1]!, out.length - 1);
      continue;
    }
    const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(line);
    if (fmtp && opus.has(fmtp[1]!)) {
      tuned.add(fmtp[1]!);
      out.push(`a=fmtp:${fmtp[1]} ${withOurs(fmtp[2]!)}`);
      continue;
    }
    out.push(line);
  }
  // the last section ends with the description; a trailing empty line stays last
  const trailing = out.length > 0 && out[out.length - 1] === "" ? out.pop() : undefined;
  closeSection();
  if (trailing !== undefined) out.push(trailing);
  return out.join(eol);
}

/** A description to apply as the remote one, tuned. Rollbacks and empty ones pass as they are. */
export function tunedRemote<D extends { type?: RTCSdpType | string; sdp?: string | null }>(desc: D): D {
  if (!desc || !desc.sdp || desc.type === "rollback") return desc;
  return { ...desc, sdp: tuneOpus(desc.sdp) };
}
