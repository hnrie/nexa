package fish.nexa.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Whether a call's pictures are on screen, as the web's videoShown.test.ts has it. */
class VideoShownTest {
    @Test fun followsTheCallViewsOfThatCall() {
        val other = VideoShown.viewOpen("another")
        val first = VideoShown.viewOpen("call")
        val second = VideoShown.viewOpen("call")
        assertEquals(2, VideoShown.open.value["call"])
        first()
        first() // closing twice counts once
        assertTrue(VideoShown.shown(VideoShown.open.value, "call", inFront = true, floating = false))
        second()
        assertFalse(VideoShown.shown(VideoShown.open.value, "call", inFront = true, floating = false))
        other()
        assertEquals(emptyMap<String, Int>(), VideoShown.open.value)
    }

    @Test fun isOffBehindOtherAppsUnlessFloating() {
        val open = mapOf("call" to 1)
        assertFalse(VideoShown.shown(open, "call", inFront = false, floating = false))
        assertTrue(VideoShown.shown(open, "call", inFront = false, floating = true))
        assertTrue(VideoShown.shown(emptyMap(), "call", inFront = true, floating = true))
        assertFalse(VideoShown.shown(open, "moved", inFront = true, floating = false))
    }
}
