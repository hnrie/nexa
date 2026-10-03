package fish.nexa.notes

import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.DecryptError
import fish.nexa.crypto.NoteCrypto
import fish.nexa.net.ApiError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/** What a failure with a note's requests means for the session (open.ts failureKind). */
fun failureKind(err: Throwable): FailureKind {
    if (err !is ApiError) return FailureKind.OTHER
    return when {
        err.code == "note_stale" -> FailureKind.STALE
        err.code == "note_rekeyed" -> FailureKind.REKEYED
        err.code == "note_save_first" -> FailureKind.SAVE_FIRST
        // no answer, the server restarting, or being asked to slow down: the words are kept here and sent again
        err.status == 0 || err.status == 429 || err.status >= 500 -> FailureKind.OFFLINE
        else -> FailureKind.OTHER
    }
}

/**
 * A save refused over files the server would not take (somebody took them
 * out of the note while this device still showed them): the note without them.
 */
fun withoutRefusedFiles(err: Throwable, doc: NoteDoc): NoteDoc? {
    if (err !is ApiError || err.code != "note_file") return null
    val named = err.details?.get("files") as? JsonArray ?: return null
    if (named.isEmpty()) return null
    val refused = named.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.toSet()
    val files = LinkedHashMap(doc.files)
    val gone = HashSet<String>()
    var changed = false
    for ((id, meta) in doc.files) {
        if (meta.blobId in refused) {
            gone += id
            files.remove(id)
            changed = true
        } else if (meta.preview != null && meta.preview.blobId in refused) {
            // only its small copy: the picture stays, shown at its full size
            files[id] = meta.copy(preview = null)
            changed = true
        }
    }
    return if (changed) doc.copy(md = NoteModel.withoutFiles(doc.md, gone), files = files) else null
}

interface OpenNoteEvents : SessionEvents {
    /** The note is gone for this account: deleted, or this account is no longer in it. */
    fun onGone()
}

/**
 * A note open in the app (web/src/lib/notes/open.ts): its session joined to
 * the server, the note's key and the gateway. The changes others make arrive
 * as events and go into the session, which takes them into its document and
 * shows them. The note's key can change under an open note (its owner's app
 * gives it a new one when someone leaves): a sealed part that will not open
 * with the key held is tried again with the key the server has for this
 * account now. And everyone with the note open says so every little while,
 * which is all "who is here" is.
 */
class OpenNote private constructor(val id: String, private val events: OpenNoteEvents) {
    companion object {
        /** How often an open note says it is open, and how soon a hello is answered again. */
        private const val HERE_EVERY = 20_000L
        private const val HELLO_GAP = 2500L

        /** Opens a note: fetched, unsealed, and followed until closed. Runs on the main thread. */
        suspend fun open(id: String, events: OpenNoteEvents): OpenNote = withContext(Dispatchers.Main.immediate) {
            val note = OpenNote(id, events)
            try {
                note.start()
            } catch (e: Throwable) {
                note.scope.cancel()
                throw e
            }
            note
        }
    }

    /** Everything about this note runs here, on the main thread. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var key = ByteArray(0)
    private var epoch = 0
    private var closed = false
    /** This open copy of the note, so its own changes are known when the server passes them back. */
    val cid: String = Bytes.b64url(Bytes.random(9))
    lateinit var session: NoteSession
        private set
    /** Someone's caret moved: for the page's live cursors. */
    var onCursor: ((NoteCursorEvent) -> Unit)? = null
    /** Someone opened or closed the note: their caret comes or goes with them. */
    var onPresence: ((NotePresenceEvent) -> Unit)? = null

    private var said = 0L
    private var greet: Job? = null
    private val jobs = ArrayList<Job>()
    private var stopWatching: () -> Unit = {}

    /** The note's key as it is now, for what is sealed beside the note (a share link, a cursor). */
    fun key(): ByteArray = key

    private suspend fun fetchRow(): NoteRow {
        val row = NotesApi.get(id)
        key = withContext(Dispatchers.Default) { NoteKeys.keyOf(row) }
        epoch = row.keyEpoch
        Notes.put(row)
        return row
    }

    /** Opens something sealed with the note's key, asking for the key again once if it will not open. */
    private suspend fun <T> withKey(work: (ByteArray) -> T): T {
        val used = key
        return try {
            withContext(Dispatchers.Default) { work(used) }
        } catch (e: DecryptError) {
            // sealed with a key newer than the one held: asked for, and tried once more
            if (key === used) fetchRow()
            if (key === used) throw e
            val k = key
            withContext(Dispatchers.Default) { work(k) }
        }
    }

    private suspend fun open(part: NoteCrypto.Part, sealed: String): JsonElement = withKey { NoteCrypto.open(it, part, sealed) }

