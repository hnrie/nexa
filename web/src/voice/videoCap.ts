/**
 * The largest picture a call carries, and what keeps this device inside it.
 *
 * Every received video frame is checked against the cap before the browser
 * decodes it (frameSize.ts), so a modified client cannot make everyone else's
 * browser allocate a picture of absurd size. This device never sends above it
 * either: a larger screen is scaled down in proportion rather than refused.
 * 8K UHD (7680x4320) fits, and so does any other shape of no more pixels with
 * no side over 8192: super-ultrawide 7680x2160, an 8K screen turned upright.
 *
 * Nothing here touches the page at load, so the frame worker can import it.
 */

/** The cap: the longest side, the most pixels, the highest frame rate. */
export const VIDEO_CAP = { side: 8192, pixels: 7680 * 4320, fps: 60 } as const;

export interface PictureSize {
  width: number;
  height: number;
}

/** Whether a picture of this size may be decoded: whole, positive and within the cap. */
export function fitsCap(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= VIDEO_CAP.side && height <= VIDEO_CAP.side && width * height <= VIDEO_CAP.pixels;
}

/**
 * What a picture of this size has to be divided by to fit the cap, keeping its
 * shape: 1 when it fits already or its size is unknown. A little is added so an
 * encoder that rounds to the nearest pixel still lands inside.
 */
export function capScale(width: number, height: number): number {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return 1;
  const need = Math.max(width / VIDEO_CAP.side, height / VIDEO_CAP.side, Math.sqrt((width * height) / VIDEO_CAP.pixels));
  return need > 1 ? need * 1.002 : 1;
}

/** A frame rate from settings or from elsewhere: a whole number from 1 to 60, the fallback when it is not a number. */
export function clampFps(fps: unknown, fallback = 30): number {
  const n = typeof fps === "number" && Number.isFinite(fps) ? Math.round(fps) : fallback;
  return Math.min(VIDEO_CAP.fps, Math.max(1, n));
}

/** A bitrate from elsewhere, held between the bounds; the fallback when it is not a positive number. */
export function clampBitrate(bps: unknown, min: number, max: number, fallback: number): number {
  if (typeof bps !== "number" || !Number.isFinite(bps) || bps <= 0) return fallback;
  return Math.round(Math.min(max, Math.max(min, bps)));
}

/**
 * A received picture's shape for laying out its tile: width over height, kept
 * between 1:16 and 16:1. Null while the size is not known or makes no sense.
 */
export function safeAspect(width: number, height: number): number | null {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return null;
  return Math.min(16, Math.max(1 / 16, width / height));
}

/**
 * What a call sends: VP8, whose payload header the frame encryption keeps
 * readable and whose keyframe header frameSize.ts reads before anything is
 * decoded. True when the browser took the list.
 */
export function preferVp8(tr: RTCRtpTransceiver): boolean {
  if (typeof tr.setCodecPreferences !== "function") return false;
  for (const caps of [RTCRtpReceiver.getCapabilities?.("video"), RTCRtpSender.getCapabilities?.("video")]) {
    const vp8 = caps?.codecs.filter((c) => c.mimeType === "video/VP8" || c.mimeType === "video/rtx") ?? [];
    if (!vp8.some((c) => c.mimeType === "video/VP8")) continue;
    try {
      tr.setCodecPreferences(vp8);
      return true;
    } catch {
      /* this list is not the one the browser checks against; try the other */
    }
  }
  return false;
}

/**
 * What a call takes in: VP8, and H.264, which a phone shares its screen in
 * with its hardware encoder (h264.ts). The frame encryption and the size
 * check read both before anything is decoded, and asking for them alone on a
 * receiving transceiver means a sender cannot slip another codec past that
 * check: a track offered in nothing else is turned down. VP8 comes first, so
 * where a sender offers both, it is the one used. True when the browser took
 * the list.
 */
