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
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ApiError } from "@/api/client";
import { guests as guestsApi } from "@/api/guests";
import type { Channel } from "@/api/types";
import { Avatar } from "@/components/common/Avatar";
import { cameraMenuItems, micMenuItems } from "./deviceMenus";
import { HangUp } from "./HangUp";
import { Tooltip } from "@/components/common/Tooltip";
import { useWakeLock } from "@/hooks/useWakeLock";
import { fitGrid } from "@/lib/callLayout";
import { appendSection, copyIdItem, developerMode } from "@/lib/copyId";
import { isGuest } from "@/lib/guestLink";
import { P } from "@/lib/perms";
import { CALL_PANEL_DEFAULT, CALL_PANEL_KEY, clampCallPanel, readCallPanel } from "@/lib/callPanel";
import { callFullscreenWay, enterElementFullscreen, enterVideoFullscreen, exitElementFullscreen, fullscreenElement, lockLandscape, onFullscreenChange, streamFullscreenWay, unlockOrientation } from "@/lib/fullscreen";
import { memberName } from "@/lib/names";
import { storage } from "@/lib/storage";
import { pinchView, type View } from "@/lib/zoomPan";
import { useAuth } from "@/stores/auth";
import { canI, memberColor, useServers } from "@/stores/servers";
import { useUI, type ContextMenuItem } from "@/stores/ui";
import { useUsers } from "@/stores/users";
import { participantsOf, useVoice } from "@/stores/voice";
import { useVoiceLocal } from "@/stores/voiceLocal";
import { callThroughSfu, currentCameraFacing, flipCamera, guestLinksOn, joinVoice, leaveVoice, setStreamLocalMute, setStreamVolume, setUserLocalMute, setUserVolume, toggleCamera, toggleScreen } from "@/voice/session";
import { canShareScreen, hasSeveralCameras } from "@/voice/media";
import s from "./Voice.module.css";

