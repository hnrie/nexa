package xyz.evilion.chat.voice

/**
 * When someone counts as speaking, for the green ring.
 *
 * Speech is full of short gaps between syllables and words, and following the
 * level reading by reading made the ring blink on and off several times a
 * second. It lights up on the first loud reading and goes out only once it has
 * been quiet for a while. The web client's `voice/speaking.ts` is the same
 * thing with the same hold, so the two clients agree about who is talking.
 */
class SpeakingGate(private val holdMs: Long = SPEAKING_HOLD_MS) {
    private var until = 0L

    /** Takes one reading and says whether they count as speaking now. */
    fun update(loud: Boolean, now: Long): Boolean {
        if (loud) until = now + holdMs
        return now < until
    }

    /** Muted or cut off: out straight away. */
    fun reset() {
        until = 0
    }

    companion object {
        /** How long it stays lit after the last loud reading. */
        const val SPEAKING_HOLD_MS = 600L

        /** Above this a reading counts as speech rather than a room. */
        const val SPEAKING_LEVEL = 0.02
    }
}
