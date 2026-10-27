import { PersonName } from "@/components/common/PersonName";
import {
  ChevronUp,
  Eye,
  EyeOff,
  Headphones,
  HeadphoneOff,
  Link2,
  Maximize,
  Maximize2,
  Mic,
  MicOff,
  Minimize,
  Minimize2,
  MonitorUp,
  MonitorX,
  PictureInPicture2,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Megaphone,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { guests as guestsApi } from "@/api/guests";
import type { Channel } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { UserTag } from "@/components/servertag/UserTag";
import { openDeviceMenu as openDeviceMenuAt } from "./deviceMenus";
import { callTileMenu } from "./callMenus";
import { CallTimer } from "./CallTimer";
import { HangUp } from "./HangUp";
import { Tooltip } from "@/components/common/Tooltip";
import { useIsMobile, useMediaQuery } from "@/hooks/useIsMobile";
import { useWakeLock } from "@/hooks/useWakeLock";
import { fitGrid } from "@/lib/callLayout";
import { isGuest } from "@/lib/guestLink";
import { P } from "@/lib/perms";
import { CALL_PANEL_DEFAULT, CALL_PANEL_KEY, clampCallPanel, readCallPanel } from "@/lib/callPanel";
import { callFullscreenWay, enterElementFullscreen, enterVideoFullscreen, exitElementFullscreen, fullscreenElement, lockLandscape, onFullscreenChange, streamFullscreenWay, unlockOrientation } from "@/lib/fullscreen";
import { memberName } from "@/lib/names";
import { bindText, keybindsOf } from "@/lib/keybinds";
import { storage } from "@/lib/storage";
import { containedSize, pinchView, type Size, type View } from "@/lib/zoomPan";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { canI, useServers } from "@/stores/servers";
import { useSettings } from "@/stores/settings";
import { useUI } from "@/stores/ui";
import { displayName, useUsers } from "@/stores/users";
import { participantsOf, useVoice } from "@/stores/voice";
import { useVoiceLocal } from "@/stores/voiceLocal";
import { callThroughSfu, flipCamera, guestLinksOn, holdToTalk, joinVoice, leaveVoice, pushToTalkButton, resumeCallAudio, retryMic, toggleCamera, toggleScreen } from "@/voice/session";
import { canShareScreen, hasSeveralCameras } from "@/voice/media";
import { usePushToTalkOn } from "@/voice/callPerms";
import { safeAspect } from "@/voice/videoCap";
import { callViewOpen } from "@/voice/videoShown";
import s from "./Voice.module.css";

import { t as tr_, translator, Tr } from "@/i18n";

/** A round trip in the reader's language: "12 ms", "١٢ ملي ث". */
function formatRtt(ms: number): string {
  try {
    return new Intl.NumberFormat(translator().locale, { style: "unit", unit: "millisecond", unitDisplay: "short", maximumFractionDigits: 0 }).format(ms);
  } catch {
    return String(Math.round(ms));
  }
}
/** A video element bound to a MediaStream, that keeps playing through whatever pauses it on iOS. */
export function StreamVideo({ stream, muted = true, mirror = false, className, onAspect }: { stream: MediaStream; muted?: boolean; mirror?: boolean; className?: string; onAspect?: (ratio: number) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const aspect = useRef(onAspect);
  aspect.current = onAspect;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    // iOS pauses a video when the page is hidden and when its own player closes; a call's picture just carries on
    const play = () => {
      if (el.paused && el.srcObject && document.visibilityState === "visible") void el.play().catch(() => {});
    };
    // the size comes from whoever sends the picture, so its shape is held to a sane range
    const measure = () => {
      const ratio = safeAspect(el.videoWidth, el.videoHeight);
      if (ratio !== null) aspect.current?.(ratio);
    };
    play();
    el.addEventListener("pause", play);
    el.addEventListener("webkitendfullscreen", play);
    el.addEventListener("loadedmetadata", measure);
    el.addEventListener("resize", measure);
    document.addEventListener("visibilitychange", play);
    return () => {
      el.removeEventListener("pause", play);
      el.removeEventListener("webkitendfullscreen", play);
      el.removeEventListener("loadedmetadata", measure);
      el.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", play);
      el.srcObject = null;
    };
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} data-mirror={mirror} />;
}

/** "ringing" is someone being called who has not picked up yet. */
type Tile = { key: string; userId: string; kind: "avatar" | "video" | "screen" | "ringing"; stream: MediaStream | null; me: boolean };

/**
 * Whether this device's own camera picture is shown mirrored, as a mirror
 * would: a camera facing the person is, one pointing away (a phone's back
 * camera, whichever way it was chosen) is not. Desktop cameras say nothing,
 * and face the person.
 */
function mirrored(stream: MediaStream | null): boolean {
  const facing = stream?.getVideoTracks()[0]?.getSettings?.().facingMode;
  return facing !== "environment";
}

/** A pressed-and-held button for push to talk on a touch screen, which has no key to hold. */
function HoldToTalk() {
  const held = useVoice((v) => v.pttHeld);
  const release = () => holdToTalk(false);
  return (
    <button
      type="button"
      className={s.pttBtn}
      data-held={held || undefined}
      aria-pressed={held}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        holdToTalk(true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      // a keyboard (or a switch control) holds it with Space or Enter
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          holdToTalk(true);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") release();
      }}
      onBlur={release}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="hold-to-talk"
    >
      <Mic size={20} aria-hidden="true" />
      {held ? tr_("voice.voice.talking") : tr_("voice.voice.holdToTalk")}
    </button>
  );
}

/** Space between tiles, and around the stage. */
const GAP = 8;
/** Two taps on the same thing this close together are a double tap. */
const DOUBLE_TAP_MS = 350;

