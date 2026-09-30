import { describe, expect, it } from "vitest";
import { tuneOpus, tunedRemote, VOICE_BITRATE } from "./opus";

const answer = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63",
  "a=mid:0",
  "a=rtpmap:111 opus/48000/2",
  "a=rtcp-fb:111 transport-cc",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:63 red/48000/2",
  "a=fmtp:63 111/111",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "a=mid:1",
  "a=rtpmap:96 VP8/90000",
  "m=audio 9 UDP/TLS/RTP/SAVPF 109",
  "a=mid:2",
  "a=rtpmap:109 opus/48000/2",
  "",
].join("\r\n");

describe("tuneOpus", () => {
  it("asks every Opus section for DTX and the voice bitrate, keeping what was there", () => {
    const out = tuneOpus(answer);
    expect(out).toContain(`a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1;maxaveragebitrate=${VOICE_BITRATE}`);
    // a section with no fmtp line of its own gets one, straight after its mapping
    expect(out).toContain(`a=rtpmap:109 opus/48000/2\r\na=fmtp:109 usedtx=1;maxaveragebitrate=${VOICE_BITRATE}`);
    // other codecs are left alone
    expect(out).toContain("a=fmtp:63 111/111");
    expect(out).toContain("a=rtpmap:96 VP8/90000\r\nm=audio");
    expect(out.endsWith("\r\n")).toBe(true);
  });

  it("overrides values it sets rather than repeating them", () => {
    const sdp = "m=audio 9 RTP/SAVPF 111\na=rtpmap:111 opus/48000/2\na=fmtp:111 usedtx=0;maxaveragebitrate=20000;stereo=0\n";
    expect(tuneOpus(sdp)).toBe(`m=audio 9 RTP/SAVPF 111\na=rtpmap:111 opus/48000/2\na=fmtp:111 usedtx=1;maxaveragebitrate=${VOICE_BITRATE};stereo=0\n`);
  });

  it("gives the same answer when it runs twice", () => {
    expect(tuneOpus(tuneOpus(answer))).toBe(tuneOpus(answer));
  });

  it("leaves a description without Opus as it is", () => {
    const sdp = "m=video 9 RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n";
    expect(tuneOpus(sdp)).toBe(sdp);
  });

  it("passes rollbacks and empty descriptions through", () => {
    expect(tunedRemote({ type: "rollback" })).toEqual({ type: "rollback" });
    const d = tunedRemote({ type: "answer", sdp: answer });
    expect(d.type).toBe("answer");
    expect(d.sdp).toContain("usedtx=1");
  });
});
