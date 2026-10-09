package fish.nexa.voice

import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Keeping a 60 fps screen share moving when the link cannot carry it whole,
 * as the web does it (web/src/voice/shareAdapt.ts, where the measurements
 * are). Left to itself, libwebrtc either shrinks a share in motion when it
 * starts and never grows it back, or keeps the full size and drops frames,
 * each of them blocky. So a share keeps its resolution (VideoCap.capShare)
 * and this picks its size: every few seconds it reads what the encoder may
 * spend (its targetBitrate) and scales the picture down just far enough for
 * that to carry 60 frames a second, then back up as soon as there is room.
 *
 * It only steers a share meant for motion. At 15 or 30 frames a second the
 * share keeps its full size and gives up frames, which keeps writing
 * readable.
 */
object ShareAdapt {
    /** Bits a frame of fast motion needs per pixel to look clean: 1080p at 60 fps comes to about 7.5 Mbit/s. */
    const val MOTION_BITS_PER_PIXEL = 0.06

    /** How far short of a size the budget may fall before the share steps down to the next one. */
    private const val SHORT_TOLERANCE = 0.06

    /** The sizes a share steps through, as what the picture is divided by. */
    val STEPS = listOf(1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0)

    /** Checks in a row that say the share is short before it is made smaller, and that say there is room before it grows again. */
    private const val SHRINK_AFTER = 2
    private const val GROW_AFTER = 3

    /** How close to the next size up the budget has to come before growing, a little closer than SHORT_TOLERANCE so the size does not flip. */
    private const val GROW_TOLERANCE = 0.02

    /** Checks after a share starts in which it is never made smaller: the budget starts low and climbs over the first seconds. */
    const val START_GRACE = 3

    /** What a share at this many pixels and frames a second would have to be divided by to fit in the budget; 1 when it fits whole. */
    fun motionScale(pixels: Double, fps: Int, budgetBps: Double): Double {
        if (!(pixels > 0 && fps > 0 && budgetBps > 0) || !(pixels * fps * budgetBps).isFinite()) return 1.0
        return max(1.0, sqrt(pixels * fps * MOTION_BITS_PER_PIXEL / budgetBps))
    }

    /** The step a share is at, and the checks in a row asking for a smaller picture and for a larger one. */
    data class State(val scale: Double = 1.0, val short: Int = 0, val room: Int = 0)

    /** The smallest step that divides the picture at least `want` times (the last step when none does). */
    fun stepFor(want: Double): Double = STEPS.firstOrNull { it >= want - SHORT_TOLERANCE } ?: STEPS.last()

    /** The next step from what the latest check asks for: down soon when short, up only after a few checks with room. */
    fun nextStep(state: State, want: Double): State {
        val fit = stepFor(want)
        if (fit > state.scale + 1e-6) {
            val short = state.short + 1
            return if (short >= SHRINK_AFTER) State(fit) else State(state.scale, short, 0)
        }
        val at = STEPS.indexOfFirst { it >= state.scale - 1e-6 }
        val up = if (at > 0) STEPS[at - 1] else state.scale
        if (up < state.scale && want <= up + GROW_TOLERANCE) {
            val room = state.room + 1
            return if (room >= GROW_AFTER) State(up) else State(state.scale, 0, room)
        }
        return State(state.scale)
    }

    /** One look at a share sender's statistics: the picture going in, and what it may spend. */
    data class Sample(val width: Double, val height: Double, val budgetBps: Double?)

    /**
     * Reads a share sender's statistics, given as each entry's type and
     * members. The size is what was sent scaled back up, and the source's
     * only when nothing has been sent yet: here the source can count frames
     * before the capture is fitted to the share's box, which would shrink the
     * share for pixels it never sends.
     */
    fun readStats(stats: Collection<Pair<String, Map<String, Any?>>>, scale: Double): Sample? {
        var source: Pair<Double, Double>? = null
        var sent: Pair<Double, Double>? = null
        var budget: Double? = null
        fun pos(v: Any?): Double? = (v as? Number)?.toDouble()?.takeIf { it.isFinite() && it > 0 }
        for ((type, m) in stats) {
            if (m["kind"] != "video") continue
            if (type == "media-source") {
                val w = pos(m["width"])
                val h = pos(m["height"])
                if (w != null && h != null) source = w to h
            } else if (type == "outbound-rtp") {
                val w = pos(m["frameWidth"])
                val h = pos(m["frameHeight"])
                if (w != null && h != null && sent == null) sent = w * scale to h * scale
                budget = pos(m["targetBitrate"]) ?: budget
            }
        }
        val size = sent ?: source ?: return null
        return Sample(size.first, size.second, budget)
    }
}

/** One share sender's steering: the step it is at, and what it is for. */
class ShareAdapter(val fps: Int, val smooth: Boolean = fps >= 50) {
    private var state = ShareAdapt.State()
    private var checks = 0

    /** Only a smooth share is steered (VideoCap.SharePlan); one that keeps sharp is only held to the size cap. */
    val steering: Boolean get() = smooth

    /** The scale to send at for this look: whatever the size cap asks for, and for a share in motion whatever fits the budget. */
    fun scaleFor(sample: ShareAdapt.Sample): Double {
        val cap = VideoCap.scaleFor(sample.width.roundToInt(), sample.height.roundToInt())
        val budget = sample.budgetBps
        if (!steering || budget == null) return cap
        val want = ShareAdapt.motionScale(sample.width * sample.height, fps, budget)
        checks++
        // while the budget is still climbing at the start, the share keeps its size
        if (checks > ShareAdapt.START_GRACE || ShareAdapt.stepFor(want) <= state.scale) state = ShareAdapt.nextStep(state, want)
        return max(cap, state.scale)
    }
}