const canPip = typeof document !== "undefined" && !!(document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled;
/** Safari (macOS and iOS) floats a video its own way. */
const webkitPip = typeof HTMLVideoElement !== "undefined" && "webkitSetPresentationMode" in HTMLVideoElement.prototype;

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

/**
 * The shape of a grid tile. A wide stage keeps the 16:9 a camera sends; a
 * stage taller than it is wide (a phone held upright, a tablet's column)
 * takes squarer tiles, never narrower than square, so the people fill the
 * screen rather than a band across the middle of it.
 */
function gridAspect(count: number, w: number, h: number): number {
  if (count <= 0 || h <= w) return 16 / 9;
  let best = { area: 0, aspect: 16 / 9 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = (w - GAP * (cols - 1)) / cols;
    const cellH = (h - GAP * (rows - 1)) / rows;
    const aspect = Math.min(16 / 9, Math.max(1, cellW / cellH));
    const tileW = Math.min(cellW, cellH * aspect);
    const area = (tileW * tileW) / aspect;
    if (area > best.area) best = { area, aspect };
  }
  return best.aspect;
}

function ControlButton({ label, keys, onClick, children, on, off, danger, testId, className, menu }: { label: string; keys?: string; onClick: () => void; children: ReactNode; on?: boolean; off?: boolean; danger?: boolean; testId?: string; className?: string; menu?: { label: string; open: (anchor: DOMRect) => void; testId?: string } }) {
  const button = (
    <Tooltip text={label} keys={keys || undefined} side="top">
      {/* The label flips between "Mute" and "Unmute", which is the whole state; adding aria-pressed on top of it announced "Unmute, pressed" for a muted mic and no state at all for a live one. */}
      <button
        className={[s.ctl, danger ? s.leave : "", className ?? ""].join(" ")}
        data-on={on || undefined}
        data-off={off || undefined}
        aria-label={label}
        onClick={onClick}
        // a right click, or a long press on a touch screen, opens the same choices as the arrow, which is a small target for a finger
        onContextMenu={
          menu
            ? (e) => {
                e.preventDefault();
                menu.open((e.currentTarget.closest(`.${s.ctlGroup}`) ?? e.currentTarget).getBoundingClientRect());
              }
            : undefined
        }
        data-testid={testId}
      >
        {children}
      </button>
    </Tooltip>
  );
  if (!menu) return button;
  // the little arrow on the button's corner opens its choices, as the one beside Discord's does
  return (
    <span className={s.ctlGroup}>
      {button}
      <Tooltip text={menu.label} side="top" className={s.ctlMenuWrap}>
        <button className={s.ctlMenu} aria-label={menu.label} aria-haspopup="menu" onClick={(e) => menu.open(e.currentTarget.closest(`.${s.ctlGroup}`)!.getBoundingClientRect())} data-testid={menu.testId}>
          <ChevronUp size={14} strokeWidth={3} />
        </button>
      </Tooltip>
    </span>
  );
}

const middle = (list: { x: number; y: number }[]) => ({ x: list.reduce((a, p) => a + p.x, 0) / list.length, y: list.reduce((a, p) => a + p.y, 0) / list.length });
const spread = (list: { x: number; y: number }[]) => (list.length < 2 ? 0 : Math.hypot(list[0]!.x - list[1]!.x, list[0]!.y - list[1]!.y));

/**
 * Holds a stream's picture. When `zoomable` (whatever is focused, a share or a
 * camera) two fingers pinch into it and one drags it around once zoomed in; a
 * mouse zooms with the wheel (a trackpad with a pinch) and drags to pan. A
 * desktop share is unreadable on a phone otherwise, and a camera is worth a
 * closer look too. The view is written straight onto the video rather than
 * through React, so it keeps up with the fingers. The picture can be moved
 * only as far as its own edges reach the tile's: a wide share on a tall phone
 * has bars above and below it, and the tile's size let it be dragged off.
 */
function StreamSurface({ zoomable, children }: { zoomable: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ scale: 1, x: 0, y: 0 });
  const points = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: View; from: { x: number; y: number }; spread: number } | null>(null);

  const apply = useCallback(() => {
    const el = ref.current;
    const video = el?.querySelector("video");
    if (!el || !video) return;
    const v = view.current;
    // your own camera is shown mirrored, and stays mirrored zoomed in
    const mirror = video.dataset.mirror === "true" ? " scaleX(-1)" : "";
    video.style.transform = v.scale > 1 ? `translate(${v.x}px, ${v.y}px) scale(${v.scale})${mirror}` : "";
    el.dataset.zoomed = String(v.scale > 1);
  }, []);

  const box = (): Size => ({ width: ref.current?.clientWidth ?? 0, height: ref.current?.clientHeight ?? 0 });
  /** The picture as drawn in the tile, fitted to it with bars at the sides or top and bottom. */
  const content = (): Size => {
    const video = ref.current?.querySelector("video");
    const b = box();
    if (!video || !video.videoWidth || !video.videoHeight) return b;
    return containedSize({ width: video.videoWidth, height: video.videoHeight }, b, true);
  };

  const restart = () => {
    const list = [...points.current.values()];
    gesture.current = list.length ? { start: { ...view.current }, from: middle(list), spread: spread(list) } : null;
  };

  const reset = useCallback(() => {
    view.current = { scale: 1, x: 0, y: 0 };
    points.current.clear();
    gesture.current = null;
    apply();
  }, [apply]);

  useEffect(() => {
    if (!zoomable) reset();
  }, [zoomable, reset]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };

  // The wheel has to be taken here: React listens passively, and zooming has
  // to stop the page (or the message list under a call) scrolling with it.
  useEffect(() => {
    const el = ref.current;
    if (!el || !zoomable) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pt = at(e);
      // a trackpad pinch arrives as ctrl+wheel, and wants a firmer response
      const step = e.deltaMode === 1 ? 0.03 : e.ctrlKey ? 0.01 : 0.0018;
      view.current = pinchView(view.current, pt, pt, Math.exp(-e.deltaY * step), box(), content());
      apply();
      // a drag going on while the wheel zooms goes on from the new view
      restart();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomable, apply]);
  const lift = (e: ReactPointerEvent) => {
    if (!points.current.delete(e.pointerId)) return;
    restart();
  };

  return (
    <div
      ref={ref}
      className={s.surface}
      data-zoomable={zoomable || undefined}
      data-no-swipe={zoomable || undefined}
      onPointerDown={(e) => {
        if (!zoomable) return;
        // a mouse's main button, held from the start, so a zoom with the wheel while it is down can be dragged at once
        if (e.pointerType !== "touch" && e.button !== 0) return;
        points.current.set(e.pointerId, at(e));
        if (e.pointerType === "touch" ? points.current.size > 1 || view.current.scale > 1 : view.current.scale > 1) e.currentTarget.setPointerCapture?.(e.pointerId);
        restart();
      }}
      onPointerMove={(e) => {
        if (!points.current.has(e.pointerId)) return;
        const now = at(e);
        if (e.pointerType !== "touch") {
          // let go somewhere this never heard of: not a drag any more
          if ((e.buttons & 1) === 0) {
            points.current.delete(e.pointerId);
            restart();
            return;
          }
          // at the whole view a mouse is only pointing
          if (view.current.scale <= 1) {
            points.current.set(e.pointerId, now);
            restart();
            return;
          }
          if (!ref.current?.hasPointerCapture?.(e.pointerId)) ref.current?.setPointerCapture?.(e.pointerId);
        } else if (points.current.size > 1 && !ref.current?.hasPointerCapture?.(e.pointerId)) {
          ref.current?.setPointerCapture?.(e.pointerId);
        }
        points.current.set(e.pointerId, now);
        const g = gesture.current;
        if (!g) return;
        const list = [...points.current.values()];
        const factor = list.length > 1 && g.spread > 0 ? spread(list) / g.spread : 1;
        view.current = pinchView(g.start, g.from, middle(list), factor, box(), content());
        apply();
      }}
      onPointerUp={lift}
      onPointerCancel={lift}
    >
      {children}
    </div>
  );
}

