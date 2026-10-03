package fish.nexa.notes

import fish.nexa.Nexa
import fish.nexa.crypto.DecryptError
import fish.nexa.crypto.NoteCrypto
import fish.nexa.net.ApiError
import fish.nexa.net.PublicUser
import fish.nexa.net.wireJson
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.util.concurrent.ConcurrentHashMap

/**
 * The note requests the server answers (web/src/api/notes.ts). Everything
 * sent and returned here is sealed on the device: the server keeps who may
 * read and write a note and which save came first, and nothing it could read.
 */
object NotesApi {
    private val api get() = Nexa.api

    suspend fun list(): NoteList = api.get("/notes", NoteList.serializer())

    suspend fun create(head: String, body: String, keySealed: String): NoteRow =
        api.request("POST", "/notes", NoteRow.serializer(), buildJsonObject {
            put("head", head)
            put("body", body)
            put("key_sealed", keySealed)
        })

    suspend fun get(id: String): NoteRow = api.get("/notes/$id", NoteRow.serializer())

    /** Saves the whole note over version `base`, holding every change up to `upto`; refused with `note_stale` when it moved on. */
    suspend fun save(id: String, head: String, body: String, base: Int, files: List<String>, upto: Long, keep: Boolean): Int {
        val res = api.request("PUT", "/notes/$id", buildJsonObject {
            put("head", head)
            put("body", body)
            put("base_version", base)
            putJsonArray("files") { files.forEach { add(JsonPrimitive(it)) } }
            put("upto", upto)
            if (keep) put("keep", true)
        })
        return ((res as? JsonObject)?.get("version") as? JsonPrimitive)?.intOrNull ?: base + 1
    }

    /** Sends one change, sealed with the key of `epoch`; `cid` is which open copy made it. Returns its number. */
    suspend fun postUpdate(id: String, update: String, epoch: Int, cid: String): Long {
        val res = api.request("POST", "/notes/$id/updates", buildJsonObject {
            put("update", update)
            put("epoch", epoch)
            put("cid", cid)
        })
        return ((res as? JsonObject)?.get("seq") as? JsonPrimitive)?.longOrNull ?: throw ApiError(200, "bad_response", "The server's answer could not be read.")
    }

    suspend fun updates(id: String, after: Long): NoteUpdates = api.get("/notes/$id/updates?after=$after", NoteUpdates.serializer())

    suspend fun versions(id: String): NoteVersions = api.get("/notes/$id/versions", NoteVersions.serializer())

    suspend fun version(id: String, versionId: String): NoteVersionRow = api.get("/notes/$id/versions/$versionId", NoteVersionRow.serializer())

    /** Says this account has the note open, or has closed it; `hello` asks the others there to say so too. */
    suspend fun presence(id: String, here: Boolean, hello: Boolean = false) {
        api.request("POST", "/notes/$id/presence", buildJsonObject {
            put("here", here)
            put("hello", hello)
        })
    }

    suspend fun remove(id: String) {
        api.request("DELETE", "/notes/$id")
    }

    suspend fun sharing(id: String): NoteSharing = api.get("/notes/$id/sharing", NoteSharing.serializer())

    suspend fun setRole(id: String, userId: String, role: Int) {
        api.request("PATCH", "/notes/$id/members/$userId", buildJsonObject { put("role", role) })
    }

    /** Takes someone out of a note; "@me" leaves it. */
    suspend fun removeMember(id: String, userId: String) {
        api.request("DELETE", "/notes/$id/members/$userId")
    }

    suspend fun invite(id: String, userId: String, role: Int, keySealed: String, captcha: String?): NoteSentInvite =
        api.request("POST", "/notes/$id/invites", NoteSentInvite.serializer(), buildJsonObject {
            put("user_id", userId)
            put("role", role)
            put("key_sealed", keySealed)
        }, captcha = captcha)

    suspend fun cancelInvite(id: String, inviteId: String) {
        api.request("DELETE", "/notes/$id/invites/$inviteId")
    }

    suspend fun acceptInvite(inviteId: String): NoteRow = api.request("POST", "/note-invites/$inviteId/accept", NoteRow.serializer())

    suspend fun declineInvite(inviteId: String) {
        api.request("DELETE", "/note-invites/$inviteId")
    }

    suspend fun createLink(id: String, tokenHash: String, role: Int, keyWrapped: String, linkSealed: String): NoteLinkRow =
        api.request("POST", "/notes/$id/links", NoteLinkRow.serializer(), buildJsonObject {
            put("token_hash", tokenHash)
            put("role", role)
            put("key_wrapped", keyWrapped)
            put("link_sealed", linkSealed)
        })

