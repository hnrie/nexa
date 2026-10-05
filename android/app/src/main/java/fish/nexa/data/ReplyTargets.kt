package fish.nexa.data

import fish.nexa.Nexa
import fish.nexa.net.Message
import fish.nexa.net.wireJson
import kotlinx.collections.immutable.PersistentMap
import kotlinx.collections.immutable.persistentHashMapOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject

/** What a reply's original is, as far as this device knows. */
sealed interface ReplyTarget {
    data class Found(val cm: ChatMessage) : ReplyTarget
    data object Deleted : ReplyTarget
    data object Failed : ReplyTarget
}

/**
 * The messages replies point at, kept apart from the stretch of conversation
 * that is loaded (web/src/stores/replyTargets.ts). A reply's original is
 * usually somewhere the reader has not scrolled to, so quoting it from the
 * loaded messages alone said "deleted or not loaded" about most replies. The
 * server sends each reply's original along with it; anything it did not is
 * fetched, a few at a time.
 */
object ReplyTargets {
    /** How many originals are kept. The ones looked at least recently go first. */
    private const val MAX = 1000

    private val _byId = MutableStateFlow<PersistentMap<String, ReplyTarget>>(persistentHashMapOf())
    val byId: StateFlow<PersistentMap<String, ReplyTarget>> = _byId

    // access order is recency: an entry used again moves to the end
    private val order = LinkedHashMap<String, Unit>(64, 0.75f, true)
    private val lock = Any()

    private fun touchAll(ids: Collection<String>): List<String> = synchronized(lock) {
        for (id in ids) order[id] = Unit
        val drop = ArrayList<String>()
        val it = order.keys.iterator()
        while (order.size - drop.size > MAX && it.hasNext()) drop += it.next()
        for (d in drop) order.remove(d)
        drop
    }

    private fun write(entries: Map<String, ReplyTarget>) {
        if (entries.isEmpty()) return
        val dropped = touchAll(entries.keys)
        _byId.update { cur ->
            val b = cur.builder()
            b.putAll(entries)
            for (d in dropped) b.remove(d)
            b.build()
        }
    }

    /** Keeps these originals, as they are now. */
    fun seed(msgs: List<ChatMessage>) = write(msgs.associate { it.id to ReplyTarget.Found(it) })

    /** These messages are gone: replies to them say so. */
    fun markDeleted(ids: Collection<String>) = write(ids.associateWith { ReplyTarget.Deleted })

    /** A kept original changed (edited, opened again): the new copy replaces it, where one is kept. */
    fun refresh(cm: ChatMessage) {
        if (_byId.value[cm.id] !is ReplyTarget.Found) return
        _byId.update { cur -> if (cur[cm.id] is ReplyTarget.Found) cur.put(cm.id, ReplyTarget.Found(cm)) else cur }
    }

    /** Marks an original as read again, so it outlives ones nobody has looked at. */
    fun used(id: String) {
        synchronized(lock) { if (order.containsKey(id)) order[id] = Unit }
    }

    fun clear() {
        synchronized(lock) {
            order.clear()
            pending.clear()
            inFlight.clear()
            scheduled = false
        }
        _byId.value = persistentHashMapOf()
    }

    /**
     * Takes the originals that came with messages from the server
     * (`referenced_message`): opened and kept, or noted as deleted. Messages
     * that came without one are left for [request].
     */
    fun ingest(msgs: List<Message>) {
        val found = ArrayList<Message>()
        val gone = ArrayList<String>()
        val seen = HashSet<String>()
        for (m in msgs) {
            val reply = m.replyToId ?: continue
            val ref = m.referenced
            if (ref == Message.NOT_SAID || !seen.add(reply)) continue
            if (ref == null) gone += reply
            else if (ref is JsonObject) {
                val orig = runCatching { wireJson.decodeFromJsonElement(Message.serializer(), ref) }.getOrNull() ?: continue
                if (orig.id == reply && orig.channelId == m.channelId) found += orig
            }
        }
        markDeleted(gone)
        if (found.isEmpty()) return
        Nexa.messages.resolveAuthors?.invoke(found.map { it.authorId })
        Nexa.scope.launch(Dispatchers.Default) { seed(found.map { Nexa.messages.decrypt(it) }) }
    }

    /** Originals still to fetch, by channel, and the ones a fetch is already on its way for. */
    private val pending = LinkedHashMap<String, LinkedHashSet<String>>()
    private val inFlight = HashSet<String>()
    private var scheduled = false

    /**
     * Asks for an original nobody sent along: gathered for a moment so a
     * screen of replies is one request per channel, not one each.
     */
    fun request(channelId: String, messageId: String) {
        if (_byId.value[messageId] != null) return
        synchronized(lock) {
            if ("$channelId:$messageId" in inFlight) return
            pending.getOrPut(channelId) { LinkedHashSet() } += messageId
            if (scheduled) return
            scheduled = true
        }
        Nexa.scope.launch {
            delay(40)
            val work = synchronized(lock) {
                scheduled = false
                pending.map { it.key to it.value.toList() }.also { pending.clear() }
            }
            for ((ch, ids) in work) for (batch in ids.chunked(100)) launch { fetch(ch, batch) }
        }
    }

    private suspend fun fetch(channelId: String, ids: List<String>) {
        val keys = ids.map { "$channelId:$it" }
        synchronized(lock) { inFlight += keys }
        try {
            val found = Nexa.api.get("/channels/$channelId/messages?ids=" + ids.joinToString(","), ListSerializer(Message.serializer()))
            ingest(found)
            val opened = withContext(Dispatchers.Default) { found.map { Nexa.messages.decrypt(it) } }
            Nexa.messages.resolveAuthors?.invoke(opened.map { it.authorId })
            seed(opened)
            val have = found.map { it.id }.toHashSet()
            markDeleted(ids.filter { it !in have })
        } catch (_: Exception) {
            // said as "could not be loaded", not as deleted: it may well be there,
            // and tapping the line tries once more
            _byId.update { cur ->
                val b = cur.builder()
                for (id in ids) if (b[id] == null) b[id] = ReplyTarget.Failed
                b.build()
            }
        } finally {
            synchronized(lock) { inFlight -= keys.toSet() }
        }
    }

    /** Forgets a failure, so the next look tries again. */
    fun retry(channelId: String, messageId: String) {
        _byId.update { cur -> if (cur[messageId] == ReplyTarget.Failed) cur.remove(messageId) else cur }
        request(channelId, messageId)
    }

    /** Opens again the kept originals a key has just arrived for. */
    suspend fun redecrypt(convs: Set<String>) {
        val waiting = _byId.value.values.mapNotNull { (it as? ReplyTarget.Found)?.cm }
            .filter { it.error == DecryptFail.NO_KEY && it.m.keyConvId in convs }
        if (waiting.isEmpty()) return
        val opened = withContext(Dispatchers.Default) { waiting.map { Nexa.messages.decrypt(it.m) } }
        _byId.update { cur ->
            val b = cur.builder()
            for (o in opened) if (b[o.id] is ReplyTarget.Found) b[o.id] = ReplyTarget.Found(o)
            b.build()
        }
    }
}