/**
 * The voice room: tiles laid out to fit, a focused stream, and the control
 * bar. `guest` is a guest's own page, which has nobody's profile to show and
 * no settings to open.
 */
export function VoiceView({ channel, embedded = false, guest = false }: { channel: Channel; embedded?: boolean; guest?: boolean }) {
  const meId = useAuth((a) => a.me?.id);
  const users = useUsers((u) => u.byId);
  const byChannel = useVoice((v) => v.byChannel);
  const mine = useVoice((v) => v.mine);
  const joining = useVoice((v) => v.joining);
  const remote = useVoice((v) => v.remote);
  const error = useVoice((v) => v.error);
  const localVideo = useVoice((v) => v.localVideo);
  const localScreen = useVoice((v) => v.localScreen);
  const speaking = useVoice((v) => v.speaking);
  const peers = useVoice((v) => v.peers);
  const focused = useVoice((v) => v.focused);
  const setFocused = useVoice((v) => v.setFocused);
  const watching = useVoice((v) => v.watching);
  const setWatching = useVoice((v) => v.setWatching);
  const tooLarge = useVoice((v) => v.tooLarge);
  const streamMutes = useVoice((v) => v.streamMutes);
  const localMutes = useVoice((v) => v.localMutes);
  const micBlocked = useVoice((v) => v.micBlocked);
  // ringing them: say who, rather than leave the caller alone on a silent stage
  const calling = useVoice((v) => v.calling === channel.id);
  const calledId = channel.type === "dm" ? channel.recipient_ids.find((id) => id !== meId) : undefined;
  // while this is open the call's cameras and shares come in (voice/videoShown.ts)
  useEffect(() => callViewOpen(channel.id), [channel.id]);
  // this device's own link to the call, apart from how each person is reached
  const connection = useVoice((v) => (v.mine?.channel_id === channel.id ? v.connection : null));
  const audioBlocked = useVoice((v) => v.audioBlocked);
  const leftAlone = useVoice((v) => v.leftAlone === channel.id);
  // push to talk on a touch screen is a button to hold in the call
  const ptt = usePushToTalkOn() && pushToTalkButton();
  const [micNoteDismissed, setMicNoteDismissed] = useState(false);
  const muted = useVoiceLocal((v) => v.muted);
  const deafened = useVoiceLocal((v) => v.deafened);
  // a moderator's mute and deafen hold whatever these buttons say, so the buttons say so
  const modMute = !!mine?.server_mute && !mine.suppress;
  const modDeaf = !!mine?.server_deaf;
  const toggleMute = useVoiceLocal((v) => v.toggleMute);
  const toggleDeafen = useVoiceLocal((v) => v.toggleDeafen);
  // the account's keys for these two, said in their tooltips (Settings, Keybinds)
  const binds = keybindsOf(useSettings((x) => x.settings.keybinds));
  const serverState = useServers((st) => (channel.server_id ? st.byId[channel.server_id] : undefined));
  const openModal = useUI((u) => u.openModal);
  const [canFlip, setCanFlip] = useState(false);
  const mobile = useIsMobile();
  const short = useMediaQuery("(max-height: 520px)");
  const quality = useVoice((v) => (v.mine?.channel_id === channel.id ? v.quality : null));
  /** What the browser has full screen, if anything. */
  const [fsEl, setFsEl] = useState<Element | null>(null);
  /** The call covering the app, where the browser cannot go full screen itself (iPhone). */
  const [pageFull, setPageFull] = useState(false);
  /** Each stream's own shape, so a focused portrait camera is not squeezed into a wide frame. */
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLDivElement>());
  /** The one off-screen player picture-in-picture uses, made on the first request. */
  const pipEl = useRef<HTMLVideoElement | null>(null);
  useEffect(
    () => () => {
      const el = pipEl.current;
      pipEl.current = null;
      if (!el) return;
      el.pause();
      el.srcObject = null;
      el.remove();
    },
    [],
  );
  const connected = mine?.channel_id === channel.id;
  const participants = useMemo(() => participantsOf(byChannel, channel.id), [byChannel, channel.id]);

  // A moderator moved this call to another voice channel of the server while
  // this one was on screen: the screen follows the call there, rather than
  // leave its owner looking at the lobby of the channel they were taken out of.
  const nav = useNavigate();
  const callAt = mine?.channel_id ?? null;
  const callWas = useRef(callAt);
  useEffect(() => {
    const was = callWas.current;
    callWas.current = callAt;
    if (embedded || guest || !channel.server_id || was !== channel.id || !callAt || callAt === channel.id) return;
    if (useChannels.getState().byId[callAt]?.server_id === channel.server_id) nav(`/channels/${channel.server_id}/${callAt}`);
  }, [callAt, channel.id, channel.server_id, embedded, guest, nav]);

  useEffect(() => {
    let alive = true;
    const look = () => void hasSeveralCameras().then((yes) => alive && setCanFlip(yes));
    look();
    // a camera plugged in mid-call, with this one already on, never showed the flip button
    navigator.mediaDevices?.addEventListener?.("devicechange", look);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", look);
    };
  }, [localVideo]);

  const tiles = useMemo<Tile[]>(() => {
    const out: Tile[] = [];
    // shares go first: they are what people are there to look at
    for (const p of participants) {
      const isMe = p.user_id === meId;
      const screen = isMe ? localScreen : (remote[p.user_id]?.screen ?? null);
      // someone else's share is offered as soon as they start it; through the SFU its picture only comes once watched
      if (screen || (!isMe && p.streaming)) out.push({ key: `${p.user_id}:screen`, userId: p.user_id, kind: "screen", stream: screen, me: isMe });
    }
    for (const p of participants) {
      const isMe = p.user_id === meId;
      const video = isMe ? localVideo : (remote[p.user_id]?.video ?? null);
      // The key names the slot, not what is in it: carrying "video" or
      // "avatar" in it meant a camera turned off and on again was a different
      // tile, and the focus on it was dropped both times.
      out.push({ key: `${p.user_id}:camera`, userId: p.user_id, kind: video ? "video" : "avatar", stream: video, me: isMe });
    }
    // the people being called, until they pick up: a caller alone on the stage could not tell ringing from a call nobody is in
    if (calling) {
      const waiting = channel.recipient_ids.filter((id) => id !== meId && !participants.some((p) => p.user_id === id));
      for (const id of waiting.slice(0, 7)) out.push({ key: `${id}:ringing`, userId: id, kind: "ringing", stream: null, me: false });
    }
    return out;
  }, [participants, remote, localVideo, localScreen, meId, calling, channel.recipient_ids]);

  const isLive = (t: Tile) => t.kind === "screen" && !t.me;
  const showsStream = (t: Tile) => !!t.stream && (t.kind === "video" || t.me || !!watching[t.userId]);

  const focusedTile = focused ? tiles.find((t) => t.key === focused) : undefined;
  // a focused tile that has gone (a camera turned off, someone left) lets go of the layout
  useEffect(() => {
    if (focused && !focusedTile) setFocused(null);
  }, [focused, focusedTile, setFocused]);

  const grid = useBoxSize(gridRef, connected && !focusedTile);
  // a short stage (a small call panel, a phone on its side) gives the focused stream all of it rather than a sliver above the strip
  const stage = useBoxSize(stageRef, connected && !!focusedTile);
  // a focused screen share has the stage to itself; people stay a click away on Unfocus
  const showStrip = tiles.length > 1 && stage.h >= 240 && focusedTile?.kind !== "screen";
  const layout = fitGrid(tiles.length, grid.w, grid.h, GAP, gridAspect(tiles.length, grid.w, grid.h));
  // the focused stream is a frame of its own shape, as large as fits, so its label and buttons sit on the picture
  const focusBox = useBoxSize(focusRef, connected && !!focusedTile);
  const focusAspect = Math.min(21 / 9, Math.max(9 / 21, (focusedTile && aspects[focusedTile.key]) || 16 / 9));
  const focusFit = fitGrid(1, focusBox.w, focusBox.h, 0, focusAspect);
  const noteAspect = useCallback((key: string, ratio: number) => setAspects((cur) => (Math.abs((cur[key] ?? 0) - ratio) < 0.01 ? cur : { ...cur, [key]: ratio })), []);

  useEffect(
    () =>
      onFullscreenChange(() => {
        const el = fullscreenElement();
        setFsEl(el);
        if (!el) unlockOrientation();
      }),
    [],
  );
  // hanging up lets go of covering the app
  useEffect(() => {
    if (!connected) setPageFull(false);
  }, [connected]);
  useEffect(() => {
    if (!pageFull) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("[data-modal-layer]") || useUI.getState().contextMenu) return;
      e.stopPropagation();
      setPageFull(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pageFull]);

  // a phone showing someone's picture stays awake, the way a video call app does
  useWakeLock(connected && tiles.some(showsStream));

  const nameOf = (uid: string) => memberName(serverState?.members[uid]?.nickname, users[uid], uid === meId ? tr_("callScreen.you") : tr_("names.unknownUser"));
  const inDM = channel.type === "dm" || channel.type === "group_dm";
  // guests are let in by a link: anyone in a DM or group may make one, and in a server whoever may invite people and join the channel
  const canInviteGuests = !guest && guestLinksOn() !== false && (inDM || (channel.type === "voice" && canI(serverState, P.CREATE_INSTANT_INVITE | P.CONNECT, channel.id)));
  const canRemoveGuests = !guest && (inDM || canI(serverState, P.MOVE_MEMBERS, channel.id));
  const removeGuest = (uid: string) =>
    void guestsApi.remove(channel.id, uid).catch((err) => useUI.getState().toast(err instanceof ApiError ? err.message : tr_("voice.voiceParticipants.couldNotRemoveTheGuest"), "error"));
  const callFull = (!!fsEl && fsEl === rootRef.current) || pageFull;

  // The control bar lays itself out by the call's own width rather than the
  // screen's: beside a sidebar on a tablet, or above a conversation with a
  // panel open, the call is narrow on a wide screen, and the side columns ran
  // into the row in the middle. Where the full bar does not fit, the side
  // columns go, full screen and inviting guests join the row (a phone has the
  // invite in the conversation's menu instead), and the buttons shrink to fit.
  const rootBox = useBoxSize(rootRef, connected);
  const mainCount = 4 + (localVideo && canFlip ? 1 : 0) + (canShareScreen ? 1 : 0);
  const fullBarWidth = 2 * Math.max(64, (canInviteGuests ? 2 : 1) * 40) + mainCount * 52 + (mainCount - 1) * 12 + 2 * 12 + 32;
  const compact = mobile || (rootBox.w > 0 && rootBox.w < fullBarWidth);
  const inviteInRow = compact && canInviteGuests && !mobile;
  const rowCount = mainCount + (compact ? 1 + (inviteInRow ? 1 : 0) : 0);
  const rowGap = Math.max(6, Math.min(12, rootBox.w * 0.022));
  const rowStyle =
    compact && rootBox.w > 0
      ? ({ "--ctl": `${Math.floor(Math.max(32, Math.min(short ? 42 : 52, rootBox.w * 0.115, (rootBox.w - 16 - (rowCount - 1) * rowGap) / rowCount)))}px`, "--ctl-gap": `${Math.round(rowGap)}px` } as CSSProperties)
      : undefined;

  const toggleCallFull = () => {
    if (fullscreenElement()) {
      void exitElementFullscreen().catch(() => {});
      return;
    }
    if (pageFull) {
      setPageFull(false);
      return;
    }
    const root = rootRef.current;
    if (callFullscreenWay() === "element" && root) void enterElementFullscreen(root).catch(() => setPageFull(true));
    else setPageFull(true);
  };

  /** Whether this tile is what fills the screen right now. */
  const tileIsFull = (t: Tile) => (!!fsEl && fsEl === tileRefs.current.get(t.key)) || (pageFull && focused === t.key);

  /**
   * Puts one stream full screen the best way this browser has: the tile itself
   * where elements can go full screen (turning a phone sideways for a wide
   * picture), the system player on an iPhone, or else focused with the call
   * covering the app.
   */
  const fullscreenTile = (t: Tile) => {
    if (tileIsFull(t)) {
      if (fullscreenElement()) void exitElementFullscreen().catch(() => {});
      else setPageFull(false);
      return;
    }
    const way = streamFullscreenWay();
    const video = tileRefs.current.get(t.key)?.querySelector("video") ?? null;
    // the system player has to open inside the tap, on the video that is already playing
    if (way === "video" && video && enterVideoFullscreen(video)) return;
    const wide = !!video && video.videoWidth > video.videoHeight;
    setFocused(t.key);
    if (way === "element") {
      requestAnimationFrame(() => {
        const el = tileRefs.current.get(t.key);
        if (!el) return;
        void enterElementFullscreen(el)
          .then(() => (wide ? lockLandscape() : false))
          .catch(() => setPageFull(true));
      });
      return;
    }
    setPageFull(true);
  };

  const pip = (t: Tile) => {
    const own = tileRefs.current.get(t.key)?.querySelector("video") as (HTMLVideoElement & { webkitSetPresentationMode?: (mode: string) => void }) | null;
    if (webkitPip && own) {
      // Safari only floats a video that is on the page, and only inside the tap
      if (typeof own.requestPictureInPicture === "function") void own.requestPictureInPicture().catch(() => own.webkitSetPresentationMode?.("picture-in-picture"));
      else own.webkitSetPresentationMode?.("picture-in-picture");
      return;
    }
    if (!t.stream) return;
    // elsewhere a video of its own keeps floating after this page moves on.
    // One element, reused and in the document: a fresh detached one per click
    // held a decode pipeline and the remote stream for the life of the page,
    // and browsers that will only float an element that is on the page did
    // nothing at all while still leaking it.
    let el = pipEl.current;
    if (!el) {
      el = document.createElement("video");
      el.muted = true;
      el.playsInline = true;
      el.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none";
      el.addEventListener("leavepictureinpicture", () => {
        el?.pause();
        if (el) el.srcObject = null;
      });
      document.body.append(el);
      pipEl.current = el;
    }
    const target = el;
    target.srcObject = t.stream;
    void target
      .play()
      .then(() => target.requestPictureInPicture())
      .catch(() => {
        target.srcObject = null;
        useUI.getState().toast(tr_("voice.voiceView.pictureInPictureCouldNotStart"), "error");
      });
  };

  const openDeviceMenu = (kind: "mic" | "camera", anchor: DOMRect) =>
    // the menu opens from the group's start edge: its left, or its right in a right-to-left language
    openDeviceMenuAt(kind, openModal, { x: document.documentElement.dir === "rtl" ? anchor.right : anchor.left, y: anchor.top - 8, above: true }, { settings: !guest });

  const tileMenu = (e: MouseEvent, t: Tile) => {
    e.preventDefault();
    const voiceState = byChannel[channel.id]?.[t.userId];
    callTileMenu.open(
      {
        userId: t.userId,
        channelId: channel.id,
        serverId: channel.server_id,
        ...(voiceState ? { voiceState } : {}),
        me: t.me,
        kind: t.kind,
        viewerIsGuest: guest,
        guestTile: isGuest(users[t.userId]),
        ...(isLive(t) ? { watch: { on: !!watching[t.userId], toggle: () => setWatching(t.userId, !watching[t.userId]) } } : {}),
        ...(showsStream(t) ? { view: { focused: focused === t.key, toggleFocus: () => setFocused(focused === t.key ? null : t.key), full: tileIsFull(t), toggleFull: () => fullscreenTile(t) } } : {}),
        stopSharing: () => void toggleScreen(),
        canRemoveGuest: canRemoveGuests,
        removeGuest: () => removeGuest(t.userId),
        openModal,
      },
      { x: e.clientX, y: e.clientY },
    );
  };

  /**
   * A click or tap focuses a stream; clicking what is already focused sends
   * it back to the grid at once. Full screen lives on the tile and control
   * buttons, so there is no double-click gesture and nothing to wait out. It
   * is watched on the whole stage, because the first click moves its tile to
   * the focused spot and the second may land beside it.
   */
  const onStageClick = (e: MouseEvent) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-tile]");
    const t = el ? tiles.find((x) => x.key === el.dataset.tile) : undefined;
    if (!t) return;
    if (el?.dataset.place !== "focus") {
      // the menu offers Focus only where there is a picture; a click used to
      // fill the stage with an avatar that had no way back
      if (showsStream(t)) setFocused(t.key);
      return;
    }
    // Clicking what is already focused sends it back to the grid at once.
    // A stream zoomed in is being panned, not dismissed.
    if (tileIsFull(t) || el.querySelector("[data-zoomed='true']")) return;
    setFocused(null);
  };

  const renderTile = (t: Tile, place: "grid" | "focus" | "strip") => {
    const vs = byChannel[channel.id]?.[t.userId];
    const isSpeaking = !!speaking[t.userId] && t.kind !== "screen";
    const peerState = t.me || t.kind === "ringing" ? "connected" : (peers[t.userId] ?? "new");
    const live = isLive(t);
    // a picture over the size cap is never decoded here: the tile says so rather than wait for it
    const oversized = !t.me && !!t.stream && showsStream(t) && !!tooLarge[`${t.userId}:${t.kind === "screen" ? "screen" : "video"}`];
    const playing = showsStream(t) && !oversized;
    const full = playing && tileIsFull(t);
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
        data-tile={t.key}
        data-no-swipe={full || undefined}
        onContextMenu={(e) => tileMenu(e, t)}
      >
        {playing && t.stream ? (
          <StreamSurface zoomable={place === "focus"}>
            <StreamVideo stream={t.stream} mirror={t.me && t.kind === "video" && mirrored(t.stream)} className={s.video} onAspect={(r) => noteAspect(t.key, r)} />
          </StreamSurface>
        ) : oversized ? (
          <div className={s.offer} data-testid="picture-too-large">
            {place === "strip" || tileH < 150 ? null : <Avatar id={t.userId} avatarId={users[t.userId]?.avatar_id ?? null} name={nameOf(t.userId)} size={tileH < 220 ? 40 : 56} />}
            {place !== "strip" && tileH >= 120 ? <div className={s.offerNote}>{t.kind === "screen" ? <Tr id="voice.voice.screenTooLarge" values={{ name: <PersonName userId={t.userId} serverId={channel.server_id}>{nameOf(t.userId)}</PersonName> }} /> : <Tr id="voice.voice.cameraTooLarge" values={{ name: <PersonName userId={t.userId} serverId={channel.server_id}>{nameOf(t.userId)}</PersonName> }} />}</div> : null}
            {live ? (
              <button
                className={s.watchBtn}
                data-testid="stop-watching"
                onClick={(e) => {
                  e.stopPropagation();
                  setWatching(t.userId, false);
                }}
              >
                <EyeOff size={16} /> {place === "strip" ? tr_("voice.voice.stop") : tr_("voice.voice.stopWatching")}
              </button>
            ) : null}
          </div>
        ) : live ? (
          <div className={s.offer}>
            {place === "strip" || tileH < 150 ? null : <Avatar id={t.userId} avatarId={users[t.userId]?.avatar_id ?? null} name={nameOf(t.userId)} size={tileH < 220 ? 40 : 56} />}
            {watching[t.userId] ? (
              <>
                {place !== "strip" && tileH >= 190 ? <div className={s.offerText}>{<Tr id="voice.voice.connectingToScreen" values={{ name: <PersonName userId={t.userId} serverId={channel.server_id}>{nameOf(t.userId)}</PersonName> }} />}</div> : null}
                <button
                  className={s.watchBtn}
                  data-testid="stop-watching"
                  onClick={(e) => {
                    e.stopPropagation();
                    setWatching(t.userId, false);
                  }}
                >
                  <EyeOff size={16} /> {place === "strip" ? tr_("voice.voice.stop") : tr_("voice.voice.stopWatching")}
                </button>
              </>
            ) : (
              <>
                {place !== "strip" && tileH >= 190 ? <div className={s.offerText}>{<Tr id="voice.voice.isSharingTheirScreen" values={{ name: <PersonName userId={t.userId} serverId={channel.server_id}>{nameOf(t.userId)}</PersonName> }} />}</div> : null}
                <button
                  className={s.watchBtn}
                  data-testid="watch-stream"
                  onClick={(e) => {
                    e.stopPropagation();
                    setWatching(t.userId, true);
                  }}
                >
                  <Eye size={16} /> {place === "strip" ? tr_("voice.voice.watch") : tr_("voice.voice.watchStream")}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className={s.avatarWrap}>
            <span className={t.kind === "ringing" ? s.ringingAvatar : undefined}>
              <Avatar id={t.userId} avatarId={users[t.userId]?.avatar_id ?? null} name={nameOf(t.userId)} size={avatarSize} />
            </span>
          </div>
        )}
        <div className={s.tileBar}>
          {t.kind === "screen" ? <span className={s.live}>{tr_("voice.voice.live")}</span> : null}
          <span className={s.tileName}>
            {t.kind === "screen" ? (t.me ? tr_("voice.voice.yourScreen") : <Tr id="voice.voice.theirScreen" values={{ name: <PersonName userId={t.userId} serverId={channel.server_id}>{nameOf(t.userId)}</PersonName> }} />) : <PersonName userId={t.userId} serverId={channel.server_id}>{nameOf(t.userId)}</PersonName>}
          </span>
          {t.kind !== "screen" && isGuest(users[t.userId]) ? <span className={s.guestTag}>{tr_("voice.voiceParticipants.guest")}</span> : null}
          {/* their server tag, as beside their name everywhere else (none on a guest's page, which knows nobody) */}
          {t.kind !== "screen" && t.kind !== "ringing" && !guest && !isGuest(users[t.userId]) ? <UserTag userId={t.userId} size="sm" /> : null}
          {t.kind !== "screen" && vs?.priority_speaker ? <Megaphone size={14} className={s.tileIcon} aria-label={tr_("perms.prioritySpeaker")} /> : null}
          {t.kind !== "screen" && (vs?.self_mute || vs?.server_mute || (t.me && micBlocked)) ? <MicOff size={14} className={s.tileIcon} data-server={!!vs?.server_mute && !vs.suppress} /> : null}
          {t.kind !== "screen" && (vs?.self_deaf || vs?.server_deaf) ? <HeadphoneOff size={14} className={s.tileIcon} data-server={!!vs?.server_deaf} /> : null}
          {(t.kind === "screen" ? streamMutes[t.userId] : localMutes[t.userId]) ? <VolumeX size={14} className={s.tileIcon} /> : null}
          {t.kind === "ringing" ? <span className={s.tileRinging}>{tr_("voice.voice.ringing")}</span> : null}
          {!t.me && peerState !== "connected" && t.kind !== "screen" ? <span className={s.tileState}>{peerState === "failed" || peerState === "disconnected" ? tr_("voice.voice.reconnecting") : tr_("voice.voice.connectingEllipsis")}</span> : null}
        </div>
        {place !== "strip" && (playing || (t.me && t.kind === "screen")) ? (
          <div className={s.tileBtns} onClick={(e) => e.stopPropagation()}>
            {t.me && t.kind === "screen" ? (
              <Tooltip text={tr_("voice.voice.stopSharing")} side="bottom">
                <button className={s.tileBtn} aria-label={tr_("voice.voice.stopSharing")} onClick={() => void toggleScreen()}><MonitorX size={18} /></button>
              </Tooltip>
            ) : null}
            {live && watching[t.userId] ? (
              <Tooltip text={tr_("voice.voice.stopWatching")} side="bottom">
                <button className={s.tileBtn} aria-label={tr_("voice.voice.stopWatching")} data-testid="stop-watching" onClick={() => setWatching(t.userId, false)}><EyeOff size={18} /></button>
              </Tooltip>
            ) : null}
            {playing && !full ? (
              <Tooltip text={place === "focus" ? tr_("voice.voice.unfocus") : tr_("voice.voice.focus")} side="bottom">
                <button className={s.tileBtn} aria-label={place === "focus" ? tr_("voice.voice.unfocus") : tr_("voice.voice.focus")} onClick={() => setFocused(place === "focus" ? null : t.key)}>
                  {place === "focus" ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
              </Tooltip>
            ) : null}
            {playing && (canPip || webkitPip) && t.stream ? (
              <Tooltip text={tr_("chat.videoPlayer.pictureInPicture")} side="bottom">
                <button className={s.tileBtn} aria-label={tr_("chat.videoPlayer.pictureInPicture")} onClick={() => pip(t)}><PictureInPicture2 size={18} /></button>
              </Tooltip>
            ) : null}
            {playing ? (
              <Tooltip text={full ? tr_("voice.voice.exitFullScreen") : tr_("voice.voice.fullScreen")} side="bottom">
                <button className={s.tileBtn} aria-label={full ? tr_("chat.videoPlayer.exitFullScreen") : tr_("chat.videoPlayer.fullScreen")} data-testid="tile-fullscreen" onClick={() => fullscreenTile(t)}>
                  {full ? <Minimize size={18} /> : <Maximize size={18} />}
                </button>
              </Tooltip>
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
          <div className={s.lobbyTitle}>{channel.type === "voice" ? channel.name : tr_("guestCall.voiceCall")}</div>
          <div className={s.lobbySub}>{participants.length === 0 ? tr_("voice.voice.noOneIsHereYet") : tr_("voice.voice.inVoiceCount", { count: participants.length })}</div>
          <div className={s.lobbyAvatars}>
            {participants.slice(0, 8).map((p) => (
              <Avatar key={p.user_id} id={p.user_id} avatarId={users[p.user_id]?.avatar_id ?? null} name={nameOf(p.user_id)} size={40} />
            ))}
          </div>
          <button className={s.joinBtn} onClick={() => void joinVoice(channel.id)} disabled={joining === channel.id} data-testid="join-voice">
            {joining === channel.id ? tr_("voice.voice.connecting") : channel.type === "voice" ? tr_("voice.voice.joinVoice") : tr_("voice.callBanner.joinCall")}
          </button>
          {/* the toast that carried this is long gone by the time anyone comes back to the lobby */}
          {error ? <div className={s.lobbyError} data-testid="voice-error">{error}</div> : null}
        </div>
      </div>
    );
  }

  const level = quality ? (quality.loss > 0.05 || quality.rtt > 400 ? "bad" : quality.rtt > 150 ? "ok" : "good") : "unknown";
  return (
    <div className={s.root} ref={rootRef} data-embedded={embedded} data-full={callFull || undefined} data-page-full={pageFull || undefined} data-no-swipe={callFull || undefined} data-compact={compact || undefined}>
      <div
        className={s.stage}
        ref={stageRef}
        onClick={onStageClick}
      >
        {/* one column of notes: side by side at the same spot they were drawn over each other */}
        <div className={s.stageNotes} onClick={(e) => e.stopPropagation()}>
          {connection === "reconnecting" ? (
            <div className={s.stageNote} role="status" data-tone="bad" data-testid="reconnecting">
              {tr_("voice.voice.connectionLostReconnecting")}
            </div>
          ) : null}
          {audioBlocked ? (
            <button type="button" className={s.stageNote} data-action="" onClick={() => resumeCallAudio()} data-testid="restore-sound">
              <Volume2 size={14} aria-hidden="true" /> {tr_("voice.voice.tapToTurnOnSound")}
            </button>
          ) : null}
          {micBlocked && !micNoteDismissed ? (
            <div className={s.stageNote} role="alert" data-testid="mic-blocked">
              {tr_("voice.voice.yourMicrophoneIsBlockedSoNo")}{" "}
              <button type="button" className={s.noteBtn} onClick={() => void retryMic()} data-testid="mic-retry">{tr_("voice.voice.tryAgain")}</button>{" "}
              <button type="button" className={s.noteBtn} onClick={() => setMicNoteDismissed(true)}>{tr_("voice.voice.hideThis")}</button>
            </div>
          ) : null}
          {participants.length > 10 && !callThroughSfu() ? <div className={s.stageNote}>{tr_("voice.voice.largeRoomsStrainPeerToPeer")}</div> : null}
          {calling ? (
            <div className={s.stageNote} role="status" data-testid="calling">
              {calledId ? <Tr id="voice.call.callingName" values={{ name: <PersonName userId={calledId}>{displayName(users[calledId])}</PersonName> }} /> : tr_("voice.call.callingGroup")}
            </div>
          ) : null}
          {leftAlone ? (
            <div className={s.stageNote} role="status" data-testid="left-alone">
              {calledId ? <Tr id="voice.call.leftName" values={{ name: <PersonName userId={calledId}>{displayName(users[calledId])}</PersonName> }} /> : tr_("voice.call.everyoneLeft")}
            </div>
          ) : null}
        </div>
        {focusedTile ? (
          <>
            <div className={s.focus} ref={focusRef}>{renderTile(focusedTile, "focus")}</div>
            {showStrip ? <div className={s.strip}>{tiles.filter((t) => t.key !== focusedTile.key).map((t) => renderTile(t, "strip"))}</div> : null}
          </>
        ) : (
          <div className={s.grid} ref={gridRef}>
            {tiles.map((t) => renderTile(t, "grid"))}
          </div>
        )}
      </div>
      {/* a narrow call has no side to the controls, so the time sits centred above them */}
      {compact && !calling ? (
        <div className={s.timerRow}>
          <CallTimer channelId={channel.id} />
        </div>
      ) : null}
      {ptt ? (
        <div className={s.pttRow}>
          <HoldToTalk />
        </div>
      ) : null}
      <div className={s.controls} style={rowStyle} data-ptt={ptt || undefined}>
        <div className={s.controlsSide}>
          {/* alone in a call between people there is no connection to measure yet, and "…" there never went away */}
          {quality || participants.length > 1 ? (
            <span className={s.quality} data-level={level} title={quality ? tr_("voice.voiceView.qualityLine", { rtt: Math.round(quality.rtt), loss: (quality.loss * 100).toFixed(1) }) : tr_("voice.voiceView.measuring")}>
              <i className={s.qualityDot} />
              {quality ? formatRtt(quality.rtt) : "…"}
            </span>
          ) : null}
          {/* while it still rings nobody has picked up, so there is nothing to count */}
          {calling ? null : <CallTimer channelId={channel.id} className={s.viewTimer} />}
        </div>
        <div className={s.controlsMain}>
          <ControlButton label={modMute ? tr_("voice.moderation.mutedByModerator") : micBlocked ? tr_("voice.voice.microphoneBlockedTryAgain") : muted ? tr_("voice.voice.unmute") : tr_("voice.voice.mute")} keys={micBlocked || modMute ? undefined : bindText(binds.mute)} off={muted || micBlocked || modMute} onClick={modMute ? () => useUI.getState().toast(tr_("voice.moderation.mutedHint")) : micBlocked ? () => void retryMic() : toggleMute} testId="voice-mute" menu={{ label: tr_("voice.voice.microphoneOptions"), open: (r) => void openDeviceMenu("mic", r), testId: "mic-menu" }}>{muted || micBlocked || modMute ? <MicOff size={22} /> : <Mic size={22} />}</ControlButton>
          <ControlButton label={modDeaf ? tr_("voice.moderation.deafenedByModerator") : deafened ? tr_("voice.voice.undeafen") : tr_("voice.voice.deafen")} keys={modDeaf ? undefined : bindText(binds.deafen)} off={deafened || modDeaf} onClick={modDeaf ? () => useUI.getState().toast(tr_("voice.moderation.deafenedHint")) : toggleDeafen} testId="voice-deafen">{deafened || modDeaf ? <HeadphoneOff size={22} /> : <Headphones size={22} />}</ControlButton>
          <ControlButton label={localVideo ? tr_("voice.voice.turnOffCamera") : tr_("voice.voice.turnOnCamera")} on={!!localVideo} onClick={() => void toggleCamera()} menu={{ label: tr_("voice.voice.cameraOptions"), open: (r) => void openDeviceMenu("camera", r), testId: "camera-menu" }}>{localVideo ? <Video size={22} /> : <VideoOff size={22} />}</ControlButton>
          {localVideo && canFlip ? (
            <ControlButton label={tr_("voice.voice.switchCamera")} onClick={() => void flipCamera()} testId="flip-camera"><SwitchCamera size={22} /></ControlButton>
          ) : null}
          {canShareScreen ? (
            <ControlButton label={localScreen ? tr_("voice.voice.stopSharing") : tr_("voice.voice.shareYourScreen")} on={!!localScreen} onClick={() => (localScreen ? void toggleScreen() : openModal("shareScreen"))} testId="screen-share">{localScreen ? <MonitorX size={22} /> : <MonitorUp size={22} />}</ControlButton>
          ) : null}
          {/* a narrow call has no side columns, so what they hold joins the row */}
          {inviteInRow ? (
            <ControlButton label={tr_("voice.voice.inviteGuests")} onClick={() => openModal("guestLink", { channelId: channel.id })} testId="invite-guests-narrow"><Link2 size={22} /></ControlButton>
          ) : null}
          {compact ? (
            <ControlButton label={callFull ? tr_("chat.videoPlayer.exitFullScreen") : tr_("chat.videoPlayer.fullScreen")} on={callFull} onClick={toggleCallFull} testId="call-fullscreen-narrow">{callFull ? <Minimize size={22} /> : <Maximize size={22} />}</ControlButton>
          ) : null}
          <ControlButton label={tr_("voice.voiceStatus.disconnect")} danger onClick={() => void leaveVoice()} testId="voice-leave"><HangUp size={22} /></ControlButton>
        </div>
        <div className={[s.controlsSide, s.controlsEnd].join(" ")}>
          {canInviteGuests ? (
            <Tooltip text={tr_("voice.voice.inviteGuests")} side="top">
              <button className={s.sideBtn} aria-label={tr_("voice.voice.inviteGuests")} onClick={() => openModal("guestLink", { channelId: channel.id })} data-testid="invite-guests"><Link2 size={20} /></button>
            </Tooltip>
          ) : null}
          <Tooltip text={callFull ? tr_("chat.videoPlayer.exitFullScreen") : tr_("chat.videoPlayer.fullScreen")} side="top">
            <button className={s.sideBtn} aria-label={callFull ? tr_("chat.videoPlayer.exitFullScreen") : tr_("chat.videoPlayer.fullScreen")} onClick={toggleCallFull} data-testid="call-fullscreen">{callFull ? <Minimize size={20} /> : <Maximize size={20} />}</button>
          </Tooltip>
        </div>
      </div>
      {embedded && !callFull ? <CallResizer root={rootRef} /> : null}
    </div>
  );
}

/**
 * The grab bar under a call above a conversation: drag it (mouse, finger or
 * arrow keys) to share the height between the call and the chat. The share is
 * written straight onto the panel while dragging and saved on this device when
 * let go. A double click or double tap puts it back.
 */
function CallResizer({ root }: { root: React.RefObject<HTMLDivElement | null> }) {
  const [share, setShare] = useState(() => readCallPanel(storage.get(CALL_PANEL_KEY)));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; top: number; height: number; y: number; moved: boolean; share: number } | null>(null);
  const lastTap = useRef(0);

  useLayoutEffect(() => {
    root.current?.style.setProperty("--call-share", String(share));
  }, [root, share]);

  const containerHeight = () => root.current?.parentElement?.getBoundingClientRect().height ?? 0;
  const commit = (next: number) => {
    const clamped = clampCallPanel(next, containerHeight());
    setShare(clamped);
    root.current?.style.setProperty("--call-share", String(clamped));
    storage.set(CALL_PANEL_KEY, String(clamped));
  };
  const reset = () => commit(CALL_PANEL_DEFAULT);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !root.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: e.pointerId, top: root.current.getBoundingClientRect().top, height: containerHeight(), y: e.clientY, moved: false, share };
    setDragging(true);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !(d.height > 0)) return;
    if (Math.abs(e.clientY - d.y) > 3) d.moved = true;
    if (!d.moved) return;
    d.share = clampCallPanel((e.clientY - d.top) / d.height, d.height);
    root.current?.style.setProperty("--call-share", String(d.share));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (d.moved) {
      commit(d.share);
      return;
    }
    if (e.pointerType === "mouse") return;
    const now = performance.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      reset();
    } else lastTap.current = now;
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowUp" ? -0.05 : e.key === "ArrowDown" ? 0.05 : e.key === "PageUp" ? -0.2 : e.key === "PageDown" ? 0.2 : 0;
    if (step) commit(share + step);
    else if (e.key === "Home") commit(0);
    else if (e.key === "End") commit(1);
    else if (e.key === "Enter") reset();
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={s.resizer}
      role="separator"
      aria-orientation="horizontal"
      aria-label={tr_("voice.voice.resizeCall")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      title={tr_("voice.voice.dragToResizeDoubleClickTo")}
      tabIndex={0}
      data-dragging={dragging || undefined}
      data-native-press=""
      data-testid="call-resizer"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={reset}
      onKeyDown={onKey}
    />
  );
}
