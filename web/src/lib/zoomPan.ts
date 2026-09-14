/**
 * The maths of pinching into a stream: a scale and an offset from the middle,
 * applied as `translate(x, y) scale(scale)` with the origin at the centre.
 */

export interface View {
  scale: number;
  x: number;
  y: number;
}

export const MAX_ZOOM = 5;

/** Holds a view between the whole picture and MAX_ZOOM, with the picture still covering its box. */
export function clampView(v: View, box: { width: number; height: number }): View {
  const scale = Math.min(MAX_ZOOM, Math.max(1, v.scale));
  const maxX = ((scale - 1) * box.width) / 2;
  const maxY = ((scale - 1) * box.height) / 2;
  return { scale, x: Math.min(maxX, Math.max(-maxX, v.x)) || 0, y: Math.min(maxY, Math.max(-maxY, v.y)) || 0 };
}

/**
 * The view after the fingers' midpoint moved from `from` to `to` (both
 * measured from the box's centre) while their spread changed by `factor`:
 * whatever was under the fingers stays under them.
 */
export function pinchView(start: View, from: { x: number; y: number }, to: { x: number; y: number }, factor: number, box: { width: number; height: number }): View {
  const scale = Math.min(MAX_ZOOM, Math.max(1, start.scale * factor));
  const k = scale / start.scale;
  return clampView({ scale, x: to.x - (from.x - start.x) * k, y: to.y - (from.y - start.y) * k }, box);
}
