import { describe, expect, it, vi } from "vitest";
import { VoiceSend } from "./voiceSend";

function fakeTrack() {
  const copies: { enabled: boolean; stop: ReturnType<typeof vi.fn> }[] = [];
  const track = {
    enabled: true,
    stop: vi.fn(),
    clone: () => {
      const c = { enabled: true, stop: vi.fn() };
      copies.push(c);
      return c;
    },
  };
  return { track: track as unknown as MediaStreamTrack, copies };
}

describe("VoiceSend", () => {
  it("sends a copy of the microphone, silenced until it is let through", () => {
    const send = new VoiceSend();
    const { track, copies } = fakeTrack();
    const sent = send.track(track);
    expect(sent).toBe(copies[0]);
    expect(sent?.enabled).toBe(false);
    send.setOpen(true);
    expect(sent?.enabled).toBe(true);
    send.setOpen(false);
    expect(sent?.enabled).toBe(false);
    // the microphone itself is never touched, so the meter keeps hearing it
    expect(track.enabled).toBe(true);
  });

  it("keeps one copy per microphone and lets the old one go on a change", () => {
    const send = new VoiceSend();
    const a = fakeTrack();
    const b = fakeTrack();
    send.setOpen(true);
    expect(send.track(a.track)).toBe(send.track(a.track));
    const next = send.track(b.track);
    expect(a.copies[0]!.stop).toHaveBeenCalled();
    // a new copy starts as open or shut as the gate is
    expect(next?.enabled).toBe(true);
    expect(send.track(null)).toBeNull();
    expect(b.copies[0]!.stop).toHaveBeenCalled();
  });

  it("stops its copy and not the microphone", () => {
    const send = new VoiceSend();
    const { track, copies } = fakeTrack();
    send.track(track);
    send.stop();
    expect(copies[0]!.stop).toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
  });
});
