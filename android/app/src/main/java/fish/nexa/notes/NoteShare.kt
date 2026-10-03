package fish.nexa.notes

import fish.nexa.Nexa
import fish.nexa.crypto.DecryptError
import fish.nexa.crypto.NoteCrypto
import fish.nexa.net.ApiError
import fish.nexa.net.PublicUser
import fish.nexa.ui.ReadableError
import fish.nexa.ui.describeError
import fish.nexa.ui.t
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.util.concurrent.ConcurrentHashMap

/**
 * Making notes and sharing them (web/src/lib/notes/share.ts). Everything that
 * leaves here for the server is sealed: a new note's head and body with a
 * key made here, and that key to each person it is shared with, with their
 * identity key as this device knows it.
 */
object NoteShare {
    private fun identity() = Nexa.keys.identity ?: throw DecryptError("this device's keys are not open")

    /** The note's key, opened: the one in memory, or fetched with the note. */
    suspend fun keyFor(noteId: String): ByteArray = NoteKeys.held(noteId)?.first ?: Notes.refresh(noteId).second

    /** Makes a note, empty unless told what it says, and puts it in the list. */
    suspend fun create(start: NoteDoc = NoteDoc("", "", emptyMap())): NoteItem {
        val me = identity()
        val key = NoteCrypto.newNoteKey()
        val (head, body, sealed) = withContext(Dispatchers.Default) {
            Triple(
                NoteCrypto.seal(key, NoteCrypto.Part.HEAD, NoteModel.headJson(NoteModel.headOf(start))),
                NoteCrypto.seal(key, NoteCrypto.Part.BODY, NoteModel.bodyJson(start.md, start.files)),
                NoteCrypto.sealKey(me.publicKey, key),
            )
        }
        return Notes.put(NotesApi.create(head, body, sealed))
    }

    /**
     * Asks someone into a note: the note's key is sealed to them and waits
     * with the invitation until they answer. Their key is the one this
     * device knows them by; one that changed and was not accepted is not sealed to.
     */
    suspend fun invite(noteId: String, user: PublicUser, role: Int) {
        val key = keyFor(noteId)
        val pub = Nexa.keys.sealingKeyOf(user.id)
            ?: throw ReadableError(t("notes.share.keyChanged", "name" to user.displayName.ifEmpty { user.username }))
        val sealed = withContext(Dispatchers.Default) { NoteCrypto.sealKey(pub, key) }
        Nexa.auth.guarded("note_invite") { captcha -> NotesApi.invite(noteId, user.id, role, sealed, captcha) }
    }

    suspend fun accept(invite: NoteInviteItem): NoteItem {
        val row = NotesApi.acceptInvite(invite.id)
        Notes.dropInvite(invite.id)
        return Notes.put(row)
    }

    suspend fun decline(invite: NoteInviteItem) {
        NotesApi.declineInvite(invite.id)
        Notes.dropInvite(invite.id)
    }

    /** A share link's whole address, as it is given to someone. */
    fun linkUrl(secret: NoteCrypto.LinkSecret): String = Nexa.api.baseUrl.trimEnd('/') + NoteCrypto.linkPath(secret)

    /**
     * Makes a share link. Its token and key are made here; the server is
     * given the token's hash and the note's key under the link's key, and
     * never the part of the link after the #.
     */
    suspend fun createLink(noteId: String, role: Int): Pair<NoteLinkRow, String> {
        val key = keyFor(noteId)
        val secret = NoteCrypto.newLink()
        val (wrapped, sealed) = withContext(Dispatchers.Default) { NoteCrypto.wrapKeyForLink(secret, key) to NoteCrypto.sealLink(key, secret) }
        val row = NotesApi.createLink(noteId, NoteCrypto.tokenHash(secret.token), role, wrapped, sealed)
        return row to linkUrl(secret)
    }

    /** A link's address, read back from what the server keeps of it; null when this device cannot open it. */
    suspend fun linkAddress(noteId: String, row: NoteLinkRow): String? = try {
        linkUrl(NoteCrypto.openLink(keyFor(noteId), row.linkSealed))
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }

    /** Joins the note a link leads to: the note's key, sealed to this account, makes it a member. */
    suspend fun joinLink(secret: NoteCrypto.LinkSecret, opened: NoteLinks.Opened): NoteItem {
        val sealed = withContext(Dispatchers.Default) { NoteCrypto.sealKey(identity().publicKey, opened.key) }
        return Notes.put(NotesApi.joinLink(secret.token, sealed))
    }

