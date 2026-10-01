import { describe, expect, it, vi } from "vitest";
import { followVideo } from "./soundtrack";

/** A stand-in for a media element: the fields the follower reads and sets, and its events. */
function media(over: Partial<{ currentTime: number; paused: boolean; ended: boolean; volume: number; muted: boolean; playbackRate: number }> = {}) {
  const target = new EventTarget();
  const el = {
    currentTime: 0,
    paused: true,
    ended: false,
    volume: 1,
    muted: false,
    playbackRate: 1,
    ...over,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    fire: (name: string) => target.dispatchEvent(new Event(name)),
    play: vi.fn(function (this: void) {
      el.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(function (this: void) {
      el.paused = true;
    }),
  };
  return el;
}

function pair() {
  const video = media();
  const audio = media();
  const stop = followVideo(video as unknown as HTMLVideoElement, audio as unknown as HTMLAudioElement);
  return { video, audio, stop };
}

describe("a video's sound in a file of its own", () => {
  it("starts where the picture is, and stops when it stops", () => {
    const { video, audio } = pair();
    video.currentTime = 12;
    video.paused = false;
    video.fire("play");
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(12);
    video.paused = true;
    video.fire("pause");
    expect(audio.paused).toBe(true);
  });

  it("waits while the picture is loading, and goes on when it does", () => {
    const { video, audio } = pair();
    video.paused = false;
    video.fire("playing");
    video.fire("waiting");
    expect(audio.paused).toBe(true);
    video.fire("playing");
    expect(audio.paused).toBe(false);
  });

  it("follows a seek, the speed, the volume and mute", () => {
    const { video, audio } = pair();
    video.currentTime = 40;
    video.fire("seeking");
    expect(audio.currentTime).toBe(40);
    video.playbackRate = 2;
    video.fire("ratechange");
    expect(audio.playbackRate).toBe(2);
    video.volume = 0.3;
    video.muted = true;
    video.fire("volumechange");
    expect([audio.volume, audio.muted]).toEqual([0.3, true]);
  });

  it("is pulled back when the two drift apart, and left alone when they have not", () => {
    const { video, audio } = pair();
    video.paused = false;
    video.fire("play");
    video.currentTime = 5;
    audio.currentTime = 4.9;
    video.fire("timeupdate");
    expect(audio.currentTime).toBe(4.9);
    audio.currentTime = 4;
    video.fire("timeupdate");
    expect(audio.currentTime).toBe(5);
  });

  it("starts again if it was refused the first time (no sound allowed until a tap)", () => {
    const { video, audio } = pair();
    audio.play.mockImplementationOnce(() => Promise.reject(new DOMException("no", "NotAllowedError")));
    video.paused = false;
    video.fire("play");
    expect(audio.paused).toBe(true);
    video.fire("timeupdate");
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.paused).toBe(false);
  });

  it("does not start the sound of a video that is not playing", () => {
    const { video, audio } = pair();
    video.fire("timeupdate");
    video.ended = true;
    video.paused = false;
    video.fire("playing");
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("lets go when the player goes away", () => {
    const { video, audio, stop } = pair();
    video.paused = false;
    video.fire("play");
    stop();
    expect(audio.paused).toBe(true);
    audio.play.mockClear();
    video.fire("play");
    expect(audio.play).not.toHaveBeenCalled();
  });
});
