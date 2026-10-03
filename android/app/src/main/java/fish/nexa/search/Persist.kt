package fish.nexa.search

import fish.nexa.crypto.Bytes
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import java.io.File
import java.io.IOException

/**
 * The search index on this device's disk (web/src/search/persist.ts).
 *
 * Decrypted messages are kept so a restart finds everything searchable at
 * once instead of fetching and decrypting it all again. They are never kept
 * in the clear: messages are stored in blocks of up to [BLOCK_SIZE] per
 * conversation, each sealed with AES-GCM under a key of this device and
 * account (IndexKeys), and bound to its place so a block cannot be moved to
 * another conversation or account and still open.
 *
 * Blocks are filled in the order messages arrive: the whole index is read
 * into memory when it opens, so where a message sits on disk only matters for
 * finding it again when it changes.
 *
 * One file per block, written to a temporary file and renamed into place;
 * the walk's progress is written after the blocks it walked past.
 */
class BlockStore(private val dir: File, private val userId: String, private val key: ByteArray) {
    private class Block(val ch: String, val n: Int, val ids: LinkedHashSet<String> = LinkedHashSet())

    private val blocks = HashMap<String, Block>()
    private val blockOf = HashMap<String, String>()
    /** The block of each conversation that new messages go into. */
    private val filling = HashMap<String, String>()
    private val nextN = HashMap<String, Int>()
    private val dirty = LinkedHashSet<String>()
    private var crawl: JsonElement? = null
    private var crawlDirty = false

    class Loaded(val docs: List<SearchDoc>, val crawl: JsonElement?, val lost: List<String>)

    private fun fileOf(k: String) = File(dir, "b-" + k.replace(':', '-') + ".bin")
    private val crawlFile get() = File(dir, "crawl.bin")

    private fun aad(where: String) = Bytes.utf8("nexa-search/1|$userId|$where")

    private fun seal(where: String, value: JsonElement): ByteArray {
        val iv = Bytes.random(12)
        val ct = Bytes.gcmEncrypt(key, iv, Bytes.utf8(Json.encodeToString(JsonElement.serializer(), value)), aad(where))
        return Bytes.concat(iv, ct)
    }

    private fun open(where: String, raw: ByteArray): JsonElement {
        if (raw.size < 12 + 16) throw IOException("search index: a block is cut short")
        val plain = Bytes.gcmDecrypt(key, raw.copyOfRange(0, 12), raw, aad(where), 12, raw.size - 12)
        return Json.parseToJsonElement(Bytes.str(plain))
    }

    /** "b-<channel>-<n>.bin" back to the block's key, or null for any other file. */
    private fun keyOf(name: String): Pair<String, Int>? {
        if (!name.startsWith("b-") || !name.endsWith(".bin")) return null
        val body = name.substring(2, name.length - 4)
        val dash = body.lastIndexOf('-')
        if (dash <= 0) return null
        val ch = body.substring(0, dash)
        val n = body.substring(dash + 1).toIntOrNull() ?: return null
        if (ch.isEmpty() || !ch.all { it in '0'..'9' }) return null
        return ch to n
    }

    /** Opens the index and reads all of it. */
    fun load(): Loaded {
        if (!dir.isDirectory && !dir.mkdirs()) throw IOException("search index: no folder for it")
        val docs = LinkedHashMap<String, SearchDoc>()
        val lost = LinkedHashSet<String>()
        val broken = ArrayList<String>()
        val files = (dir.listFiles() ?: emptyArray()).mapNotNull { f -> keyOf(f.name)?.let { Triple(f, it.first, it.second) } }.sortedBy { it.third }
        for ((f, ch, n) in files) {
            val k = "$ch:$n"
            nextN[ch] = maxOf(nextN[ch] ?: 0, n + 1)
            val list = try {
                open(k, f.readBytes()) as? JsonArray
            } catch (_: Exception) {
                null
            }
            if (list == null) {
                lost += ch
                broken += k
                continue
            }
            val block = Block(ch, n)
            for (el in list) {
                val d = SearchDocs.fromJson(el) ?: continue
                if (d.c != ch) continue
                // a message found in two blocks (a write cut off halfway) keeps the later copy
                blockOf[d.id]?.let { had ->
                    blocks[had]?.ids?.remove(d.id)
                    dirty += had
                }
                docs[d.id] = d
                block.ids += d.id
                blockOf[d.id] = k
            }
            blocks[k] = block
            if (block.ids.size < BLOCK_SIZE) filling[ch] = k
        }
        for (k in broken) {
            // gone from disk at the next write, and its conversation walked again
            blocks[k] = Block(k.substringBefore(':'), -1)
            dirty += k
        }
        crawl = crawlFile.takeIf { it.exists() }?.let { f ->
            try {
                open(CRAWL_KEY, f.readBytes())
            } catch (_: Exception) {
                null
            }
        }
        compactSparse()
        return Loaded(docs.values.toList(), crawl, lost.toList())
    }