    suspend fun removeLink(id: String, linkId: String) {
        api.request("DELETE", "/notes/$id/links/$linkId")
    }

    /** What a share link leads to. Only the link's token is sent: the key after its # never leaves the device. */
    suspend fun link(token: String): NoteLinkView = api.get("/note-links/${java.net.URLEncoder.encode(token, "UTF-8")}", NoteLinkView.serializer())

    suspend fun joinLink(token: String, keySealed: String): NoteRow =
        api.request("POST", "/note-links/${java.net.URLEncoder.encode(token, "UTF-8")}/join", NoteRow.serializer(), buildJsonObject { put("key_sealed", keySealed) })

    suspend fun rekey(id: String, body: JsonObject) {
        api.request("POST", "/notes/$id/rekey", body)
    }
}

/**
 * The keys of this account's notes, opened (web/src/lib/notes/keys.ts). Each
 * comes sealed to this account; opening one is a public-key operation, so it
 * is done once and kept here, in memory only, never on disk. They go when the
 * app locks or signs out.
 */
object NoteKeys {
    private class Held(val sealed: String, val key: ByteArray, val epoch: Int)

    private val held = ConcurrentHashMap<String, Held>()

    /** Opens (or returns) the key a note's row carries for this account. */
    fun keyOf(id: String, keySealed: String, epoch: Int): ByteArray {
        held[id]?.let { if (it.sealed == keySealed) return it.key }
        val identity = Nexa.keys.identity ?: throw DecryptError("this device's keys are not open")
        val key = NoteCrypto.openKey(identity, keySealed)
        // a slower answer about an older key does not replace a newer one
        val now = held[id]
        if (now == null || now.epoch <= epoch) held[id] = Held(keySealed, key, epoch)
        return key
    }

    fun keyOf(row: NoteRow): ByteArray = keyOf(row.id, row.keySealed, row.keyEpoch)

    /** The key held for a note and which of its keys it is, if it has been opened. */
    fun held(id: String): Pair<ByteArray, Int>? = held[id]?.let { it.key to it.epoch }

    fun forget(id: String) {
        held.remove(id)
    }

    /** Lets go of every key but those of the notes named: the notes this account is still in. */
    fun keepOnly(ids: Set<String>) {
        held.keys.retainAll(ids)
    }

    fun clear() = held.clear()
}

/**
 * Changes made in a note that never reached the server (web/src/lib/notes/unsent.ts):
 * kept in memory until the note is opened again, where they go back into it
 * and are sent. Never on disk: it is what was written, in the clear.
 */
object NoteUnsent {
    private val unsent = ConcurrentHashMap<String, ByteArray>()

    fun keep(id: String, changes: ByteArray) {
        unsent[id] = changes
    }

    /** The changes left unsent in a note, once: the caller puts them back. */
    fun take(id: String): ByteArray? = unsent.remove(id)

    fun forget(id: String? = null) {
        if (id == null) unsent.clear() else unsent.remove(id)
    }
}

/**
 * The colours people are drawn in inside a note (web/src/lib/notes/people.ts):
 * their caret, their selection, the name flag and the ring round their face.
 * Brand violet is not among them: that is this page's own caret.
 */
object NoteHues {
    val HUES = longArrayOf(0xFFD9473D, 0xFF2F7BD8, 0xFF138A7E, 0xFFC93D7A, 0xFFB97A12, 0xFF4B8F2A, 0xFF5361D6, 0xFFB5612A)

    private val given = HashMap<String, HashMap<String, Int>>()

    /** Where in the list someone's colour is looked for first: the same for them in every note. */
    private fun preferred(userId: String): Int {
        var h = 0L
        for (c in userId) h = ((h * 31) + c.code) and 0xFFFFFFFFL
        return (h % HUES.size).toInt()
    }

    /** The colour someone has in a note: their own where it is free, the next free one where it is not. */
    @Synchronized fun of(noteId: String, userId: String): Long {
        val inNote = given.getOrPut(noteId) { HashMap() }
        val at = inNote.getOrPut(userId) {
            val taken = inNote.values.toSet()
            val first = preferred(userId)
            (0 until HUES.size).map { (first + it) % HUES.size }.firstOrNull { it !in taken } ?: first
        }
        return HUES[at]
    }

    @Synchronized fun clear() = given.clear()
}

/** One note in the list, opened as far as its head. */
data class NoteItem(
    val id: String,
    val ownerId: String,
    val role: Int,
    val version: Int,
    val createdAt: Long,
    val updatedAt: Long,
    val editedBy: String?,
    /** How many people it is shared with, the owner included. */
    val members: Int,
    val keyEpoch: Int,
    /** The title and first lines; null when the note could not be opened on this device. */
    val head: NoteHead?,
)

