package fish.nexa.notes

import fish.nexa.crypto.AttachmentMeta
import fish.nexa.crypto.MessageCrypto
import fish.nexa.ui.markdown.Js
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/**
 * What a note is, once it is opened (web/src/lib/notes/model.ts).
 *
 * A note is markdown, the same a message is written in, plus the files it
 * holds: each file sits on a line of its own in the text
 * (`![name](nexa-file:id)`) and `files` says what each id is. The head is
 * what the list of notes shows without opening the note: its title and its
 * first lines, with the files those lines show.
 *
 * Everything here was written by whoever last saved the note, which may be
 * someone else, so it is read as carefully as a message is: only what a note
 * can hold comes out of readHead and readBody.
 */
data class NoteHead(val title: String, val preview: String, val files: Map<String, AttachmentMeta>)

data class NoteBody(val md: String, val files: Map<String, AttachmentMeta>)

/** A note as it is edited: its title, its text and its files. */
data class NoteDoc(val title: String, val md: String, val files: Map<String, AttachmentMeta>)

/** What the page changed in a note (Partial<NoteDoc>): null is "not this". */
data class NoteChange(val title: String? = null, val md: String? = null, val files: Map<String, AttachmentMeta>? = null)

object NoteModel {
    /** How long a note's text may be, in characters. */
    const val MAX_CHARS = 200_000
    const val TITLE_MAX = 200
    /** How much of a note the list shows of it. */
    const val PREVIEW_CHARS = 1200
    /** How many files a note can hold; the server's limit is its blobs, which a picture takes two of. */
    const val MAX_FILES = 200
    /** How many of a preview's files ride in the head. */
    private const val PREVIEW_FILES = 6

    private val FILE_ID = Regex("^[A-Za-z0-9_-]{1,64}$")
    private val BLOB_ID = Regex("^\\d{1,20}$")
    /** RE_FILE (markdown/parse.ts): a file alone on its line. */
    private val RE_FILE = Regex("^!\\[([^\\[\\]\\n]{0,200})]\\(nexa-file:([A-Za-z0-9_-]{1,64})(?:\\?w=(\\d{1,3})(?:&a=(left|right))?|\\?a=(left|right))?\\)[ \\t]*$")
    private val CALLOUT = Regex("^(?:> ?)+")
    private val FENCE = Regex("^(`{3,})")

    /** At most n characters (code points, so an emoji is never cut in half). */
    fun cap(v: String, n: Int): String {
        if (v.length <= n) return v
        return if (v.codePointCount(0, v.length) > n) v.substring(0, v.offsetByCodePoints(0, n)) else v
    }

    /** `.replace(/\s+/g, " ").trim()`, the way JavaScript reads white space. */
    fun oneLine(s: String): String {
        val out = StringBuilder(s.length)
        var space = false
        for (c in s) {
            if (Js.isSpace(c)) {
                if (!space) out.append(' ')
                space = true
            } else {
                out.append(c)
                space = false
            }
        }
        return Js.trim(out.toString())
    }

    fun readFiles(x: JsonElement?, max: Int): Map<String, AttachmentMeta> {
        val out = LinkedHashMap<String, AttachmentMeta>()
        val o = x as? JsonObject ?: return out
        for ((id, raw) in o) {
            if (out.size >= max) break
            if (!FILE_ID.matches(id)) continue
            val meta = MessageCrypto.sanitizeAttachment(raw) ?: continue
            // a note's files are sealed like a message's: one that says it is not is not shown
            if (!BLOB_ID.matches(meta.blobId) || meta.key.isEmpty()) continue
            out[id] = meta
        }
        return out
    }

    private fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    fun readHead(x: JsonElement?): NoteHead {
        val o = x as? JsonObject ?: return NoteHead("", "", emptyMap())
        return NoteHead(
            title = str(o, "title")?.let { cap(oneLine(it), TITLE_MAX) } ?: "",
            preview = str(o, "preview")?.let { cap(it, PREVIEW_CHARS * 2) } ?: "",
            files = readFiles(o["files"], PREVIEW_FILES),
        )
    }

    fun readBody(x: JsonElement?): NoteBody {
        val o = x as? JsonObject ?: return NoteBody("", emptyMap())
        return NoteBody(str(o, "md")?.let { cap(it, MAX_CHARS) } ?: "", readFiles(o["files"], MAX_FILES))
    }

