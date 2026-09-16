package xyz.evilion.chat.data

import android.util.Log
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.flow.update
import xyz.evilion.chat.crypto.Bytes
import xyz.evilion.chat.crypto.Conv
import xyz.evilion.chat.crypto.Identity
import xyz.evilion.chat.crypto.KeyRing
import xyz.evilion.chat.crypto.Keys
import xyz.evilion.chat.net.ApiException
import xyz.evilion.chat.net.GrantUpload
import xyz.evilion.chat.net.KeyGrant
import xyz.evilion.chat.net.KeysApi
import xyz.evilion.chat.net.UsersApi

/**
 * Conversation keys: unwrapping the grants the server holds for this account,
 * creating an epoch when a conversation has none, and handing the key to
 * members who cannot read it yet (web/src/stores/keys.ts).
 *
 * The server never sees a root key: it stores one sealed copy per member, and
 * only a member who already holds it can make another.
 */
object KeyService {
    private const val TAG = "KeyService"

    val ring = KeyRing()

    @Volatile
    var identity: Identity? = null
        private set

    @Volatile
    private var userId: String? = null

    private val convLocks = mutableMapOf<String, Mutex>()
    private val locksGuard = Mutex()

    fun start(userId: String, identity: Identity) {
        this.userId = userId
        this.identity = identity
        for ((conv, epoch, root) in SecureStore.roots(userId)) ring.set(conv, epoch, root)
    }

    fun reset() {
        userId = null
        identity = null
        ring.clear()
    }

    private fun persist() {
        val uid = userId ?: return
        val all = buildList {
            for (conv in ring.convs()) for (epoch in ring.epochs(conv)) {
                ring.get(conv, epoch)?.let { add(Triple(conv, epoch, it)) }
            }
        }
        SecureStore.saveRoots(uid, all)
    }

    /** Opens the grants this account can read and remembers the roots they carry. */
    suspend fun ingestGrants(grants: List<KeyGrant>): List<String> {
        val id = identity ?: return emptyList()
        val changed = mutableListOf<String>()
        for (g in grants) {
            if (ring.get(g.convId, g.epoch) != null) continue
            val wrapped = Bytes.unb64OrNull(g.wrappedKey) ?: continue
            try {
                val root = Keys.unwrapGrant(id.privateKey, id.publicKey, wrapped)
                ring.set(g.convId, g.epoch, root)
                changed += g.convId
            } catch (_: Exception) {
                // a grant we cannot open is ignored; another holder may send a good one
            }
        }
        if (changed.isNotEmpty()) {
            persist()
            AppState.waitingForKeys.update { it - changed.toSet() }
        }
        return changed.distinct()
    }

    /**
     * The newest key of a conversation, creating the first epoch if there is
     * none. The root only goes into use once its grants are uploaded: an epoch
     * nobody holds a grant for would leave everything written under it
     * unreadable to everyone else.
     */
    suspend fun ensureConvKey(conv: String): Pair<Int, ByteArray>? {
        ring.latest(conv)?.let { return it }
        val lock = locksGuard.withLock { convLocks.getOrPut(conv) { Mutex() } }
        return lock.withLock {
            ring.latest(conv)?.let { return@withLock it }
            val uid = userId ?: return@withLock null
            try {
                createAndGrant(conv, uid, "")
            } catch (e: ApiException) {
                if (e.status == 409 || e.code == "epoch_race") {
                    // someone else created it at the same moment; take theirs
                    ingestGrants(KeysApi.grants().filter { it.convId == conv })
                    ring.latest(conv) ?: run {
                        AppState.waitingForKeys.update { it + conv }
                        null
                    }
                } else {
                    throw e
                }
            }
        }
    }

    private suspend fun createAndGrant(conv: String, uid: String, reason: String): Pair<Int, ByteArray> {
        val created = KeysApi.createEpoch(conv, reason)
        val root = Conv.newRootKey()
        val targets = if (uid in created.userIds) created.userIds else created.userIds + uid
        putGrantsFor(conv, created.epoch, root, targets)
        ring.set(conv, created.epoch, root)
        persist()
        return created.epoch to root
    }

    /** Wraps a root for each member and uploads the grants; unknown users are skipped. */
    private suspend fun putGrantsFor(conv: String, epoch: Int, root: ByteArray, userIds: List<String>) {
        val uploads = mutableListOf<GrantUpload>()
        for (uid in userIds) {
            val pub = publicKeyOf(uid) ?: continue
            uploads += GrantUpload(conv, epoch, uid, Bytes.b64(Keys.wrapGrant(pub, root)))
        }
        uploads.chunked(200).forEach { KeysApi.putGrants(it) }
    }

    private suspend fun publicKeyOf(userId: String): ByteArray? {
        AppState.user(userId)?.publicKey?.takeIf { it.isNotEmpty() }?.let { return Bytes.unb64OrNull(it) }
        return runCatching {
            val key = UsersApi.publicKey(userId)
            Bytes.unb64OrNull(key)
        }.getOrNull()
    }

    /** Takes in a key that arrived outside the grants, such as in an invite link. */
    fun adopt(conv: String, epoch: Int, root: ByteArray) {
        if (ring.get(conv, epoch) != null) return
        ring.set(conv, epoch, root)
        persist()
        AppState.waitingForKeys.update { it - conv }
    }

    /** Hands an epoch's key to members who do not hold it yet. */
    suspend fun grantTo(conv: String, epoch: Int, userIds: List<String>) {
        val root = ring.get(conv, epoch) ?: return
        if (userIds.isEmpty()) return
        putGrantsFor(conv, epoch, root, userIds)
    }

    /** Answers everything the server says is missing, and rotates when someone lost access. */
    suspend fun reconcile() {
        val needs = runCatching { KeysApi.needs() }.getOrNull() ?: return
        for (n in needs) {
            if (ring.get(n.convId, n.epoch) == null) {
                AppState.waitingForKeys.update { it + n.convId }
                continue
            }
            runCatching { grantTo(n.convId, n.epoch, n.userIds) }
                .onFailure { Log.w(TAG, "could not grant ${n.convId}", it) }
            if (n.rotate) runCatching { rotate(n.convId, "membership change") }
        }
    }

    suspend fun rotate(conv: String, reason: String) {
        val uid = userId ?: return
        try {
            createAndGrant(conv, uid, reason)
        } catch (e: ApiException) {
            if (e.status != 409 && e.code != "epoch_race") throw e
        }
    }

    /** The key a channel's messages are encrypted with, for one epoch. */
    fun channelKey(conv: String, epoch: Int, channelId: String): ByteArray? = ring.channelKey(conv, epoch, channelId)

    /** Every call key this device holds for a channel, newest first for sealing. */
    fun voiceKeys(channelId: String): Triple<List<Pair<Int, ByteArray>>, Int, String>? {
        val conv = AppState.convFor(channelId)
        val epochs = ring.epochs(conv)
        val newest = epochs.lastOrNull() ?: return null
        val keys = epochs.mapNotNull { epoch ->
            ring.get(conv, epoch)?.let { (epoch and 0xff) to Conv.voiceFrameKey(it, channelId) }
        }
        return Triple(keys, newest and 0xff, "$conv:${epochs.joinToString(",")}")
    }
}
