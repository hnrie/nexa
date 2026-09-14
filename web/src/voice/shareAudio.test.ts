import { echoesOwnAudio } from "./media";

describe("echoesOwnAudio", () => {
  it("catches system sound that still has the call in it", () => {
    expect(echoesOwnAudio({ deviceId: "loopback", restrictOwnAudio: false })).toBe(true);
    expect(echoesOwnAudio({ deviceId: "loopback" })).toBe(true);
    expect(echoesOwnAudio({ deviceId: "loopbackWithMute" })).toBe(true);
  });

  it("lets through system sound that leaves this app out, and any other sound", () => {
    expect(echoesOwnAudio({ deviceId: "loopbackWithoutChrome" })).toBe(false);
    expect(echoesOwnAudio({ deviceId: "loopback", restrictOwnAudio: true })).toBe(false);
    // a browser tab's own sound, or no device named at all
    expect(echoesOwnAudio({ deviceId: "web-contents-media-stream://1:2" })).toBe(false);
    expect(echoesOwnAudio({})).toBe(false);
  });
});
