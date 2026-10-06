/**
 * The maths of zooming into a picture or a stream: a scale and an offset from
 * the middle, applied as `translate(x, y) scale(scale)` with the origin at the
 * centre.
 */

export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MAX_ZOOM = 5;

/**
 * Holds a view between the whole picture and MAX_ZOOM. The picture can be
 * moved only as far as it is larger than the box: an edge never comes in past
 * the box's own, and while it is narrower (or shorter) than the box it stays
 * in the middle that way. `content` is the picture's own size in the box at
 * the whole-picture view, centred in it; a picture filling the box when it is
 * not given. Measuring the box alone let a tall picture in a wide box, or a
 * screen share with bars above and below it, be dragged out of sight.
 */
export function clampView(v: View, box: Size, content: Size = box): View {
  const scale = Math.min(MAX_ZOOM, Math.max(1, v.scale));
  const maxX = Math.max(0, (content.width * scale - box.width) / 2);
  const maxY = Math.max(0, (content.height * scale - box.height) / 2);
  return { scale, x: Math.min(maxX, Math.max(-maxX, v.x)) || 0, y: Math.min(maxY, Math.max(-maxY, v.y)) || 0 };
}

/**
 * The view after the fingers' midpoint (or the pointer) moved from `from` to
 * `to` (both measured from the box's centre) while their spread changed by
 * `factor`: whatever was under them stays under them.
 */
export function pinchView(start: View, from: { x: number; y: number }, to: { x: number; y: number }, factor: number, box: Size, content: Size = box): View {
  const scale = Math.min(MAX_ZOOM, Math.max(1, start.scale * factor));
  const k = scale / start.scale;
  return clampView({ scale, x: to.x - (from.x - start.x) * k, y: to.y - (from.y - start.y) * k }, box, content);
}

/**
 * The size a picture of `natural` size is drawn at when fitted inside `box`
 * without being made larger than it is (`object-fit: contain` in a box it may
 * not overflow), or at most the box when `grow` lets it fill the box.
 */
export function containedSize(natural: Size, box: Size, grow = false): Size {
  if (!natural.width || !natural.height || !box.width || !box.height) return box;
  const r = Math.min(box.width / natural.width, box.height / natural.height, grow ? Infinity : 1);
  return { width: natural.width * r, height: natural.height * r };
}
