import { useVoice } from "./voice";

const stream = {} as MediaStream;

describe("watching screen shares", () => {
  beforeEach(() => useVoice.getState().clear());

  it("brings a share to the front when watched, and lets it go when stopped", () => {
    const v = useVoice.getState();
    v.setRemote("u1", "screen", stream);
    v.setWatching("u1", true);
    expect(useVoice.getState().watching).toEqual({ u1: true });
    expect(useVoice.getState().focused).toBe("u1:screen");
    useVoice.getState().setWatching("u1", false);
    expect(useVoice.getState().watching).toEqual({});
    expect(useVoice.getState().focused).toBeNull();
  });

  it("does not unfocus something else when stopping", () => {
    const v = useVoice.getState();
    v.setWatching("u1", true);
    v.setFocused("u2:video");
    useVoice.getState().setWatching("u1", false);
    expect(useVoice.getState().focused).toBe("u2:video");
  });

  it("forgets a share once it ends or its sharer leaves", () => {
    const v = useVoice.getState();
    v.setRemote("u1", "screen", stream);
    v.setWatching("u1", true);
    useVoice.getState().setRemote("u1", "screen", null);
    expect(useVoice.getState().watching).toEqual({});
    expect(useVoice.getState().focused).toBeNull();

    useVoice.getState().setRemote("u2", "screen", stream);
    useVoice.getState().setWatching("u2", true);
    useVoice.getState().removePeer("u2");
    expect(useVoice.getState().watching).toEqual({});
    expect(useVoice.getState().focused).toBeNull();
  });

  it("keeps watching when only a camera changes", () => {
    const v = useVoice.getState();
    v.setRemote("u1", "screen", stream);
    v.setWatching("u1", true);
    useVoice.getState().setRemote("u1", "video", null);
    expect(useVoice.getState().watching).toEqual({ u1: true });
  });
});
