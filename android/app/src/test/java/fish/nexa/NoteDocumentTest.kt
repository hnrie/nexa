package fish.nexa

import fish.nexa.crypto.Bytes
import fish.nexa.notes.NoteDocument
import fish.nexa.notes.TextDiff
import fish.nexa.notes.YDoc
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * yrs against the web's Yjs: a note seeded on a phone and in a browser is the
 * same document, and each side's edits land in the other unchanged.
 * The JVM test needs the host build of android/ydoc (cargo build --release);
 * on the device the same code runs from the APK.
 */
class NoteDocumentTest {
    private val v = Json.parseToJsonElement(javaClass.getResource("/web-ydoc-vectors.json")!!.readText()).jsonObject
    private fun s(k: String) = v[k]!!.jsonPrimitive.content

    private fun hostLib(): Boolean {
        val lib = File(System.getProperty("user.dir"), "../ydoc/target/release/libnexa_ydoc.dylib").canonicalFile
        val so = File(System.getProperty("user.dir"), "../ydoc/target/release/libnexa_ydoc.so").canonicalFile
        val found = listOf(lib, so).firstOrNull { it.exists() } ?: return false
        System.setProperty("nexa.ydoc.path", found.path)
        return true
    }

    @Test fun diffNeverSplitsACharacter() {
        assertEquals(Triple(4, 0, " there"), TextDiff.edit("hello", "hell there o".let { "hell" + " there" + "o" }))
        assertNull(TextDiff.edit("same", "same"))
        val e = TextDiff.edit("a😀b", "a😁b")!!
        assertEquals(1, e.first)
        assertEquals(2, e.second)
        assertEquals("😁", e.third)
    }

    @Test fun startingClientMatches() {
        assertEquals(v["client"]!!.jsonPrimitive.long, YDoc.startingClient("12345", 7))
    }

    @Test fun seededDocumentsAreTheSame() {
        assumeTrue(hostLib())
        val filesJson = v["files"].toString()
        NoteDocument.starting("12345", 7, "Shopping 🛒", "eggs\nmilk 🥛\nbread", filesJson).use { mine ->
            // the browser's copy of the very same seed adds nothing new
            mine.apply(Bytes.unb64(s("full")))
            assertEquals("Shopping 🛒", mine.text(NoteDocument.TITLE))
            assertEquals("eggs\nmilk 🥛\nbread", mine.text(NoteDocument.MD))
            // the browser's edit lands where it was made
            mine.apply(Bytes.unb64(s("edit")))
            assertEquals(s("afterMd"), mine.text(NoteDocument.MD))
            val files = Json.parseToJsonElement(mine.filesJson()).jsonObject
            assertEquals(3000000000L, files["f2"]!!.jsonObject["size"]!!.jsonPrimitive.long)
            // and an edit made here goes back as an update of its own
            val up = mine.replaceText(NoteDocument.MD, s("afterMd") + "\njam")!!
            NoteDocument.create().use { other ->
                other.apply(Bytes.unb64(s("full")))
                other.apply(Bytes.unb64(s("edit")))
                other.apply(up)
                assertEquals(s("afterMd") + "\njam", other.text(NoteDocument.MD))
            }
            File(System.getProperty("user.dir"), "build/ydoc-from-android.json").writeText(
                "{\"full\":\"${Bytes.b64(mine.encodeState())}\",\"md\":${Json.encodeToString(kotlinx.serialization.json.JsonPrimitive(mine.text(NoteDocument.MD)))}}"
            )
        }
    }
}