data class NoteInviteItem(
    val id: String,
    val noteId: String,
    val role: Int,
    val from: PublicUser,
    val createdAt: Long,
    val head: NoteHead?,
)

/** Someone changed a note: the change itself, sealed, as the gateway passes it on. */
data class NoteCrdtEvent(val id: String, val seq: Long, val update: String?, val userId: String, val cid: String, val at: Long)

/** What the server says when a note changes (NoteUpdateEvent). */
data class NoteUpdateEvent(
    val id: String,
    val version: Int?,
    val head: String?,
    val body: String?,
    val updatedAt: Long?,
    val editedBy: String?,
    val members: Boolean,
    val removed: Boolean,
    val rekeyed: Boolean,
    val upto: Long?,
    val reset: Boolean,
)

data class NotePresenceEvent(val id: String, val userId: String, val here: Boolean, val hello: Boolean)

data class NoteCursorEvent(val id: String, val userId: String, val data: String)

/** One open note's events, for the page that has it open. */
interface NoteListener {
    fun update(d: NoteUpdateEvent) {}
    fun presence(d: NotePresenceEvent) {}
    fun cursor(d: NoteCursorEvent) {}
    fun crdt(d: NoteCrdtEvent) {}
    /** The note is gone for this account: deleted, or this account is out of it. */
    fun gone() {}
}

/**
 * The notes this account has, and the invitations waiting for it
 * (web/src/stores/notes.ts). Each note's key is opened with this account's
 * identity key and its head with that, so the list has titles and first
 * lines to show. A note's text is not kept here: it is fetched and opened
 * when the note is (OpenNote).
 */
object Notes {
    enum class Status { IDLE, LOADING, READY, ERROR }

    /** How long someone counts as being in a note after they last said so. They say so every twenty seconds. */
    const val HERE_TTL = 50_000L

    private val _status = MutableStateFlow(Status.IDLE)
    val status: StateFlow<Status> = _status
    private val _notes = MutableStateFlow<Map<String, NoteItem>>(emptyMap())
    val notes: StateFlow<Map<String, NoteItem>> = _notes
    private val _invites = MutableStateFlow<List<NoteInviteItem>>(emptyList())
    val invites: StateFlow<List<NoteInviteItem>> = _invites
    /** Who else has each note open: note id, then user id, then when they last said so. */
    private val _here = MutableStateFlow<Map<String, Map<String, Long>>>(emptyMap())
    val here: StateFlow<Map<String, Map<String, Long>>> = _here
    /** Counts changes to who each note is shared with, so a dialog showing that knows to look again. */
    private val _sharing = MutableStateFlow<Map<String, Int>>(emptyMap())
    val sharing: StateFlow<Map<String, Int>> = _sharing

    private val listeners = ConcurrentHashMap<String, MutableSet<NoteListener>>()

    /** Counts loads, so an answer that comes back after signing out, or after a newer load, is dropped. */
    @Volatile private var generation = 0
    /** Counts sessions: what was asked for one account is not put in the next one's list. */
    @Volatile private var session = 0
    @Volatile private var loading: kotlinx.coroutines.Deferred<Unit>? = null

    /** Follows one note's events while it is open; returns how to stop. */
    fun watch(id: String, l: NoteListener): () -> Unit {
        val set = listeners.getOrPut(id) { java.util.Collections.newSetFromMap(ConcurrentHashMap()) }
        set += l
        return {
            set -= l
            if (set.isEmpty()) listeners.remove(id, set)
        }
    }

    private fun each(id: String, f: (NoteListener) -> Unit) {
        listeners[id]?.toList()?.forEach(f)
    }

    // ---- rows into items --------------------------------------------------------------

    private fun item(row: NoteRow): NoteItem {
        val head = try {
            NoteModel.readHead(NoteCrypto.open(NoteKeys.keyOf(row), NoteCrypto.Part.HEAD, row.head))
        } catch (_: Exception) {
            // listed all the same, as a note this device cannot open
            null
        }
        return NoteItem(row.id, row.ownerId, row.role, row.version, row.createdAt, row.updatedAt, row.editedBy, row.members, row.keyEpoch, head)
    }

    private fun inviteItem(row: NoteInviteRow): NoteInviteItem {
        val head = try {
            val identity = Nexa.keys.identity ?: throw DecryptError("locked")
            NoteModel.readHead(NoteCrypto.open(NoteCrypto.openKey(identity, row.keySealed), NoteCrypto.Part.HEAD, row.head))
        } catch (_: Exception) {
            null
        }
        return NoteInviteItem(row.id, row.noteId, row.role, row.from, row.createdAt, head)
    }

