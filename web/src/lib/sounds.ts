export type SoundName = "message" | "mention" | "ring" | "join" | "leave" | "mute" | "unmute";

let ctx: AudioContext | null = null;
let ringTimer: ReturnType<typeof setInterval> | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    const ac = new Ctor();
    ctx = ac;
    // iOS suspends the context again after a phone call or Siri, and only a tap can wake it
    ac.onstatechange = () => (ac.state === "running" ? disarmUnlock() : armUnlock());
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

const UNLOCK_EVENTS = ["pointerdown", "touchend", "keydown"] as const;
let unlockWanted = false;
let unlockArmed = false;

/**
 * Starts the context from inside a tap or key press. Sounds mostly play from
 * gateway events, and iOS Safari keeps Web Audio silent until a gesture has
 * started it, which resume() outside one cannot do. A one-sample silent
 * buffer is what makes WebKit count the gesture.
 */
function unlock(): void {
  const ac = audio();
  if (!ac) {
    disarmUnlock();
    return;
  }
  try {
    const src = ac.createBufferSource();
    src.buffer = ac.createBuffer(1, 1, 22050);
    src.connect(ac.destination);
    src.start(0);
  } catch {
    /* nothing to unlock with; the next gesture tries again */
  }
  if (ac.state === "running") disarmUnlock();
}

function armUnlock(): void {
  if (!unlockWanted || unlockArmed || typeof window === "undefined") return;
  unlockArmed = true;
  for (const t of UNLOCK_EVENTS) window.addEventListener(t, unlock, { capture: true, passive: true });
}

function disarmUnlock(): void {
  if (!unlockArmed) return;
  unlockArmed = false;
  for (const t of UNLOCK_EVENTS) window.removeEventListener(t, unlock, { capture: true });
}

/** Lets the next tap or key press start audio, and again whenever the system suspends it. */
export function installAudioUnlock(): void {
  unlockWanted = true;
  if (ctx?.state !== "running") armUnlock();
}

function tone(ac: AudioContext, freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.18): void {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ac.currentTime + start);
  g.gain.setValueAtTime(0, ac.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ac.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
  o.connect(g).connect(ac.destination);
  o.start(ac.currentTime + start);
  o.stop(ac.currentTime + start + dur + 0.02);
}

/** All sounds are synthesised so no audio asset is bundled or copied. */
export function playSound(name: SoundName): void {
  const ac = audio();
  if (!ac) return;
  switch (name) {
    case "message":
      tone(ac, 880, 0, 0.09);
      tone(ac, 1174.7, 0.09, 0.12);
      break;
    case "mention":
      tone(ac, 784, 0, 0.08);
      tone(ac, 987.8, 0.09, 0.08);
      tone(ac, 1318.5, 0.18, 0.16);
      break;
    case "join":
      tone(ac, 523.3, 0, 0.08, "triangle");
      tone(ac, 784, 0.08, 0.12, "triangle");
      break;
    case "leave":
      tone(ac, 784, 0, 0.08, "triangle");
      tone(ac, 523.3, 0.08, 0.12, "triangle");
      break;
    case "mute":
      tone(ac, 440, 0, 0.07, "square", 0.08);
      tone(ac, 330, 0.07, 0.1, "square", 0.08);
      break;
    case "unmute":
      tone(ac, 330, 0, 0.07, "square", 0.08);
      tone(ac, 440, 0.07, 0.1, "square", 0.08);
      break;
    case "ring":
      tone(ac, 659.3, 0, 0.25, "sine", 0.15);
      tone(ac, 880, 0.3, 0.25, "sine", 0.15);
      break;
  }
}

export function startRinging(): void {
  stopRinging();
  playSound("ring");
  ringTimer = setInterval(() => playSound("ring"), 1500);
}

export function stopRinging(): void {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
}
