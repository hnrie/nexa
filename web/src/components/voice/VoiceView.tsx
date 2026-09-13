import {
  Eye,
  EyeOff,
  Headphones,
  HeadphoneOff,
  Maximize,
  Maximize2,
  Mic,
  MicOff,
  Minimize,
  Minimize2,
  MonitorUp,
  MonitorX,
  PhoneOff,
  PictureInPicture2,
  SwitchCamera,
  Video,
  VideoOff,
  VolumeX,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { Channel } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { Tooltip } from "@/components/common/Tooltip";
import { fitGrid } from "@/lib/callLayout";
import { memberName } from "@/lib/names";
import { useAuth } from "@/stores/auth";
import { memberColor, useServers } from "@/stores/servers";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { participantsOf, useVoice } from "@/stores/voice";
import { useVoiceLocal } from "@/stores/voiceLocal";
import { flipCamera, joinVoice, leaveVoice, setUserLocalMute, setUserVolume, toggleCamera, toggleScreen, voiceStats } from "@/voice/session";
import { hasSeveralCameras } from "@/voice/media";
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

/** Space between tiles, and around the stage. */
const GAP = 8;

const canFullscreen = typeof document !== "undefined" && !!document.fullscreenEnabled;
const canPip = typeof document !== "undefined" && "pictureInPictureEnabled" in document && !!(document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled;
const canShare = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";

function useBoxSize(ref: React.RefObject<HTMLElement | null>, active: boolean): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const measure = () => setSize((cur) => (cur.w === el.clientWidth && cur.h === el.clientHeight ? cur : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active]);
  return size;
}

function ControlButton({ label, onClick, children, on, off, danger, testId }: { label: string; onClick: () => void; children: ReactNode; on?: boolean; off?: boolean; danger?: boolean; testId?: string }) {
  return (
    <Tooltip text={label} side="top">
      <button className={[s.ctl, danger ? s.leave : ""].join(" ")} data-on={on || undefined} data-off={off || undefined} aria-label={label} aria-pressed={on || off ? true : undefined} onClick={onClick} data-testid={testId}>
        {children}
      </button>
    </Tooltip>
  );
}

/** The voice room: tiles laid out to fit, a focused stream, and the control bar. */
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
  const watching = useVoice((v) => v.watching);
  const setWatching = useVoice((v) => v.setWatching);
  const volumes = useVoice((v) => v.volumes);
  const localMutes = useVoice((v) => v.localMutes);
  const muted = useVoiceLocal((v) => v.muted);
  const deafened = useVoiceLocal((v) => v.deafened);
  const toggleMute = useVoiceLocal((v) => v.toggleMute);
  const toggleDeafen = useVoiceLocal((v) => v.toggleDeafen);
  const serverState = useServers((st) => (channel.server_id ? st.byId[channel.server_id] : undefined));
  const openContextMenu = useUI((u) => u.openContextMenu);
  const openModal = useUI((u) => u.openModal);
  const [canFlip, setCanFlip] = useState(false);
  const [quality, setQuality] = useState<{ rtt: number; loss: number } | null>(null);
  const [full, setFull] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLDivElement>());
  const connected = mine?.channel_id === channel.id;
  const participants = useMemo(() => participantsOf(byChannel, channel.id), [byChannel, channel.id]);

  useEffect(() => {
    void hasSeveralCameras().then(setCanFlip);
  }, [localVideo]);

  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => void voiceStats()?.then(setQuality), 3000);
    return () => clearInterval(t);
  }, [connected]);

  const tiles = useMemo<Tile[]>(() => {
    const out: Tile[] = [];
    // shares go first: they are what people are there to look at
    for (const p of participants) {
      const isMe = p.user_id === meId;
      const screen = isMe ? localScreen : (remote[p.user_id]?.screen ?? null);
      if (screen) out.push({ key: `${p.user_id}:screen`, userId: p.user_id, kind: "screen", stream: screen, me: isMe });
    }
    for (const p of participants) {
      const isMe = p.user_id === meId;
      const video = isMe ? localVideo : (remote[p.user_id]?.video ?? null);
      out.push({ key: `${p.user_id}:${video ? "video" : "avatar"}`, userId: p.user_id, kind: video ? "video" : "avatar", stream: video, me: isMe });
    }
    return out;
  }, [participants, remote, localVideo, localScreen, meId]);

  const focusedTile = focused ? tiles.find((t) => t.key === focused) : undefined;
  // a focused tile that has gone (a camera turned off, someone left) lets go of the layout
  useEffect(() => {
    if (focused && !focusedTile) setFocused(null);
  }, [focused, focusedTile, setFocused]);

  const grid = useBoxSize(gridRef, connected && !focusedTile);
  const layout = fitGrid(tiles.length, grid.w, grid.h, GAP);
  // the focused stream is a 16:9 frame as large as fits, so its label and buttons sit on the picture
  const focusBox = useBoxSize(focusRef, connected && !!focusedTile);
  const focusFit = fitGrid(1, focusBox.w, focusBox.h, 0);

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const nameOf = (uid: string) => memberName(serverState?.members[uid]?.nickname, users[uid], uid === meId ? "You" : "Unknown User");
  const isLive = (t: Tile) => t.kind === "screen" && !t.me;
  const showsStream = (t: Tile) => !!t.stream && (t.kind === "video" || t.me || !!watching[t.userId]);

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

  const tileMenu = (e: MouseEvent, t: Tile) => {
    e.preventDefault();
    const items: ContextMenuItem[] = [{ id: "profile", label: "Profile", onSelect: () => openModal("profile", { userId: t.userId }) }];
    if (t.kind === "screen" && t.me) items.push({ id: "stop-share", label: "Stop Sharing", onSelect: () => void toggleScreen() });
    if (isLive(t)) items.push({ id: "watch", label: watching[t.userId] ? "Stop Watching" : "Watch Stream", onSelect: () => setWatching(t.userId, !watching[t.userId]) });
    if (showsStream(t)) items.push({ id: "focus", label: focused === t.key ? "Unfocus" : "Focus", onSelect: () => setFocused(focused === t.key ? null : t.key) });
    if (!t.me) {
      const vol = volumes[t.userId] ?? 100;
      items[items.length - 1]!.separatorAfter = true;
      items.push(
        { id: "volume", label: "User Volume", slider: { value: vol, min: 0, max: 200, unit: "%", onChange: (v) => setUserVolume(t.userId, v) } },
        { id: "mute", label: localMutes[t.userId] ? "Unmute" : "Mute", onSelect: () => setUserLocalMute(t.userId, !localMutes[t.userId]) },
        { id: "reset", label: "Reset Volume", disabled: vol === 100, onSelect: () => setUserVolume(t.userId, 100) },
      );
    }
    openContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  const renderTile = (t: Tile, place: "grid" | "focus" | "strip") => {
    const vs = byChannel[channel.id]?.[t.userId];
    const isSpeaking = !!speaking[t.userId] && t.kind !== "screen";
    const color = serverState ? memberColor(serverState, t.userId) : undefined;
    const peerState = t.me ? "connected" : (peers[t.userId] ?? "new");
    const live = isLive(t);
    const playing = showsStream(t);
    const box = place === "grid" ? layout : place === "focus" ? focusFit : null;
    const size: CSSProperties | undefined = box && box.width > 0 ? { width: box.width, height: box.height } : undefined;
    const tileH = box?.height ?? 96;
    const avatarSize = place === "strip" ? 40 : Math.round(Math.max(40, Math.min(112, tileH * 0.36)));
    return (
      <div
        key={t.key}
        ref={(el) => {
          if (el) tileRefs.current.set(t.key, el);
          else tileRefs.current.delete(t.key);
        }}
        className={s.tile}
        style={size}
        data-kind={t.kind}
        data-place={place}
        data-speaking={isSpeaking}
        data-peer-state={peerState}
        data-user={t.userId}
        onContextMenu={(e) => tileMenu(e, t)}
        onClick={() => {
          if (place !== "focus" && playing) setFocused(t.key);
        }}
        onDoubleClick={() => playing && canFullscreen && fullscreenTile(t.key)}
      >
        {playing && t.stream ? (
          <StreamVideo stream={t.stream} mirror={t.me && t.kind === "video"} className={s.video} />
        ) : live ? (
          <div className={s.offer}>
            {place === "strip" || tileH < 150 ? null : <Avatar id={t.userId} avatarId={users[t.userId]?.avatar_id ?? null} name={nameOf(t.userId)} size={tileH < 220 ? 40 : 56} />}
            {place !== "strip" && tileH >= 190 ? <div className={s.offerText}>{nameOf(t.userId)} is sharing their screen</div> : null}
            <button
              className={s.watchBtn}
              data-testid="watch-stream"
              onClick={(e) => {
                e.stopPropagation();
                setWatching(t.userId, true);
              }}
            >
              <Eye size={16} /> {place === "strip" ? "Watch" : "Watch Stream"}
            </button>
          </div>
        ) : (
          <div className={s.avatarWrap}>
            <Avatar id={t.userId} avatarId={users[t.userId]?.avatar_id ?? null} name={nameOf(t.userId)} size={avatarSize} />
          </div>
        )}
        <div className={s.tileBar}>
          {t.kind === "screen" ? <span className={s.live}>LIVE</span> : null}
          <span className={s.tileName} style={color ? { color } : undefined}>
            {t.kind === "screen" ? (t.me ? "Your screen" : `${nameOf(t.userId)}'s screen`) : nameOf(t.userId)}
          </span>
          {t.kind !== "screen" && (vs?.self_mute || vs?.server_mute) ? <MicOff size={14} className={s.tileIcon} data-server={!!vs?.server_mute} /> : null}
          {t.kind !== "screen" && (vs?.self_deaf || vs?.server_deaf) ? <HeadphoneOff size={14} className={s.tileIcon} data-server={!!vs?.server_deaf} /> : null}
          {t.kind !== "screen" && localMutes[t.userId] ? <VolumeX size={14} className={s.tileIcon} /> : null}
          {!t.me && peerState !== "connected" && t.kind !== "screen" ? <span className={s.tileState}>{peerState === "failed" ? "reconnecting…" : "connecting…"}</span> : null}
        </div>
        {place !== "strip" && (playing || (t.me && t.kind === "screen")) ? (
          <div className={s.tileBtns} onClick={(e) => e.stopPropagation()}>
            {t.me && t.kind === "screen" ? (
              <button className={s.tileBtn} aria-label="Stop sharing" title="Stop sharing" onClick={() => void toggleScreen()}><MonitorX size={16} /></button>
            ) : null}
            {live && watching[t.userId] ? (
              <button className={s.tileBtn} aria-label="Stop watching" title="Stop watching" data-testid="stop-watching" onClick={() => setWatching(t.userId, false)}><EyeOff size={16} /></button>
            ) : null}
            {playing ? (
              <button className={s.tileBtn} aria-label={place === "focus" ? "Unfocus" : "Focus"} title={place === "focus" ? "Unfocus" : "Focus"} onClick={() => setFocused(place === "focus" ? null : t.key)}>
                {place === "focus" ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            ) : null}
            {playing && canPip && t.stream ? (
              <button className={s.tileBtn} aria-label="Picture in picture" title="Picture in picture" onClick={() => void pip(t.stream!)}><PictureInPicture2 size={16} /></button>
            ) : null}
            {playing && canFullscreen ? (
              <button className={s.tileBtn} aria-label="Full screen" title="Full screen" data-testid="tile-fullscreen" onClick={() => fullscreenTile(t.key)}><Maximize size={16} /></button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  if (!connected) {
    return (
      <div className={s.root} ref={rootRef} data-embedded={embedded}>
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
      </div>
    );
  }

  const level = quality ? (quality.loss > 0.05 || quality.rtt > 400 ? "bad" : quality.rtt > 150 ? "ok" : "good") : "unknown";
  return (
    <div className={s.root} ref={rootRef} data-embedded={embedded} data-full={full}>
      <div className={s.stage}>
        {participants.length > 10 ? <div className={s.stageNote}>Large rooms strain peer-to-peer calls.</div> : null}
        {focusedTile ? (
          <>
            <div className={s.focus} ref={focusRef}>{renderTile(focusedTile, "focus")}</div>
            {tiles.length > 1 ? <div className={s.strip}>{tiles.filter((t) => t.key !== focusedTile.key).map((t) => renderTile(t, "strip"))}</div> : null}
          </>
        ) : (
          <div className={s.grid} ref={gridRef}>
            {tiles.map((t) => renderTile(t, "grid"))}
          </div>
        )}
      </div>
      <div className={s.controls}>
        <div className={s.controlsSide}>
          <span className={s.quality} data-level={level} title={quality ? `${Math.round(quality.rtt)} ms · ${(quality.loss * 100).toFixed(1)}% loss` : "Measuring…"}>
            <i className={s.qualityDot} />
            {quality ? `${Math.round(quality.rtt)} ms` : "…"}
          </span>
        </div>
        <div className={s.controlsMain}>
          <ControlButton label={muted ? "Unmute" : "Mute"} off={muted} onClick={toggleMute} testId="voice-mute">{muted ? <MicOff size={22} /> : <Mic size={22} />}</ControlButton>
          <ControlButton label={deafened ? "Undeafen" : "Deafen"} off={deafened} onClick={toggleDeafen}>{deafened ? <HeadphoneOff size={22} /> : <Headphones size={22} />}</ControlButton>
          <ControlButton label={localVideo ? "Turn off camera" : "Turn on camera"} on={!!localVideo} onClick={() => void toggleCamera()}>{localVideo ? <Video size={22} /> : <VideoOff size={22} />}</ControlButton>
          {localVideo && canFlip ? (
            <ControlButton label="Switch camera" onClick={() => void flipCamera()} testId="flip-camera"><SwitchCamera size={22} /></ControlButton>
          ) : null}
          {canShare ? (
            <ControlButton label={localScreen ? "Stop sharing" : "Share your screen"} on={!!localScreen} onClick={() => void toggleScreen()} testId="screen-share">{localScreen ? <MonitorX size={22} /> : <MonitorUp size={22} />}</ControlButton>
          ) : null}
          <ControlButton label="Disconnect" danger onClick={() => void leaveVoice()} testId="voice-leave"><PhoneOff size={22} /></ControlButton>
        </div>
        <div className={[s.controlsSide, s.controlsEnd].join(" ")}>
          {canFullscreen ? (
            <Tooltip text={full ? "Exit full screen" : "Full screen"} side="top">
              <button className={s.sideBtn} aria-label={full ? "Exit full screen" : "Full screen"} onClick={() => toggleFull()}>{full ? <Minimize size={20} /> : <Maximize size={20} />}</button>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}
