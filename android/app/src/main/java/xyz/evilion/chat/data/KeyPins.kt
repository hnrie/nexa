package xyz.evilion.chat.data

import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The identity keys this device has seen before, and what it refused to do
 * about the ones that changed. Mirrors web/src/lib/keyPins.ts and
 * web/src/stores/keyAlerts.ts.
 *
 * Every public key a client encrypts to arrives from the server, and the server
 * is the party the product promises is shut out. Nothing in the protocol stops
 * it handing out a key of its own choosing for somebody and collecting the
 * conversation keys that get sealed to it. Trust on first use is the cheap
 * defence: remember the key the first time this device sees a person, and treat
 * a different one later as something a human has to look at.
 *
 * What makes that fair rather than a nuisance is that **there is no update path
 * for `public_key` in the API**. It is written once at registration
 * (internal/store/users.go, CreateUser) and every other write to the users row
 * — profile edits, password changes, recovery replacement, account deletion —
 * leaves the column alone. A user id is a fresh snowflake per registration, so
 * even signing up again gives a *different id*, not the same id with a new key.
 * A changed key is therefore a restored database, a migration, or an attack.
 *
 * The pins live in the device-only preferences, never in the account's synced
 * settings and never on the server: putting them there would make them worth
 * exactly as much as the keys they are meant to check. They survive signing out
 * and back in on purpose — the whole value is in the memory being long, and a
 * public key is not a secret.
 */
object KeyPins {
    enum class Verdict {
        /** No key to judge — a placeholder user, a guest, a stripped payload. */
        UNKNOWN,

        /** Never seen this person before; the key is now pinned. */
        FIRST,

        /** Same key as last time. */
        SAME,

        /** A different key. Nothing is sealed to it until a human says so. */
        CHANGED,
    }

    @Serializable
    private data class PinFile(val v: Int = 1, val keys: Map<String, String> = emptyMap(), val since: Long = 0)

    /**
     * A crowded server can hand over thousands of user objects. Past this many,
     * the oldest-recorded pins are dropped; dropping one costs the warning on a
     * key change for that person, not access to anything.
     */
    private const val MAX_PINS = 4000

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private var account: String? = null
    private var file: PinFile? = null

    /** Insertion order, so the eviction above has something to go on. */
    private val order = mutableListOf<String>()

    private fun keyFor(userId: String) = "keypins.$userId"

    /** Starts keeping pins for a signed-in account. Called when the keys come up. */
    @Synchronized
    fun open(userId: String) {
        if (account == userId && file != null) return
        account = userId
        file = runCatching { json.decodeFromString<PinFile>(SettingsStore.deviceString(keyFor(userId), "")) }
            .getOrNull()
            ?.takeIf { it.v == 1 }
            ?: PinFile(since = System.currentTimeMillis())
        order.clear()
        order += file!!.keys.keys
    }

    /** Stops, on sign-out. The pins themselves stay on the device on purpose. */
    @Synchronized
    fun close() {
        account = null
        file = null
        order.clear()
    }

    /** Whether this device has any memory at all — false on a second device's first run. */
    @Synchronized
    fun hasPins(): Boolean = order.isNotEmpty()

    /** When this device started remembering, so the interface can be honest about how much it knows. */
    @Synchronized
    fun since(): Long? = file?.since

    @Synchronized
    fun pinned(userId: String): String? = file?.keys?.get(userId)

    /** What this device thinks of a key, without changing anything. */
    @Synchronized
    fun check(userId: String, publicKeyB64: String?): Verdict {
        if (publicKeyB64.isNullOrEmpty()) return Verdict.UNKNOWN
        val have = file?.keys?.get(userId) ?: return if (file == null) Verdict.UNKNOWN else Verdict.FIRST
        return if (have == publicKeyB64) Verdict.SAME else Verdict.CHANGED
    }

    /**
     * Records a key as this person's. Used both for a first sighting and for a
     * change a human has looked at and accepted; there is deliberately no way
     * to accept one without saying so.
     */
    @Synchronized
    fun pin(userId: String, publicKeyB64: String) {
        val current = file ?: return
        if (publicKeyB64.isEmpty()) return
        val keys = current.keys.toMutableMap()
        if (!keys.containsKey(userId)) {
            order += userId
            while (order.size > MAX_PINS) {
                val drop = order.removeAt(0)
                if (drop != userId) keys.remove(drop)
            }
        }
        keys[userId] = publicKeyB64
        val next = current.copy(keys = keys)
        file = next
        val id = account ?: return
        runCatching { SettingsStore.setDeviceString(keyFor(id), json.encodeToString(PinFile.serializer(), next)) }
            .onFailure { Log.w(LOG_TAG, "could not write the key pins", it) }
    }