    /** A note this account owns that someone holding its key has left gets a new key (NoteRekey). */
    private fun mind(row: NoteRow) {
        if (row.role == NoteRole.OWNER && row.needsRekey) Nexa.scope.launch { NoteRekey.rekey(row.id) }
    }

    /**
     * Fetches a note and puts it in the list as it is now: after it got a new
     * key, after this account's role in it changed, or to open it. A note
     * that turns out to be gone is taken off the list.
     */
    suspend fun refresh(id: String): Pair<NoteRow, ByteArray> {
        val row = try {
            NotesApi.get(id)
        } catch (e: ApiError) {
            if (e.status == 404) drop(id)
            throw e
        }
        val key = NoteKeys.keyOf(row)
        put(row)
        return row to key
    }

    suspend fun load(force: Boolean = false) {
        val running = loading
        if (running != null && !force) return running.await()
        if (!force && _status.value == Status.READY) return
        val mine = ++generation
        if (_status.value != Status.READY) _status.value = Status.LOADING
        val job = Nexa.scope.async {
            try {
                val res = NotesApi.list()
                val items = res.notes.map { item(it) }
                val invites = res.invites.map { inviteItem(it) }
                if (mine != generation) return@async
                Nexa.users.upsert(res.invites.map { it.from })
                val map = LinkedHashMap<String, NoteItem>()
                for (n in items) map[n.id] = n
                NoteKeys.keepOnly(map.keys)
                // whoever was in a note that is gone is no longer anywhere
                _here.update { h -> h.filterKeys { it in map } }
                _notes.value = map
                _invites.value = invites
                _status.value = Status.READY
                // a note on the page that is no longer listed is gone
                for ((id, set) in listeners) if (id !in map) set.toList().forEach { it.gone() }
                res.notes.forEach { mind(it) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (_: Exception) {
                if (mine == generation && _status.value != Status.READY) _status.value = Status.ERROR
            }
        }
        loading = job
        try {
            job.await()
        } finally {
            if (loading === job) loading = null
        }
    }

    /** Puts a note the server just sent (created, joined, fetched) in the list. */
    fun put(row: NoteRow): NoteItem {
        val mine = session
        val it = item(row)
        if (mine != session) return it
        _notes.update { cur ->
            val was = cur[it.id]
            // an older answer does not replace what a newer one already put there
            if (was != null && was.version > it.version) cur else cur + (it.id to it)
        }
        mind(row)
        return it
    }

    fun drop(id: String) {
        NoteKeys.forget(id)
        NoteUnsent.forget(id)
        each(id) { it.gone() }
        _notes.update { it - id }
        _here.update { it - id }
    }

    fun dropInvite(id: String) = _invites.update { list -> list.filter { it.id != id } }

    fun clear() {
        generation += 1
        session += 1
        loading = null
        NoteKeys.clear()
        NoteRekey.clear()
        // a note in the clear does not outlast the keys that opened it, nor do the links opened
        NoteUnsent.forget()
        NoteLinks.clear()
        NoteHues.clear()
        _status.value = Status.IDLE
        _notes.value = emptyMap()
        _invites.value = emptyList()
        _here.value = emptyMap()
        _sharing.value = emptyMap()
    }

    private fun updated(d: NoteUpdateEvent) {
        each(d.id) { it.update(d) }
        if (d.members) _sharing.update { it + (d.id to ((it[d.id] ?: 0) + 1)) }
        val known = _notes.value[d.id]
        if (known == null) {
            // a note this account was just let into, or made on another device
            if (_status.value != Status.IDLE) Nexa.scope.launch { load(true) }
            return
        }
        if (d.rekeyed || d.members || d.removed) {
            // the key, this account's role or how many it is shared with changed: the note is asked for again
            Nexa.scope.launch { runCatching { refresh(d.id) } }
            return
        }
        val version = d.version ?: return
        val sealed = d.head ?: return
        if (version <= known.version) return
        val have = NoteKeys.held(d.id)
        val head = try {
            if (have == null) throw DecryptError("no key")
            NoteModel.readHead(NoteCrypto.open(have.first, NoteCrypto.Part.HEAD, sealed))
        } catch (_: Exception) {
            // sealed with a key this device does not have yet: fetched with it
            Nexa.scope.launch { runCatching { refresh(d.id) } }
            return
        }
        _notes.update { cur ->
            val c = cur[d.id]
            if (c == null || c.version >= version) cur
            else cur + (d.id to c.copy(head = head, version = version, updatedAt = d.updatedAt ?: c.updatedAt, editedBy = d.editedBy ?: c.editedBy))
        }
    }

    private fun invited(row: NoteInviteRow): Boolean {
        Nexa.users.upsert(listOf(row.from))
        val known = _invites.value.any { it.id == row.id }
        val it = inviteItem(row)
        _invites.update { list -> listOf(it) + list.filter { i -> i.id != it.id } }
        return !known
    }

    /** What a note being written here says now, for the list, ahead of its next save. */
    fun shown(id: String, head: NoteHead, by: String?) {
        _notes.update { cur ->
            val known = cur[id] ?: return@update cur
            // someone else's words keep the time and name their own change gave the note
            cur + (id to known.copy(head = head, updatedAt = if (by != null) maxOf(known.updatedAt, System.currentTimeMillis()) else known.updatedAt, editedBy = by ?: known.editedBy))
        }
    }

    private fun crdt(d: NoteCrdtEvent) {
        each(d.id) { it.crdt(d) }
        // the list shows when it was last written in, and by whom
        _notes.update { cur ->
            val known = cur[d.id]
            if (known != null && d.at > known.updatedAt) cur + (d.id to known.copy(updatedAt = d.at, editedBy = d.userId)) else cur
        }
    }

    private fun present(d: NotePresenceEvent) {
        each(d.id) { it.presence(d) }
        _here.update { all ->
            val cur = all[d.id] ?: emptyMap()
            if (!d.here && d.userId !in cur) return@update all
            val next = if (d.here) cur + (d.userId to System.currentTimeMillis()) else cur - d.userId
            all + (d.id to next)
        }
    }

    /** The people in a note right now, besides this account: those who said so within HERE_TTL. */
    fun peopleHere(here: Map<String, Long>?, now: Long = System.currentTimeMillis()): List<String> =
        here?.entries?.filter { now - it.value < HERE_TTL }?.map { it.key }?.sorted() ?: emptyList()

    /** This account's notes, the one written in last first. */
    fun sorted(notes: Map<String, NoteItem>): List<NoteItem> =
        notes.values.sortedWith(compareByDescending<NoteItem> { it.updatedAt }.thenByDescending { it.id })

    // ---- the gateway -------------------------------------------------------------------------------

    private fun JsonElement?.s(k: String): String? = ((this as? JsonObject)?.get(k) as? JsonPrimitive)?.contentOrNull
    private fun JsonElement?.b(k: String): Boolean = ((this as? JsonObject)?.get(k) as? JsonPrimitive)?.booleanOrNull ?: false
    private fun JsonElement?.l(k: String): Long? = ((this as? JsonObject)?.get(k) as? JsonPrimitive)?.longOrNull
    private fun JsonElement?.i(k: String): Int? = ((this as? JsonObject)?.get(k) as? JsonPrimitive)?.intOrNull

    /** A note event from the gateway (gateway/dispatch.ts). */
    fun onEvent(type: String, d: JsonElement?) {
        when (type) {
            "note_update" -> {
                val id = d.s("id") ?: return
                updated(NoteUpdateEvent(id, d.i("version"), d.s("head"), d.s("body"), d.l("updated_at"), d.s("edited_by"), d.b("members"), d.b("removed"), d.b("rekeyed"), d.l("upto"), d.b("reset")))
            }
            "note_delete" -> d.s("id")?.let { drop(it) }
            "note_invite" -> {
                val row = try {
                    wireJson.decodeFromJsonElement(NoteInviteRow.serializer(), d ?: return)
                } catch (_: Exception) {
                    return
                }
                if (invited(row)) fish.nexa.notify.Notifier.onNoteInvite(row)
            }
            "note_invite_delete" -> d.s("id")?.let { dropInvite(it) }
            "note_presence" -> {
                val id = d.s("id") ?: return
                val user = d.s("user_id") ?: return
                present(NotePresenceEvent(id, user, d.b("here"), d.b("hello")))
            }
            "note_cursor" -> {
                val id = d.s("id") ?: return
                val user = d.s("user_id") ?: return
                val data = d.s("data") ?: return
                each(id) { it.cursor(NoteCursorEvent(id, user, data)) }
            }
            "note_crdt" -> {
                val id = d.s("id") ?: return
                val seq = d.l("seq") ?: return
                crdt(NoteCrdtEvent(id, seq, d.s("update"), d.s("user_id") ?: "", d.s("cid") ?: "", d.l("at") ?: System.currentTimeMillis()))
            }
        }
    }

    /** Every ready: the list catches up with whatever a reconnect missed, without clearing what is open. */
    fun onReady() {
        Nexa.scope.launch { load(true) }
    }
}
