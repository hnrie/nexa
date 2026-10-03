package fish.nexa.search

import fish.nexa.data.Ids
import kotlin.math.ln

/**
 * The inverted index (web/src/search/tokenIndex.ts): for every token, the
 * messages it occurs in, by ordinal (the order they were added), so each
 * list only grows at its end and stays sorted. A message that goes is not
 * taken out of the lists; the engine rebuilds once enough of them have gone.
 *
 * A search word is found by its beginning, so the distinct tokens are also
 * kept sorted, and a word looks up the run of tokens that start with it.
 * Tokens added since the last lookup wait unsorted until one needs them.
 */
class TokenIndex {
    private val postings = HashMap<String, IntList>()
    private var sorted: Array<String> = emptyArray()
    private val pending = ArrayList<String>()

    /** Adds one message's tokens under its ordinal. Ordinals must only grow. */
    fun add(ord: Int, tokens: Iterable<String>) {
        for (t in LinkedHashSet<String>().apply { tokens.forEach { add(it) } }) {
            val list = postings[t]
            if (list != null) {
                if (list.last() != ord) list.add(ord)
            } else {
                postings[t] = IntList(2).apply { add(ord) }
                pending += t
            }
        }
    }

    val size get() = postings.size

    private fun settle() {
        if (pending.isEmpty()) return
        val fresh = pending.toTypedArray().also { it.sort() }
        pending.clear()
        val out = Array(sorted.size + fresh.size) { "" }
        var i = 0
        var j = 0
        var k = 0
        while (i < sorted.size && j < fresh.size) out[k++] = if (sorted[i] <= fresh[j]) sorted[i++] else fresh[j++]
        while (i < sorted.size) out[k++] = sorted[i++]
        while (j < fresh.size) out[k++] = fresh[j++]
        sorted = out
    }

    private fun lowerBound(prefix: String): Int {
        var lo = 0
        var hi = sorted.size
        while (lo < hi) {
            val mid = (lo + hi) ushr 1
            if (sorted[mid] < prefix) lo = mid + 1 else hi = mid
        }
        return lo
    }

    /**
     * Every message holding the token: any token that starts with it for a
     * word, or exactly it for a CJK character or pair. `size` is one past the
     * highest ordinal in use.
     */
    fun lookup(tok: SearchText.Token, size: Int): ByteArray {
        val out = ByteArray(size)
        fun mark(list: IntList?) {
            list?.forEach { o -> if (o < size) out[o] = 1 }
        }
        if (!tok.prefix) {
            mark(postings[tok.text])
            return out
        }
        settle()
        var i = lowerBound(tok.text)
        while (i < sorted.size) {
            val t = sorted[i]
            if (!t.startsWith(tok.text)) break
            mark(postings[t])
            i++
        }
        return out
    }

    companion object {
        /** Keeps only what is in both, in `a`; says whether anything is left. */
        fun intersectInto(a: ByteArray, b: ByteArray): Boolean {
            var any = false
            for (i in a.indices) {
                if (a[i].toInt() != 0 && b[i].toInt() == 0) a[i] = 0 else if (a[i].toInt() != 0) any = true
            }
            return any
        }

        fun countOf(a: ByteArray): Int {
            var n = 0
            for (b in a) n += b
            return n
        }
    }
}

enum class SearchTab(val wire: String) { MESSAGES("messages"), MEDIA("media"), LINKS("links"), FILES("files") }

enum class SearchSort(val wire: String) { NEWEST("newest"), OLDEST("oldest"), RELEVANCE("relevance") }

data class EngineRequest(
    val query: SearchQueries.Resolved,
    /** The channels to look in, or null for everywhere. */
    val scope: List<String>?,
    /** Authors whose messages are left out of the results. */
    val hide: List<String> = emptyList(),
    val tab: SearchTab = SearchTab.MESSAGES,
    val sort: SearchSort = SearchSort.NEWEST,
    val offset: Int = 0,
    val limit: Int = 40,
)

data class EngineResult(
    /** How much matched in each tab: messages, pictures and clips, links, files. */
    val counts: Map<SearchTab, Int>,
    /** How many messages the chosen tab's results come from, for paging. */
    val total: Int,
    /** One page of them. */
    val docs: List<SearchDoc>,
) {
    companion object {
        val EMPTY = EngineResult(SearchTab.entries.associateWith { 0 }, 0, emptyList())
    }
}

/** What an upsert did: nothing, a new message, or a changed one. */
enum class Change { SAME, ADDED, CHANGED }