    /** Forgets one person, so the next key seen for them is pinned afresh. */
    @Synchronized
    fun forget(userId: String) {
        val current = file ?: return
        if (!current.keys.containsKey(userId)) return
        val keys = current.keys.toMutableMap()
        keys.remove(userId)
        order.remove(userId)
        val next = current.copy(keys = keys)
        file = next
        val id = account ?: return
        runCatching { SettingsStore.setDeviceString(keyFor(id), json.encodeToString(PinFile.serializer(), next)) }
    }

    /**
     * The first-sight path: judge a key and pin it if this device has never
     * seen one for that person. A change is reported, never recorded.
     */
    fun note(userId: String, publicKeyB64: String?): Verdict {
        val verdict = check(userId, publicKeyB64)
        if (verdict == Verdict.FIRST && !publicKeyB64.isNullOrEmpty()) pin(userId, publicKeyB64)
        return verdict
    }
}

/**
 * What this device noticed about identity keys, and what it refused to do.
 *
 * Two things used to happen with nothing on screen at all: the client sealed a
 * conversation key for whoever the server named, and it accepted whatever key
 * the server offered for a person. Both are checked now, and both can be
 * refused — but a refusal nobody can see is barely better than no refusal, so
 * this is where they surface.
 */
object KeyAlerts {
    enum class Kind {
        /** The server offered a different identity key for someone this device knows. */
        KEY_CHANGED,

        /** A grant was asked for on behalf of an account that is not in the conversation. */
        OUTSIDER_REFUSED,

        /** A grant was withheld because the recipient's key had changed. */
        GRANT_WITHHELD,

        /** Recipients could not be checked against a membership list held in full. */
        UNCHECKED,
    }

    data class Event(val id: Long, val at: Long, val kind: Kind, val userId: String? = null, val conv: String? = null, val count: Int = 1)

    /** A key change waiting on a decision: what was pinned, and what is offered instead. */
    data class PendingChange(val userId: String, val pinned: String, val offered: String, val firstSeen: Long)

    /** Enough to see a pattern, few enough that nothing grows without bound. */
    private const val MAX_EVENTS = 100

    val events = MutableStateFlow<List<Event>>(emptyList())
    val pending = MutableStateFlow<Map<String, PendingChange>>(emptyMap())

    private var nextId = 1L

    @Synchronized
    fun report(kind: Kind, userId: String? = null, conv: String? = null, count: Int = 1) {
        val e = Event(nextId++, System.currentTimeMillis(), kind, userId, conv, count)
        events.update { (listOf(e) + it).take(MAX_EVENTS) }
        Log.w(LOG_TAG, "keys: $kind conv=$conv user=$userId count=$count")
    }

    /**
     * Records a changed key as needing a decision. Nothing is sealed to the new
     * key until it is answered, so the question has to be raised rather than
     * only logged — otherwise the person simply stops receiving keys with no
     * idea why.
     */
    fun flagChange(userId: String, offered: String) {
        val was = KeyPins.pinned(userId) ?: return
        if (was == offered) return
        if (pending.value[userId]?.offered == offered) return
        pending.update { it + (userId to PendingChange(userId, was, offered, System.currentTimeMillis())) }
        report(Kind.KEY_CHANGED, userId = userId)
    }

    /** The user has looked at the new key and says it really is them. */
    fun accept(userId: String) {
        val p = pending.value[userId] ?: return
        KeyPins.pin(userId, p.offered)
        pending.update { it - userId }
    }

    /** The user says it is not. The old pin stays, so nothing is ever sealed to the new key. */
    fun reject(userId: String) {
        pending.update { it - userId }
    }

    fun clearEvents() {
        events.value = emptyList()
    }

    fun reset() {
        events.value = emptyList()
        pending.value = emptyMap()
    }
}

/**
 * The one call the rest of the app makes about somebody's key: pin it if this
 * device has never seen one for them, say whether it is the one it remembers,
 * and put a change in front of a human rather than deciding it here.
 */
fun judgeKey(userId: String, publicKeyB64: String?): KeyPins.Verdict {
    val verdict = KeyPins.note(userId, publicKeyB64)
    if (verdict == KeyPins.Verdict.CHANGED && !publicKeyB64.isNullOrEmpty()) KeyAlerts.flagChange(userId, publicKeyB64)
    return verdict
}
