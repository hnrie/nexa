package fish.nexa.search

import fish.nexa.crypto.Bytes
import kotlinx.serialization.json.Json
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** The index on disk (persist.ts, keys.ts, core.ts): sealed, bound to its place, and read back whole. */
class PersistTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val key = Bytes.random(32)

    private fun doc(id: Int, ch: String, t: String = "message $id") = SearchDoc(id = id.toString(), c = ch, a = "7", ts = id * 1000L, ed = null, t = t, fl = 0)

    @Test
    fun blocksComeBackAsTheyWereWritten() {
        val dir = File(tmp.root, "u1")
        val s = BlockStore(dir, "u1", key)
        assertEquals(0, s.load().docs.size)
        val docs = (1..450).map { doc(it, if (it % 3 == 0) "100" else "200") }
        for (d in docs) s.noteUpsert(d)
        s.setCrawl(Json.parseToJsonElement("""{"v":1,"channels":{"100":{"done":true}}}"""))
        val byId = docs.associateBy { it.id }
        s.flush { byId[it] }
        assertFalse(s.pending)
        // blocks of at most 200 each, per conversation: 150 in one, 300 in two
        assertEquals(3, dir.listFiles()!!.count { it.name.startsWith("b-") })

        val back = BlockStore(dir, "u1", key).load()
        assertEquals(docs.map { it.id }.toSet(), back.docs.map { it.id }.toSet())
        assertEquals(byId["9"], back.docs.first { it.id == "9" })
        assertEquals("""{"v":1,"channels":{"100":{"done":true}}}""", back.crawl.toString())
        assertTrue(back.lost.isEmpty())
    }

    @Test
    fun nothingIsKeptInTheClear() {
        val dir = File(tmp.root, "u1")
        val s = BlockStore(dir, "u1", key)
        s.load()
        val d = doc(1, "100", "a very secret sentence")
        s.noteUpsert(d)
        s.flush { if (it == "1") d else null }
        for (f in dir.listFiles()!!) assertFalse(String(f.readBytes(), Charsets.ISO_8859_1).contains("secret"))
    }

    @Test
    fun aBlockMovedElsewhereOrUnderAnotherKeyDoesNotOpen() {
        val dir = File(tmp.root, "u1")
        val s = BlockStore(dir, "u1", key)
        s.load()
        val d = doc(1, "100")
        s.noteUpsert(d)
        s.flush { if (it == "1") d else null }
        // moved to another conversation's name: its seal is bound to where it was
        File(dir, "b-100-0.bin").renameTo(File(dir, "b-300-0.bin"))
        val moved = BlockStore(dir, "u1", key).load()
        assertTrue(moved.docs.isEmpty())
        assertEquals(listOf("300"), moved.lost)
        // another account's key opens nothing
        val other = BlockStore(dir, "u2", key).load()
        assertTrue(other.docs.isEmpty())
        assertTrue(BlockStore(dir, "u1", Bytes.random(32)).load().docs.isEmpty())
    }

    @Test
    fun removalsAndRemovedConversationsLeaveTheDisk() {
        val dir = File(tmp.root, "u1")
        val core = SearchCore()
        core.open("u1", dir, key, reset = false)
        core.upsert((1..30).map { doc(it, if (it <= 10) "100" else "200") })
        core.remove(listOf("5", "6"))
        core.removeChannel("200")
        core.flush()
        val again = SearchCore()
        val res = again.open("u1", dir, key, reset = false)
        assertTrue(res.persisted)
        assertEquals(8, res.docs)
        assertEquals(mapOf("100" to 8), res.counts)
        // reset starts afresh
        assertEquals(0, SearchCore().open("u1", dir, key, reset = true).docs)
    }

    @Test
    fun pinsAndReconcilingAPage() {
        val core = SearchCore()
        core.open("u1", null, null, reset = false)
        core.upsert((1..10).map { doc(it, "100") })
        assertTrue(core.pin("3", true).changed)
        assertFalse(core.pin("3", true).changed)
        val pinned = core.query(EngineRequest(SearchQueries.resolve(SearchQueries.parse("pinned:yes"), SearchQueries.Ctx(emptyMap())), null))
        assertEquals(listOf("3"), pinned.docs.map { it.id })
        // a page from 2 to 8 without 4 and 6: those were deleted while nobody listened
        val m = core.reconcile("100", "2", "8", listOf("2", "3", "5", "7", "8"))
        assertTrue(m.changed)
        assertEquals(8, m.docs)
    }

    @Test
    fun theIndexKeyOpensOnlyWithItsIdentity() {
        val slot = object : IndexKeys.Slot {
            val map = HashMap<String, String>()
            override fun get(name: String) = map[name]
            override fun put(name: String, value: String) {
                map[name] = value
            }
            override fun delete(name: String) {
                map.remove(name)
            }
        }
        val identity = Bytes.random(32)
        val first = IndexKeys.keyFor(slot, "u1", identity)!!
        assertTrue(first.fresh)
        val again = IndexKeys.keyFor(slot, "u1", identity)!!
        assertFalse(again.fresh)
        assertArrayEquals(first.key, again.key)
        // the wrapped key is bound to the account and to the identity key
        assertNull(IndexKeys.unwrap("u2", identity, slot.map[IndexKeys.slotName("u1")]!!))
        assertNull(IndexKeys.unwrap("u1", Bytes.random(32), slot.map[IndexKeys.slotName("u1")]!!))
        // a new identity (a recovery) means a new key, and a new index with it
        val other = IndexKeys.keyFor(slot, "u1", Bytes.random(32))!!
        assertTrue(other.fresh)
        IndexKeys.forget(slot, "u1")
        assertNotNull(IndexKeys.keyFor(slot, "u1", identity))
    }
}
