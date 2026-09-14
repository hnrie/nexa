import { useSettings } from "@/stores/settings";
import type { ContextMenuItem } from "@/stores/ui";
import { defaultDeviceLabel, listDevices, realDevices as real } from "@/voice/media";

type OpenModal = (kind: string, props?: Record<string, unknown>) => void;

/** Whether this browser can send call audio to a chosen speaker. */
function canPickOutput(): boolean {
  return typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
}

/** A device's name; a browser hides them until a device of the kind has been allowed once. */
function nameOf(d: MediaDeviceInfo, i: number, kind: string): string {
  if (d.label) return d.label;
  return `${kind} ${i + 1}`;
}

/**
 * The menu under the mute button: which microphone the call uses and, where
 * the browser can route it, which speakers it plays through. A choice takes
 * effect at once, in a call too, and is the same one the voice settings show.
 */
export async function micMenuItems(openModal: OpenModal): Promise<ContextMenuItem[]> {
  const devices = await listDevices().catch(() => ({ inputs: [], outputs: [], cameras: [] }));
  const store = useSettings.getState();
  const v = store.settings.voice;
  const set = (patch: Partial<typeof v>) => store.patch({ voice: { ...useSettings.getState().settings.voice, ...patch } });
  const items: ContextMenuItem[] = [{ id: "input-heading", label: "Input Device", heading: true }];
  items.push({ id: "input-default", label: defaultDeviceLabel(devices.inputs), checked: !v.inputDeviceId, onSelect: () => set({ inputDeviceId: null, inputDeviceLabel: null }) });
  real(devices.inputs).forEach((d, i) => {
    items.push({ id: `input-${d.deviceId}`, label: nameOf(d, i, "Microphone"), checked: v.inputDeviceId === d.deviceId, onSelect: () => set({ inputDeviceId: d.deviceId, inputDeviceLabel: d.label || null }) });
  });
  const outputs = real(devices.outputs);
  if (canPickOutput() && outputs.length > 0) {
    items[items.length - 1]!.separatorAfter = true;
    items.push({ id: "output-heading", label: "Output Device", heading: true });
    items.push({ id: "output-default", label: defaultDeviceLabel(devices.outputs), checked: !v.outputDeviceId, onSelect: () => set({ outputDeviceId: null, outputDeviceLabel: null }) });
    outputs.forEach((d, i) => {
      items.push({ id: `output-${d.deviceId}`, label: nameOf(d, i, "Speakers"), checked: v.outputDeviceId === d.deviceId, onSelect: () => set({ outputDeviceId: d.deviceId, outputDeviceLabel: d.label || null }) });
    });
  }
  items[items.length - 1]!.separatorAfter = true;
  items.push({ id: "voice-settings", label: "Voice Settings", onSelect: () => openModal("settings", { page: "voice" }) });
  return items;
}

/** The menu under the camera button: which camera to use, switched live when it is on. */
export async function cameraMenuItems(openModal: OpenModal): Promise<ContextMenuItem[]> {
  const devices = await listDevices().catch(() => ({ inputs: [], outputs: [], cameras: [] }));
  const store = useSettings.getState();
  const v = store.settings.voice;
  const set = (patch: Partial<typeof v>) => store.patch({ voice: { ...useSettings.getState().settings.voice, ...patch } });
  const cameras = real(devices.cameras);
  const items: ContextMenuItem[] = [{ id: "camera-heading", label: "Camera", heading: true }];
  if (cameras.length === 0) {
    items.push({ id: "camera-none", label: "No camera found", disabled: true });
  } else {
    items.push({ id: "camera-default", label: defaultDeviceLabel(devices.cameras), checked: !v.cameraDeviceId, onSelect: () => set({ cameraDeviceId: null, cameraDeviceLabel: null }) });
    cameras.forEach((d, i) => {
      items.push({ id: `camera-${d.deviceId}`, label: nameOf(d, i, "Camera"), checked: v.cameraDeviceId === d.deviceId, onSelect: () => set({ cameraDeviceId: d.deviceId, cameraDeviceLabel: d.label || null }) });
    });
  }
  items[items.length - 1]!.separatorAfter = true;
  items.push({ id: "video-settings", label: "Video Settings", onSelect: () => openModal("settings", { page: "voice" }) });
  return items;
}
