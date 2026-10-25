/** Voice changers that play the sharer's own voice back must never be heard in a share. */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getAppMetrics: () => [] }, BrowserWindow: { getAllWindows: () => [] } }));

const { selfMonitoringApp } = await import("../src/main/appAudio");

describe("selfMonitoringApp", () => {
  it("knows the usual voice changers and mixers", () => {
    for (const p of [
      "C:\\Program Files\\Voicemod Desktop\\VoicemodDesktop.exe",
      "C:\\Program Files (x86)\\VB\\Voicemeeter\\voicemeeterpro.exe",
      "C:\\Program Files\\Clownfish Voice Changer\\ClownfishVoiceChanger.exe",
      "C:\\Program Files\\Screaming Bee\\MorphVOX Pro\\MorphVOXPro.exe",
      "C:\\Program Files\\NVIDIA Corporation\\NVIDIA Broadcast\\NVIDIA Broadcast.exe",
      "C:\\Program Files\\SteelSeries\\GG\\SteelSeriesGG.exe",
      "C:\\Users\\a\\AppData\\Local\\Voice.ai\\VoiceAI.exe",
      "net.voicemod.desktop",
      "com.rogueamoeba.Loopback",
      "com.rogueamoeba.audiohijack",
    ]) expect(selfMonitoringApp(p), p).toBe(true);
  });

  it("leaves other programs alone", () => {
    for (const p of ["C:\\Program Files\\Mozilla Firefox\\firefox.exe", "C:\\Games\\Voices of the Void\\VotV.exe", "com.spotify.client", "com.apple.Safari", null, ""]) {
      expect(selfMonitoringApp(p), String(p)).toBe(false);
    }
  });
});
