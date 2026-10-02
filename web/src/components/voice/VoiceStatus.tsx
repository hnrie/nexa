import { AudioLines, AudioWaveform, MonitorUp, PhoneOutgoing, Signal, Video } from "lucide-react";
import type { MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { menuAnchor } from "@/components/common/ContextMenu";
import { Tooltip } from "@/components/common/Tooltip";
import { channelDisplayName } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import { useVoice } from "@/stores/voice";
import { canShareScreen } from "@/voice/media";
import { noiseMenuItems, noiseModeLabel } from "@/voice/noiseMode";
import { leaveVoice, toggleCamera, toggleScreen } from "@/voice/session";
import { HangUp } from "./HangUp";
import s from "./Voice.module.css";
import { cameraMenuItems } from "./deviceMenus";

import { t } from "@/i18n";
/** The "Voice Connected" block that sits above the user panel while in a call. */
export function VoiceStatus() {
  const nav = useNavigate();
  const mine = useVoice((v) => v.mine);
  const joining = useVoice((v) => v.joining);
  const localVideo = useVoice((v) => v.localVideo);
  const localScreen = useVoice((v) => v.localScreen);
  const channelId = mine?.channel_id ?? joining;
  const channel = useChannels((c) => (channelId ? c.byId[channelId] : undefined));
  const server = useServers((st) => (channel?.server_id ? st.byId[channel.server_id] : undefined));
  const users = useUsers((u) => u.byId);
  const meId = useAuth((a) => a.me?.id);
  // measured by the call itself, so switching sidebars (which remounts this) keeps the colour it had
  const quality = useVoice((v) => v.quality);
  const connection = useVoice((v) => v.connection);
  const calling = useVoice((v) => !!v.calling && v.calling === v.mine?.channel_id);
  const openModal = useUI((u) => u.openModal);

  if (!channelId) return null;
  const name = channel ? channelDisplayName(channel, users, meId) : "…";
  const where = server ? `${channel?.name} / ${server.server.name}` : name;
  const reconnecting = !!mine && connection === "reconnecting";
  const level = !mine || calling ? "unknown" : reconnecting ? "bad" : quality ? (quality.loss > 0.05 || quality.rtt > 400 ? "bad" : quality.rtt > 150 ? "ok" : "good") : "unknown";
  // Ringing someone, or a connection that dropped, is not "connected": the
  // panel said so, green, while nobody had picked up or nothing got through.
  const calledId = channel?.type === "dm" ? channel.recipient_ids.find((id) => id !== meId) : undefined;
  const head = !mine
    ? t("voice.voice.connecting")
    : calling
      ? calledId
        ? t("voice.call.callingName", { name: displayName(users[calledId]) })
        : t("voice.call.callingGroup")
      : reconnecting
        ? t("voice.voice.reconnecting")
        : connection === "connecting"
          ? t("voice.voice.connecting")
          : t("voice.voiceStatus.voiceConnected");
  const go = () => {
    if (!channel) return;
    nav(channel.server_id ? `/channels/${channel.server_id}/${channel.id}` : `/channels/@me/${channel.id}`);
  };
  return (
    <div className={s.status} data-testid="voice-status">
      <div className={s.statusRow}>
        <div className={s.statusText}>
          <span className={s.statusHead} data-level={level} data-connecting={!mine || calling || connection === "connecting"} data-testid="voice-status-head">
            {calling ? <PhoneOutgoing size={14} /> : <Signal size={14} />} {head}
          </span>
          <span className={s.statusSub} onClick={go} title={where}>{where}</span>
        </div>
        <NoiseButton />
        <Tooltip text={t("voice.voiceStatus.disconnect")} side="top">
          <button className={s.statusBtn} aria-label={t("voice.voiceStatus.disconnect")} onClick={() => void leaveVoice()} data-testid="voice-status-leave"><HangUp size={18} /></button>
        </Tooltip>
      </div>
      <div className={s.statusBtns}>
        <button
          className={s.statusWide}
          data-on={!!localVideo}
          onClick={() => void toggleCamera()}
          disabled={!mine}
          onContextMenu={(e) => {
            // a right click chooses the camera
            e.preventDefault();
            const at = { x: e.clientX, y: e.clientY };
            void cameraMenuItems(openModal).then((items) => useUI.getState().openContextMenu({ ...at, above: true, items }));
          }}
        >
          <Video size={16} /> {localVideo ? t("voice.voiceStatus.cameraOn") : t("settings.voice.camera")}
        </button>
        {/* phone browsers cannot share a screen, so the camera gets the row */}
        {canShareScreen ? <button className={s.statusWide} data-on={!!localScreen} onClick={() => (localScreen ? void toggleScreen() : openModal("shareScreen"))} disabled={!mine}><MonitorUp size={16} /> {localScreen ? t("voice.voiceStatus.sharing") : t("desktop.displayPicker.share")}</button> : null}
      </div>
    </div>
  );
}

/**
 * Noise suppression, beside hanging up: which of Enhanced (RNNoise), Standard
 * and Off the call uses, chosen from a menu and switched at once.
 */
function NoiseButton() {
  const mode = useSettings((x) => x.settings.voice.noiseMode);
  const label = t("voice.noise.button", { mode: noiseModeLabel(mode) });
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    useUI.getState().openContextMenu({ x: r.left, y: r.top, above: true, anchor: menuAnchor(e.currentTarget), label: t("voice.noise.title"), items: noiseMenuItems() });
  };
  return (
    <Tooltip text={label} side="top">
      <button className={s.statusBtn} data-noise={mode} aria-label={label} aria-haspopup="menu" onClick={open} data-testid="noise-mode">
        {mode === "standard" ? <AudioLines size={18} /> : <AudioWaveform size={18} />}
      </button>
    </Tooltip>
  );
}
