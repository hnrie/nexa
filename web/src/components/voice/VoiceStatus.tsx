import { MonitorUp, Signal, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Tooltip } from "@/components/common/Tooltip";
import { channelDisplayName } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { useVoice } from "@/stores/voice";
import { canShareScreen } from "@/voice/media";
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
  const openModal = useUI((u) => u.openModal);

  if (!channelId) return null;
  const name = channel ? channelDisplayName(channel, users, meId) : "…";
  const where = server ? `${channel?.name} / ${server.server.name}` : name;
  const level = !mine ? "unknown" : quality ? (quality.loss > 0.05 || quality.rtt > 400 ? "bad" : quality.rtt > 150 ? "ok" : "good") : "unknown";
  const go = () => {
    if (!channel) return;
    nav(channel.server_id ? `/channels/${channel.server_id}/${channel.id}` : `/channels/@me/${channel.id}`);
  };
  return (
    <div className={s.status} data-testid="voice-status">
      <div className={s.statusRow}>
        <div className={s.statusText}>
          <span className={s.statusHead} data-level={level} data-connecting={!mine}>
            <Signal size={14} /> {mine ? "Voice Connected" : "Connecting…"}
          </span>
          <span className={s.statusSub} onClick={go} title={where}>{where}</span>
        </div>
        <Tooltip text="Disconnect" side="top">
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
          <Video size={16} /> {localVideo ? "Camera on" : "Camera"}
        </button>
        {/* phone browsers cannot share a screen, so the camera gets the row */}
        {canShareScreen ? <button className={s.statusWide} data-on={!!localScreen} onClick={() => (localScreen ? void toggleScreen() : openModal("shareScreen"))} disabled={!mine}><MonitorUp size={16} /> {localScreen ? "Sharing" : "Share"}</button> : null}
      </div>
    </div>
  );
}