    private suspend fun start() {
        val (row, k) = Notes.refresh(id)
        key = k
        epoch = row.keyEpoch
        val head = open(NoteCrypto.Part.HEAD, row.head)
        val body = open(NoteCrypto.Part.BODY, row.body ?: "")
        val deps = object : SessionDeps {
            override suspend fun send(update: ByteArray, keepalive: Boolean): Long {
                // sealed and sent with the same key, so the server can say when that key is no longer the note's
                val k2 = key
                val e = epoch
                val sealed = withContext(Dispatchers.Default) { NoteCrypto.sealUpdate(k2, update) }
                return NotesApi.postUpdate(id, sealed, e, cid)
            }

            override suspend fun changes(after: Long): Changes {
                val res = NotesApi.updates(id, after)
                return Changes(res.updates.map { SealedChange(it.seq, it.update) }, res.crdtUpto, res.more)
            }

            override suspend fun openUpdate(sealed: String): ByteArray = withKey { NoteCrypto.openUpdate(it, sealed) }

            override suspend fun save(head: String, body: String, base: Int, files: List<String>, upto: Long, keep: Boolean, keepalive: Boolean): Int =
                NotesApi.save(id, head, body, base, files, upto, keep)

            override suspend fun fetch(): Fetched {
                val r = fetchRow()
                return Fetched(r.version, r.head, r.body ?: "", r.crdtUpto)
            }

            override suspend fun seal(part: NoteCrypto.Part, value: JsonElement): String {
                val k2 = key
                return withContext(Dispatchers.Default) { NoteCrypto.seal(k2, part, value) }
            }

            override suspend fun open(part: NoteCrypto.Part, sealed: String): JsonElement = this@OpenNote.open(part, sealed)
            override fun kind(err: Throwable): FailureKind = failureKind(err)
            override suspend fun rekeyed() {
                fetchRow()
            }

            override fun mend(err: Throwable, doc: NoteDoc): NoteDoc? = withoutRefusedFiles(err, doc)
        }
        session = NoteSession(
            deps,
            SessionStart(id, row.version, NoteModel.readHead(head).title, body, row.crdtUpto, NoteUnsent.take(id)),
            events,
            scope,
        )
        // the changes made since the note was last saved whole
        session.catchUp()

        // ---- who is here ---------------------------------------------------------------------
        say(hello = true)
        jobs += scope.launch {
            while (true) {
                delay(HERE_EVERY)
                say()
            }
        }
        stopWatching = Notes.watch(id, object : NoteListener {
            override fun crdt(d: NoteCrdtEvent) {
                scope.launch { session.remote(d.seq, d.update, d.cid, cid) }
            }

            override fun update(d: NoteUpdateEvent) {
                scope.launch {
                    if (d.version != null) session.remoteSave(d.version, d.body, d.upto, d.reset, d.rekeyed)
                }
                if (d.members) scope.launch {
                    if (greet == null) {
                        // someone may have just been let in: said again once the list knows
                        greet = scope.launch {
                            delay(1500)
                            greet = null
                            say(hello = true)
                        }
                    }
                }
            }

            override fun presence(d: NotePresenceEvent) {
                scope.launch {
                    if (d.hello && System.currentTimeMillis() - said > HELLO_GAP) say()
                    onPresence?.invoke(d)
                }
            }

            override fun cursor(d: NoteCursorEvent) {
                scope.launch { onCursor?.invoke(d) }
            }

            override fun gone() {
                scope.launch { if (!closed) events.onGone() }
            }
        })
        // back from a connection that was down: whatever changed meanwhile
        jobs += scope.launch {
            Nexa.session.ready.drop(1).collect { ready ->
                if (ready && !closed) {
                    if (session.state == SaveState.OFFLINE) launch { session.retry() }
                    session.catchUp()
                }
            }
        }
        // ---- leaving -------------------------------------------------------------------------
        jobs += scope.launch {
            Nexa.ui.visible.drop(1).collect { visible ->
                if (closed) return@collect
                if (!visible) {
                    session.leaving = true
                    launch { session.flush() }
                } else {
                    session.leaving = false
                    say(hello = true)
                    session.catchUp()
                }
            }
        }
    }

    private fun shared(): Boolean = (Notes.notes.value[id]?.members ?: 1) > 1

    private fun say(hello: Boolean = false) {
        if (closed || !shared() || !Nexa.ui.visible.value) return
        said = System.currentTimeMillis()
        Nexa.scope.launch { runCatching { NotesApi.presence(id, true, hello) } }
    }

    /** Sends where this page's caret is, sealed with the note's key, to the others with the note open. */
    fun sendCursor(value: JsonElement) {
        if (closed || !shared()) return
        val k = key
        Nexa.scope.launch {
            val sealed = runCatching { NoteCrypto.seal(k, NoteCrypto.Part.CURSOR, value) }.getOrNull() ?: return@launch
            Nexa.session.send("note_cursor", buildJsonObject {
                put("id", id)
                put("data", sealed)
            })
        }
    }

    /** Opens a cursor someone else sent; null when it will not open. */
    suspend fun openCursor(sealed: String): JsonElement? = try {
        withKey { NoteCrypto.open(it, NoteCrypto.Part.CURSOR, sealed) }
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }

    /** Stops following the note. What is unsent is sent first. */
    fun close() {
        if (closed) return
        val wasShared = shared()
        closed = true
        greet?.cancel()
        jobs.forEach { it.cancel() }
        stopWatching()
        onCursor = null
        onPresence = null
        if (wasShared) Nexa.scope.launch { runCatching { NotesApi.presence(id, false) } }
        // what is unsent goes before the session stops listening for the answer
        scope.launch {
            try {
                session.flush()
            } catch (_: Exception) {
            }
            // Could not be sent: kept for when the note is opened again. Not
            // once the app has locked or signed out, which forget what was readable.
            val left = session.unsent()
            if (left != null && Nexa.keys.identity != null) NoteUnsent.keep(id, left)
            session.close()
            session.free()
            scope.cancel()
        }
    }
}