    /** Each line of a note's text with the id of the file it is, or null. A file line inside a code block is code. */
    private fun fileLines(md: String): List<Pair<String, String?>> {
        val out = ArrayList<Pair<String, String?>>()
        var fence: String? = null
        for (raw in md.split("\n")) {
            // inside a callout a line starts with "> "
            val line = raw.replaceFirst(CALLOUT, "")
            val mark = FENCE.find(Js.trimStart(line))
            if (mark != null) {
                val ticks = mark.groupValues[1]
                if (fence == null) fence = ticks
                else if (ticks.length >= fence.length && Js.trim(line) == ticks) fence = null
                out += raw to null
                continue
            }
            val m = if (fence == null && line.startsWith("![")) RE_FILE.find(line) else null
            out += raw to m?.groupValues?.get(2)
        }
        return out
    }

    /** The ids of the files a note's text shows, in order, each once. */
    fun fileIds(md: String): List<String> {
        val out = ArrayList<String>()
        val seen = HashSet<String>()
        for ((_, file) in fileLines(md)) if (file != null && seen.add(file)) out += file
        return out
    }

    /** A note's text without the lines that show the files named. */
    fun withoutFiles(md: String, ids: Set<String>): String {
        if (ids.isEmpty()) return md
        return fileLines(md).filter { (_, file) -> file == null || file !in ids }.joinToString("\n") { it.first }
    }

    /** A note's body with only the files its text still shows. */
    fun pruned(md: String, files: Map<String, AttachmentMeta>): NoteBody {
        val kept = LinkedHashMap<String, AttachmentMeta>()
        for (id in fileIds(md)) files[id]?.let { kept[id] = it }
        return NoteBody(md, kept)
    }

    /** The blobs a note holds on the server: each file, and a picture's small copy beside it. */
    fun blobIds(doc: NoteBody): List<String> {
        val out = LinkedHashSet<String>()
        for (id in fileIds(doc.md)) {
            val meta = doc.files[id] ?: continue
            out += meta.blobId
            meta.preview?.let { out += it.blobId }
        }
        return out.toList()
    }

    /** The first lines of a note, cut at the end of a line where it can be. */
    private fun previewOf(md: String): String {
        if (md.length <= PREVIEW_CHARS) return md
        val cut = md.substring(0, PREVIEW_CHARS)
        val line = cut.lastIndexOf('\n')
        if (line > PREVIEW_CHARS / 2) return cut.substring(0, line)
        // not through the middle of an emoji either: the last whole character goes
        val count = cut.codePointCount(0, cut.length)
        return cut.substring(0, cut.offsetByCodePoints(0, count - 1))
    }

    /** What the list shows of a note. */
    fun headOf(doc: NoteDoc): NoteHead {
        val preview = previewOf(doc.md)
        val files = LinkedHashMap<String, AttachmentMeta>()
        for (id in fileIds(preview).take(PREVIEW_FILES)) doc.files[id]?.let { files[id] = it }
        return NoteHead(cap(oneLine(doc.title), TITLE_MAX), preview, files)
    }

    fun sameDoc(a: NoteDoc, b: NoteDoc): Boolean {
        if (a.title != b.title || a.md != b.md) return false
        return fileIds(a.md).all { a.files[it]?.blobId == b.files[it]?.blobId }
    }

    fun filesJson(files: Map<String, AttachmentMeta>): JsonObject = buildJsonObject { for ((id, meta) in files) put(id, meta.toJson()) }

    /** A head as it is sealed. */
    fun headJson(h: NoteHead): JsonObject = buildJsonObject {
        put("title", h.title)
        put("preview", h.preview)
        put("files", filesJson(h.files))
    }

    /** A body without its document (an app from before notes were documents reads this). */
    fun bodyJson(md: String, files: Map<String, AttachmentMeta>): JsonObject = buildJsonObject {
        put("md", md)
        put("files", filesJson(files))
    }

    /** A note's title as it is shown: what it is called, or that it is not called anything yet. */
    fun name(title: String?): String = title?.let { Js.trim(it) }?.ifEmpty { null } ?: fish.nexa.ui.t("notes.untitled")
}
