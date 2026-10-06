package fish.nexa.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same cases as the web's shareAdapt.test.ts, so a share in motion is sized alike on both. */
class ShareAdaptTest {
    private val p1080 = 1920.0 * 1080

    @Test
    fun asksForScalingOnlyWhenTheBudgetFallsShort() {
        assertEquals(1.0, ShareAdapt.motionScale(p1080, 60, 9_000_000.0), 0.0)
        val at4 = ShareAdapt.motionScale(p1080, 60, 4_000_000.0)
        assertTrue(at4 > 1.3 && at4 < 1.45)
        assertTrue(ShareAdapt.motionScale(p1080, 60, 1_000_000.0) > ShareAdapt.motionScale(p1080, 60, 2_000_000.0))
        // nothing to go on is no reason to shrink
        for (bad in listOf(0.0, -1.0, Double.NaN, Double.POSITIVE_INFINITY)) assertEquals(1.0, ShareAdapt.motionScale(p1080, 60, bad), 0.0)
        assertTrue(ShareAdapt.MOTION_BITS_PER_PIXEL * p1080 * 60 < VideoCap.shareBitrate("1080p", 60))
    }

    @Test
    fun roundsAWishUpToTheNextStep() {
        assertEquals(1.0, ShareAdapt.stepFor(1.0), 0.0)
        // a budget a little short of the full size keeps it
        assertEquals(1.0, ShareAdapt.stepFor(1.04), 0.0)
        assertEquals(1.25, ShareAdapt.stepFor(1.1), 0.0)
        assertEquals(1.75, ShareAdapt.stepFor(1.6), 0.0)
        assertEquals(ShareAdapt.STEPS.last(), ShareAdapt.stepFor(9.0), 0.0)
    }

    @Test
    fun shrinksAfterTwoShortChecksInARow() {
        var st = ShareAdapt.nextStep(ShareAdapt.State(), 1.6)
        assertEquals(1.0, st.scale, 0.0)
        st = ShareAdapt.nextStep(st, 1.6)
        assertEquals(1.75, st.scale, 0.0)
        // a good check in between starts the count over
        st = ShareAdapt.nextStep(ShareAdapt.State(), 1.6)
        st = ShareAdapt.nextStep(st, 1.0)
        st = ShareAdapt.nextStep(st, 1.6)
        assertEquals(1.0, st.scale, 0.0)
    }

    @Test
    fun growsBackOneStepAtATime() {
        var st = ShareAdapt.State(2.0)
        st = ShareAdapt.nextStep(st, 1.0)
        st = ShareAdapt.nextStep(st, 1.0)
        assertEquals(2.0, st.scale, 0.0)
        st = ShareAdapt.nextStep(st, 1.0)
        assertEquals(1.75, st.scale, 0.0)
        st = ShareAdapt.State(1.25)
        repeat(3) { st = ShareAdapt.nextStep(st, 0.95) }
        assertEquals(1.0, st.scale, 0.0)
        // between one size's tolerance and the next nothing changes, so the share does not flip
        st = ShareAdapt.State(1.5)
        repeat(5) { st = ShareAdapt.nextStep(st, 1.3) }
        assertEquals(1.5, st.scale, 0.0)
    }

    @Test
    fun readsWhatWasSentAndTheEncodersTarget() {
        val source = "media-source" to mapOf<String, Any?>("kind" to "video", "width" to 2560L, "height" to 1440L)
        val sent = "outbound-rtp" to mapOf<String, Any?>("kind" to "video", "frameWidth" to 1280L, "frameHeight" to 720L, "targetBitrate" to 5_000_000.0)
        val audio = "outbound-rtp" to mapOf<String, Any?>("kind" to "audio", "targetBitrate" to 64_000.0)
        // what was sent, scaled back up, wins over a source that may not be fitted to the box yet
        assertEquals(ShareAdapt.Sample(1920.0, 1080.0, 5_000_000.0), ShareAdapt.readStats(listOf(source, sent, audio), 1.5))
        assertEquals(ShareAdapt.Sample(2560.0, 1440.0, null), ShareAdapt.readStats(listOf(source), 1.0))
        assertNull(ShareAdapt.readStats(emptyList(), 1.0))
    }

    @Test
    fun steersOnlyAShareMeantForMotion() {
        val slides = ShareAdapter(30)
        repeat(4) { assertEquals(1.0, slides.scaleFor(ShareAdapt.Sample(1920.0, 1080.0, 1_000_000.0)), 0.0) }
        val game = ShareAdapter(60)
        // the first seconds of a share are its budget climbing: no shrinking yet
        repeat(3) { assertEquals(1.0, game.scaleFor(ShareAdapt.Sample(1920.0, 1080.0, 2_000_000.0)), 0.0) }
        game.scaleFor(ShareAdapt.Sample(1920.0, 1080.0, 2_000_000.0))
        assertEquals(2.0, game.scaleFor(ShareAdapt.Sample(1920.0, 1080.0, 2_000_000.0)), 0.0)
        // an 8K-wide picture is held to the cap whatever the budget
        assertTrue(ShareAdapter(60).scaleFor(ShareAdapt.Sample(16384.0, 4320.0, null)) > 1.9)
    }
}
