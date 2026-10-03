package fish.nexa.search

import kotlinx.serialization.json.JsonElement
import java.io.File

/**
 * The index's side of the conversation with the app (web/src/search/core.ts):
 * the engine and, when the index is kept on this device, the block store.
 * Every call is made on one thread at a time (SearchIndex runs them on a
 * single-threaded dispatcher), so a search waits behind the opening of the
 * index, and a message added while it opens lands after what was on disk.
 */
class SearchCore {
    private val engine = SearchEngine()
    private var store: BlockStore? = null
    private var userId: String? = null
    private var dir: File? = null

    class OpenResult(
        /** Kept on disk (false: in memory for this session only). */
        val persisted: Boolean,
        val docs: Int,
        /** How far each conversation had been walked, as last saved. */
        val crawl: JsonElement?,
        /** Conversations with history on disk that could not be read, to be fetched again. */
        val lost: List<String>,
        val counts: Map<String, Int>,
    )

    class Mutation(val docs: Int, val changed: Boolean)

    val size get() = engine.size

    /** Opens the index: from disk under `key`, or in memory only when there is no key. `reset` starts the disk copy afresh. */
    fun open(userId: String, dir: File?, key: ByteArray?, reset: Boolean): OpenResult {
        engine.clear()
        store = null
        this.userId = userId
        this.dir = dir
        if (key == null || dir == null) return OpenResult(false, 0, null, emptyList(), emptyMap())
        if (reset) BlockStore.delete(dir)
        val s = BlockStore(dir, userId, key)
        return try {
            val loaded = s.load()
            for (d in loaded.docs) engine.upsert(d)
            store = s
            OpenResult(true, engine.size, loaded.crawl, loaded.lost, engine.channelCounts())
        } catch (e: Exception) {
            // no disk to keep it on: search still works, in memory
            android.util.Log.w(TAG, "keeping the search index in memory only", e)
            engine.clear()
            OpenResult(false, 0, null, emptyList(), emptyMap())
        }
    }

    private fun mutation(changed: Boolean) = Mutation(engine.size, changed)

    fun upsert(docs: List<SearchDoc>): Mutation {
        var changed = false
        for (d in docs) {
            if (engine.upsert(d) == Change.SAME) continue
            changed = true
            store?.noteUpsert(d)
        }
        return mutation(changed)
    }

    fun remove(ids: List<String>): Mutation {
        var changed = false
        for (id in ids) {
            if (!engine.remove(id)) continue
            changed = true
            store?.noteRemove(id)
        }
        return mutation(changed)
    }

    fun pin(id: String, pinned: Boolean): Mutation {
        val d = engine.get(id) ?: return mutation(false)
        val fl = if (pinned) d.fl or 1L else d.fl and 1L.inv()
        if (fl == d.fl) return mutation(false)
        val next = d.copy(fl = fl)
        engine.upsert(next)
        store?.noteUpsert(next)
        return mutation(true)
    }

    /** Everything held strictly between the first and the last message of a page the server just sent, and not in it, was deleted. */
    fun reconcile(channel: String, low: String, high: String, present: Collection<String>): Mutation {
        val here = present.toHashSet()
        var changed = false
        for (id in engine.idsBetween(channel, low, high)) {
            if (id in here) continue
            engine.remove(id)
            store?.noteRemove(id)
            changed = true
        }
        return mutation(changed)
    }

    fun removeChannel(channel: String): Mutation {
        val gone = engine.removeChannel(channel)
        store?.noteRemoveChannel(channel)
        return mutation(gone.isNotEmpty())
    }

    fun setCrawl(state: JsonElement) {
        store?.setCrawl(state)
    }

    val pending get() = store?.pending == true

    fun query(req: EngineRequest): EngineResult = if (engine.size == 0) EngineResult.EMPTY else engine.query(req)

    fun channelCounts(): Map<String, Int> = engine.channelCounts()

    fun flush() {
        store?.flush { engine.get(it) }
    }

    /** Forgets everything here and on disk. */
    fun wipe() {
        engine.clear()
        store = null
        dir?.let { BlockStore.delete(it) }
    }

    /** Lets go of everything held, writing nothing more (a sign-out). */
    fun release() {
        store = null
        engine.clear()
    }

    fun close() {
        try {
            flush()
        } finally {
            store = null
            engine.clear()
        }
    }

    companion object {
        private const val TAG = "NexaSearch"
    }
}
