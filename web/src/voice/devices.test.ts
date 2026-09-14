import { defaultDeviceLabel, defaultDeviceName, realDevices } from "./media";

const dev = (deviceId: string, label: string) => ({ deviceId, label, kind: "audioinput", groupId: "", toJSON: () => ({}) }) as MediaDeviceInfo;

describe("default device names", () => {
  it("reads Chromium's default alias", () => {
    const list = [dev("default", "Default - MacBook Pro Microphone (Built-in)"), dev("communications", "Communications - Headset"), dev("abc", "MacBook Pro Microphone (Built-in)")];
    expect(defaultDeviceName(list)).toBe("MacBook Pro Microphone (Built-in)");
    expect(defaultDeviceLabel(list)).toBe("Default (MacBook Pro Microphone (Built-in))");
    expect(realDevices(list).map((d) => d.deviceId)).toEqual(["abc"]);
  });

  it("takes the first device where the browser lists the default first", () => {
    expect(defaultDeviceLabel([dev("x1", "USB Mic"), dev("x2", "Webcam Mic")])).toBe("Default (USB Mic)");
  });

  it("says just Default while names are hidden", () => {
    expect(defaultDeviceLabel([dev("default", ""), dev("x1", "")])).toBe("Default");
    expect(defaultDeviceLabel([])).toBe("Default");
  });
});