    /** Deletes a note this account owns, or leaves one it was shared. */
    suspend fun remove(note: NoteItem) {
        if (note.role == NoteRole.OWNER) NotesApi.remove(note.id) else NotesApi.removeMember(note.id, "@me")
        Notes.drop(note.id)
    }

    /**
     * What a failure with a note says, in the reader's language
     * (web/src/lib/notes/errors.ts). The server's sentences for these are
     * English, and each is about something the person can do.
     */
    fun error(err: Throwable?, fallback: String? = null): String {
        if (err is ApiError) {
            val said = when (err.code) {
                "note_role" -> "notes.errors.role"
                "note_full" -> "notes.errors.full"
                "already_member" -> "notes.errors.alreadyMember"
                "blocked" -> "notes.errors.blocked"
                "user_not_found" -> "notes.errors.userNotFound"
                "self" -> "notes.errors.self"
                "too_many_links" -> "notes.errors.tooManyLinks"
                "too_many_notes" -> "notes.errors.tooManyNotes"
                "note_files_full" -> "notes.errors.filesFull"
                "note_file" -> "notes.errors.file"
                "no_link" -> "notes.errors.noLink"
                "no_invite" -> "notes.errors.noInvite"
                "note_owner" -> "notes.errors.owner"
                "bad_note" -> "notes.errors.bad"
                "not_found" -> "notes.errors.gone"
                else -> null
            }
            if (said != null) return t(said)
            if (err.status == 404) return t("notes.errors.gone")
        }
        return describeError(err, fallback)
    }
}

/**
 * Giving a note a new key (web/src/lib/notes/rekey.ts). When someone who held
 * a note's key is no longer in it, the server marks the note, and the
 * owner's app does this the next time it sees the mark: a new key, the note
 * sealed again with it, and the key sealed to everyone still in the note, to
 * each invitation still waiting and for each link still there. The key being
 * replaced is kept, sealed with the new one, so earlier versions still open.
 */
object NoteRekey {
    enum class Result { DONE, NOT_NEEDED, BLOCKED, FAILED }

    private val running = ConcurrentHashMap<String, CompletableDeferred<Result>>()
    /** When a note's rekey last could not be done, so one that cannot be is not tried on every event. */
    private val stuck = ConcurrentHashMap<String, Long>()
    private const val TRY_AGAIN_AFTER = 60_000L

    /** Gives the note a new key if it is marked as needing one and this account owns it. */
    suspend fun rekey(id: String, force: Boolean = false): Result {
        running[id]?.let { return it.await() }
        val last = stuck[id]
        if (!force && last != null && System.currentTimeMillis() - last < TRY_AGAIN_AFTER) return Result.FAILED
        val mine = CompletableDeferred<Result>()
        running.putIfAbsent(id, mine)?.let { return it.await() }
        val res = try {
            run(id)
        } catch (e: CancellationException) {
            mine.complete(Result.FAILED)
            running.remove(id, mine)
            throw e
        } catch (_: Exception) {
            Result.FAILED
        }
        if (res == Result.BLOCKED || res == Result.FAILED) stuck[id] = System.currentTimeMillis() else stuck.remove(id)
        mine.complete(res)
        running.remove(id, mine)
        return res
    }

    /** Forgets what could not be done, for the next account on this device. */
    fun clear() = stuck.clear()