export function acceptCallVideo(tr: RTCRtpTransceiver): boolean {
  if (typeof tr.setCodecPreferences !== "function") return false;
  const rank = (c: RTCRtpCodec) => (/^video\/vp8$/i.test(c.mimeType) ? 0 : /^video\/h264$/i.test(c.mimeType) ? 1 : 2);
  for (const caps of [RTCRtpReceiver.getCapabilities?.("video"), RTCRtpSender.getCapabilities?.("video")]) {
    const list = caps?.codecs.filter((c) => /^video\/(vp8|h264|rtx)$/i.test(c.mimeType)) ?? [];
    if (!list.some((c) => rank(c) === 0)) continue;
    try {
      tr.setCodecPreferences([...list].sort((a, b) => rank(a) - rank(b)));
      return true;
    } catch {
      /* this list is not the one the browser checks against; try the other */
    }
  }
  return false;
}

/** Whether this browser can take a phone's H.264 screen share (acceptCallVideo), which the call is told. */
export function canReceiveH264(): boolean {
  return !!RTCRtpReceiver.getCapabilities?.("video")?.codecs.some((c) => /^video\/h264$/i.test(c.mimeType));
}

/**
 * Holds a video sender inside the cap: at most `maxBitrate`, at most 60 frames
 * a second, and scaled down in proportion when `size`, the picture going in,
 * is larger than the cap. Without a size the scale already set is kept.
 */
export function capSender(sender: RTCRtpSender, maxBitrate: number, size?: PictureSize | null): void {
  const bitrate = Number.isFinite(maxBitrate) && maxBitrate > 0 ? Math.round(maxBitrate) : undefined;
  const withBitrate = () => {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    if (bitrate !== undefined) params.encodings[0]!.maxBitrate = bitrate;
    return params;
  };
  try {
    const params = withBitrate();
    const enc = params.encodings[0]!;
    enc.maxFramerate = Math.min(VIDEO_CAP.fps, enc.maxFramerate && enc.maxFramerate > 0 ? enc.maxFramerate : VIDEO_CAP.fps);
    enc.scaleResolutionDownBy = size ? capScale(size.width, size.height) : Math.max(1, enc.scaleResolutionDownBy ?? 1);
    // a browser that turns the frame rate or the scale down still gets the bitrate
    void sender
      .setParameters(params)
      .catch(() => sender.setParameters(withBitrate()))
      .catch(() => {});
  } catch {
    /* not supported */
  }
}

/**
 * The scale a video sender should use, from its statistics: the source's last
 * frame where the browser reports it (exact, so a picture that fits again goes
 * back to full size), otherwise what was sent scaled back up by the scale in
 * use. That can be less than the source when the encoder shrank the picture
 * for a slow link, so from it the scale only ever grows. Null when the
 * statistics say neither.
 */
export function scaleFromStats(stats: Iterable<Record<string, unknown>>, have: number): number | null {
  let sent: number | null = null;
  const size = (w: unknown, h: unknown) => (typeof w === "number" && typeof h === "number" && w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h) ? { width: w, height: h } : null);
  for (const s of stats) {
    if (s.kind !== "video") continue;
    if (s.type === "media-source") {
      const src = size(s.width, s.height);
      if (src) return capScale(src.width, src.height);
    } else if (s.type === "outbound-rtp" && sent === null) {
      const out = size(s.frameWidth, s.frameHeight);
      if (out) sent = Math.max(have, capScale(out.width * have, out.height * have));
    }
  }
  return sent;
}

/**
 * Checks a video sender against what is actually going into it and changes
 * its scale when that calls for it: a share switched to a larger screen is
 * scaled down, and back up once the picture fits again. Called every few
 * seconds while a call runs.
 */
export async function recapSender(sender: RTCRtpSender): Promise<void> {
  try {
    const track = sender.track;
    if (!track || track.kind !== "video" || track.readyState !== "live") return;
    const have = Math.max(1, sender.getParameters().encodings?.[0]?.scaleResolutionDownBy ?? 1);
    const report = await sender.getStats();
    const want = scaleFromStats(report.values() as Iterable<Record<string, unknown>>, have);
    if (want === null || Math.abs(want - have) / have < 0.01) return;
    const params = sender.getParameters();
    const enc = params.encodings?.[0];
    if (!enc) return;
    enc.scaleResolutionDownBy = want;
    await sender.setParameters(params);
  } catch {
    /* the sender went away, or cannot say */
  }
}
