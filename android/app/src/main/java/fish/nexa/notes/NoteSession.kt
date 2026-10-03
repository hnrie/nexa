package fish.nexa.notes

import fish.nexa.crypto.NoteCrypto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement

/** Where the note stands: everything sent, changes waiting, being sent, waiting for the connection, or refused. */
enum class SaveState { SAVED, UNSAVED, SAVING, OFFLINE, FAILED }

/** What kind of failure a request met. */
enum class FailureKind { STALE, OFFLINE, REKEYED, SAVE_FIRST, OTHER }

/** The note as the server has it saved. */
data class Fetched(val version: Int, val head: String, val body: String, val crdtUpto: Long)

/** One sealed change, as the server numbered it. */
data class SealedChange(val seq: Long, val update: String)

data class Changes(val updates: List<SealedChange>, val crdtUpto: Long, val more: Boolean)

/** Carets as offsets: in the note's text, and the title's selection. Null where there is none, or it is not known. */
data class Carets(val md: Int?, val title: Pair<Int, Int>?)

/** How long things wait (tests make them short and leave out the jitter). */
data class SessionTiming(
    val sendDelay: Long = 40,
    val sendMax: Long = 250,
    val saveIdle: Long = 4000,
    val saveMax: Long = 20_000,
    val retry: Long = 4000,
    /** A little apart for each copy, so two people writing do not save over each other every time. */
    val jitter: Boolean = true,
)

/**
 * What the session needs from outside: the sending, fetching, sealing and
 * opening. Nothing in the session knows about the network or the keys, which
 * is what lets a test drive several people's sessions against one pretend
 * server.
 */
interface SessionDeps {
    /** Seals one change with the note's key as it is now and sends it; returns the number it was given. */
    suspend fun send(update: ByteArray, keepalive: Boolean): Long
    /** The sealed changes after a number, and where the saved note stands. */
    suspend fun changes(after: Long): Changes
    suspend fun openUpdate(sealed: String): ByteArray
    /** Saves the whole note, sealed, over version `base`, holding every change up to `upto`; returns its new version. */
    suspend fun save(head: String, body: String, base: Int, files: List<String>, upto: Long, keep: Boolean, keepalive: Boolean): Int
    suspend fun fetch(): Fetched
    suspend fun seal(part: NoteCrypto.Part, value: JsonElement): String
    suspend fun open(part: NoteCrypto.Part, sealed: String): JsonElement
    fun kind(err: Throwable): FailureKind
    /** The note has a new key: fetched before anything is sealed again. */
    suspend fun rekeyed() {}
    /** A save refused for something in the note itself (a file the server no longer has): the note without it. */
    fun mend(err: Throwable, doc: NoteDoc): NoteDoc? = null
}

interface SessionEvents {
    fun onState(state: SaveState, error: Throwable?)
    /**
     * Someone else's changes are in the note: the page shows `doc` in place
     * of what it has. `at` is where the page's carets go: what `caret` said,
     * moved past everything put in or taken out before them.
     */
    fun onRemote(doc: NoteDoc, at: Carets?): Boolean
    /** Where the page's carets are, as offsets into the note's text and its title, when it can say exactly. */
    fun caret(): Carets? = null
    /** What the page holds this instant, where that can be a frame ahead of the last edit(). */
    fun read(): NoteChange? = null
    /** Whether the page can take someone else's change just now: not while a word is being composed. */
    fun canShow(): Boolean = true
    /** The whole note was saved: its new version, and what it says. */
    fun onSaved(version: Int, doc: NoteDoc) {}
}

data class SessionStart(
    val noteId: String,
    val version: Int,
    /** The title the note's head has: the title of a note saved before it was kept as a document. */
    val title: String,
    /** The note's body, opened. */
    val body: JsonElement?,
    /** The newest change the body holds. */
    val crdtUpto: Long,
    /** Changes made here the last time the note was open that never reached the server. */
    val unsent: ByteArray? = null,
)

