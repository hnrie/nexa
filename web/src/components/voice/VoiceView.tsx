import { Expand, Headphones, HeadphoneOff, Maximize2, Mic, MicOff, Minimize2, MonitorUp, MonitorX, PhoneOff, PictureInPicture2, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { Channel } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Tooltip } from "@/components/common/Tooltip";
import { memberName } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { memberColor, useServers } from "@/stores/servers";
import { useUI } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { participantsOf, useVoice } from "@/stores/voice";
import { useVoiceLocal } from "@/stores/voiceLocal";
import { joinVoice, leaveVoice, setUserLocalMute, setUserVolume, toggleCamera, toggleScreen, voiceStats } from "@/voice/session";
import s from "./Voice.module.css";

/** A video element bound to a MediaStream. */
export function StreamVideo({ stream, muted = true, mirror = false, className, onDoubleClick }: { stream: MediaStream; muted?: boolean; mirror?: boolean; className?: string; onDoubleClick?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} data-mirror={mirror} onDoubleClick={onDoubleClick} />;
}

type Tile = { key: string; userId: string; kind: "avatar" | "video" | "screen"; stream: MediaStream | null; me: boolean };

/** The voice room: tiles, a focused stream, and the control bar. */
export function VoiceView({ channel, embedded = false }: { channel: Channel; embedded?: boolean }) {
  const meId = useAuth((a) => a.me?.id);
  const users = useUsers((u) => u.byId);
  const byChannel = useVoice((v) => v.byChannel);
  const mine = useVoice((v) => v.mine);
  const joining = useVoice((v) => v.joining);
  const remote = useVoice((v) => v.remote);
  const localVideo = useVoice((v) => v.localVideo);
  const localScreen = useVoice((v) => v.localScreen);
  const speaking = useVoice((v) => v.speaking);
  const peers = useVoice((v) => v.peers);
  const focused = useVoice((v) => v.focused);
  const setFocused = useVoice((v) => v.setFocused);
  const volumes = useVoice((v) => v.volumes);
  const localMutes = useVoice((v) => v.localMutes);
  const muted = useVoiceLocal((v) => v.muted);
  const deafened = useVoiceLocal((v) => v.deafened);
  const toggleMute = useVoiceLocal((v) => v.toggleMute);
  const toggleDeafen = useVoiceLocal((v) => v.toggleDeafen);
  const serverState = useServers((st) => (channel.server_id ? st.byId[channel.server_id] : undefined));
  const openContextMenu = useUI((u) => u.openContextMenu);
  const openModal = useUI((u) => u.openModal);
  const [quality, setQuality] = useState<{ rtt: number; loss: number } | null>(null);
  const [full, setFull] = useState(false);
  const [volumeFor, setVolumeFor] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLDivElement>());
  const connected = mine?.channel_id === channel.id;
  const participants = useMemo(() => participantsOf(byChannel, channel.id), [byChannel, channel.id]);

  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => void voiceStats()?.then(setQuality), 3000);
    return () => clearInterval(t);
  }, [connected]);

  const tiles = useMemo<Tile[]>(() => {
    const out: Tile[] = [];
    for (const p of participants) {
      const isMe = p.user_id === meId;
      const media = remote[p.user_id];
      const video = isMe ? localVideo : (media?.video ?? null);
      const screen = isMe ? localScreen : (media?.screen ?? null);
      if (screen) out.push({ key: `${p.user_id}:screen`, userId: p.user_id, kind: "screen", stream: screen, me: isMe });
      out.push({ key: `${p.user_id}:${video ? "video" : "avatar"}`, userId: p.user_id, kind: video ? "video" : "avatar", stream: video, me: isMe });
    }
    return out;
  }, [participants, remote, localVideo, localScreen, meId]);

  const focusedTile = focused ? tiles.find((t) => t.key === focused) : undefined;
  const nameOf = (uid: string) => memberName(serverState?.members[uid]?.nickname, users[uid], uid === meId ? "You" : "Unknown User");

  const tileMenu = (e: MouseEvent, t: Tile) => {
    e.preventDefault();
    if (t.me) return;
    const vol = volumes[t.userId] ?? 100;
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: "profile", label: "Profile", onSelect: () => openModal("profile", { userId: t.userId }) },
        { id: "focus", label: focused === t.key ? "Unfocus" : "Focus", onSelect: () => setFocused(focused === t.key ? null : t.key), separatorAfter: true },
        { id: "mute", label: localMutes[t.userId] ? "Unmute for me" : "Mute for me", onSelect: () => setUserLocalMute(t.userId, !localMutes[t.userId]) },
        { id: "vol", label: `Volume — ${vol}%`, onSelect: () => setVolumeFor(t.userId) },
        { id: "vol=", label: "Reset volume", onSelect: () => setUserVolume(t.userId, 100) },
      ],
    });
  };

  const pip = async (stream: MediaStream) => {
    const el = document.createElement("video");
    el.srcObject = stream;
    el.muted = true;
    await el.play().catch(() => {});
    try {
      await el.requestPictureInPicture();
    } catch {
      /* not supported */
    }
  };

  const toggleFull = (el?: HTMLElement | null) => {
    const target = el ?? rootRef.current;
    if (!target) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void target.requestFullscreen?.();
  };
  /** Full-screens one stream, focusing it first so it fills the frame. */
  const fullscreenTile = (key: string) => {
    setFocused(key);
    requestAnimationFrame(() => toggleFull(tileRefs.current.get(key) ?? rootRef.current));
  };
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const renderTile = (t: Tile, big = false) => {
    const vs = byChannel[channel.id]?.[t.userId];
    const isSpeaking = !!speaking[t.userId] && t.kind !== "screen";
    const color = serverState ? memberColor(serverState, t.userId) : undefined;
    const peerState = t.me ? "connected" : (peers[t.userId] ?? "new");
    return (
      <div
        key={t.key}
        ref={(el) => {
          if (el) tileRefs.current.set(t.key, el);
          else tileRefs.current.delete(t.key);
        }}
        className={s.tile}
        data-kind={t.kind}
        data-speaking={isSpeaking}
        data-big={big}
        data-peer-state={peerState}
        data-user={t.userId}
        onContextMenu={(e) => tileMenu(e, t)}
        onClick={() => !big && t.kind !== "avatar" && setFocused(t.key)}
      >
        {t.stream && t.kind !== "avatar" ? (
          <StreamVideo stream={t.stream} mirror={t.me && t.kind === "video"} className={s.video} onDoubleClick={() => setFocused(focused === t.key ? null : t.key)} />
        ) : (
          <div className={s.avatarWrap}>
            <Avatar id={t.userId} avatarId={users[t.userId]?.avatar_id ?? null} name={nameOf(t.userId)} size={big ? 120 : 80} />
          </div>
        )}
        <div className={s.tileBar}>
          <span className={s.tileName} style={color ? { color } : undefined}>{nameOf(t.userId)}{t.kind === "screen" ? "'s screen" : ""}</span>
          {vs?.self_mute || vs?.server_mute ? <MicOff size={14} className={s.tileIcon} data-server={!!vs?.server_mute} /> : null}
          {vs?.self_deaf || vs?.server_deaf ? <HeadphoneOff size={14} className={s.tileIcon} data-server={!!vs?.server_deaf} /> : null}
          {localMutes[t.userId] ? <VolumeX size={14} className={s.tileIcon} /> : null}
          {!t.me && peerState !== "connected" && t.kind !== "screen" ? <span className={s.tileState}>{peerState === "failed" ? "reconnecting…" : "connecting…"}</span> : null}
        </div>
        {t.kind !== "avatar" && t.stream ? (
          <span className={s.tileBtns}>
            <button className={s.tileBtn} aria-label="Full screen" title="Full screen" data-testid="tile-fullscreen" onClick={(e) => { e.stopPropagation(); fullscreenTile(t.key); }}><Expand size={16} /></button>
            <button className={s.tileBtn} aria-label="Picture in picture" title="Picture in picture" onClick={(e) => { e.stopPropagation(); void pip(t.stream!); }}><PictureInPicture2 size={16} /></button>
          </span>
        ) : null}
        {volumeFor === t.userId && !t.me ? (
          <div className={s.volumePop} onClick={(e) => e.stopPropagation()}>
            <Volume2 size={14} />
            <input
              className={s.volumeRange}
              type="range"
              min={0}
              max={200}
              step={1}
              value={volumes[t.userId] ?? 100}
              aria-label={`Volume for ${nameOf(t.userId)}`}
              onChange={(e) => setUserVolume(t.userId, Number(e.target.value))}
            />
            <input
              className={s.volumeNum}
              type="number"
              min={0}
              max={200}
              value={volumes[t.userId] ?? 100}
              aria-label="Volume percent"
              onChange={(e) => setUserVolume(t.userId, Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
            />
            <button className={s.tileBtn} aria-label="Close volume" onClick={() => setVolumeFor(null)}>✕</button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={s.root} ref={rootRef} data-embedded={embedded} data-full={full}>
      {!connected ? (
        <div className={s.lobby}>
          <div className={s.lobbyTitle}>{channel.type === "voice" ? channel.name : "Voice call"}</div>
          <div className={s.lobbySub}>{participants.length === 0 ? "No one is here yet." : `${participants.length} in voice`}</div>
          <div className={s.lobbyAvatars}>
            {participants.slice(0, 8).map((p) => (
              <Avatar key={p.user_id} id={p.user_id} avatarId={users[p.user_id]?.avatar_id ?? null} name={nameOf(p.user_id)} size={40} />
            ))}
          </div>
          <button className={s.joinBtn} onClick={() => void joinVoice(channel.id)} disabled={joining === channel.id} data-testid="join-voice">
            {joining === channel.id ? "Connecting…" : channel.type === "voice" ? "Join Voice" : "Join Call"}
          </button>
        </div>
      ) : (
        <>
          <div className={s.stage} data-focused={!!focusedTile}>
            {focusedTile ? (
              <>
                <div className={s.focus}>{renderTile(focusedTile, true)}</div>
                <div className={s.strip}>{tiles.filter((t) => t.key !== focusedTile.key).map((t) => renderTile(t))}</div>
              </>
            ) : (
              <div className={s.grid} data-count={Math.min(tiles.length, 9)}>{tiles.map((t) => renderTile(t))}</div>
            )}
          </div>
          <div className={s.controls}>
            <span className={s.quality} data-level={quality ? (quality.loss > 0.05 || quality.rtt > 400 ? "bad" : quality.rtt > 150 ? "ok" : "good") : "unknown"} title={quality ? `${Math.round(quality.rtt)} ms · ${(quality.loss * 100).toFixed(1)}% loss` : "Measuring…"}>
              {quality ? `${Math.round(quality.rtt)} ms` : "…"}
            </span>
            <Tooltip text={muted ? "Unmute" : "Mute"} side="top">
              <button className={s.ctl} data-off={muted} aria-label={muted ? "Unmute" : "Mute"} onClick={toggleMute} data-testid="voice-mute">{muted ? <MicOff size={22} /> : <Mic size={22} />}</button>
            </Tooltip>
            <Tooltip text={deafened ? "Undeafen" : "Deafen"} side="top">
              <button className={s.ctl} data-off={deafened} aria-label={deafened ? "Undeafen" : "Deafen"} onClick={toggleDeafen}>{deafened ? <HeadphoneOff size={22} /> : <Headphones size={22} />}</button>
            </Tooltip>
            <Tooltip text={localVideo ? "Turn off camera" : "Turn on camera"} side="top">
              <button className={s.ctl} data-on={!!localVideo} aria-label="Camera" onClick={() => void toggleCamera()}>{localVideo ? <Video size={22} /> : <VideoOff size={22} />}</button>
            </Tooltip>
            <Tooltip text={localScreen ? "Stop sharing" : "Share your screen"} side="top">
              <button className={s.ctl} data-on={!!localScreen} aria-label="Share screen" onClick={() => void toggleScreen()}>{localScreen ? <MonitorX size={22} /> : <MonitorUp size={22} />}</button>
            </Tooltip>
            <Tooltip text={full ? "Exit full screen" : "Full screen"} side="top">
              <button className={s.ctl} aria-label="Full screen" onClick={() => toggleFull()}>{full ? <Minimize2 size={22} /> : <Maximize2 size={22} />}</button>
            </Tooltip>
            <Tooltip text="Disconnect" side="top">
              <button className={[s.ctl, s.leave].join(" ")} aria-label="Disconnect" onClick={() => void leaveVoice()} data-testid="voice-leave"><PhoneOff size={22} /></button>
            </Tooltip>
            {deafened ? <span className={s.note}><VolumeX size={14} /> Deafened</span> : null}
            {participants.length > 10 ? <span className={s.note}><Volume2 size={14} /> Large rooms strain peer-to-peer calls.</span> : null}
          </div>
        </>
      )}
    </div>
  );
}