import { t as tr_ } from "@/i18n";
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
    const measure = () => {
      if (el.videoWidth > 0 && el.videoHeight > 0) aspect.current?.(el.videoWidth / el.videoHeight);
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

type Tile = { key: string; userId: string; kind: "avatar" | "video" | "screen"; stream: MediaStream | null; me: boolean };

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

function ControlButton({ label, onClick, children, on, off, danger, testId, className, menu }: { label: string; onClick: () => void; children: ReactNode; on?: boolean; off?: boolean; danger?: boolean; testId?: string; className?: string; menu?: { label: string; open: (anchor: DOMRect) => void; testId?: string } }) {
  const button = (
    <Tooltip text={label} side="top">
      {/* The label flips between "Mute" and "Unmute", which is the whole state; adding aria-pressed on top of it announced "Unmute, pressed" for a muted mic and no state at all for a live one. */}
      <button className={[s.ctl, danger ? s.leave : "", className ?? ""].join(" ")} data-on={on || undefined} data-off={off || undefined} aria-label={label} onClick={onClick} data-testid={testId}>
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
 * mouse zooms with the wheel and drags to pan. A desktop share is unreadable
 * on a phone otherwise, and a camera is worth a closer look too. The view is
 * written straight onto the video rather than through React, so it keeps up
 * with the fingers.
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
    video.style.transform = v.scale > 1 ? `translate(${v.x}px, ${v.y}px) scale(${v.scale})` : "";
    el.dataset.zoomed = String(v.scale > 1);
  }, []);

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
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.03 : 0.0015));
      view.current = pinchView(view.current, pt, pt, factor, { width: el.clientWidth, height: el.clientHeight });
      apply();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomable, apply]);
  const restart = () => {
    const list = [...points.current.values()];
    gesture.current = list.length ? { start: { ...view.current }, from: middle(list), spread: spread(list) } : null;
  };
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
        // a mouse only takes part once there is something to drag around
        if (e.pointerType !== "touch" && view.current.scale <= 1) return;
        points.current.set(e.pointerId, at(e));
        if (points.current.size > 1 || view.current.scale > 1) e.currentTarget.setPointerCapture?.(e.pointerId);
        restart();
      }}
      onPointerMove={(e) => {
        if (!points.current.has(e.pointerId)) return;
        points.current.set(e.pointerId, at(e));
        const g = gesture.current;
        const el = ref.current;
        if (!g || !el) return;
        const list = [...points.current.values()];
        const factor = list.length > 1 && g.spread > 0 ? spread(list) / g.spread : 1;
        view.current = pinchView(g.start, g.from, middle(list), factor, { width: el.clientWidth, height: el.clientHeight });
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
  const volumes = useVoice((v) => v.volumes);
  const streamVolumes = useVoice((v) => v.streamVolumes);
  const streamMutes = useVoice((v) => v.streamMutes);
  const localMutes = useVoice((v) => v.localMutes);
  const micBlocked = useVoice((v) => v.micBlocked);
  const [micNoteDismissed, setMicNoteDismissed] = useState(false);
  const muted = useVoiceLocal((v) => v.muted);
  const deafened = useVoiceLocal((v) => v.deafened);
  const toggleMute = useVoiceLocal((v) => v.toggleMute);
  const toggleDeafen = useVoiceLocal((v) => v.toggleDeafen);
  const serverState = useServers((st) => (channel.server_id ? st.byId[channel.server_id] : undefined));
  const openContextMenu = useUI((u) => u.openContextMenu);
  const openModal = useUI((u) => u.openModal);
  const [canFlip, setCanFlip] = useState(false);
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
    return out;
  }, [participants, remote, localVideo, localScreen, meId]);

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
  const layout = fitGrid(tiles.length, grid.w, grid.h, GAP);
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

  const nameOf = (uid: string) => memberName(serverState?.members[uid]?.nickname, users[uid], uid === meId ? "You" : tr_("names.unknownUser"));
  const inDM = channel.type === "dm" || channel.type === "group_dm";
  // guests are let in by a link: anyone in a DM or group may make one, and in a server whoever may invite people and join the channel
  const canInviteGuests = !guest && guestLinksOn() !== false && (inDM || (channel.type === "voice" && canI(serverState, P.CREATE_INSTANT_INVITE | P.CONNECT, channel.id)));
  const canRemoveGuests = !guest && (inDM || canI(serverState, P.MOVE_MEMBERS, channel.id));
  const removeGuest = (uid: string) =>
    void guestsApi.remove(channel.id, uid).catch((err) => useUI.getState().toast(err instanceof ApiError ? err.message : tr_("voice.voiceParticipants.couldNotRemoveTheGuest"), "error"));
  const callFull = (!!fsEl && fsEl === rootRef.current) || pageFull;

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

  const openDeviceMenu = async (kind: "mic" | "camera", anchor: DOMRect) => {
    const items = kind === "mic" ? await micMenuItems(openModal, { settings: !guest }) : await cameraMenuItems(openModal, { settings: !guest });
    openContextMenu({ x: anchor.left, y: anchor.top - 8, above: true, items });
  };

  const tileMenu = (e: MouseEvent, t: Tile) => {
    e.preventDefault();
    const guestTile = isGuest(users[t.userId]);
    const items: ContextMenuItem[] = [];
    // a guest has no profile, and a guest's page knows nobody's
    if (!guest && !guestTile) items.push({ id: "profile", label: tr_("profile.profile.profile"), onSelect: () => openModal("profile", { userId: t.userId }) });
    if (t.kind === "screen" && t.me) items.push({ id: "stop-share", label: tr_("voice.voice.stopSharing"), onSelect: () => void toggleScreen() });
    if (isLive(t)) items.push({ id: "watch", label: watching[t.userId] ? tr_("voice.voice.stopWatching") : tr_("voice.voice.watchStream"), onSelect: () => setWatching(t.userId, !watching[t.userId]) });
    if (showsStream(t)) {
      items.push({ id: "focus", label: focused === t.key ? tr_("voice.voice.unfocus") : tr_("voice.voice.focus"), onSelect: () => setFocused(focused === t.key ? null : t.key) });
      items.push({ id: "fullscreen", label: tileIsFull(t) ? tr_("voice.voice.exitFullScreen") : tr_("voice.voice.fullScreen"), onSelect: () => fullscreenTile(t) });
    }
    if (!t.me && t.kind === "screen") {
      // a stream's sound has its own level: turning a loud game down leaves the person's voice alone
      const vol = streamVolumes[t.userId] ?? 100;
      if (items.length) items[items.length - 1]!.separatorAfter = true;
      items.push(
        { id: "stream-volume", label: tr_("voice.voice.streamVolume"), slider: { value: vol, min: 0, max: 200, unit: "%", onChange: (v) => setStreamVolume(t.userId, v) } },
        { id: "stream-mute", label: streamMutes[t.userId] ? tr_("voice.voice.unmuteStream") : tr_("voice.voice.muteStream"), onSelect: () => setStreamLocalMute(t.userId, !streamMutes[t.userId]) },
        { id: "stream-reset", label: tr_("voice.voice.resetStreamVolume"), disabled: vol === 100, onSelect: () => setStreamVolume(t.userId, 100) },
      );
    } else if (!t.me) {
      const vol = volumes[t.userId] ?? 100;
      if (items.length) items[items.length - 1]!.separatorAfter = true;
      items.push(
        { id: "volume", label: tr_("voice.voiceParticipants.userVolume"), slider: { value: vol, min: 0, max: 200, unit: "%", onChange: (v) => setUserVolume(t.userId, v) } },
        { id: "mute", label: localMutes[t.userId] ? tr_("voice.voice.unmute") : tr_("voice.voice.mute"), onSelect: () => setUserLocalMute(t.userId, !localMutes[t.userId]) },
        { id: "reset", label: tr_("voice.voiceParticipants.resetVolume"), disabled: vol === 100, onSelect: () => setUserVolume(t.userId, 100) },
      );
    }
    if (guestTile && canRemoveGuests && t.kind !== "screen") {
      if (items.length) items[items.length - 1]!.separatorAfter = true;
      items.push({ id: "remove-guest", label: tr_("voice.voiceParticipants.removeFromCall"), danger: true, onSelect: () => removeGuest(t.userId) });
    }
    if (!guest && !guestTile && developerMode()) appendSection(items, [copyIdItem("copy-user", tr_("chat.groupMemberMenu.copyUserId"), t.userId)]);
    if (items.length === 0) return;
    openContextMenu({ x: e.clientX, y: e.clientY, items });
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
    const color = serverState ? memberColor(serverState, t.userId) : undefined;
    const peerState = t.me ? "connected" : (peers[t.userId] ?? "new");
    const live = isLive(t);
    const playing = showsStream(t);
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
            <StreamVideo stream={t.stream} mirror={t.me && t.kind === "video" && currentCameraFacing() === "user"} className={s.video} onAspect={(r) => noteAspect(t.key, r)} />
          </StreamSurface>
        ) : live ? (
          <div className={s.offer}>
            {place === "strip" || tileH < 150 ? null : <Avatar id={t.userId} avatarId={users[t.userId]?.avatar_id ?? null} name={nameOf(t.userId)} size={tileH < 220 ? 40 : 56} />}
            {watching[t.userId] ? (
              <>
                {place !== "strip" && tileH >= 190 ? <div className={s.offerText}>{tr_("voice.voice.connectingToScreen", { name: nameOf(t.userId) })}</div> : null}
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
                {place !== "strip" && tileH >= 190 ? <div className={s.offerText}>{tr_("voice.voice.isSharingTheirScreen", { name: nameOf(t.userId) })}</div> : null}
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
            <Avatar id={t.userId} avatarId={users[t.userId]?.avatar_id ?? null} name={nameOf(t.userId)} size={avatarSize} />
          </div>
        )}
        <div className={s.tileBar}>
          {t.kind === "screen" ? <span className={s.live}>{tr_("voice.voice.live")}</span> : null}
          <span className={s.tileName} style={color ? { color } : undefined}>
            {t.kind === "screen" ? (t.me ? tr_("voice.voice.yourScreen") : tr_("voice.voice.theirScreen", { name: nameOf(t.userId) })) : nameOf(t.userId)}
          </span>
          {t.kind !== "screen" && isGuest(users[t.userId]) ? <span className={s.guestTag}>{tr_("voice.voiceParticipants.guest")}</span> : null}
          {t.kind !== "screen" && (vs?.self_mute || vs?.server_mute || (t.me && micBlocked)) ? <MicOff size={14} className={s.tileIcon} data-server={!!vs?.server_mute} /> : null}
          {t.kind !== "screen" && (vs?.self_deaf || vs?.server_deaf) ? <HeadphoneOff size={14} className={s.tileIcon} data-server={!!vs?.server_deaf} /> : null}
          {(t.kind === "screen" ? streamMutes[t.userId] : localMutes[t.userId]) ? <VolumeX size={14} className={s.tileIcon} /> : null}
          {!t.me && peerState !== "connected" && t.kind !== "screen" ? <span className={s.tileState}>{peerState === "failed" ? tr_("voice.voice.reconnecting") : tr_("voice.voice.connectingEllipsis")}</span> : null}
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
      <div className={s.root} ref={rootRef} data-embedded={embedded} data-dark-scope="">
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
    <div className={s.root} ref={rootRef} data-embedded={embedded} data-dark-scope="" data-full={callFull || undefined} data-page-full={pageFull || undefined} data-no-swipe={callFull || undefined}>
      <div
        className={s.stage}
        ref={stageRef}
        onClick={onStageClick}
      >
        {micBlocked && !micNoteDismissed ? (
          <div className={s.stageNote} role="alert" data-testid="mic-blocked">
            {tr_("voice.voice.yourMicrophoneIsBlockedSoNo")}{" "}
            <button onClick={() => setMicNoteDismissed(true)} style={{ textDecoration: "underline" }}>{tr_("voice.voice.hideThis")}</button>
          </div>
        ) : null}
        {participants.length > 10 && !callThroughSfu() ? <div className={s.stageNote}>{tr_("voice.voice.largeRoomsStrainPeerToPeer")}</div> : null}
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
      <div className={s.controls}>
        <div className={s.controlsSide}>
          <span className={s.quality} data-level={level} title={quality ? `${Math.round(quality.rtt)} ms · ${(quality.loss * 100).toFixed(1)}% loss` : "Measuring…"}>
            <i className={s.qualityDot} />
            {quality ? `${Math.round(quality.rtt)} ms` : "…"}
          </span>
        </div>
        <div className={s.controlsMain}>
          <ControlButton label={micBlocked ? tr_("voice.voice.microphoneBlocked") : muted ? tr_("voice.voice.unmute") : tr_("voice.voice.mute")} off={muted || micBlocked} onClick={toggleMute} testId="voice-mute" menu={{ label: tr_("voice.voice.microphoneOptions"), open: (r) => void openDeviceMenu("mic", r), testId: "mic-menu" }}>{muted || micBlocked ? <MicOff size={22} /> : <Mic size={22} />}</ControlButton>
          <ControlButton label={deafened ? tr_("voice.voice.undeafen") : tr_("voice.voice.deafen")} off={deafened} onClick={toggleDeafen}>{deafened ? <HeadphoneOff size={22} /> : <Headphones size={22} />}</ControlButton>
          <ControlButton label={localVideo ? tr_("voice.voice.turnOffCamera") : tr_("voice.voice.turnOnCamera")} on={!!localVideo} onClick={() => void toggleCamera()} menu={{ label: tr_("voice.voice.cameraOptions"), open: (r) => void openDeviceMenu("camera", r), testId: "camera-menu" }}>{localVideo ? <Video size={22} /> : <VideoOff size={22} />}</ControlButton>
          {localVideo && canFlip ? (
            <ControlButton label={tr_("voice.voice.switchCamera")} onClick={() => void flipCamera()} testId="flip-camera"><SwitchCamera size={22} /></ControlButton>
          ) : null}
          {canShareScreen ? (
            <ControlButton label={localScreen ? tr_("voice.voice.stopSharing") : tr_("voice.voice.shareYourScreen")} on={!!localScreen} onClick={() => (localScreen ? void toggleScreen() : openModal("shareScreen"))} testId="screen-share">{localScreen ? <MonitorX size={22} /> : <MonitorUp size={22} />}</ControlButton>
          ) : null}
          {/* phones have no side column for it, so full screen joins the row there */}
          <ControlButton label={callFull ? tr_("chat.videoPlayer.exitFullScreen") : tr_("chat.videoPlayer.fullScreen")} on={callFull} onClick={toggleCallFull} className={s.narrowOnly} testId="call-fullscreen-narrow">{callFull ? <Minimize size={22} /> : <Maximize size={22} />}</ControlButton>
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
