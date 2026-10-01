import { avatarColor, initials } from "./avatarColor";

/**
 * A person's picture for a notification, drawn round. A notification shows
 * the picture it is given as it is: Windows and most Linux desktops put the
 * square avatar in the corner of the notification, corners and all, where the
 * app draws a circle everywhere else. The circle is drawn here, with the
 * corners left transparent, so every system shows the same round avatar; and
 * someone with no picture gets their initial on their colour, as in the app,
 * rather than Nexa's icon.
 */

/** Drawn at twice the size notifications show, so a sharp screen gets a sharp picture. */
const SIZE = 192;
/** A picture that takes longer than this to arrive is shown square rather than holding the notification up. */
const LOAD_MS = 1500;
const KEEP = 64;

const made = new Map<string, Promise<string | null>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    const timer = setTimeout(() => resolve(null), LOAD_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img.naturalWidth > 0 ? img : null);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

/** Paints into a circle and hands back the PNG, or null where there is no canvas to paint on. */
function circle(paint: (ctx: CanvasRenderingContext2D) => void): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    paint(ctx);
    return canvas.toDataURL("image/png");
  } catch {
    // a picture from somewhere that did not allow reading it back (a tainted canvas)
    return null;
  }
}

/** A picture cut to a circle, filling it as the app's avatars do (centred, cropped to fit). */
async function roundPicture(src: string): Promise<string | null> {
  const img = await loadImage(src);
  if (!img) return null;
  return circle((ctx) => {
    const scale = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  });
}

/** Someone's initial on their colour, the avatar the app draws for anyone without a picture. */
function roundInitials(id: string, name: string): string | null {
  return circle((ctx) => {
    ctx.fillStyle = avatarColor(id);
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.round(SIZE * 0.42)}px "Twemoji Text", system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(initials(name), SIZE / 2, SIZE / 2 + SIZE * 0.02);
  });
}

/**
 * The round picture for a notification about someone, as a data URL, or
 * `fallback` when none can be drawn (no canvas, a picture that never came).
 */
export function roundAvatar(person: { id: string; name: string; url: string | null }, fallback: string): Promise<string> {
  const key = `${person.id}|${person.url ?? ""}|${person.url ? "" : person.name}`;
  let p = made.get(key);
  if (!p) {
    p = person.url ? roundPicture(person.url).then((d) => d ?? roundInitials(person.id, person.name)) : Promise.resolve(roundInitials(person.id, person.name));
    made.set(key, p);
    if (made.size > KEEP) made.delete(made.keys().next().value!);
    // a failure is not remembered: the next notification tries again
    void p.then((d) => {
      if (!d) made.delete(key);
    });
  }
  return p.then((d) => d ?? person.url ?? fallback);
}
