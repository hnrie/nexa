package fish.nexa

import fish.nexa.crypto.Bytes
import fish.nexa.crypto.NoteCrypto
import fish.nexa.net.ApiError
import fish.nexa.notes.Carets
import fish.nexa.notes.Changes
import fish.nexa.notes.FailureKind
import fish.nexa.notes.Fetched
import fish.nexa.notes.NoteChange
import fish.nexa.notes.NoteDoc
import fish.nexa.notes.NoteDocs
import fish.nexa.notes.NoteDocument
import fish.nexa.notes.NoteSession
import fish.nexa.notes.SaveState
import fish.nexa.notes.SealedChange
import fish.nexa.notes.SessionDeps
import fish.nexa.notes.SessionEvents
import fish.nexa.notes.SessionStart
import fish.nexa.notes.SessionTiming
import fish.nexa.notes.TextDelta
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * Several people's copies of one note against a pretend server (a port of
 * web/src/lib/notes/session.test.ts): each change is numbered, kept and
 * passed on as the real one does, but the passing on waits until the test
 * lets it through, in whatever order the test likes, so the changes cross
 * every way they can on a real network.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NoteSessionTest {
    private fun hostLib(): Boolean {
        val lib = File(System.getProperty("user.dir"), "../ydoc/target/release/libnexa_ydoc.dylib").canonicalFile
        val so = File(System.getProperty("user.dir"), "../ydoc/target/release/libnexa_ydoc.so").canonicalFile
        val found = listOf(lib, so).firstOrNull { it.exists() } ?: return false
        System.setProperty("nexa.ydoc.path", found.path)
        return true
    }

    private fun plainSeal(v: JsonElement) = "S:$v"
    private fun plainOpen(s: String): JsonElement = Json.parseToJsonElement(s.substring(2))

    private class Event(val to: Page, val seq: Long, val update: String, val cid: String)

    private inner class Server(title: String, md: String) {
        var version = 1
        var head = plainSeal(buildJsonObject { put("title", title); put("preview", md); put("files", JsonObject(emptyMap())) })
        var body = plainSeal(buildJsonObject { put("md", md); put("files", JsonObject(emptyMap())) })
        var crdtSeq = 0L
        var crdtUpto = 0L
        val log = ArrayList<Triple<Long, String, String>>()
        val pages = ArrayList<Page>()
        var pending = ArrayList<Event>()

        fun post(update: String, cid: String): Long {
            val seq = ++crdtSeq
            log += Triple(seq, update, cid)
            for (p in pages) if (p.open) pending += Event(p, seq, update, cid)
            return seq
        }

        fun save(h: String, b: String, base: Int, upto: Long): Int {
            if (base != version || upto < crdtUpto) throw ApiError(409, "note_stale", "stale")
            if (upto > crdtSeq) throw ApiError(400, "bad_note", "bad")
            version += 1
            head = h
            body = b
            crdtUpto = upto
            log.removeAll { it.first <= upto }
            return version
        }

        fun changes(after: Long) = Changes(log.filter { it.first > after }.map { SealedChange(it.first, it.second) }, crdtUpto, false)

        suspend fun TestScope.deliver(shuffle: Boolean = false) {
            val batch = pending
            pending = ArrayList()
            if (shuffle) batch.shuffle()
            for (e in batch) if (e.to.open) e.to.session.remote(e.seq, e.update, e.cid, e.to.cid)
            settle()
        }
    }

    /** One person's copy with the note open: what the editor shows, and the session behind it. */
    private inner class Page(val server: Server, name: String, scope: TestScope) {
        var shown: NoteDoc
        var caretAt: Int? = null
        var open = true
        val cid = "$name-${(Math.random() * 1e6).toInt()}"
        val session: NoteSession

        init {
            server.pages += this
            val head = plainOpen(server.head) as JsonObject
            val deps = object : SessionDeps {
                override suspend fun send(update: ByteArray, keepalive: Boolean): Long = server.post("U:" + Bytes.b64(update), cid)
                override suspend fun changes(after: Long): Changes = server.changes(after)
                override suspend fun openUpdate(sealed: String): ByteArray = Bytes.unb64(sealed.substring(2))
                override suspend fun save(head: String, body: String, base: Int, files: List<String>, upto: Long, keep: Boolean, keepalive: Boolean): Int = server.save(head, body, base, upto)
                override suspend fun fetch(): Fetched = Fetched(server.version, server.head, server.body, server.crdtUpto)
                override suspend fun seal(part: NoteCrypto.Part, value: JsonElement): String = plainSeal(value)
                override suspend fun open(part: NoteCrypto.Part, sealed: String): JsonElement = plainOpen(sealed)
                override fun kind(err: Throwable): FailureKind = when {
                    err !is ApiError -> FailureKind.OTHER
                    err.code == "note_stale" -> FailureKind.STALE
                    err.status == 0 -> FailureKind.OFFLINE
                    else -> FailureKind.OTHER
                }
            }
            session = NoteSession(
                deps,
                SessionStart("note-1", server.version, head["title"]!!.jsonPrimitive.content, plainOpen(server.body), server.crdtUpto),
                object : SessionEvents {
                    override fun onState(state: SaveState, error: Throwable?) {}
                    override fun onRemote(doc: NoteDoc, at: Carets?): Boolean {
                        shown = doc
                        at?.md?.let { caretAt = it }
                        return true
                    }
                    override fun read(): NoteChange = NoteChange(title = shown.title, md = shown.md)
                    override fun caret(): Carets = Carets(caretAt, null)
                },
                scope.backgroundScope,
                SessionTiming(sendDelay = 0, sendMax = 0, saveIdle = 10_000_000, saveMax = 10_000_000, retry = 5, jitter = false),
                now = { scope.testScheduler.currentTime },
            )
            shown = session.doc
            session.catchUp()
        }

        fun type(at: Int, text: String) {
            val md = shown.md
            shown = shown.copy(md = md.substring(0, at) + text + md.substring(at))
            session.edit(NoteChange(md = shown.md))
        }

        fun typeAtCaret(text: String) {
            val at = caretAt ?: shown.md.length
            type(at, text)
            caretAt = at + text.length
        }

        fun title(text: String) {
            shown = shown.copy(title = text)
            session.edit(NoteChange(title = text))
        }
    }

    private fun TestScope.settle() {
        repeat(12) {
            advanceTimeBy(1)
            runCurrent()
        }
    }

    private suspend fun TestScope.sync(server: Server, shuffle: Boolean = false) {
        repeat(10) {
            settle()
            if (server.pending.isEmpty()) {
                settle()
                if (server.pending.isEmpty()) return
            }
            with(server) { deliver(shuffle) }
        }
    }

    private fun count(hay: String, needle: String) = hay.split(needle).size - 1

    @Test fun keepsBothPeoplesWordsInOneSentence() = runTest {
        assumeTrue(hostLib())
        val server = Server("Plan", "We leave on Friday.")
        val alice = Page(server, "alice", this)
        val bob = Page(server, "bob", this)
        sync(server)
        // both type at the very same place before either hears of the other
        alice.type(18, " at nine")
        bob.type(18, " by train")
        sync(server)
        assertEquals(alice.shown.md, bob.shown.md)
        assertEquals(1, count(alice.shown.md, " at nine"))
        assertEquals(1, count(alice.shown.md, " by train"))
        assertEquals(1, count(alice.shown.md, "We leave on Friday"))
        assertTrue(alice.shown.md.endsWith("."))
    }

    @Test fun threePeoplesFastTypingComesTogetherEverywhere() = runTest {
        assumeTrue(hostLib())
        val server = Server("Ideas", "Start\nEnd")
        val people = listOf("ann", "ben", "cat").map { Page(server, it, this) }
        sync(server)
        val words = listOf("apples ", "boats ", "candles ")
        for (i in 0 until 8) {
            people.forEachIndexed { k, p ->
                val word = words[k]
                if (i < word.length) p.type(p.shown.md.indexOf("\nEnd"), word[i].toString())
            }
            settle()
            with(server) { deliver(shuffle = true) }
        }
        sync(server, shuffle = true)
        val md = people[0].shown.md
        for (p in people) assertEquals(md, p.shown.md)
        // every letter once: nothing doubled, nothing lost
        assertEquals("Start\nEnd".length + words.joinToString("").length, md.length)
        assertTrue(md.startsWith("Start"))
        assertTrue(md.endsWith("\nEnd"))
    }

    @Test fun keepsEachPersonsWordsTogetherAtTheSameSpot() = runTest {
        assumeTrue(hostLib())
        repeat(6) { round ->
            val server = Server("Plan", "We leave on Friday\nBring snacks")
            val alice = Page(server, "alice", this)
            val bob = Page(server, "bob", this)
            sync(server)
            alice.caretAt = 18
            bob.caretAt = 18
            val a = " at nine"
            val b = " by train"
            for (i in 0 until maxOf(a.length, b.length)) {
                if (i < a.length) alice.typeAtCaret(a[i].toString())
                if (i < b.length) bob.typeAtCaret(b[i].toString())
                settle()
                with(server) { deliver(shuffle = round % 2 == 1) }
            }
            sync(server, shuffle = true)
            assertEquals(alice.shown.md, bob.shown.md)
            val line = alice.shown.md.split("\n")[0]
            assertTrue(line, line == "We leave on Friday$a$b" || line == "We leave on Friday$b$a")
            assertTrue(alice.shown.md.endsWith("\nBring snacks"))
        }
    }

    @Test fun movesACaretPastWhatIsPutInBeforeIt() {
        fun s(vararg p: Pair<Char, Int>) = p.map { NoteDocument.Step(it.first, it.second) }
        assertEquals(8, NoteSession.moveThrough(5, s('r' to 2, 'i' to 3)))
        assertEquals(5, NoteSession.moveThrough(5, s('r' to 5, 'i' to 3)))
        assertEquals(3, NoteSession.moveThrough(5, s('r' to 1, 'd' to 2)))
        assertEquals(3, NoteSession.moveThrough(5, s('r' to 3, 'd' to 4)))
        assertEquals(5, NoteSession.moveThrough(5, s('r' to 7, 'd' to 1)))
        assertEquals(0, NoteSession.moveThrough(0, s('i' to 1)))
    }

    @Test fun doesNotDoubleAnOldNoteOpenedByTwoAtOnce() = runTest {
        assumeTrue(hostLib())
        val server = Server("Old Note", "Line one\nLine two")
        assertFalse(NoteDocs.hasDoc(plainOpen(server.body)))
        val alice = Page(server, "alice", this)
        val bob = Page(server, "bob", this)
        alice.type(8, " (edited)")
        bob.type(17, "!")
        sync(server)
        assertEquals("Line one (edited)\nLine two!", alice.shown.md)
        assertEquals(alice.shown.md, bob.shown.md)
        val carol = Page(server, "carol", this)
        sync(server)
        assertEquals(alice.shown.md, carol.shown.md)
        assertEquals("Old Note", carol.shown.title)
    }

    @Test fun putsTwoTitlesTypedAtOnceTogether() = runTest {
        assumeTrue(hostLib())
        val server = Server("Trip", "")
        val alice = Page(server, "alice", this)
        val bob = Page(server, "bob", this)
        alice.title("Trip to the coast")
        bob.title("Summer Trip")
        sync(server)
        assertEquals(alice.shown.title, bob.shown.title)
        assertTrue(alice.shown.title.contains("to the coast"))
        assertTrue(alice.shown.title.contains("Summer"))
        assertEquals(1, count(alice.shown.title, "Trip"))
    }

    @Test fun savesTheWholeNoteAndOpensFromItTheSame() = runTest {
        assumeTrue(hostLib())
        val server = Server("Shopping", "milk")
        val alice = Page(server, "alice", this)
        val bob = Page(server, "bob", this)
        alice.type(4, ", eggs")
        bob.type(0, "- ")
        sync(server)
        alice.session.save(force = true).join()
        assertEquals(2, server.version)
        assertEquals(2L, server.crdtUpto)
        assertTrue(server.log.isEmpty())
        val body = plainOpen(server.body)
        assertTrue(NoteDocs.hasDoc(body))
        assertEquals("- milk, eggs", (body as JsonObject)["md"]!!.jsonPrimitive.content)
        bob.type(12, ", bread")
        sync(server)
        val later = Page(server, "later", this)
        sync(server)
        assertEquals("- milk, eggs, bread", later.shown.md)
        assertEquals(later.shown.md, alice.shown.md)
    }

    @Test fun goesAgainOverASaveThatCrossedAnother() = runTest {
        assumeTrue(hostLib())
        val server = Server("Draft", "one")
        val alice = Page(server, "alice", this)
        val bob = Page(server, "bob", this)
        alice.type(3, " two")
        bob.type(0, "zero ")
        settle()
        val a = alice.session.save(force = true)
        val b = bob.session.save(force = true)
        a.join()
        b.join()
        sync(server)
        assertTrue(server.version >= 3)
        assertEquals("zero one two", (plainOpen(server.body) as JsonObject)["md"]!!.jsonPrimitive.content)
        assertEquals("zero one two", alice.shown.md)
        assertEquals("zero one two", bob.shown.md)
    }

    @Test fun smallestEditKeepsAFormattedWord() {
        val steps = TextDelta.delta("say hello now", "say **hello** now")
        // the word itself is kept, its markers put in on both sides
        assertTrue(steps.none { it is TextDelta.Delete })
        assertEquals("say **hello** now", TextDelta.apply("say hello now", steps))
        val emoji = TextDelta.delta("a😀b", "a😁b")
        assertEquals("a😁b", TextDelta.apply("a😀b", emoji))
    }
}
