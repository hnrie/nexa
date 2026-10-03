package fish.nexa.notes

import fish.nexa.crypto.AttachmentMeta
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.MessageCrypto
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/**
 * A note as a CRDT (web/src/lib/notes/ydoc.ts): its text and title are texts
 * and its files a map in one document, which every copy of the note edits
 * with the smallest change that gets it to what was typed. A saved body
 * carries the whole document (`y`) and, beside it, the text and files as
 * plain values, for its preview, its history and any app from before notes
 * were kept this way.
 */
object NoteDocs {
    /** Whether a body opened from a note carries its document. */
    fun hasDoc(raw: JsonElement?): Boolean {
        val o = raw as? JsonObject ?: return false
        return (o["v"] as? JsonPrimitive)?.intOrNull == 2 && (o["y"] as? JsonPrimitive)?.isString == true
    }

    /** The document's bytes, from a body that has one. */
    fun docBytes(raw: JsonElement?): ByteArray? {
        if (!hasDoc(raw)) return null
        return Bytes.unb64OrNull(((raw as JsonObject)["y"] as JsonPrimitive).contentOrNull)
    }

    /** The note as its document holds it, read as carefully as anything someone else wrote. */
    fun readDoc(doc: NoteDocument): NoteDoc {
        val files = try {
            MessageCrypto.json.parseToJsonElement(doc.filesJson())
        } catch (_: Exception) {
            JsonObject(emptyMap())
        }
        val body = NoteModel.readBody(buildJsonObject {
            put("md", doc.text(NoteDocument.MD))
            put("files", files)
        })
        return NoteDoc(doc.text(NoteDocument.TITLE), body.md, body.files)
    }

    /**
     * Puts what the page now holds into the document as the smallest edits
     * that get it there; returns the updates that made, for the others. Files
     * are only ever added: one the text no longer shows is left in the map,
     * where someone else's undo can still find it, and saving leaves it out
     * of the note (NoteModel.pruned).
     */
    fun applyDoc(doc: NoteDocument, change: NoteChange): List<ByteArray> {
        val out = ArrayList<ByteArray>()
        val edits = ArrayList<TextEdit>()
        for ((name, value) in listOf(NoteDocument.TITLE to change.title, NoteDocument.MD to change.md)) {
            if (value == null) continue
            edits += TextDelta.edits(name, TextDelta.delta(doc.text(name), value))
        }
        if (edits.isNotEmpty()) doc.edit(edits)?.let { out += it }
        val files = change.files
        if (!files.isNullOrEmpty()) {
            val was = try {
                MessageCrypto.json.parseToJsonElement(doc.filesJson()) as? JsonObject
            } catch (_: Exception) {
                null
            }
            val changed = buildJsonObject {
                for ((id, meta) in files) {
                    val now = meta.toJson()
                    val before = was?.get(id) as? JsonObject
                    if (before != null && sameJson(before, now)) continue
                    put(id, now)
                }
            }
            if (changed.isNotEmpty()) doc.setFiles(changed.toString())?.let { out += it }
        }
        return out
    }

    /** Two JSON objects with the same fields, in whatever order (numbers compared as numbers). */
    private fun sameJson(a: JsonElement, b: JsonElement): Boolean = when {
        a is JsonObject && b is JsonObject -> a.keys == b.keys && a.all { (k, v) -> sameJson(v, b[k]!!) }
        a is JsonPrimitive && b is JsonPrimitive ->
            if (a.isString || b.isString) a.isString == b.isString && a.content == b.content
            else a.content == b.content || (a.content.toDoubleOrNull() != null && a.content.toDoubleOrNull() == b.content.toDoubleOrNull())
        else -> a == b
    }

    /** The document a saved body holds, or the one made from its plain text when it holds none. */
    fun docFromBody(noteId: String, version: Int, title: String, raw: JsonElement?): NoteDocument {
        docBytes(raw)?.let { bytes ->
            val doc = NoteDocument.create()
            if (doc.apply(bytes)) return doc
            // a document that cannot be read is no document: the plain text stands in
            doc.close()
        }
        val body = NoteModel.readBody(raw)
        return NoteDocument.starting(noteId, version, title, body.md, filesSorted(body.files))
    }

    private fun filesSorted(files: Map<String, AttachmentMeta>): String? =
        if (files.isEmpty()) null else buildJsonObject { for (id in files.keys.sorted()) put(id, files.getValue(id).toJson()) }.toString()

    /** The body to save: the whole document, and the note as plain values. */
    fun bodyOf(doc: NoteDocument, md: String, files: Map<String, AttachmentMeta>): JsonObject = buildJsonObject {
        put("v", 2)
        put("y", Bytes.b64(doc.encodeState()))
        put("md", md)
        put("files", NoteModel.filesJson(files))
    }
}

/**
 * What changed between two texts, as the few steps that turn one into the
 * other (web/src/lib/notes/textDiff.ts): keep so many characters, take so
 * many out, put this in. Formatting a word adds its markers on both sides;
 * the word itself is kept, not taken out and put back, so someone typing in
 * it at the same time keeps what they typed. Lengths are UTF-16 units, but a
 * change never cuts a character in half.
 */
object TextDelta {
    sealed interface Step
    data class Retain(val n: Int) : Step
    data class Delete(val n: Int) : Step
    data class Insert(val s: String) : Step

    /** Past this many characters on both sides of what differs, the middle is replaced whole rather than compared. */
    private const val COMPARE_MAX = 4000

