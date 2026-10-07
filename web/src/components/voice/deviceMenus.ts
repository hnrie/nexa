import { useSettings, type VoiceSettings } from "@/stores/settings";
import { button, defineMenu, type MenuPlacement } from "@/lib/contextMenus/registry";
import { defaultDeviceLabel, listDevices, realDevices as real } from "@/voice/media";
import { noiseMenuItems } from "@/voice/noiseMode";
import { canChooseOutput } from "@/voice/output";

import { t } from "@/i18n";
type OpenModal = (kind: string, props?: Record<string, unknown>) => void;

/** A device's own name, or "Microphone 2" when the browser will not say it (it hides them until a device of the kind was allowed once). */
function nameOf(d: MediaDeviceInfo, i: number, kind: "microphone" | "speakers" | "camera"): string {
  if (d.label) return d.label;
  const key = kind === "microphone" ? "voice.devices.microphoneN" : kind === "speakers" ? "voice.devices.speakersN" : "voice.devices.cameraN";
  return t(key, { n: i + 1 });
}

type Devices = Awaited<ReturnType<typeof listDevices>>;

interface DeviceMenuCtx {
  devices: Devices;
  openModal: OpenModal;
  /** Whether to offer the settings page (a guest has none). */
  settings: boolean;
}

function setVoice(patch: Partial<VoiceSettings>): void {
  const store = useSettings.getState();
  store.patch({ voice: { ...store.settings.voice, ...patch } });
}

const voice = () => useSettings.getState().settings.voice;

/**
 * The menu under the mute button: which microphone the call uses and, where
 * the browser can route it, which speakers it plays through, and how noise is
 * taken out of the microphone. A choice takes effect at once, in a call too,
 * and is the same one the voice settings show.
 */
export const micMenu = defineMenu<DeviceMenuCtx>("microphone", [
  [button("microphoneDevices", ({ devices }) => {
    const v = voice();
    return [
      { id: "input-heading", label: t("voice.deviceMenus.inputDevice"), heading: true },
      { id: "input-default", label: defaultDeviceLabel(devices.inputs), checked: !v.inputDeviceId, onSelect: () => setVoice({ inputDeviceId: null, inputDeviceLabel: null }) },
      ...real(devices.inputs).map((d, i) => ({ id: `input-${d.deviceId}`, label: nameOf(d, i, "microphone"), checked: v.inputDeviceId === d.deviceId, onSelect: () => setVoice({ inputDeviceId: d.deviceId, inputDeviceLabel: d.label || null }) })),
    ];
  })],
  [button("speakerDevices", ({ devices }) => {
    const outputs = real(devices.outputs);
    if (!canChooseOutput() || outputs.length === 0) return null;
    const v = voice();
    return [
      { id: "output-heading", label: t("voice.deviceMenus.outputDevice"), heading: true },
      { id: "output-default", label: defaultDeviceLabel(devices.outputs), checked: !v.outputDeviceId, onSelect: () => setVoice({ outputDeviceId: null, outputDeviceLabel: null }) },
      ...outputs.map((d, i) => ({ id: `output-${d.deviceId}`, label: nameOf(d, i, "speakers"), checked: v.outputDeviceId === d.deviceId, onSelect: () => setVoice({ outputDeviceId: d.deviceId, outputDeviceLabel: d.label || null }) })),
    ];
  })],
  [button("microphoneNoiseModes", () => noiseMenuItems())],
  [button("voiceSettings", ({ settings, openModal }) => settings && { id: "voice-settings", label: t("voice.deviceMenus.voiceSettings"), onSelect: () => openModal("settings", { page: "voice" }) })],
]);

/** The menu under the camera button: which camera to use, switched live when it is on. */
export const cameraMenu = defineMenu<DeviceMenuCtx>("camera", [
  [button("cameraDevices", ({ devices }) => {
    const v = voice();
    const cameras = real(devices.cameras);
    return [
      { id: "camera-heading", label: t("settings.voice.camera"), heading: true },
      ...(cameras.length === 0
        ? [{ id: "camera-none", label: t("voice.deviceMenus.noCameraFound"), disabled: true }]
        : [
            { id: "camera-default", label: defaultDeviceLabel(devices.cameras), checked: !v.cameraDeviceId, onSelect: () => setVoice({ cameraDeviceId: null, cameraDeviceLabel: null }) },
            ...cameras.map((d, i) => ({ id: `camera-${d.deviceId}`, label: nameOf(d, i, "camera"), checked: v.cameraDeviceId === d.deviceId, onSelect: () => setVoice({ cameraDeviceId: d.deviceId, cameraDeviceLabel: d.label || null }) })),
          ]),
    ];
  })],
  [button("videoSettings", ({ settings, openModal }) => settings && { id: "video-settings", label: t("voice.deviceMenus.videoSettings"), onSelect: () => openModal("settings", { page: "voice" }) })],
]);

/** Opens the microphone or camera menu once the devices are listed. */
export async function openDeviceMenu(kind: "mic" | "camera", openModal: OpenModal, at: MenuPlacement, opts: { settings?: boolean } = {}): Promise<void> {
  const devices = await listDevices().catch((): Devices => ({ inputs: [], outputs: [], cameras: [] }));
  (kind === "mic" ? micMenu : cameraMenu).open({ devices, openModal, settings: opts.settings !== false }, at);
}

/** Noise suppression's own menu, beside hanging up: Enhanced (RNNoise), Standard or Off. */
export const noiseMenu = defineMenu<null>("noiseMode", [[button("noiseModes", () => noiseMenuItems())]]);