    private suspend fun run(id: String): Result {
        val identity = Nexa.keys.identity ?: return Result.FAILED
        val meId = Nexa.users.meId ?: return Result.FAILED
        // a save or someone joining in between makes the server refuse; it is put together again from what is there now
        repeat(4) {
            val row = NotesApi.get(id)
            // done meanwhile by another of this account's devices, or not this account's to do
            if (row.role != NoteRole.OWNER || !row.needsRekey) return Result.NOT_NEEDED
            val oldKey = NoteKeys.keyOf(row)
            val sharing = NotesApi.sharing(id)
            val newKey = NoteCrypto.newNoteKey()

            val members = ArrayList<Pair<String, String>>()
            for (m in sharing.members) {
                val pub = if (m.user.id == meId) identity.publicKey else Nexa.keys.sealingKeyOf(m.user.id)
                // Their key is not the one this device knows them by, and nobody
                // has accepted the change: nothing is sealed to it. The note waits.
                    ?: return Result.BLOCKED
                members += m.user.id to NoteCrypto.sealKey(pub, newKey)
            }
            // An invitation or a link that cannot be carried over is left out, and the server drops it.
            val invites = ArrayList<Pair<String, String>>()
            for (inv in sharing.invites) {
                val pub = try {
                    Nexa.keys.sealingKeyOf(inv.user.id)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    null
                }
                if (pub != null) invites += inv.id to NoteCrypto.sealKey(pub, newKey)
            }
            val links = ArrayList<Triple<String, String, String>>()
            for (l in sharing.links) {
                try {
                    val secret = NoteCrypto.openLink(oldKey, l.linkSealed)
                    links += Triple(l.id, NoteCrypto.wrapKeyForLink(secret, newKey), NoteCrypto.sealLink(newKey, secret))
                } catch (_: Exception) {
                    // sealed with a key this device does not have: it stops working
                }
            }

            val head = NoteCrypto.open(oldKey, NoteCrypto.Part.HEAD, row.head)
            val body = NoteCrypto.open(oldKey, NoteCrypto.Part.BODY, row.body ?: "")
            // The changes kept since the note was last saved whole are sealed with
            // the old key, and go when it does: the new body carries every one of them.
            val doc = NoteDocs.docFromBody(id, row.version, NoteModel.readHead(head).title, body)
            val whole: JsonObject
            var upto = row.crdtUpto
            try {
                var more = true
                while (more) {
                    val page = NotesApi.updates(id, upto)
                    for (u in page.updates) {
                        try {
                            doc.apply(NoteCrypto.openUpdate(oldKey, u.update))
                        } catch (_: Exception) {
                            // one that will not open with the key it should have been sealed with holds nothing anyone can read
                        }
                        upto = maxOf(upto, u.seq)
                    }
                    upto = maxOf(upto, page.crdtUpto)
                    more = page.more
                }
                val now = NoteDocs.readDoc(doc)
                val p = NoteModel.pruned(now.md, now.files)
                whole = NoteDocs.bodyOf(doc, p.md, p.files)
            } finally {
                doc.close()
            }
            val request = buildJsonObject {
                put("head", NoteCrypto.seal(newKey, NoteCrypto.Part.HEAD, head))
                put("body", NoteCrypto.seal(newKey, NoteCrypto.Part.BODY, whole))
                put("base_version", row.version)
                put("prev_key", NoteCrypto.wrapPreviousKey(newKey, oldKey))
                putJsonArray("members") { members.forEach { (u, k) -> add(buildJsonObject { put("user_id", u); put("key_sealed", k) }) } }
                putJsonArray("invites") { invites.forEach { (i, k) -> add(buildJsonObject { put("id", i); put("key_sealed", k) }) } }
                putJsonArray("links") { links.forEach { (i, w, s) -> add(buildJsonObject { put("id", i); put("key_wrapped", w); put("link_sealed", s) }) } }
                put("upto", upto)
            }
            try {
                NotesApi.rekey(id, request)
                return Result.DONE
            } catch (e: ApiError) {
                if (e.code == "note_stale" || e.code == "note_members_changed") return@repeat
                throw e
            }
        }
        return Result.FAILED
    }
}

/**
 * What a note's share link leads to (web/src/lib/notes/linkPreview.ts), for
 * a card in a message, the dialog a link opens and the page it lands on. The
 * server keeps, beside each link, the note's key under the link's own key,
 * which is the part of the link after the # and never reaches it.
 */
object NoteLinks {
    class Opened(val view: NoteLinkView, val key: ByteArray, val head: NoteHead)

    sealed interface Entry {
        data object Loading : Entry
        class Ready(val opened: Opened, val at: Long) : Entry
        /** No such link: removed, or never was. */
        class Invalid(val at: Long) : Entry
        /** The link is there, but the key it carries does not open it: cut short when it was copied. */
        class Locked(val at: Long) : Entry
        class Failed(val at: Long) : Entry
    }

    /** A note's title and first lines move on as it is written: a card drawn again after this long asks again. */
    private const val FRESH_MS = 2 * 60_000L
    private const val RETRY_MS = 30_000L