    private fun high(c: Char) = c in '\uD800'..'\uDBFF'
    private fun low(c: Char) = c in '\uDC00'..'\uDFFF'

    fun delta(a: String, b: String): List<Step> {
        if (a == b) return emptyList()
        var pre = 0
        val max = minOf(a.length, b.length)
        while (pre < max && a[pre] == b[pre]) pre++
        // not between the two halves of one character
        if (pre > 0 && pre < a.length && low(a[pre]) && high(a[pre - 1])) pre--
        var suf = 0
        while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] == b[b.length - 1 - suf]) suf++
        if (suf > 0 && suf < a.length - pre && low(a[a.length - suf]) && high(a[a.length - suf - 1])) suf--
        val midA = a.substring(pre, a.length - suf)
        val midB = b.substring(pre, b.length - suf)
        val out = ArrayList<Step>()
        if (pre > 0) out += Retain(pre)
        when {
            midA.isEmpty() -> out += Insert(midB)
            midB.isEmpty() -> out += Delete(midA.length)
            midA.length + midB.length > COMPARE_MAX -> {
                out += Delete(midA.length)
                out += Insert(midB)
            }
            else -> out += compare(midA, midB)
        }
        return tidy(out)
    }

    /** Joins neighbouring steps of the same kind and drops empty ones; a trailing keep says nothing. */
    private fun tidy(steps: List<Step>): List<Step> {
        val out = ArrayList<Step>()
        for (s in steps) {
            val last = out.lastOrNull()
            when (s) {
                is Retain -> if (s.n > 0) { if (last is Retain) out[out.lastIndex] = Retain(last.n + s.n) else out += s }
                is Delete -> if (s.n > 0) { if (last is Delete) out[out.lastIndex] = Delete(last.n + s.n) else out += s }
                is Insert -> if (s.s.isNotEmpty()) { if (last is Insert) out[out.lastIndex] = Insert(last.s + s.s) else out += s }
            }
        }
        while (out.lastOrNull() is Retain) out.removeAt(out.lastIndex)
        return out
    }

    private fun chars(s: String): List<String> {
        val out = ArrayList<String>(s.length)
        var i = 0
        while (i < s.length) {
            val n = Character.charCount(s.codePointAt(i))
            out += s.substring(i, i + n)
            i += n
        }
        return out
    }

    /** The shortest edit between two short texts, whole characters at a time (Myers's O(ND) difference). */
    private fun compare(a: String, b: String): List<Step> {
        val x = chars(a)
        val y = chars(b)
        val n = x.size
        val m = y.size
        val offset = n + m
        val v = IntArray(2 * offset + 2)
        val trace = ArrayList<IntArray>()
        run outer@{
            for (d in 0..n + m) {
                trace += v.copyOf()
                var k = -d
                while (k <= d) {
                    var i = if (k == -d || (k != d && v[offset + k - 1] < v[offset + k + 1])) v[offset + k + 1] else v[offset + k - 1] + 1
                    var j = i - k
                    while (i < n && j < m && x[i] == y[j]) {
                        i++
                        j++
                    }
                    v[offset + k] = i
                    if (i >= n && j >= m) return@outer
                    k += 2
                }
            }
        }
        // walk back from the end, one step of the edit at a time
        val steps = ArrayList<Int>() // 0 keep, 1 delete, 2 insert
        var i = n
        var j = m
        for (d in trace.size - 1 downTo 1) {
            val prev = trace[d]
            val k = i - j
            val down = k == -d || (k != d && prev[offset + k - 1] < prev[offset + k + 1])
            val pk = if (down) k + 1 else k - 1
            val pi = prev[offset + pk]
            val pj = pi - pk
            while (i > pi && j > pj) {
                steps += 0
                i--
                j--
            }
            steps += if (down) 2 else 1
            if (down) j-- else i--
        }
        while (i > 0 && j > 0) {
            steps += 0
            i--
            j--
        }
        steps.reverse()
        val out = ArrayList<Step>()
        var ai = 0
        var bi = 0
        for (s in steps) {
            when (s) {
                0 -> {
                    out += Retain(x[ai].length)
                    ai++
                    bi++
                }
                1 -> {
                    out += Delete(x[ai].length)
                    ai++
                }
                else -> {
                    out += Insert(y[bi])
                    bi++
                }
            }
        }
        return out
    }

    /** The steps as edits for the document, each at its place once the ones before it are made. */
    fun edits(text: String, steps: List<Step>): List<TextEdit> {
        val out = ArrayList<TextEdit>()
        var at = 0
        var k = 0
        while (k < steps.size) {
            when (val s = steps[k]) {
                is Retain -> at += s.n
                is Delete -> {
                    // a deletion with what replaces it is one edit
                    val next = steps.getOrNull(k + 1) as? Insert
                    out += TextEdit(text, at, s.n, next?.s ?: "")
                    if (next != null) {
                        at += next.s.length
                        k++
                    }
                }
                is Insert -> {
                    out += TextEdit(text, at, 0, s.s)
                    at += s.s.length
                }
            }
            k++
        }
        return out
    }

    /** Applies steps to a text: what the document does with them, for tests. */
    fun apply(a: String, steps: List<Step>): String {
        var at = 0
        val out = StringBuilder()
        for (s in steps) when (s) {
            is Retain -> {
                out.append(a, at, at + s.n)
                at += s.n
            }
            is Delete -> at += s.n
            is Insert -> out.append(s.s)
        }
        out.append(a, at, a.length)
        return out.toString()
    }
}
