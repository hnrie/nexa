package fish.nexa.data

import fish.nexa.net.VoiceState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The call timer as lib/callTimer.test.ts has it. */
class CallTimerTest {
    private fun vs(user: String, joined: Long, since: Long = 0, channel: String = "c") =
        VoiceState(userId = user, channelId = channel, joinedAt = joined, callSince = since)

    @Test fun nobodyInTheCall() {
        assertNull(CallTimer.since(emptyMap(), "c"))
        assertNull(CallTimer.since(mapOf("a" to vs("a", 1000, channel = "other")), "c"))
    }

    @Test fun takesTheServersStartOfTheCall() {
        assertEquals(1000L, CallTimer.since(mapOf("b" to vs("b", 5000, 1000)), "c"))
    }

    @Test fun fallsBackToTheEarliestJoin() {
        assertEquals(2000L, CallTimer.since(mapOf("a" to vs("a", 3000), "b" to vs("b", 2000)), "c"))
    }

    @Test fun countsWholeSecondsNeverBelowZero() {
        assertEquals(61L, CallTimer.seconds(1000, 62_999))
        assertEquals(0L, CallTimer.seconds(5000, 1000))
    }

    @Test fun serverClockFollowsTheOffset() {
        ServerClock.set(10_000, 50_000)
        assertEquals(20_000L, ServerClock.now(60_000))
        assertEquals(50_000L, ServerClock.toLocal(10_000))
        ServerClock.set(0)
        assertEquals(60_000L, ServerClock.now(60_000))
    }
}