/**
 * The search engine (web/src/search/engine.ts): the messages this device has
 * decrypted, and the index that finds them. A query narrows by the index to
 * the messages holding every word, goes through the filters, then checks the
 * words themselves, so a phrase is a phrase and a left-out word is left out.
 * With no words the filters go through the conversation, or everything.
 *
 * Not safe to share between threads: SearchCore runs it on one at a time.
 */
class SearchEngine {
    private var docs = ArrayList<SearchDoc?>()
    private var lengths = IntList()
    private val ords = HashMap<String, Int>()
    private val byChannel = HashMap<String, IntList>()
    private var index = TokenIndex()
    private var dead = 0
    private var tokenTotal = 0L

    /** How many messages it holds. */
    val size get() = ords.size

    fun has(id: String) = id in ords

    fun get(id: String): SearchDoc? = ords[id]?.let { docs[it] }

    /** Adds a message, or replaces the copy held if it has changed. */
    fun upsert(d: SearchDoc): Change {
        val o = ords[d.id]
        if (o != null) {
            val prev = docs[o]!!
            if (SearchDocs.same(prev, d)) return Change.SAME
            drop(o)
            put(d)
            return Change.CHANGED
        }
        put(d)
        return Change.ADDED
    }

    private fun tokensOf(d: SearchDoc): List<String> = SearchText.tokenize(SearchText.fold(SearchDocs.searchableText(d))).map { it.text }

    private fun put(d: SearchDoc) {
        val o = docs.size
        val tokens = tokensOf(d)
        docs += d
        lengths.add(tokens.size)
        tokenTotal += tokens.size
        ords[d.id] = o
        byChannel.getOrPut(d.c) { IntList() }.add(o)
        index.add(o, tokens)
    }

    private fun drop(o: Int) {
        val d = docs[o] ?: return
        docs[o] = null
        ords.remove(d.id)
        tokenTotal -= lengths[o]
        dead += 1
    }

    /** Forgets a message; says whether it was held. */
    fun remove(id: String): Boolean {
        val o = ords[id] ?: return false
        drop(o)
        maybeCompact()
        return true
    }

    /** Forgets every message of a channel, and says which went. */
    fun removeChannel(channelId: String): List<String> {
        val gone = ArrayList<String>()
        byChannel[channelId]?.forEach { o ->
            val d = docs[o]
            if (d != null && d.c == channelId) {
                gone += d.id
                drop(o)
            }
        }
        byChannel.remove(channelId)
        maybeCompact()
        return gone
    }

    /** The ids held for a channel whose ids fall strictly between two others. */
    fun idsBetween(channelId: String, low: String, high: String): List<String> {
        val out = ArrayList<String>()
        byChannel[channelId]?.forEach { o ->
            val d = docs[o]
            if (d != null && d.c == channelId && Ids.compare(d.id, low) > 0 && Ids.compare(d.id, high) < 0) out += d.id
        }
        return out
    }

    /** How many messages it holds for each channel. */
    fun channelCounts(): Map<String, Int> {
        val out = HashMap<String, Int>()
        for (d in docs) if (d != null) out[d.c] = (out[d.c] ?: 0) + 1
        return out
    }

    /** Every message held, for writing out. */
    fun all(): List<SearchDoc> = docs.filterNotNull()

    fun clear() {
        docs = ArrayList()
        lengths = IntList()
        ords.clear()
        byChannel.clear()
        index = TokenIndex()
        dead = 0
        tokenTotal = 0
    }

    /** Numbers the messages afresh once a quarter of the numbers point at nothing. */
    private fun maybeCompact() {
        if (dead < 1000 || dead * 4 < docs.size) return
        compact()
    }

    fun compact() {
        val live = all()
        clear()
        for (d in live) put(d)
    }

    private class Candidates(val set: ByteArray, val df: HashMap<String, Int>)

    /** The candidates the index gives for the query's words, or null when it has no words to narrow by. */
    private fun candidates(r: SearchQueries.Resolved): Candidates? {
        val size = docs.size
        var set: ByteArray? = null
        val df = HashMap<String, Int>()
        for (w in r.terms + r.phrases) {
            var own: ByteArray? = null
            for (tok in SearchText.termTokens(w)) {
                val found = index.lookup(tok, size)
                if (own == null) own = found else TokenIndex.intersectInto(own, found)
            }
            // a word with nothing the index keys by (an emoji, punctuation) is left to the check against the text
            if (own == null) continue
            df[w] = TokenIndex.countOf(own)
            if (set == null) set = own else if (!TokenIndex.intersectInto(set, own)) return Candidates(set, df)
        }
        return set?.let { Candidates(it, df) }
    }

