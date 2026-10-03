package fish.nexa.search

import fish.nexa.crypto.MessagePayload
import fish.nexa.data.ChatMessage
import fish.nexa.data.DecryptFail
import fish.nexa.net.ApiError
import fish.nexa.net.Channel
import fish.nexa.net.Message
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The walk through history without a server or a clock (web/src/search/crawler.test.ts):
 * which pages are asked for and in what order, how far apart, what is saved
 * to resume from, and what happens when the server says no or there is no key.
 */
class CrawlerTest {
    private class Call(val channel: String, val before: String?, val after: String?, val at: Long)

    private class World(spec: List<Triple<String, Int, Int>>, background: Boolean = true, maxDocs: Int = 1_000_000, initial: CrawlState? = null) {
        val history = HashMap<String, MutableList<Long>>()
        val channels = ArrayList<Channel>()
        val calls = ArrayList<Call>()
        val docs = LinkedHashMap<String, SearchDoc>()
        var saved: CrawlState? = null
        var now = 1_000_000L
        val fail = HashMap<String, Exception>()
        val locked = HashSet<String>()
        var throttleSeen = false
        lateinit var crawler: Crawler

        init {
            for ((id, count, base) in spec) {
                val ids = (1..count).map { (base + it).toLong() }.toMutableList()
                history[id] = ids
                channels += Channel(id = id, type = "dm", lastMessageId = ids.lastOrNull()?.toString())
            }
            val w = this
            crawler = Crawler(object : CrawlerDeps {
                override suspend fun list(channelId: String, before: String?, after: String?, limit: Int): List<Message> {
                    calls += Call(channelId, before, after, now)
                    fail.remove(channelId)?.let { throw it }
                    val all = history[channelId] ?: emptyList<Long>()
                    if (after != null) return all.filter { it > after.toLong() }.take(Pacing.PAGE).map { message(channelId, it) }
                    val below = if (before == null) all else all.filter { it < before.toLong() }
                    return below.takeLast(Pacing.PAGE).map { message(channelId, it) }
                }

                override fun decrypt(m: Message): ChatMessage =
                    if (m.id in locked) ChatMessage(m, error = DecryptFail.NO_KEY) else ChatMessage(m, payload = MessagePayload(t = "message ${m.id}"))

                override fun channels(): List<Channel> = w.channels

                override suspend fun index(docs: List<SearchDoc>): Int {
                    for (d in docs) w.docs[d.id] = d
                    return w.docs.size
                }

                override fun now() = w.now

                // resting with nothing to do waits to be woken; anything else is the clock moving on
                override suspend fun sleep(ms: Long) {
                    if (ms >= 60_000) awaitCancellation()
                    w.now += ms
                }

                override fun online() = true
                override fun hidden() = false
                override fun changed() {
                    if (crawler.throttled) throttleSeen = true
                }

                override fun save(state: CrawlState) {
                    saved = state
                }
            }, background, maxDocs, initial, 0)
        }

        fun message(channel: String, id: Long) = Message(id = id.toString(), channelId = channel, authorId = "u1", keyConvId = "k", keyEpoch = 1, createdAt = id)

        fun setLast(channel: String, id: Long) {
            val i = channels.indexOfFirst { it.id == channel }
            channels[i] = channels[i].copy(lastMessageId = id.toString())
        }
    }

    private suspend fun settle(w: World, until: () -> Boolean = { !w.crawler.busy }) {
        repeat(200_000) {
            if (until()) return
            yield()
        }
        throw AssertionError("the walk never settled")
    }

    private fun run(block: suspend CoroutineScope.() -> Unit) = runBlocking { block() }

    @Test
    fun walksEveryConversationNewestActivityFirst() = run {
        val w = World(listOf(Triple("a", 250, 0), Triple("b", 30, 5_000)))
        w.crawler.start(this)
        settle(w)
        w.crawler.stop()
        assertEquals(280, w.docs.size)
        // b has the newest message, so it goes first
        assertEquals("b", w.calls[0].channel)
        assertEquals(3, w.calls.count { it.channel == "a" })
        assertEquals(Crawler.Progress(2, 2, 0), w.crawler.progress(w.channels))
        val a = w.saved!!.channels["a"]!!
        assertTrue(a.done)
        assertEquals("1", a.oldest)
        assertEquals("250", a.newest)
    }

    @Test
    fun pacesRequestsAndGoesFasterWhileASearchWaits() = run {
        val w = World(listOf(Triple("a", 500, 0)))
        w.crawler.start(this)
        settle(w)
        w.crawler.stop()
        val gaps = w.calls.drop(1).mapIndexed { i, c -> c.at - w.calls[i].at }
        assertTrue(gaps.min() >= Pacing.BACKGROUND_GAP_MS)

        val v = World(listOf(Triple("a", 500, 0)), background = false)
        v.crawler.setDemand(setOf("a"), false)
        v.crawler.start(this)
        settle(v)
        v.crawler.stop()
        val fast = v.calls.drop(1).mapIndexed { i, c -> c.at - v.calls[i].at }
        assertTrue(fast.min() >= Pacing.REQUEST_GAP_MS)
        assertTrue(fast.max() < Pacing.BACKGROUND_GAP_MS)
    }

    @Test
    fun inMemoryWalksNothingUntilASearchAsks() = run {
        val w = World(listOf(Triple("a", 150, 0), Triple("b", 150, 1_000)), background = false)
        w.crawler.start(this)
        repeat(200) { yield() }
        assertEquals(0, w.calls.size)
        w.crawler.setDemand(setOf("a"), false)
        settle(w)
        assertEquals(setOf("a"), w.calls.map { it.channel }.toSet())
        w.crawler.setDemand(null, false)
        w.crawler.stop()
    }

