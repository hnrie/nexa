/**
 * How far this device's clock is from the server's, measured from the `now`
 * every ready carries. Server times shown as running clocks (a call's timer)
 * go through it, so a phone whose clock runs 40 seconds fast does not start
 * every call at 0:40. A ready from a server without `now` leaves it at zero.
 */
let offset = 0;

/** Takes the server's clock from a ready, as the ready arrives. */
export function setServerNow(serverMs: number | undefined, localMs = Date.now()): void {
  offset = typeof serverMs === "number" && serverMs > 0 ? serverMs - localMs : 0;
}

/** The server's time for a moment on this device's clock (now, by default). */
export function serverNow(localMs = Date.now()): number {
  return localMs + offset;
}