    fun query(req: EngineRequest): EngineResult {
        val r = req.query
        if ((r.from != null && r.from.isEmpty()) || (r.mentions != null && r.mentions.isEmpty() && !r.everyone) || (r.since != null && r.until != null && r.since >= r.until)) return EngineResult.EMPTY
        var allowed: LinkedHashSet<String>? = req.scope?.let { LinkedHashSet(it) }
        if (r.channels != null) {
            val within = allowed
            allowed = LinkedHashSet(r.channels.filter { within == null || it in within })
        }
        if (allowed != null && allowed.isEmpty()) return EngineResult.EMPTY
        val hide = req.hide.takeIf { it.isNotEmpty() }?.toHashSet()
        val hasWords = r.terms.isNotEmpty() || r.phrases.isNotEmpty() || r.exclude.isNotEmpty()
        val cand = candidates(r)

        val matched = IntList()
        fun consider(o: Int) {
            val d = docs[o] ?: return
            if (allowed != null && d.c !in allowed) return
            if (hide != null && d.a in hide) return
            if (!SearchQueries.matchFilters(d, r)) return
            if (hasWords && !SearchQueries.matchText(SearchText.fold(SearchDocs.searchableText(d)), r)) return
            matched.add(o)
        }
        when {
            cand != null -> {
                val s = cand.set
                for (o in s.indices) if (s[o].toInt() != 0) consider(o)
            }
            allowed != null -> for (c in allowed) byChannel[c]?.forEach { consider(it) }
            else -> for (o in docs.indices) consider(o)
        }

        val counts = HashMap<SearchTab, Int>()
        counts[SearchTab.MESSAGES] = matched.size
        var media = 0
        var links = 0
        var files = 0
        val inTab = ArrayList<Int>()
        matched.forEach { o ->
            val d = docs[o]!!
            val m = SearchDocs.mediaOf(d).size
            val l = SearchDocs.linksOf(d).size
            val f = SearchDocs.filesOf(d).size
            media += m
            links += l
            files += f
            val n = when (req.tab) {
                SearchTab.MESSAGES -> 1
                SearchTab.MEDIA -> m
                SearchTab.LINKS -> l
                SearchTab.FILES -> f
            }
            if (n > 0) inTab += o
        }
        counts[SearchTab.MEDIA] = media
        counts[SearchTab.LINKS] = links
        counts[SearchTab.FILES] = files

        val byId = Comparator<Int> { a, b -> Ids.compare(docs[a]!!.id, docs[b]!!.id) }
        if (req.sort == SearchSort.OLDEST) inTab.sortWith(byId)
        else if (req.sort == SearchSort.RELEVANCE && (r.terms.isNotEmpty() || r.phrases.isNotEmpty())) {
            val scores = scores(inTab, r, cand?.df ?: HashMap())
            inTab.sortWith { a, b ->
                val c = scores[b]!!.compareTo(scores[a]!!)
                if (c != 0) c else byId.compare(b, a)
            }
        } else inTab.sortWith { a, b -> byId.compare(b, a) }

        val from = minOf(req.offset, inTab.size)
        val to = minOf(inTab.size, req.offset + req.limit)
        val page = inTab.subList(from, to).map { docs[it]!! }
        return EngineResult(counts, inTab.size, page)
    }

    /**
     * How well each message matches, by BM25: a word counts for more the
     * rarer it is and the more often it appears, and for less in a long
     * message. A word that is a whole word in the message beats one that only
     * starts one.
     */
    private fun scores(ords: List<Int>, r: SearchQueries.Resolved, df: Map<String, Int>): HashMap<Int, Double> {
        val n = maxOf(1, size).toDouble()
        val avg = maxOf(1.0, tokenTotal / n)
        val out = HashMap<Int, Double>()
        for (o in ords) {
            val d = docs[o]!!
            val folded = SearchText.fold(SearchDocs.searchableText(d))
            val toks = SearchText.tokenize(folded)
            val len = lengths[o].toDouble()
            var score = 0.0
            for (w in r.terms) {
                var tf = 0.0
                var whole = false
                for (t in toks) {
                    if (t.text.startsWith(w)) {
                        tf += 1
                        if (t.text == w) whole = true
                    }
                }
                // a term with no tokens of its own (an emoji) still matched as text
                if (tf == 0.0 && folded.contains(w)) tf = 1.0
                val docsWith = (df[w] ?: 1).toDouble()
                val idf = ln(1 + (n - docsWith + 0.5) / (docsWith + 0.5))
                score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / avg))) + (if (whole) idf * 0.3 else 0.0)
            }
            for (p in r.phrases) {
                val docsWith = (df[p] ?: 1).toDouble()
                score += 1.5 * ln(1 + (n - docsWith + 0.5) / (docsWith + 0.5))
            }
            out[o] = score
        }
        return out
    }

    companion object {
        private const val K1 = 1.2
        private const val B = 0.75
    }
}