/**
 * One open note (web/src/lib/notes/session.ts): its CRDT document, the
 * changes made here on their way to everyone else, and the changes others
 * made on their way in.
 *
 * Everything typed is put into the document as the smallest edit, and the
 * change it makes is sent a few milliseconds later, sealed, to the server,
 * which numbers it, keeps it and passes it on to whoever else has the note.
 * Their changes come in the same way and are taken into the document here,
 * then shown, with the caret kept where it was. However the changes cross,
 * every copy that has taken in the same ones reads the same.
 *
 * Every few seconds of writing the whole note is saved too, with the number
 * of the newest change it holds; the server lets those changes go. A save
 * that crossed someone else's takes theirs in and goes again.
 *
 * Everything here runs on the one thread `scope` runs on (the main thread in
 * the app), as the web's does on its page.
 */
class NoteSession(
    private val deps: SessionDeps,
    start: SessionStart,
    private val events: SessionEvents,
    private val scope: CoroutineScope,
    private val timing: SessionTiming = SessionTiming(),
    private val now: () -> Long = System::currentTimeMillis,
) {
    companion object {
        /** How soon to try again to show changes the page could not take (a word was being composed). */
        private const val SHOW_AGAIN = 250L
        /** How long a gap in the numbers is waited out before the missing changes are asked for. */
        private const val GAP_WAIT = 1200L

        /**
         * Where an offset into a text is after a change to it. Something put
         * in right where it is goes after it: the caret stays with the words
         * its own person was just typing, and someone else's words land beyond it.
         */
        fun moveThrough(at: Int, delta: List<NoteDocument.Step>): Int {
            var pos = 0
            var shift = 0
            for (op in delta) {
                when (op.kind) {
                    'r' -> pos += op.n
                    'i' -> if (pos < at) shift += op.n
                    'd' -> {
                        val end = pos + op.n
                        if (end <= at) shift -= op.n else if (pos < at) shift -= at - pos
                        pos = end
                    }
                }
                if (pos >= at && op.kind != 'i') break
            }
            return maxOf(0, at + shift)
        }

        private val DONE: Deferred<Unit> = CompletableDeferred(Unit)
    }

    /** Another copy's change, or a whole saved note, waiting to be taken in. */
    private class Incoming(val update: ByteArray, val seq: Long? = null, val upto: Long? = null, val version: Int? = null)

    /** The note as it is on this page. */
    var doc: NoteDoc
        private set
    /** The version of the saved note this copy last saved over or took in. */
    var version: Int = start.version
        private set
    var state: SaveState = SaveState.SAVED
        private set
    var error: Throwable? = null
        private set
    private var y: NoteDocument
    private val noteId = start.noteId
    /** Every change up to this number is in the document. */
    private var applied: Long = start.crdtUpto
    /** Changes past `applied` that are in the document already (arrived out of order, or this copy's own). */
    private val have = HashSet<Long>()
    /** This copy's changes not yet sent, and the one being sent. */
    private var outbox = ArrayList<ByteArray>()
    private var inFlight: ByteArray? = null
    private var inbox = ArrayList<Incoming>()
    private var sending: Deferred<Unit>? = null
    private var sendAgain = false
    private var saving: Deferred<Unit>? = null
    private var catching: Deferred<Unit>? = null
    private var sendTimer: Job? = null
    private var firstQueued = 0L
    private var saveTimer: Job? = null
    private var showTimer: Job? = null
    private var gapTimer: Job? = null
    /** Edits made here since the note was last saved whole, and when the first of them was. */
    private var edits = 0
    private var savedEdits = 0
    private var firstUnsaved = 0L
    private var closed = false
    /** The app is going away: what is sent rides a request that outlives it. */
    var leaving = false

    init {
        y = NoteDocs.docFromBody(noteId, start.version, start.title, start.body)
        doc = NoteDocs.readDoc(y)
        val unsent = start.unsent
        if (unsent != null && unsent.isNotEmpty() && y.apply(unsent)) {
            // put back as this copy's own, and sent again
            doc = NoteDocs.readDoc(y)
            queue(unsent)
            changed()
        }
    }

    /** Whether changes made here have not reached the server yet. */
    val dirty: Boolean get() = outbox.isNotEmpty() || inFlight != null

    /** The newest change this copy holds every change up to. */
    val upto: Long get() = applied

    /** This copy's changes the server does not have, as one update, to keep for the next time the note opens. */
    fun unsent(): ByteArray? {
        val all = ArrayList<ByteArray>()
        inFlight?.let { all += it }
        all += outbox
        if (all.isEmpty()) return null
        return YDoc.merge(all)
    }

    private fun set(next: SaveState, err: Throwable? = null) {
        if (state == next && error === err) return
        state = next
        error = err
        if (!closed) events.onState(next, err)
    }

    /** Starts a job now, keeping hold of it before it can finish (the main thread may run it at once). */
    private fun begin(work: suspend () -> Unit, keep: (Deferred<Unit>?) -> Unit): Deferred<Unit> {
        val d = scope.async(start = CoroutineStart.LAZY) {
            try {
                work()
            } finally {
                keep(null)
            }
        }
        keep(d)
        d.start()
        return d
    }

    // ---- this copy's changes ---------------------------------------------------------------

    /** The page's note changed. */
    fun edit(change: NoteChange) {
        if (closed) return
        val updates = NoteDocs.applyDoc(y, change)
        if (updates.isEmpty()) return
        for (u in updates) queue(u)
        doc = NoteDocs.readDoc(y)
        changed()
    }

    private fun changed() {
        edits += 1
        if (firstUnsaved == 0L) firstUnsaved = now()
        scheduleSave()
    }

    private fun queue(update: ByteArray) {
        outbox.add(update)
        if (state != SaveState.SAVING && state != SaveState.OFFLINE) set(SaveState.UNSAVED)
        scheduleSend()
    }

    private fun scheduleSend(after: Long? = null) {
        if (closed) return
        val t = now()
        if (firstQueued == 0L) firstQueued = t
        val wait = after ?: maxOf(0L, minOf(timing.sendDelay, firstQueued + timing.sendMax - t))
        sendTimer?.cancel()
        sendTimer = scope.launch {
            delay(wait)
            sendTimer = null
            send()
        }
    }

    /** Sends what is waiting now; the job ends once it is sent or has failed. */
    private fun send(): Deferred<Unit> {
        sendTimer?.cancel()
        sendTimer = null
        sending?.let {
            sendAgain = true
            return it
        }
        if (outbox.isEmpty()) return DONE
        return begin({ runSend() }) { sending = it }
    }

    private suspend fun runSend() {
        var tries = 0
        do {
            sendAgain = false
            firstQueued = 0
            if (outbox.isEmpty()) break
            val taken = outbox
            val update = if (taken.size == 1) taken[0] else YDoc.merge(taken)
            if (update == null) {
                // could not be put together: sent one at a time instead
                outbox = ArrayList(taken.drop(1))
                inFlight = taken[0]
            } else {
                outbox = ArrayList()
                inFlight = update
            }
            val sent = inFlight!!
            set(SaveState.SAVING)
            try {
                val seq = deps.send(sent, leaving)
                inFlight = null
                got(seq)
            } catch (e: CancellationException) {
                inFlight = null
                outbox.add(0, sent)
                throw e
            } catch (e: Throwable) {
                inFlight = null
                outbox.add(0, sent)
                val kind = deps.kind(e)
                if (kind == FailureKind.REKEYED && tries++ < 3) {
                    // sealed again with the note's new key
                    try {
                        deps.rekeyed()
                    } catch (c: CancellationException) {
                        throw c
                    } catch (_: Throwable) {
                    }
                    sendAgain = true
                    continue
                }
                if (kind == FailureKind.SAVE_FIRST && tries++ < 3) {
                    save(force = true).join()
                    sendAgain = true
                    continue
                }
                if (kind == FailureKind.OFFLINE) {
                    set(SaveState.OFFLINE, e)
                    // tried again by itself: the words are safe here until it gets through
                    scheduleSend(timing.retry)
                    return
                }
                set(SaveState.FAILED, e)
                return
            }
        } while (sendAgain || outbox.isNotEmpty())
        if (!closed) set(if (outbox.isNotEmpty()) SaveState.UNSAVED else SaveState.SAVED)
    }

    /** A change is in the document: counted in, and a gap behind it looked into. */
    private fun got(seq: Long) {
        if (seq <= applied) return
        have += seq
        advance()
    }

    /** Moves `applied` over every change held in order since it, and looks into a gap past it. */
    private fun advance() {
        have.removeAll { it <= applied }
        while (have.remove(applied + 1)) applied += 1
        if (have.isNotEmpty() && gapTimer == null && !closed) {
            // one that overtook another is usually followed by it a moment later
            gapTimer = scope.launch {
                delay(GAP_WAIT)
                gapTimer = null
                if (have.isNotEmpty()) catchUp()
            }
        }
    }

    // ---- others' changes -------------------------------------------------------------------

    /** A change someone made, as the server passed it on. `mine` is this copy's id. */
    suspend fun remote(seq: Long, update: String?, cid: String, mine: String) {
        if (closed) return
        // this copy's own change, come back: the answer to sending it already counted it
        if (cid == mine) {
            got(seq)
            return
        }
        if (seq <= applied || seq in have || inbox.any { it.seq == seq }) return
        if (update == null) {
            catchUp()
            return
        }
        val bytes = try {
            deps.openUpdate(update)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            // sealed with a key this copy does not have yet: asked for again with it
            catchUp()
            return
        }
        if (closed || seq <= applied || seq in have || inbox.any { it.seq == seq }) return
        inbox += Incoming(bytes, seq = seq)
        show()
    }

    /**
     * Someone saved the note whole. A copy that already holds every change
     * that save holds just notes its version; one that does not takes in the
     * body that came along, or fetches it.
     */
    suspend fun remoteSave(version: Int?, body: String?, upto: Long?, reset: Boolean, rekeyed: Boolean) {
        if (closed || version == null) return
        if (rekeyed) {
            // the note has a new key, and every change kept so far went with the old one: the note is what its body says
            try {
                deps.rekeyed()
            } catch (c: CancellationException) {
                throw c
            } catch (_: Throwable) {
            }
            catchUp(true).join()
            return
        }
        if (reset) {
            reset()
            return
        }
        if (version <= this.version) return
        if (upto != null && upto <= applied) {
            this.version = version
            return
        }
        if (body != null) {
            try {
                val raw = deps.open(NoteCrypto.Part.BODY, body)
                val bytes = NoteDocs.docBytes(raw)
                if (bytes != null) {
                    inbox += Incoming(bytes, upto = upto ?: 0, version = version)
                    show()
                    return
                }
            } catch (c: CancellationException) {
                throw c
            } catch (_: Throwable) {
                // fetched below
            }
        }
        catchUp(true).join()
    }

    /**
     * The note as an app from before notes were kept as documents saved it:
     * its text replaces this copy's, made a document the same way on every
     * device so all of them go on from the same one.
     */
    private suspend fun reset() {
        val row = deps.fetch()
        val head = try {
            deps.open(NoteCrypto.Part.HEAD, row.head)
        } catch (c: CancellationException) {
            throw c
        } catch (_: Throwable) {
            null
        }
        val body = deps.open(NoteCrypto.Part.BODY, row.body)
        val bytes = NoteDocs.docBytes(body)
        if (bytes != null) {
            inbox += Incoming(bytes, upto = row.crdtUpto, version = row.version)
            show()
            return
        }
        if (closed) return
        val old = y
        y = NoteDocs.docFromBody(noteId, row.version, NoteModel.readHead(head).title, body)
        old.close()
        version = row.version
        applied = row.crdtUpto
        have.clear()
        inbox = ArrayList()
        // what was waiting to go was written against the note as it was
        outbox = ArrayList()
        doc = NoteDocs.readDoc(y)
        events.onRemote(doc, null)
        if (state != SaveState.FAILED) set(SaveState.SAVED)
    }

    /** Takes in what is waiting, unless the page cannot show it just now. */
    private fun show() {
        if (closed || inbox.isEmpty()) return
        if (!events.canShow()) {
            if (showTimer == null) {
                showTimer = scope.launch {
                    delay(SHOW_AGAIN)
                    showTimer = null
                    show()
                }
            }
            return
        }
        // what the page holds this instant first, so nothing typed a moment ago is lost under it
        events.read()?.let { edit(it) }
        // where the carets are, in the text as it is before the others' changes go in
        val before = events.caret()
        val incoming = inbox
        inbox = ArrayList()
        val res = y.applyAll(incoming.map { it.update })
        val at = before?.let { b ->
            Carets(
                md = b.md?.let { m -> res.md?.let { moveThrough(m, it) } ?: m },
                title = b.title?.let { t -> res.title?.let { d -> moveThrough(t.first, d) to moveThrough(t.second, d) } ?: t },
            )
        }
        for (i in incoming) {
            i.seq?.let { if (it > applied) have += it }
            // a whole saved note holds every change up to its number
            i.upto?.let { if (it > applied) applied = it }
            i.version?.let { if (it > version) version = it }
        }
        advance()
        val next = NoteDocs.readDoc(y)
        val same = next.md == doc.md && next.title == doc.title && NoteModel.filesJson(next.files) == NoteModel.filesJson(doc.files)
        doc = next
        if (!same) events.onRemote(next, at)
    }

    /**
     * Asks for the changes after the newest this copy holds in order: after a
     * gap in the numbers, a connection that was down, or a change too big to
     * be passed on. A saved note that holds changes this copy never got is
     * taken in whole first.
     */
    fun catchUp(force: Boolean = false): Deferred<Unit> {
        catching?.let { return it }
        if (closed) return DONE
        return begin({
            try {
                // the changes are fetched from here on: what is held, or waiting to be shown, stays out
                var after = applied
                var round = 0
                while (round < 50) {
                    val res = deps.changes(after)
                    if (res.crdtUpto > after || (force && round == 0)) {
                        // the saved note holds changes this copy never got (or was asked to be taken in): it comes first
                        val row = deps.fetch()
                        val raw = deps.open(NoteCrypto.Part.BODY, row.body)
                        val bytes = NoteDocs.docBytes(raw)
                        if (bytes == null) {
                            if (!NoteDocs.hasDoc(raw)) reset()
                            return@begin
                        }
                        inbox += Incoming(bytes, upto = row.crdtUpto, version = row.version)
                        if (row.crdtUpto > after) {
                            // what was fetched before it may have been let go meanwhile: asked for again from there
                            after = row.crdtUpto
                            show()
                            round++
                            continue
                        }
                    }
                    for (u in res.updates) {
                        if (u.seq > after) after = u.seq
                        if (u.seq <= applied || u.seq in have || inbox.any { it.seq == u.seq }) continue
                        try {
                            inbox += Incoming(deps.openUpdate(u.update), seq = u.seq)
                        } catch (c: CancellationException) {
                            throw c
                        } catch (_: Throwable) {
                            // one that will not open is skipped; the next whole save of the note carries it
                        }
                    }
                    show()
                    if (!res.more) break
                    round++
                }
            } catch (c: CancellationException) {
                throw c
            } catch (_: Throwable) {
                // tried again on the next event, reconnect or save
            }
        }) { catching = it }
    }

    // ---- saving the whole note --------------------------------------------------------------

    private fun scheduleSave(after: Long? = null) {
        if (closed) return
        val t = now()
        val jitter = if (timing.jitter) (Math.random() * 1500).toLong() else 0L
        val wait = after ?: maxOf(0L, minOf(timing.saveIdle + jitter, firstUnsaved + timing.saveMax - t))
        saveTimer?.cancel()
        saveTimer = scope.launch {
            delay(wait)
            saveTimer = null
            save()
        }
    }

    /**
     * Saves the whole note, if anything was written here since it last was,
     * or whatever was: `force` (the server asked for it), `keep` (the state
     * it replaces is set aside as a version).
     */
    fun save(keep: Boolean = false, force: Boolean = false): Deferred<Unit> {
        val wanted = keep || force || edits != savedEdits
        saving?.let { cur ->
            return scope.async {
                cur.join()
                if (wanted && (keep || force || edits != savedEdits)) save(keep, force).join()
            }
        }
        if (closed && !leaving) return DONE
        if (!wanted) return DONE
        saveTimer?.cancel()
        saveTimer = null
        return begin({ runSave(keep) }) { saving = it }
    }

    private suspend fun runSave(keep: Boolean) {
        for (attempt in 0 until 5) {
            val editsNow = edits
            val d = doc
            val p = NoteModel.pruned(d.md, d.files)
            val sent = NoteDoc(d.title, p.md, p.files)
            // the document as it is this instant, before anything else can change it
            val body = NoteDocs.bodyOf(y, sent.md, sent.files)
            val head = NoteModel.headJson(NoteModel.headOf(sent))
            try {
                val sealedHead = deps.seal(NoteCrypto.Part.HEAD, head)
                val sealedBody = deps.seal(NoteCrypto.Part.BODY, body)
                val v = deps.save(sealedHead, sealedBody, version, NoteModel.blobIds(p), applied, keep, leaving)
                version = v
                savedEdits = editsNow
                if (edits == editsNow) firstUnsaved = 0 else scheduleSave()
                events.onSaved(v, sent)
                return
            } catch (c: CancellationException) {
                throw c
            } catch (e: Throwable) {
                val kind = deps.kind(e)
                if (kind == FailureKind.STALE) {
                    // someone saved first: theirs is taken in, and this goes again over it
                    catchUp(true).join()
                    if (inbox.isNotEmpty()) {
                        // the page cannot take it in just now (a word is being composed): saved a moment later
                        scheduleSave(1000)
                        return
                    }
                    continue
                }
                if (kind == FailureKind.REKEYED) {
                    try {
                        deps.rekeyed()
                    } catch (c: CancellationException) {
                        throw c
                    } catch (_: Throwable) {
                    }
                    continue
                }
                val fixed = if (kind == FailureKind.OTHER) deps.mend(e, doc) else null
                if (fixed != null) {
                    // a file the server would not keep: the note without it
                    edit(NoteChange(fixed.title, fixed.md, fixed.files))
                    events.onRemote(doc, null)
                    continue
                }
                // the changes themselves are safe on the server; the whole note is saved again later
                scheduleSave(if (kind == FailureKind.OFFLINE) timing.retry * 2 else 30_000)
                return
            }
        }
    }

    // ---- for the page ------------------------------------------------------------------------

    /** Sends what is waiting and saves the note whole if it was written in; returns once both are done or have failed. */
    suspend fun flush() {
        send().join()
        save().join()
    }

    /**
     * Puts an earlier state of the note back: shown here, sent to everyone as
     * this copy's change, and saved with the state it replaces set aside as a
     * version, so putting something back never loses what was there. False
     * when it could not be sent.
     */
    suspend fun restore(earlier: NoteDoc): Boolean {
        if (closed) return false
        flush()
        edit(NoteChange(earlier.title, earlier.md, earlier.files))
        events.onRemote(doc, null)
        send().join()
        if (state == SaveState.FAILED || state == SaveState.OFFLINE) return false
        save(keep = true).join()
        return true
    }

    /** Tries again after a send that was refused. */
    suspend fun retry() {
        if (dirty) set(SaveState.UNSAVED)
        flush()
    }

    /** Stops listening and sending. What is unsent is the caller's to flush first. */
    fun close() {
        closed = true
        for (t in listOf(sendTimer, saveTimer, showTimer, gapTimer)) t?.cancel()
        sendTimer = null
        saveTimer = null
        showTimer = null
        gapTimer = null
    }

    /** Lets go of the document itself, once nothing will use it again. */
    fun free() {
        y.close()
    }

    /** The whole document's state, for a test. */
    fun encodeState(): ByteArray = y.encodeState()
}
