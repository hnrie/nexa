package fish.nexa.voice

import org.junit.Assert.assertEquals
import org.junit.Test

/** Stream modes as shareQuality.test.ts has them. */
class SharePlanTest {
    @Test fun performanceAndQuality() {
        assertEquals(VideoCap.SharePlan("1080p", 60, 6_000_000, true), VideoCap.sharePlan("performance", null, null, null, null))
        assertEquals(VideoCap.SharePlan("source", 60, VideoCap.MAX_SHARE_BPS, false), VideoCap.sharePlan("quality", "720p", 15, 2e6, "smooth"))
        // anything not understood, with the usual size and frame rate, is Performance
        assertEquals(VideoCap.PERFORMANCE, VideoCap.sharePlan("turbo", "1080p", 30, null, null))
    }

    @Test fun customAsChosen() {
        assertEquals(VideoCap.SharePlan("1440p", 30, VideoCap.shareBitrate("1440p", 30), true), VideoCap.sharePlan("custom", "1440p", 30, null, "smooth"))
        assertEquals(4_500_000, VideoCap.sharePlan("custom", "1440p", 30, 4.5e6, "sharp").bitrate)
        assertEquals(VideoCap.MAX_SHARE_BPS, VideoCap.sharePlan("custom", "1440p", 30, 99e9, "sharp").bitrate)
        assertEquals(VideoCap.MIN_SHARE_BPS, VideoCap.sharePlan("custom", "1440p", 30, 10.0, "sharp").bitrate)
    }

    @Test fun settingsFromBeforeModes() {
        assertEquals("performance", VideoCap.shareMode(null, "1080p", 30))
        assertEquals("custom", VideoCap.shareMode(null, "1080p", 60))
        assertEquals("smooth", VideoCap.shareKeep(null, 60))
        assertEquals("sharp", VideoCap.shareKeep(null, 15))
        assertEquals(VideoCap.SharePlan("1080p", 60, VideoCap.shareBitrate("1080p", 60), true), VideoCap.sharePlan(null, "1080p", 60, null, null))
    }
}