    @Test
    fun givesALongConversationsTurnAwayAfterASlice() = run {
        val long = (Crawler.SLICE_PAGES + 5) * Pacing.PAGE
        val w = World(listOf(Triple("long", long, 100_000), Triple("short", 50, 0)))
        w.crawler.start(this)
        settle(w)
        w.crawler.stop()
        val order = w.calls.map { it.channel }
        assertEquals(List(Crawler.SLICE_PAGES) { "long" }, order.take(Crawler.SLICE_PAGES))
        assertEquals("short", order[Crawler.SLICE_PAGES])
        assertEquals(long + 50, w.docs.size)
    }

    @Test
    fun picksUpWhereTheLastSessionStopped() = run {
        val first = World(listOf(Triple("a", 350, 0)))
        first.crawler.start(this)
        settle(first) { first.saved?.channels?.get("a")?.oldest == "151" }
        first.crawler.stop()
        val saved = first.saved!!
        assertEquals("350", saved.channels["a"]!!.newest)
        assertEquals("151", saved.channels["a"]!!.oldest)

        // a new session: forty more messages arrived meanwhile
        val again = World(listOf(Triple("a", 390, 0)), initial = saved)
        again.crawler.start(this)
        settle(again)
        again.crawler.stop()
        // one page to catch up, then on down from where it was
        assertEquals("350", again.calls[0].after)
        assertNull(again.calls[0].before)
        assertEquals(listOf("151", "51"), again.calls.drop(1).map { it.before })
        val a = again.saved!!.channels["a"]!!
        assertTrue(a.done)
        assertEquals("390", a.newest)
        assertEquals("1", a.oldest)
    }

    @Test
    fun keepsUpWithLiveMessagesAndCatchesUpAfterAReconnect() = run {
        val w = World(listOf(Triple("a", 10, 0)))
        w.crawler.start(this)
        settle(w)
        w.history["a"]!! += 11
        w.setLast("a", 11)
        w.crawler.noteLive("a", "11")
        w.crawler.kick()
        settle(w)
        // held live: nothing to fetch
        assertEquals(1, w.calls.size)
        assertEquals("11", w.saved!!.channels["a"]!!.newest)

        // after a reconnect nothing can be trusted to have arrived
        w.crawler.resync()
        w.history["a"]!! += 12
        w.setLast("a", 12)
        w.crawler.kick()
        settle(w)
        w.crawler.stop()
        assertEquals("11", w.calls.last().after)
        assertTrue("12" in w.docs)
    }

    @Test
    fun waitsOutARefusalAndSaysItIsWaiting() = run {
        val w = World(listOf(Triple("a", 150, 0)))
        w.fail["a"] = ApiError(429, "rate_limited", "", retryAfter = 7)
        w.crawler.start(this)
        settle(w)
        w.crawler.stop()
        assertTrue(w.throttleSeen)
        assertFalse(w.crawler.throttled)
        assertTrue(w.calls[1].at - w.calls[0].at >= 7_000)
        assertEquals(150, w.docs.size)
    }

    @Test
    fun marksWhatItMayNotReadAndLooksAgainNextSession() = run {
        val spec = listOf(Triple("refused", 20, 0), Triple("nokey", 20, 1_000), Triple("partly", 150, 2_000))
        val w = World(spec)
        w.fail["refused"] = ApiError(403, "forbidden", "")
        for (i in 1001..1020) w.locked += i.toString()
        // the older of partly's two pages is from before this reader had a key
        for (i in 2001..2050) w.locked += i.toString()
        w.crawler.start(this)
        settle(w)
        w.crawler.stop()
        assertEquals(Crawler.Progress(3, 3, 2), w.crawler.progress(w.channels))
        val partly = w.saved!!.channels["partly"]!!
        assertTrue(partly.done)
        assertTrue(partly.locked)
        assertFalse(partly.unreadable)

        val next = World(spec, initial = w.saved)
        next.crawler.start(this)
        settle(next)
        next.crawler.stop()
        // one more look each, and the refused one is readable now
        assertEquals(listOf("nokey", "partly", "refused"), next.calls.map { it.channel }.sorted())
        // everything that was out of reach: all of two, and partly's older page
        assertEquals(20 + 20 + 50, next.docs.size)
    }

    @Test
    fun stopsReachingBackOnceTheIndexIsFull() = run {
        val w = World(listOf(Triple("a", 1_000, 0)), maxDocs = 300)
        w.crawler.start(this)
        settle(w)
        w.crawler.stop()
        assertTrue(w.crawler.capped)
        assertEquals(300, w.docs.size)
        assertEquals(3, w.calls.size)
    }

    @Test
    fun aSavedWalkIsReadBackWithAnythingOddLeftOut() {
        val good = CrawlState(mapOf("1" to ChannelCrawl(newest = "5", oldest = "2", done = true), "2" to ChannelCrawl(locked = true, readable = true)))
        val back = CrawlState.parse(good.toJson())!!
        assertEquals(good.toJson(), back.toJson())
        val odd = kotlinx.serialization.json.Json.parseToJsonElement("""{"v":1,"channels":{"x":{},"3":{"newest":"a1"},"4":{"done":"yes"},"5":{"oldest":"9"}}}""")
        assertEquals(setOf("5"), CrawlState.parse(odd)!!.channels.keys)
        assertNull(CrawlState.parse(kotlinx.serialization.json.Json.parseToJsonElement("""{"v":2,"channels":{}}""")))
    }
}
