package fish.nexa.notes

import fish.nexa.crypto.Bytes

/**
 * The JNI side of a note's CRDT: yrs (android/ydoc), which reads and writes
 * Yjs's version 1 updates, so a phone and a browser editing one note exchange
 * the same bytes. Positions count UTF-16 code units, as JavaScript strings do.
 */
object YDoc {
    @Volatile private var loaded = false

    fun load() {
        if (!loaded) {
            synchronized(this) {
                if (!loaded) {
                    val path = System.getProperty("nexa.ydoc.path")
                    if (path != null) System.load(path) else System.loadLibrary("nexa_ydoc")
                    loaded = true
                }
            }
        }
    }

    @JvmStatic external fun nativeNew(clientId: Long): Long
    @JvmStatic external fun nativeFree(h: Long)
    @JvmStatic external fun nativeApply(h: Long, update: ByteArray): Boolean
    @JvmStatic external fun nativeEncodeState(h: Long): ByteArray?
    @JvmStatic external fun nativeStateVector(h: Long): ByteArray?
    @JvmStatic external fun nativeDiff(h: Long, stateVector: ByteArray): ByteArray?
    @JvmStatic external fun nativeText(h: Long, name: String): String?
    @JvmStatic external fun nativeFiles(h: Long): String?
    @JvmStatic external fun nativeEdit(h: Long, ops: Array<String>): ByteArray?
    @JvmStatic external fun nativeSetFiles(h: Long, json: String): ByteArray?
    @JvmStatic external fun nativeMerge(updates: Array<ByteArray>): ByteArray?
    @JvmStatic external fun nativeLength(h: Long, name: String): Int

    /** The client id a note gets when first made a document from plain text: the same on every device (ydoc.ts startingClient). */
    fun startingClient(noteId: String, version: Int): Long {
        val h = Bytes.sha256(Bytes.utf8("nexa-note-start\u0000$noteId\u0000$version"))
        val v = ((h[0].toLong() and 0xff) shl 24) or ((h[1].toLong() and 0xff) shl 16) or ((h[2].toLong() and 0xff) shl 8) or (h[3].toLong() and 0xff)
        return if (v == 0L) 1L else v
    }

    fun merge(updates: List<ByteArray>): ByteArray? {
        load()
        return if (updates.size == 1) updates[0] else nativeMerge(updates.toTypedArray())
    }
}

/** One edit to a note's title or text: at `index`, take out `delete` code units and put in `insert`. */
data class TextEdit(val text: String, val index: Int, val delete: Int, val insert: String)

/**
 * A note's document: texts "title" and "md", map "files". Every change returns
 * the update it made, which is what goes to the others, sealed with the note's key.
 */
class NoteDocument private constructor(private var handle: Long) : AutoCloseable {
    companion object {
        const val TITLE = "title"
        const val MD = "md"

        fun create(clientId: Long = 0): NoteDocument {
            YDoc.load()
            return NoteDocument(YDoc.nativeNew(clientId))
        }

        /**
         * The document holding exactly this note, made the same way on every
         * device (ydoc.ts startingDoc): seeded under startingClient in one
         * transaction (title, text, then files by sorted id), then copied
         * into a document with an id of its own.
         */
        fun starting(noteId: String, version: Int, title: String, md: String, filesJson: String?): NoteDocument {
            val seed = create(YDoc.startingClient(noteId, version))
            try {
                val ops = ArrayList<TextEdit>()
                if (title.isNotEmpty()) ops += TextEdit(TITLE, 0, 0, title)
                if (md.isNotEmpty()) ops += TextEdit(MD, 0, 0, md)
                if (ops.isNotEmpty()) seed.edit(ops)
                if (!filesJson.isNullOrEmpty() && filesJson != "{}") seed.setFiles(filesJson)
                val doc = create()
                doc.apply(seed.encodeState())
                return doc
            } finally {
                seed.close()
            }
        }
    }

    private fun h(): Long {
        check(handle != 0L) { "the note's document is closed" }
        return handle
    }

    @Synchronized fun apply(update: ByteArray): Boolean = YDoc.nativeApply(h(), update)
    @Synchronized fun encodeState(): ByteArray = YDoc.nativeEncodeState(h()) ?: ByteArray(0)
    @Synchronized fun stateVector(): ByteArray = YDoc.nativeStateVector(h()) ?: ByteArray(0)
    @Synchronized fun diff(stateVector: ByteArray): ByteArray = YDoc.nativeDiff(h(), stateVector) ?: ByteArray(0)
    @Synchronized fun text(name: String): String = YDoc.nativeText(h(), name) ?: ""
    @Synchronized fun filesJson(): String = YDoc.nativeFiles(h()) ?: "{}"
    @Synchronized fun length(name: String): Int = YDoc.nativeLength(h(), name)

    /** Applies edits in one transaction; returns its update, or null when nothing changed. */
    @Synchronized fun edit(edits: List<TextEdit>): ByteArray? {
        if (edits.isEmpty()) return null
        val flat = ArrayList<String>(edits.size * 3)
        for (e in edits) {
            flat += e.text
            flat += "${e.index}:${e.delete}"
            flat += e.insert
        }
        return YDoc.nativeEdit(h(), flat.toTypedArray())?.takeIf { it.size > 2 }
    }

    /** Sets files (a JSON object of id → file) in one transaction; returns its update. */
    @Synchronized fun setFiles(json: String): ByteArray? = YDoc.nativeSetFiles(h(), json)?.takeIf { it.size > 2 }

    /**
     * Turns the text into `next` with the smallest edit (textDiff.ts: common
     * start and end, never splitting a surrogate pair), so two people writing
     * in one sentence both keep their words.
     */
    fun replaceText(name: String, next: String): ByteArray? {
        val cur = text(name)
        val e = TextDiff.edit(cur, next) ?: return null
        return edit(listOf(TextEdit(name, e.first, e.second, e.third)))
    }

    @Synchronized override fun close() {
        if (handle != 0L) {
            YDoc.nativeFree(handle)
            handle = 0
        }
    }
}

/** The smallest single edit between two texts, in UTF-16 units, never inside a surrogate pair. */
object TextDiff {
    private fun high(c: Char) = c in '\uD800'..'\uDBFF'
    private fun low(c: Char) = c in '\uDC00'..'\uDFFF'

    /** (index, deleteCount, insert), or null when the texts are the same. */
    fun edit(a: String, b: String): Triple<Int, Int, String>? {
        if (a == b) return null
        var pre = 0
        val max = minOf(a.length, b.length)
        while (pre < max && a[pre] == b[pre]) pre++
        if (pre > 0 && pre < a.length && low(a[pre]) && high(a[pre - 1])) pre--
        var suf = 0
        while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] == b[b.length - 1 - suf]) suf++
        if (suf > 0 && suf < a.length - pre && low(a[a.length - suf]) && high(a[a.length - suf - 1])) suf--
        return Triple(pre, a.length - pre - suf, b.substring(pre, b.length - suf))
    }
}
