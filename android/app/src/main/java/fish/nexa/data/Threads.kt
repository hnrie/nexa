package fish.nexa.data

import fish.nexa.net.Channel
import kotlinx.collections.immutable.PersistentMap
import kotlinx.collections.immutable.PersistentSet
import kotlinx.collections.immutable.persistentHashMapOf
import kotlinx.collections.immutable.persistentHashSetOf
import kotlinx.collections.immutable.toPersistentHashSet
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/**
 * stores/threads.ts: threads are channels (the channels store holds them, so
 * a thread opens like any conversation); this keeps what is about this
 * account and them: which it is in, and how many people each holds where
 * that is known.
 */
class ThreadsStore(private val channels: ChannelsStore) {
    private val _joined = MutableStateFlow<PersistentSet<String>>(persistentHashSetOf())
    val joined: StateFlow<PersistentSet<String>> = _joined
    private val _memberCounts = MutableStateFlow(persistentHashMapOf<String, Int>())
    val memberCounts: StateFlow<PersistentMap<String, Int>> = _memberCounts

    fun isJoined(threadId: String) = threadId in _joined.value

    /** A server's threads still going, and the ones this account is in, from ready or a join. */
    fun setServer(serverId: String, threads: List<Channel>, joined: List<String>) {
        channels.upsert(threads)
        _joined.update { cur ->
            // threads of other servers are kept as they are
            val byId = channels.byId.value
            (cur.filter { byId[it]?.serverId != serverId } + joined).toPersistentHashSet()
        }
        _memberCounts.update { m -> m.builder().apply { for (th in threads) th.memberCount?.let { put(th.id, it) } }.build() }
    }

    /** Someone came into or left a thread; me is this account. */
    fun membersChanged(threadId: String, added: List<String>, removed: List<String>, count: Int, me: String?) {
        _joined.update { j ->
            var next = j
            if (me != null && me in added) next = next.add(threadId)
            if (me != null && me in removed) next = next.remove(threadId)
            next
        }
        _memberCounts.update { it.put(threadId, count) }
    }

    fun setJoined(threadId: String, on: Boolean) = _joined.update { if (on) it.add(threadId) else it.remove(threadId) }

    fun forget(threadId: String) {
        _joined.update { it.remove(threadId) }
        _memberCounts.update { it.remove(threadId) }
    }

    fun clear() {
        _joined.value = persistentHashSetOf()
        _memberCounts.value = persistentHashMapOf()
    }
}

/** A channel's threads, newest activity first (web selectThreads). */
fun threadsOf(all: Collection<Channel>, parentId: String): List<Channel> =
    all.filter { it.parentId == parentId && it.isThread }
        .sortedWith { a, b -> Ids.compare(b.lastMessageId ?: b.id, a.lastMessageId ?: a.id) }
