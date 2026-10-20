// @vitest-environment jsdom
import { PRIORITY_DUCK, Playback } from "./playback";

const gains: { gain: { value: number } }[] = [];
let level = 0;
vi.mock("./media", () => {
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => {} });
  return {
    audioContext: () => ({
      destination: {},
      createMediaStreamSource: () => node(),
      createGain: () => {
        const g = { ...node(), gain: { value: 1 } };
        gains.push(g);
        return g;
      },
    }),
    LevelMeter: class {
      level() {
        return level;
      }
      close() {}
    },
  };
});

class FakeStream {
  getAudioTracks() {
    return [{ addEventListener: () => {} }];
  }
}

describe("screen share sound", () => {
  beforeAll(() => {
    // jsdom has no MediaStream, and media elements cannot play
    (globalThis as unknown as { MediaStream: unknown }).MediaStream = FakeStream;
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  });
  beforeEach(() => {
    gains.length = 0;
  });

  it("has its own volume and mute, apart from the person's voice", () => {
    const p = new Playback(() => {});
    p.attachVoice("u1", new FakeStream() as unknown as MediaStream);
    p.attachScreenAudio("u1", new FakeStream() as unknown as MediaStream);
    const [voice, screen] = gains;
    p.setWatching("u1", true);
    expect(screen!.gain.value).toBe(1);

    // turning the person down (or muting them) leaves their stream alone
    p.setVolume("u1", 50);
    p.setLocalMute("u1", true);
    expect(voice!.gain.value).toBe(0);
    expect(screen!.gain.value).toBe(1);

    // and the stream's own level leaves their voice alone
    p.setLocalMute("u1", false);
    p.setStreamVolume("u1", 30);
    expect(voice!.gain.value).toBeCloseTo(0.5);
    expect(screen!.gain.value).toBeCloseTo(0.3);
    p.setStreamMuted("u1", true);
    expect(screen!.gain.value).toBe(0);
    expect(voice!.gain.value).toBeCloseTo(0.5);

    // deafening and not watching still silence it, and the master level applies to both
    p.setStreamMuted("u1", false);
    p.setMasterVolume(200);
    expect(screen!.gain.value).toBeCloseTo(0.6);
    p.setWatching("u1", false);
    expect(screen!.gain.value).toBe(0);
    p.setWatching("u1", true);
    p.setOutputMuted(true);
    expect(screen!.gain.value).toBe(0);
    expect(voice!.gain.value).toBe(0);
  });

  it("keeps sound not yet known to be opened silent until it is let go", () => {
    const p = new Playback(() => {});
    p.attachVoice("u1", new FakeStream() as unknown as MediaStream, true);
    p.attachScreenAudio("u1", new FakeStream() as unknown as MediaStream, true);
    const [voice, screen] = gains;
    p.setWatching("u1", true);
    p.setVolume("u1", 150);
    expect(voice!.gain.value).toBe(0);
    expect(screen!.gain.value).toBe(0);
    p.setHeld("u1", "voice", false);
    expect(voice!.gain.value).toBeCloseTo(1.5);
    expect(screen!.gain.value).toBe(0);
    p.setHeld("u1", "screen", false);
    expect(screen!.gain.value).toBe(1);
    // attached again without holding, it plays at once
    p.setHeld("u1", "voice", true);
    p.attachVoice("u1", new FakeStream() as unknown as MediaStream);
    expect(gains[2]!.gain.value).toBeCloseTo(1.5);
  });
});

describe("priority speaker", () => {
  beforeAll(() => {
    (globalThis as unknown as { MediaStream: unknown }).MediaStream = FakeStream;
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  });

  it("turns everyone else down while a priority speaker is heard", () => {
    vi.useFakeTimers();
    gains.length = 0;
    level = 0;
    const p = new Playback(() => {});
    p.attachVoice("loud", new FakeStream() as unknown as MediaStream);
    p.attachVoice("other", new FakeStream() as unknown as MediaStream);
    const [loud, other] = gains;
    p.setPriority("loud", true);
    expect(other!.gain.value).toBe(1);
    // both meters hear sound: the priority speaker is speaking, so the other is turned down
    level = 1;
    vi.advanceTimersByTime(300);
    expect(loud!.gain.value).toBe(1);
    expect(other!.gain.value).toBeCloseTo(PRIORITY_DUCK);
    // letting go of the key brings them back
    p.setPriority("loud", false);
    expect(other!.gain.value).toBe(1);
    p.close();
    level = 0;
    vi.useRealTimers();
  });
});
