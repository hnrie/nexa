/**
 * The three ways a call can take noise out of the microphone, as the settings
 * page, the microphone's menu in a call and the Voice Connected panel offer
 * them. Choosing one takes effect at once, in a call too (session.ts swaps
 * the microphone).
 */
import { t } from "@/i18n";
import { NOISE_MODES, useSettings, type NoiseMode, type VoiceSettings } from "@/stores/settings";
import type { ContextMenuItem } from "@/stores/ui";

/** The settings for a mode: the mode, and the switch older copies of the app read kept in step with it. */
export function noiseModePatch(mode: NoiseMode): Pick<VoiceSettings, "noiseMode" | "noiseSuppression"> {
  return { noiseMode: mode, noiseSuppression: mode !== "off" };
}

export function setNoiseMode(mode: NoiseMode): void {
  const st = useSettings.getState();
  if (st.settings.voice.noiseMode === mode) return;
  st.patch({ voice: { ...st.settings.voice, ...noiseModePatch(mode) } });
}

/** "Enhanced (RNNoise)", "Standard", "Off". */
export function noiseModeLabel(mode: NoiseMode): string {
  return mode === "enhanced" ? t("voice.noise.enhanced") : mode === "standard" ? t("voice.noise.standard") : t("voice.noise.off");
}

/** What each mode does, in a sentence. */
export function noiseModeHint(mode: NoiseMode): string {
  return mode === "enhanced" ? t("voice.noise.enhancedHint") : mode === "standard" ? t("voice.noise.standardHint") : t("voice.noise.offHint");
}

/** The three modes as menu items, under a heading, the one in use checked. */
export function noiseMenuItems(): ContextMenuItem[] {
  const mode = useSettings.getState().settings.voice.noiseMode;
  return [
    { id: "noise-heading", label: t("voice.noise.title"), heading: true },
    ...NOISE_MODES.map((m) => ({ id: `noise-${m}`, label: noiseModeLabel(m), checked: mode === m, onSelect: () => setNoiseMode(m) })),
  ];
}
