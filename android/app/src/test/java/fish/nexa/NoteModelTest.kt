package fish.nexa

import fish.nexa.crypto.AttachmentMeta
import fish.nexa.crypto.AttachmentPreview
import fish.nexa.notes.NoteBody
import fish.nexa.notes.NoteDoc
import fish.nexa.notes.NoteModel
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The note model read and written as the web's is (a port of web/src/lib/notes/model.test.ts). */
class NoteModelTest {
    private fun file(blob: String, key: String = "a2V5", preview: AttachmentPreview? = null) =
        AttachmentMeta(blobId = blob, name = "a.png", type = "image/png", size = 10, key = key, preview = preview)

    private fun json(meta: AttachmentMeta): JsonObject = meta.toJson()

    @Test fun takesOnlyWhatAHeadCanHold() {
        val empty = NoteModel.readHead(null)
        assertEquals("", empty.title)
        assertEquals("", empty.preview)
        assertTrue(empty.files.isEmpty())
        assertEquals("", NoteModel.readHead(JsonPrimitive("a string")).title)
        assertEquals("", NoteModel.readHead(JsonArray(listOf(JsonPrimitive(1)))).title)
        val head = NoteModel.readHead(buildJsonObject {
            put("title", "  Shopping\n list  ")
            put("preview", "milk\n")
            put("files", buildJsonObject { put("a", json(file("12"))) })
            put("more", "ignored")
        })
        assertEquals("Shopping list", head.title)
        assertEquals("milk\n", head.preview)
        assertEquals(listOf("a"), head.files.keys.toList())
    }

    @Test fun cutsATitleAndATextLongerThanANoteCanBe() {
        assertEquals(NoteModel.TITLE_MAX, NoteModel.readHead(buildJsonObject { put("title", "x".repeat(NoteModel.TITLE_MAX + 50)) }).title.length)
        assertEquals(NoteModel.MAX_CHARS, NoteModel.readBody(buildJsonObject { put("md", "y".repeat(NoteModel.MAX_CHARS + 10)) }).md.length)
        // an emoji at the cut is left out whole rather than cut in half
        val title = "x".repeat(NoteModel.TITLE_MAX - 1) + "😀😀"
        val read = NoteModel.readHead(buildJsonObject { put("title", title) }).title
        assertTrue(read.endsWith("😀"))
        assertEquals(NoteModel.TITLE_MAX, read.codePointCount(0, read.length))
    }

    @Test fun dropsFilesThatAreNotSealedFiles() {
        val body = NoteModel.readBody(buildJsonObject {
            put("md", "")
            put("files", buildJsonObject {
                put("ok", json(file("123")))
                put("bad id!", json(file("124")))
                put("nokey", json(file("125", key = "")))
                put("blob", json(file("not-a-number")))
                put("junk", "nope")
            })
        })
        assertEquals(listOf("ok"), body.files.keys.toList())
    }

    @Test fun readsAnythingThatIsNotANoteAsAnEmptyOne() {
        assertEquals(NoteBody("", emptyMap()), NoteModel.readBody(null))
        assertEquals(NoteBody("", emptyMap()), NoteModel.readBody(buildJsonObject { put("md", 5); put("files", JsonArray(emptyList())) }))
        assertEquals(NoteBody("", emptyMap()), NoteModel.readBody(JsonNull))
    }

    private val md = listOf(
        "Intro", "![cat.png](nexa-file:a)", "> ![in a callout](nexa-file:b)", "```", "![code.png](nexa-file:c)", "```",
        "text ![inline](nexa-file:d) is not a file line", "![cat.png](nexa-file:a)", "![last one](nexa-file:e)  ",
    ).joinToString("\n")

    @Test fun listsEachFileOnceInOrderAndNotTheOnesInCode() {
        assertEquals(listOf("a", "b", "e"), NoteModel.fileIds(md))
    }

    @Test fun keepsOnlyTheFilesTheTextStillShows() {
        val pruned = NoteModel.pruned(md, mapOf("a" to file("1"), "b" to file("2"), "c" to file("3"), "gone" to file("9")))
        assertEquals(listOf("a", "b"), pruned.files.keys.toList())
    }

    @Test fun namesEveryBlobTheyNeedAPicturesSmallCopyIncluded() {
        val copy = AttachmentPreview("11", "a2V5", 4, "image/webp", 4.0, 4.0)
        val doc = NoteBody(md, mapOf("a" to file("1", preview = copy), "b" to file("2"), "c" to file("3")))
        assertEquals(listOf("1", "11", "2"), NoteModel.blobIds(doc))
    }

    @Test fun takesFileLinesOutByIdWhereverTheyAreAndLeavesCodeAlone() {
        val out = NoteModel.withoutFiles(md, setOf("a", "c"))
        assertEquals(
            listOf("Intro", "> ![in a callout](nexa-file:b)", "```", "![code.png](nexa-file:c)", "```", "text ![inline](nexa-file:d) is not a file line", "![last one](nexa-file:e)  "),
            out.split("\n"),
        )
        assertEquals(md, NoteModel.withoutFiles(md, emptySet()))
    }

    @Test fun theListShowsTheTitleAndFirstLinesWithTheirFiles() {
        val doc = NoteDoc("  Trip  ", "Day one\n![map.png](nexa-file:m)\n", mapOf("m" to file("5"), "other" to file("6")))
        val head = NoteModel.headOf(doc)
        assertEquals("Trip", head.title)
        assertEquals(doc.md, head.preview)
        assertEquals(listOf("m"), head.files.keys.toList())
    }

    @Test fun cutsALongNoteAtTheEndOfALine() {
        val lines = List(200) { "line number $it" }
        val head = NoteModel.headOf(NoteDoc("", lines.joinToString("\n"), emptyMap()))
        assertTrue(head.preview.length <= NoteModel.PREVIEW_CHARS)
        assertTrue(lines.joinToString("\n").startsWith(head.preview))
        assertTrue(head.preview.endsWith(lines[head.preview.split("\n").size - 1]))
    }

    @Test fun onlyCarriesTheFilesInsideThePartItShows() {
        val text = "x".repeat(NoteModel.PREVIEW_CHARS + 100) + "\n![late.png](nexa-file:late)\n"
        assertTrue(NoteModel.headOf(NoteDoc("", text, mapOf("late" to file("7")))).files.isEmpty())
    }

    @Test fun twoStatesAreTheSameByTitleTextAndTheFilesShown() {
        val a = NoteDoc("T", "one\n![p](nexa-file:x)\n", mapOf("x" to file("1")))
        assertTrue(NoteModel.sameDoc(a, a.copy(files = mapOf("x" to file("1"), "unused" to file("2")))))
        assertFalse(NoteModel.sameDoc(a, a.copy(title = "U")))
        assertFalse(NoteModel.sameDoc(a, a.copy(md = "two\n")))
        assertFalse(NoteModel.sameDoc(a, a.copy(files = mapOf("x" to file("3")))))
    }

    @Test fun aSealedHeadReadsBackAsTheWebWritesIt() {
        val head = NoteModel.headOf(NoteDoc("Plan", "milk\n![a](nexa-file:a)", mapOf("a" to file("12"))))
        val written = Json.parseToJsonElement(NoteModel.headJson(head).toString())
        assertEquals(head, NoteModel.readHead(written))
    }
}