    private val _byLink = MutableStateFlow<Map<String, Entry>>(emptyMap())
    val byLink: StateFlow<Map<String, Entry>> = _byLink
    private val inflight = ConcurrentHashMap<String, Boolean>()
    @Volatile private var generation = 0

    fun keyOf(secret: NoteCrypto.LinkSecret) = "${secret.token}#${secret.key}"

    suspend fun open(secret: NoteCrypto.LinkSecret): Opened {
        val view = NotesApi.link(secret.token)
        return withContext(Dispatchers.Default) {
            val key = NoteCrypto.unwrapKeyFromLink(secret, view.keyWrapped)
            Opened(view, key, NoteModel.readHead(NoteCrypto.open(key, NoteCrypto.Part.HEAD, view.head)))
        }
    }

    private fun due(e: Entry?, now: Long): Boolean = when (e) {
        null -> true
        Entry.Loading -> false
        is Entry.Ready -> now - e.at > FRESH_MS
        is Entry.Invalid -> now - e.at > FRESH_MS
        is Entry.Locked -> now - e.at > FRESH_MS
        is Entry.Failed -> now - e.at > RETRY_MS
    }

    suspend fun load(secret: NoteCrypto.LinkSecret, force: Boolean = false) {
        val k = keyOf(secret)
        if (inflight.putIfAbsent(k, true) != null) return
        try {
            val cur = _byLink.value[k]
            if (!force && !due(cur, System.currentTimeMillis())) return
            if (cur !is Entry.Ready) _byLink.update { it + (k to Entry.Loading) }
            val mine = generation
            val next: Entry = try {
                Entry.Ready(open(secret), System.currentTimeMillis())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val at = System.currentTimeMillis()
                when {
                    e is ApiError && e.status == 404 -> Entry.Invalid(at)
                    e is DecryptError -> Entry.Locked(at)
                    cur is Entry.Ready -> Entry.Ready(cur.opened, at)
                    else -> Entry.Failed(at)
                }
            }
            if (mine == generation) _byLink.update { it + (k to next) }
        } finally {
            inflight.remove(k)
        }
    }

    /** Forgets every share link this account opened, with the keys they gave. */
    fun clear() {
        generation += 1
        inflight.clear()
        _byLink.value = emptyMap()
    }
}

/**
 * A note's earlier states (web/src/lib/notes/history.ts), each sealed as it
 * was with the key the note had then; whoever holds the note's key now can
 * open all of them through the chain of earlier keys.
 */
class NoteHistoryData private constructor(
    val versions: List<Version>,
    private val noteId: String,
    private val keyAt: suspend (Int) -> ByteArray,
) {
    data class Version(val id: String, val version: Int, val savedAt: Long, val editedBy: String?, val head: NoteHead?, val epoch: Int)

    /** Opens one of them in full. */
    suspend fun open(versionId: String): NoteDoc {
        val v = NotesApi.version(noteId, versionId)
        val key = keyAt(v.keyEpoch)
        return withContext(Dispatchers.Default) {
            val head = NoteCrypto.open(key, NoteCrypto.Part.HEAD, v.head)
            val body = NoteModel.readBody(NoteCrypto.open(key, NoteCrypto.Part.BODY, v.body ?: ""))
            NoteDoc(NoteModel.readHead(head).title, body.md, body.files)
        }
    }

    companion object {
        /** The note's earlier states, newest first, with their heads opened. */
        suspend fun load(noteId: String): NoteHistoryData {
            val res = NotesApi.versions(noteId)
            val (row, key) = Notes.refresh(noteId)
            val wrapped = res.keys.associate { it.epoch to it.wrapped }
            val keys = ConcurrentHashMap<Int, ByteArray>()
            val keyAt: suspend (Int) -> ByteArray = { epoch ->
                keys[epoch] ?: withContext(Dispatchers.Default) { NoteCrypto.keyAt(key, row.keyEpoch, epoch, wrapped) }.also { keys[epoch] = it }
            }
            val versions = res.versions.map { v ->
                val head = try {
                    NoteModel.readHead(NoteCrypto.open(keyAt(v.keyEpoch), NoteCrypto.Part.HEAD, v.head))
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    null
                }
                Version(v.id, v.version, v.savedAt, v.editedBy, head, v.keyEpoch)
            }
            return NoteHistoryData(versions, noteId, keyAt)
        }
    }
}
