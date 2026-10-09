package fish.nexa.data

/**
 * How far this device's clock is from the server's, measured from the `now`
 * every ready carries (the web's lib/serverClock.ts). Server times shown as
 * running clocks (a call's timer) go through it, so a phone whose clock runs
 * 40 seconds fast does not start every call at 0:40. A ready from a server
 * without `now` leaves it at zero.
 */
object ServerClock {
    @Volatile private var offset = 0L

    /** Takes the server's clock from a ready, as the ready arrives. */
    fun set(serverMs: Long, localMs: Long = System.currentTimeMillis()) {
        offset = if (serverMs > 0) serverMs - localMs else 0L
    }

    /** The server's time for a moment on this device's clock (now, by default). */
    fun now(localMs: Long = System.currentTimeMillis()): Long = localMs + offset

    /** A server time on this device's clock, for what counts by it (a notification's chronometer). */
    fun toLocal(serverMs: Long): Long = serverMs - offset
}