    /** Repacks a conversation whose blocks have mostly emptied, so opening does not read many near-empty blocks. */
    private fun compactSparse() {
        val perChannel = HashMap<String, MutableList<Block>>()
        for (b in blocks.values) if (b.n >= 0) perChannel.getOrPut(b.ch) { ArrayList() } += b
        for ((ch, list) in perChannel) {
            val count = list.sumOf { it.ids.size }
            if (list.size <= (count + BLOCK_SIZE - 1) / BLOCK_SIZE * 2 + 2) continue
            val ids = list.flatMap { it.ids.toList() }
            for (b in list) {
                b.ids.clear()
                dirty += "$ch:${b.n}"
            }
            filling.remove(ch)
            for (id in ids) place(ch, id)
        }
    }

    private fun place(ch: String, id: String) {
        var k = filling[ch]
        var block = k?.let { blocks[it] }
        if (k == null || block == null || block.ids.size >= BLOCK_SIZE) {
            val n = nextN[ch] ?: 0
            nextN[ch] = n + 1
            k = "$ch:$n"
            block = Block(ch, n)
            blocks[k] = block
            filling[ch] = k
        }
        block.ids += id
        blockOf[id] = k
        dirty += k
    }

    /** A message added or changed. */
    fun noteUpsert(d: SearchDoc) {
        val k = blockOf[d.id]
        if (k != null) dirty += k else place(d.c, d.id)
    }

    /** A message gone. */
    fun noteRemove(id: String) {
        val k = blockOf.remove(id) ?: return
        blocks[k]?.ids?.remove(id)
        dirty += k
    }

    /** A whole conversation gone. */
    fun noteRemoveChannel(ch: String) {
        for ((k, b) in blocks) {
            if (b.ch != ch) continue
            for (id in b.ids) blockOf.remove(id)
            b.ids.clear()
            dirty += k
        }
        filling.remove(ch)
    }

    fun setCrawl(state: JsonElement) {
        crawl = state
        crawlDirty = true
    }

    val pending get() = dirty.isNotEmpty() || crawlDirty

    /** Writes everything changed: the blocks first, then the walk's progress, so it is never saved ahead of them. */
    fun flush(get: (String) -> SearchDoc?) {
        if (!pending) return
        val keys = dirty.toList()
        dirty.clear()
        val state = if (crawlDirty) crawl else null
        crawlDirty = false
        try {
            for (k in keys) {
                val b = blocks[k]
                val docs = b?.ids?.mapNotNull(get) ?: emptyList()
                if (b == null || docs.isEmpty()) {
                    fileOf(k).delete()
                    if (b != null && b.ids.isEmpty()) {
                        blocks.remove(k)
                        if (filling[b.ch] == k) filling.remove(b.ch)
                    }
                    continue
                }
                write(fileOf(k), seal(k, JsonArray(docs.map(SearchDocs::toJson))))
            }
            if (state != null) write(crawlFile, seal(CRAWL_KEY, state))
        } catch (e: Exception) {
            // tried again with the next write
            dirty += keys
            if (state != null && !crawlDirty) crawlDirty = true
            throw e
        }
    }

    private fun write(f: File, bytes: ByteArray) {
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(f)) {
            f.delete()
            if (!tmp.renameTo(f)) throw IOException("search index: could not write ${f.name}")
        }
    }

    companion object {
        const val BLOCK_SIZE = 200
        private const val CRAWL_KEY = "crawl"

        /** Takes an account's index off this device. Never throws. */
        fun delete(dir: File) {
            try {
                dir.listFiles()?.forEach { it.delete() }
                dir.delete()
            } catch (_: Exception) {
            }
        }
    }
}
