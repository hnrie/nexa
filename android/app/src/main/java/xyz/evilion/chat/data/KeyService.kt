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
        // Before the gateway connects: the first ready puts every user this
        // account can see through judgeKey, and each of those keys has to be
        // held against what this device remembers rather than pinned late.
        KeyPins.open(userId)
        for ((conv, epoch, root) in SecureStore.roots(userId)) ring.set(conv, epoch, root)
    }

    fun reset() {
        userId = null
        identity = null
        ring.clear()
        // The pins themselves stay on the device — that is the point of them —
        // but this session's unanswered questions and its log go with it.
        KeyPins.close()
        KeyAlerts.reset()
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

    /**
     * Who this device believes is in a conversation: the DM's recipients, or a
     * server's members. A private server channel carries its own conversation,
     * and who can view it is a subset of the server's members — the subset is
     * not recomputed here, because this client's view of role overwrites can
     * lag the server's and a member wrongly dropped loses messages they are
     * entitled to. The superset still catches what matters: an account that is
     * in no part of the conversation at all.
     *
     * Null means nothing can be said, which is not the same as "nobody".
     */
    private fun membersOf(conv: String): Set<String>? {
        val channel = AppState.channels.value[conv]
        if (channel != null) {
            // Recipients ride on the channel object and are always complete: a
            // group DM missing a member could not be drawn.
            if (channel.isDm) return channel.recipientIds.toSet()
            val serverId = channel.serverId ?: return null
            return completeServerMembers(serverId)
        }
        return completeServerMembers(conv)
    }

    /**
     * A server's members, but only when the whole list is in hand. A large
     * server loads its members a page at a time, so an id missing from a
     * partial list may simply not have been fetched yet, and a stranger cannot
     * be told from a member. Refusing there would strand real members without
     * keys for messages they may read, which is the worse of the two failures.
     */
    private fun completeServerMembers(serverId: String): Set<String>? {
        val state = AppState.servers.value[serverId] ?: return null
        if (state.members.size < state.memberCount) return null
        return state.members.keys
    }

    /**
     * Narrows a server-supplied recipient list to the accounts this device is
     * willing to hand a conversation key to.
     *
     * Nothing about who gets a key was ever the client's decision before: the
     * user_ids in a keys_needed event, in /keys/needs and in the answer to
     * creating an epoch went straight into the wrapping, so one fabricated
     * event naming an attacker's account was enough to make this device seal
     * the conversation root for it and upload the result, silently. Here they
     * are held against the membership this device already knows and draws, and
     * anything outside it is dropped and written down where it can be seen.
     */
    private fun recipientsFor(conv: String, epoch: Int, wanted: List<String>): List<String> {
        val known = membersOf(conv)
        if (known == null) {
            if (wanted.isNotEmpty()) KeyAlerts.report(KeyAlerts.Kind.UNCHECKED, conv = conv, count = wanted.size)
            return wanted
        }
        // Never this account. A membership list that has not caught up with a
        // join would otherwise leave this device holding a root with no grant
        // of its own, which is the one way this check could lock somebody out
        // of their own conversation.
        val me = userId
        val allowed = wanted.filter { it in known || it == me }
        val outsiders = wanted.filter { it !in known && it != me }
        if (outsiders.isNotEmpty()) {
            Log.w(TAG, "refusing to wrap $conv epoch $epoch for ${outsiders.joinToString()} — not in this conversation")
            KeyAlerts.report(KeyAlerts.Kind.OUTSIDER_REFUSED, userId = outsiders.singleOrNull(), conv = conv, count = outsiders.size)
        }
        return allowed
    }

    /** Wraps a root for each member and uploads the grants; unknown users are skipped. */
    private suspend fun putGrantsFor(conv: String, epoch: Int, root: ByteArray, wanted: List<String>) {
        // The one place every grant this client makes passes through, so the
        // recipient check cannot be forgotten by a path added later: createEpoch,
        // /keys/needs and the keys_needed event all end up here.
        val userIds = recipientsFor(conv, epoch, wanted)
        val uploads = mutableListOf<GrantUpload>()
        for (uid in userIds) {
            val pubB64 = publicKeyOf(uid) ?: continue
            // A key that is not the one this device pinned for that person does
            // not get a copy of the conversation until a human has looked at
            // it. judgeKey raises the question; this path just declines, and
            // the grant is made on the next reconcile once it is answered.
            if (judgeKey(uid, pubB64) == KeyPins.Verdict.CHANGED) {
                KeyAlerts.report(KeyAlerts.Kind.GRANT_WITHHELD, userId = uid, conv = conv)
                continue
            }
            val pub = Bytes.unb64OrNull(pubB64) ?: continue
            uploads += GrantUpload(conv, epoch, uid, Bytes.b64(Keys.wrapGrant(pub, root)))
        }
        uploads.chunked(200).forEach { KeysApi.putGrants(it) }
    }

    /**
     * The key to seal to, as base64 — the shape the pin file keeps, so the two
     * can be compared without decoding either.
     */
    private suspend fun publicKeyOf(userId: String): String? {
        AppState.user(userId)?.publicKey?.takeIf { it.isNotEmpty() }?.let { return it }
        return runCatching { UsersApi.publicKey(userId) }.getOrNull()?.takeIf { it.isNotEmpty() }
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
