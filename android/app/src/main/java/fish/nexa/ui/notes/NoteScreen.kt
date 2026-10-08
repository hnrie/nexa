package fish.nexa.ui.notes

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import fish.nexa.Nexa
import fish.nexa.crypto.AttachmentMeta
import fish.nexa.crypto.Bytes
import fish.nexa.data.Uploads
import fish.nexa.net.ApiError
import fish.nexa.notes.Carets
import fish.nexa.notes.NoteChange
import fish.nexa.notes.NoteDoc
import fish.nexa.notes.NoteModel
import fish.nexa.notes.NoteRole
import fish.nexa.notes.NoteShare
import fish.nexa.notes.Notes
import fish.nexa.notes.OpenNote
import fish.nexa.notes.OpenNoteEvents
import fish.nexa.notes.SaveState
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.format.Cmd
import fish.nexa.ui.format.FormatBlocks
import fish.nexa.ui.format.FormatSurface
import fish.nexa.ui.format.PageLook
import fish.nexa.ui.format.ToolButton
import fish.nexa.ui.format.Toolbar
import fish.nexa.ui.format.Tray
import fish.nexa.ui.format.TrayBody
import fish.nexa.ui.format.topHairline
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.markdown.MarkdownView
import fish.nexa.ui.markdown.RenderCtx
import fish.nexa.ui.server.Loading
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.dangerGradient
import fish.nexa.ui.theme.ring
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** How the page reaches whichever view of the note is showing: the editor, or the note as read (NoteEditor.tsx NoteBridge). */
class NoteBridge {
    /** Someone else's changes: shown in place of what is here, the carets put where `at` says. False when that cannot be done just now. */
    var onRemote: (NoteDoc, Carets?) -> Boolean = { _, _ -> false }
    var caret: () -> Carets? = { null }
    var read: () -> NoteChange? = { null }
    var canShow: () -> Boolean = { true }
}

private sealed interface Opening {
    data object Busy : Opening
    class Open(val note: OpenNote) : Opening
    data object Gone : Opening
    class Failed(val error: Throwable) : Opening
}

/**
 * One note, open (NoteView.tsx): written in by whoever may edit it, with
 * everyone else who has it open seeing the words and the carets move, or read
 * by whoever may only read it, kept up to date the same way. Its history
 * opens in its place.
 */
@Composable
fun NoteScreen(noteId: String, narrow: Boolean) {
    val notes by Notes.notes.collectAsState()
    val item = notes[noteId]
    var opening by remember { mutableStateOf<Opening>(Opening.Busy) }
    var saving by remember { mutableStateOf<Pair<SaveState, Throwable?>>(SaveState.SAVED to null) }
    var history by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var barTitle by remember { mutableStateOf<String?>(null) }
    val bridge = remember { NoteBridge() }
    val events = remember(bridge) {
        object : OpenNoteEvents {
            override fun onState(state: SaveState, error: Throwable?) {
                saving = state to error
            }

            override fun onRemote(doc: NoteDoc, at: Carets?): Boolean = bridge.onRemote(doc, at)
            override fun caret(): Carets? = bridge.caret()
            override fun read(): NoteChange? = bridge.read()
            override fun canShow(): Boolean = bridge.canShow()
            override fun onGone() {
                opening = Opening.Gone
            }
        }
    }
    DisposableEffect(noteId, attempt) {
        var handle: OpenNote? = null
        var cancelled = false
        opening = Opening.Busy
        saving = SaveState.SAVED to null
        history = false
        val job = Nexa.scope.launch(Dispatchers.Main.immediate) {
            try {
                val h = OpenNote.open(noteId, events)
                if (cancelled) {
                    h.close()
                    return@launch
                }
                handle = h
                barTitle = h.session.doc.title
                opening = Opening.Open(h)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (!cancelled) opening = if (e is ApiError && e.status == 404) Opening.Gone else Opening.Failed(e)
            }
        }
        onDispose {
            cancelled = true
            job.cancel()
            handle?.close()
        }
    }

    val role = item?.role ?: 0
    val editable = role >= NoteRole.EDITOR
    val owner = role == NoteRole.OWNER
    // Back from a note goes to the list, once whatever is open over it (a sheet, a drawer) has gone
    BackHandler(enabled = narrow && !history && fish.nexa.ui.layers.Layers.isEmpty && !fish.nexa.ui.nav.Nav.leftOpen && !fish.nexa.ui.nav.Nav.rightOpen) { NotesUi.backToList() }

    val o = opening
    if (o !is Opening.Open) {
        Column(Modifier.fillMaxSize()) {
            NoteBar(narrow, title = null, viewOnly = false) {}
            when (o) {
                Opening.Busy -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Loading(t("notes.page.opening")) }
                Opening.Gone -> Calm(
                    icon = "NotebookPen",
                    title = t("notes.page.goneTitle"),
                    body = t("notes.page.goneBody"),
                    action = t("notes.page.backToNotes"),
                    secondary = true,
                    modifier = Modifier.weight(1f),
                ) { fish.nexa.ui.nav.Nav.go(fish.nexa.ui.nav.Route.Notes()) }
                is Opening.Failed -> Calm(
                    icon = null,
                    title = t("notes.page.failedTitle"),
                    body = NoteShare.error(o.error, t("notes.page.failedBody")),
                    action = t("notes.page.tryAgain"),
                    secondary = false,
                    modifier = Modifier.weight(1f),
                ) { attempt += 1 }
            }
        }
        return
    }
    val note = o.note
    if (history) {
        NoteHistoryView(
            noteId = noteId,
            current = { note.session.doc },
            canRestore = editable,
            narrow = narrow,
            onClose = { history = false },
            onRestore = { doc ->
                val done = note.session.restore(doc)
                if (done) Nexa.ui.toast(t("notes.history.restored"), "success")
                done
            },
        )
        return
    }
    val title = barTitle ?: note.session.doc.title
    val end: @Composable RowScope.() -> Unit = {
        PeopleHere(noteId, max = if (narrow) 2 else 4)
        if (editable) SaveStateView(saving.first, saving.second, compact = narrow) { note.scope.launch { note.session.retry() } }
        if (!narrow) BarIcon("History", t("notes.menu.history")) { history = true }
        if (item != null && owner) BrandPill(if (narrow) null else t("notes.menu.share"), "UserPlus", description = t("notes.menu.share")) { openShareNote(noteId) }
        else if (item != null) BarIcon("Users", t("notes.menu.whoHasAccess")) { openShareNote(noteId) }
        if (item != null) BarIcon("Ellipsis", t("notes.page.more")) {
            openMenu(noteMenuItems(item, inList = false, onHistory = { history = true }, onGone = { NotesUi.backToList() }), title = NoteModel.name(title))
        }
    }
    // What is being written stays in the note when the view changes: a role
    // taken away mid-sentence leaves the reader with the note as it was saved.
    if (editable) {
        androidx.compose.runtime.key("edit") {
            NoteEditor(noteId, note, bridge, narrow, onTitle = { barTitle = it }, autoFocus = NotesUi.freshId == noteId && note.session.doc.title.isEmpty() && note.session.doc.md.isEmpty(), end = end)
        }
    } else {
        androidx.compose.runtime.key("read") { NoteReader(noteId, note.session.doc, bridge, narrow, onTitle = { barTitle = it }, end = end) }
    }
}

/** The bar over a note (.bar): the way back on a phone, its title, then who is here, whether it is saved, sharing and more. */
@Composable
private fun NoteBar(narrow: Boolean, title: String?, viewOnly: Boolean, end: @Composable RowScope.() -> Unit) {
    val c = Nx.colors
    Row(
        Modifier
            .fillMaxWidth()
            .height(52.dp)
            .drawBehind { drawRect(c.borderSubtle, topLeft = Offset(0f, size.height - 1.dp.toPx()), size = Size(size.width, 1.dp.toPx())) }
            .padding(start = 8.dp, end = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (narrow) BarIcon("ArrowLeft", t("notes.page.backToNotes"), mirror = true) { NotesUi.backToList() }
        if (viewOnly) {
            Row(
                Modifier.padding(start = 6.dp).height(26.dp).background(c.bgActive, RoundedCornerShape(50)).padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon("Eye", c.textSubtle, size = 15.dp)
                Txt(t("notes.page.viewOnly"), style = Nx.type.label.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(650)), color = c.textSubtle, maxLines = 1)
            }
        }
        if (title != null && !viewOnly) {
            val untitled = title.isBlank()
            // as wide as the bar allows: the rest of the bar is after it
            Txt(
                NoteModel.name(title),
                style = Nx.type.headerTitle.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(680)),
                color = if (untitled) c.textMuted else c.textStrong,
                maxLines = 1,
                modifier = Modifier.padding(horizontal = 6.dp).weight(1f),
            )
        } else Spacer(Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp), content = end)
    }
}

/** An icon in the bar (.iconBtn): 40 dp to touch. */
@Composable
private fun BarIcon(icon: String, label: String, mirror: Boolean = false, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val rtl = androidx.compose.ui.platform.LocalLayoutDirection.current == androidx.compose.ui.unit.LayoutDirection.Rtl
    Box(
        Modifier
            .size(40.dp)
            .clip(Radii.Sm)
            .background(if (pressed) c.bgHover else Color.Transparent)
            .pressable(interaction, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.then(if (mirror && rtl) Modifier.graphicsLayer { scaleX = -1f } else Modifier)) {
            Icon(icon, if (pressed) c.textStrong else c.icon, size = 20.dp)
        }
    }
}

/** A calm state in place of a note (.calm): gone, or could not be opened. */
@Composable
private fun Calm(icon: String?, title: String, body: String, action: String, secondary: Boolean, modifier: Modifier, onAction: () -> Unit) {
    val c = Nx.colors
    Column(
        modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 32.dp).semantics { liveRegion = LiveRegionMode.Polite },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        if (icon != null) Icon(icon, c.textMuted, size = 28.dp)
        Txt(title, style = Nx.type.heading.copy(fontSize = Nx.type.sp(20f)), color = c.textStrong, align = TextAlign.Center, modifier = Modifier.semantics { heading() })
        Txt(body, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14.5f), lineHeight = Nx.type.sp(21.75f)), color = c.textMuted, align = TextAlign.Center, modifier = Modifier.widthIn(max = 360.dp))
        NxButton(action, onAction, kind = if (secondary) ButtonKind.SECONDARY else ButtonKind.PRIMARY)
    }
}

/** Who wrote in a note last, and when, under its title (.byline), with the hairline under it. */
@Composable
private fun Byline(noteId: String) {
    val c = Nx.colors
    val notes by Notes.notes.collectAsState()
    val item = notes[noteId]
    val users by Nexa.users.byId.collectAsState()
    val me by Nexa.users.me.collectAsState()
    val now = minuteClock()
    val editedBy = item?.editedBy
    LaunchedEffect(editedBy) { if (editedBy != null && editedBy != me?.id && users[editedBy] == null) Nexa.session.ensureUsers(listOf(editedBy)) }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 10.dp, bottom = 22.dp)
            .heightIn(min = 22.dp)
            // the line under it, just past its foot (box-shadow: 0 1px 0)
            .drawBehind { drawRect(c.borderSubtle, topLeft = Offset(0f, size.height), size = Size(size.width, 1.dp.toPx())) }
            .padding(bottom = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (item == null) return@Row
        val whenText = Time.relative(item.updatedAt, now)
        val mine = editedBy != null && editedBy == me?.id
        val who = if (editedBy != null) users[editedBy] else null
        val faceName = if (mine) me?.let { it.displayName.ifEmpty { it.username } } else who?.let { it.displayName.ifEmpty { it.username } }
        val faceAvatar = if (mine) me?.avatarId else who?.avatarId
        if (editedBy != null && faceName != null) {
            Box(Modifier.ring(CircleShape, c.bgRaised, 2.dp)) { Avatar(editedBy, faceName, faceAvatar, 20.dp) }
        }
        Txt(
            when {
                editedBy == null -> t("notes.page.edited", "when" to whenText)
                mine -> t("notes.page.editedByYou", "when" to whenText)
                else -> t("notes.page.editedBy", "name" to (who?.let { it.displayName.ifEmpty { it.username } } ?: ""), "when" to whenText)
            },
            style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18f)),
            color = c.textMuted,
        )
    }
}

/** Who else has the note open right now (.here): their faces, each ringed in their caret's colour. */
@Composable
private fun PeopleHere(noteId: String, max: Int) {
    val c = Nx.colors
    val here by Notes.here.collectAsState()
    val users by Nexa.users.byId.collectAsState()
    val meId = Nexa.users.meId
    // someone who stops saying they are here drops off after a while; this is what notices
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(10_000)
            now = System.currentTimeMillis()
        }
    }
    val ids = Notes.peopleHere(here[noteId], now).filter { it != meId }
    LaunchedEffect(ids.joinToString(",")) {
        val missing = ids.filter { users[it] == null }
        if (missing.isNotEmpty()) Nexa.session.ensureUsers(missing)
    }
    if (ids.isEmpty()) return
    val names = ids.map { id -> users[id]?.let { it.displayName.ifEmpty { it.username } } ?: "" }
    Row(
        Modifier.padding(start = 2.dp, end = 6.dp).semantics(mergeDescendants = true) { contentDescription = t("notes.page.hereNow", "names" to names.joinToString(", ")) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy((-6).dp),
    ) {
        ids.take(max).forEachIndexed { i, id -> Face(noteId, id, names[i], users[id]?.avatarId, 26.dp) }
        if (ids.size > max) {
            Box(
                Modifier.ring(RoundedCornerShape(50), c.bgRaised, 2.dp).height(26.dp).widthIn(min = 26.dp).background(c.bgActive, RoundedCornerShape(50)).padding(horizontal = 6.dp),
                contentAlignment = Alignment.Center,
            ) { Txt("+${ids.size - max}", style = Nx.type.label.copy(fontSize = Nx.type.sp(12f), fontWeight = FontWeight(700)), color = c.text) }
        }
    }
}

/** Where the note stands, in a word (.state): saved, saving, offline, or not saved with the way to try again. */
@Composable
private fun SaveStateView(state: SaveState, error: Throwable?, compact: Boolean, onRetry: () -> Unit) {
    val c = Nx.colors
    val label = Nx.type.label.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600))
    when (state) {
        SaveState.FAILED -> {
            val why = NoteShare.error(error, t("notes.page.notSavedWhy"))
            Row(
                Modifier.padding(horizontal = 6.dp).semantics(mergeDescendants = true) { contentDescription = why; liveRegion = LiveRegionMode.Assertive },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon("TriangleAlert", c.textDanger, size = 14.dp)
                if (!compact) Txt(t("notes.page.notSaved"), style = label, color = c.textDanger, maxLines = 1)
                val interaction = remember { MutableInteractionSource() }
                Box(
                    Modifier.height(32.dp).clip(RoundedCornerShape(50)).background(dangerGradient(c)).pressable(interaction, onClick = onRetry).padding(horizontal = 10.dp),
                    contentAlignment = Alignment.Center,
                ) { Txt(t("notes.page.tryAgain"), style = label.copy(fontSize = Nx.type.sp(12f), fontWeight = FontWeight(700)), color = c.onDanger, maxLines = 1) }
            }
        }
        SaveState.OFFLINE -> Row(
            Modifier.padding(horizontal = 6.dp).semantics(mergeDescendants = true) { contentDescription = t("notes.page.offlineWhy") },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon("CloudOff", c.textWarning, size = 14.dp)
            if (!compact) Txt(t("notes.page.offline"), style = label, color = c.textWarning, maxLines = 1)
        }
        else -> {
            val busy = state == SaveState.SAVING || state == SaveState.UNSAVED
            val word = if (busy) t("notes.page.saving") else t("notes.page.saved")
            Row(
                Modifier.padding(horizontal = 6.dp).semantics(mergeDescendants = true) { contentDescription = word; liveRegion = LiveRegionMode.Polite },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (compact) {
                    if (busy && !Nx.motion.reduced) SavingDot() else Box(Modifier.size(8.dp).background(if (busy) c.textMuted else c.positive, CircleShape))
                } else Txt(word, style = label, color = if (busy) c.textSubtle else c.textMuted, maxLines = 1)
            }
        }
    }
}

/** The dot while changes are going: it breathes, and only then, so a saved note draws nothing more. */
@Composable
private fun SavingDot() {
    val breathe = rememberInfiniteTransition(label = "saving")
    val a by breathe.animateFloat(1f, 0.35f, infiniteRepeatable(tween(500), RepeatMode.Reverse), label = "breathe")
    Box(Modifier.size(8.dp).alpha(a).background(Nx.colors.textMuted, CircleShape))
}

/** Files going up from this device into one note, three at a time (NoteEditor.tsx upload queue). */
private class NoteUploads(private val noteId: String, private val scope: kotlinx.coroutines.CoroutineScope, private val onDone: (String, AttachmentMeta) -> Unit) {
    val pending = mutableStateMapOf<String, PendingNoteFile>()
    private val queue = ArrayDeque<String>()
    private val uris = HashMap<String, Uri>()
    private val jobs = HashMap<String, Job>()
    private var running = 0

    fun add(id: String, name: String, uri: Uri) {
        pending[id] = PendingNoteFile(name, 0f, null)
        uris[id] = uri
        queue.addLast(id)
        pump()
    }

    private fun pump() {
        while (running < 3 && queue.isNotEmpty()) {
            val id = queue.removeFirst()
            val uri = uris[id] ?: continue
            running++
            jobs[id] = scope.launch {
                try {
                    upload(id, uri)
                } finally {
                    running--
                    jobs.remove(id)
                    pump()
                }
            }
        }
    }

    private suspend fun upload(id: String, uri: Uri) {
        try {
            val st = fish.nexa.ui.chat.Staging.stage(uri) ?: throw IllegalStateException("not staged")
            var shown = -1
            val res = try {
                Uploads.uploadStaged("/notes/$noteId/attachments", st) { p ->
                    val percent = (p * 100).toInt()
                    if (percent != shown) {
                        shown = percent
                        scope.launch { pending[id]?.let { pending[id] = it.copy(progress = p.toFloat()) } }
                    }
                }
            } finally {
                st.file.delete()
            }
            pending.remove(id)
            uris.remove(id)
            onDone(id, res.meta)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            pending[id]?.let { pending[id] = it.copy(error = describeError(e, t("notes.file.failed"))) }
        }
    }

    fun retry(id: String) {
        if (id !in uris) return
        pending[id]?.let { pending[id] = it.copy(progress = 0f, error = null) }
        queue.addLast(id)
        pump()
    }

    fun cancel(id: String) {
        jobs[id]?.cancel()
        queue.remove(id)
        uris.remove(id)
        pending.remove(id)
    }

    fun cancelAll() {
        jobs.values.forEach { it.cancel() }
        queue.clear()
    }
}

/** A new file's id in the note's text: random, and nothing else. */
private fun newFileId(): String = Bytes.b64url(Bytes.random(9))

/** A picked file's name and size, as the phone tells them. */
private fun describe(uri: Uri): Pair<String, Long> {
    var name = ""
    var size = -1L
    runCatching {
        Nexa.app.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cur ->
            if (cur.moveToFirst()) {
                cur.getString(0)?.let { name = it }
                if (!cur.isNull(1)) size = cur.getLong(1)
            }
        }
    }
    return name to size
}

/** The sheet the note is written on (.sheet): one easy column, 18 dp in from the edges on a phone. */
private val SHEET_MAX = 720.dp

/**
 * A note, being written (NoteEditor.tsx): its title, the writing page with
 * its files drawn where its text has them and everyone else's caret drawn
 * where they are, and the formatting tools along the bottom, over the
 * keyboard. Everything typed goes to the note's session, which saves it a
 * moment later and sends it on; what others write arrives through `bridge`
 * and is put in without moving the caret.
 */
@Composable
private fun NoteEditor(noteId: String, note: OpenNote, bridge: NoteBridge, narrow: Boolean, onTitle: (String) -> Unit, autoFocus: Boolean, end: @Composable RowScope.() -> Unit) {
    val c = Nx.colors
    val session = note.session
    val initial = remember { session.doc }
    val surface = remember { FormatSurface(initial.md, files = true, max = NoteModel.MAX_CHARS, focusOnOpen = false) }
    var title by remember { mutableStateOf(TextFieldValue(initial.title)) }
    var titleFocused by remember { mutableStateOf(false) }
    val titleFocus = remember { FocusRequester() }
    var files by remember { mutableStateOf(initial.files) }
    var over by remember { mutableStateOf(initial.md.length > NoteModel.MAX_CHARS) }
    // read live from the surface: a format chosen to type with (Bold pressed with nothing selected)
    // lights its button at once, not after the next letter
    val state by remember(surface) { derivedStateOf { surface.state() } }
    var tray by remember { mutableStateOf<Tray?>(null) }
    var redraw by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val meId = Nexa.users.meId

    // The list shows what the note says as it is written, ahead of the next
    // whole save, which is what tells everyone else's lists.
    var headJob by remember { mutableStateOf<Job?>(null) }
    /** Whether what the list is about to be shown includes words written here, so it says who wrote last. */
    var headMine by remember { mutableStateOf(false) }
    fun showHead(mine: Boolean = true) {
        if (mine) headMine = true
        if (headJob?.isActive == true) return
        headJob = scope.launch {
            delay(300)
            // someone else's words alone leave the list saying they wrote last
            val by = if (headMine) meId else null
            headMine = false
            Notes.shown(noteId, NoteModel.headOf(session.doc), by)
        }
    }

    val uploads = remember { NoteUploads(noteId, note.scope) { id, meta -> files = files + (id to meta); session.edit(NoteChange(files = files)) } }
    DisposableEffect(Unit) { onDispose { uploads.cancelAll() } }

    fun addFiles(uris: List<Uri>) {
        if (uris.isEmpty()) return
        val room = NoteModel.MAX_FILES - NoteModel.fileIds(surface.markdown()).size
        if (room <= 0) {
            Nexa.ui.toast(t("notes.file.full"), "error")
            return
        }
        if (uris.size > room) Nexa.ui.toast(t("notes.file.someLeftOut", "count" to room), "info")
        for (uri in uris.take(room)) {
            val (picked, size) = describe(uri)
            val name = picked.ifEmpty { t("notes.file.untitled") }
            if (size >= 0 && !Uploads.fits(size)) {
                Nexa.ui.toast(t("notes.file.tooBig", "name" to name, "limit" to fish.nexa.ui.chat.Staging.limitText()), "error")
                continue
            }
            val id = newFileId()
            surface.command(Cmd.File(id, name))
            uploads.add(id, name, uri)
        }
    }
    val pickMedia = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(50)) { addFiles(it) }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { addFiles(it) }

    fun refresh() {
        redraw++
    }
    LaunchedEffect(surface) {
        surface.onChange = {
            val md = surface.markdown()
            // past the longest a note can be it is not saved, and says so, until it is short enough again
            val tooLong = md.length > NoteModel.MAX_CHARS
            over = tooLong
            if (!tooLong) {
                session.edit(NoteChange(md = md))
                showHead()
            }
            refresh()
        }
        surface.onReload = { refresh() }
        surface.onSubmit = { scope.launch { session.flush() } }
        surface.onLinkKey = { tray = Tray.LINK }
        surface.onEscape = { tray = null }
        // a mention tapped is selected whole (Backspace takes it out) and shows who it is
        surface.onMention = { id -> fish.nexa.ui.shell.openProfile(id) }
        if (autoFocus) {
            NotesUi.freshId = null
            runCatching { titleFocus.requestFocus() }
        }
    }
    fun changeTitle(v: TextFieldValue) {
        // a title is one line: Enter goes on to the note itself
        if (v.text.contains('\n') && !title.text.contains('\n')) {
            val clean = v.text.replace(Regex("[\r\n]+"), "")
            if (clean != title.text) {
                title = TextFieldValue(clean, TextRange(minOf(v.selection.start, clean.length)))
                session.edit(NoteChange(title = clean))
                onTitle(clean)
            }
            surface.focus()
            return
        }
        val clean = v.text.replace(Regex("[\r\n]+"), " ").take(NoteModel.TITLE_MAX)
        val changed = clean != title.text
        title = if (clean == v.text) v else v.copy(text = clean, selection = TextRange(minOf(v.selection.start, clean.length), minOf(v.selection.end, clean.length)))
        if (changed) {
            onTitle(clean)
            session.edit(NoteChange(title = clean))
            showHead()
        }
    }

    // ---- someone else's changes -----------------------------------------------------------
    bridge.onRemote = { doc, at ->
        if (doc.md != surface.markdown() && !surface.reload(doc.md, at?.md)) false
        else {
            showHead(mine = false)
            files = doc.files
            if (doc.title != title.text) {
                val sel = at?.title ?: if (titleFocused) title.selection.start to title.selection.end else null
                title = TextFieldValue(doc.title, sel?.let { TextRange(minOf(it.first, doc.title.length), minOf(it.second, doc.title.length)) } ?: TextRange(doc.title.length))
                onTitle(doc.title)
            }
            refresh()
            true
        }
    }
    bridge.canShow = { !surface.busy && title.composition == null }
    bridge.caret = { Carets(md = surface.caretMarkdown(), title = if (titleFocused) title.selection.start to title.selection.end else null) }
    bridge.read = {
        val md = surface.markdown()
        // a note past its longest is not saved, so what is merged is what was last saved of it
        if (md.length > NoteModel.MAX_CHARS) NoteChange(title = title.text, files = files) else NoteChange(title = title.text, md = md, files = files)
    }
    DisposableEffect(bridge) {
        onDispose {
            bridge.onRemote = { _, _ -> false }
            bridge.caret = { null }
            bridge.read = { null }
            bridge.canShow = { true }
        }
    }

    val cursors = rememberLiveCursors(noteId, note, surface, titleFocused) { redraw }

    Column(Modifier.fillMaxSize().imePadding().navigationBarsPadding()) {
        NoteBar(narrow, title.text, viewOnly = false, end = end)
        val sheetScroll = rememberScrollState()
        val sheetArea = remember { arrayOfNulls<androidx.compose.ui.layout.LayoutCoordinates>(1) }
        Box(Modifier.weight(1f).fillMaxWidth().onGloballyPositioned { sheetArea[0] = it }) {
            Column(Modifier.fillMaxSize().verticalScroll(sheetScroll)) {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                    Column(
                        Modifier
                            .widthIn(max = SHEET_MAX)
                            .fillMaxWidth()
                            .then(cursors)
                            .padding(start = 18.dp, end = 18.dp, top = 22.dp, bottom = 128.dp),
                    ) {
                        val titleStyle = Nx.type.title.copy(
                            fontSize = Nx.type.sp(24f), lineHeight = Nx.type.sp(28.8f), fontWeight = FontWeight(720), letterSpacing = (-0.018).em, color = c.textStrong,
                        )
                        BasicTextField(
                            value = title,
                            onValueChange = ::changeTitle,
                            textStyle = titleStyle,
                            cursorBrush = SolidColor(c.textBrand),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Next),
                            keyboardActions = KeyboardActions(onNext = { surface.focus() }),
                            modifier = Modifier
                                .fillMaxWidth()
                                .focusRequester(titleFocus)
                                .onFocusChanged { titleFocused = it.isFocused }
                                .semantics { contentDescription = t("notes.editor.title") },
                            decorationBox = { inner ->
                                Box {
                                    if (title.text.isEmpty()) Txt(t("notes.editor.titlePlaceholder"), style = titleStyle, color = c.textPlaceholder.copy(alpha = 0.8f))
                                    inner()
                                }
                            },
                        )
                        Byline(noteId)
                        if (over) {
                            Txt(
                                t("notes.editor.tooLong", "max" to java.text.NumberFormat.getInstance(fish.nexa.ui.I18n.locale).format(NoteModel.MAX_CHARS)),
                                style = Nx.type.bodySmall,
                                color = c.textDanger,
                                modifier = Modifier.padding(bottom = 16.dp).fillMaxWidth().background(c.danger.copy(alpha = 0.12f), Radii.Sm).padding(horizontal = 12.dp, vertical = 10.dp).semantics { liveRegion = LiveRegionMode.Assertive },
                            )
                        }
                        if (surface.simplified) Txt(t("composer.format.simplified"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, modifier = Modifier.padding(bottom = 14.dp))
                        FormatBlocks(surface, t("notes.editor.placeholder"), PageLook.NOTE, Modifier.semantics { contentDescription = t("notes.editor.body") }) { block ->
                            NoteFileView(
                                meta = files[block.file],
                                name = block.name,
                                pending = uploads.pending[block.file],
                                width = block.width,
                                onResize = { w -> surface.command(Cmd.FileWidth(block.id, w)) },
                                onRemove = {
                                    uploads.cancel(block.file)
                                    surface.command(Cmd.RemoveBlock(block.id))
                                },
                                onRetry = { uploads.retry(block.file) },
                            )
                        }
                        // the page goes on below the last line: a tap there writes at the end
                        val density = LocalDensity.current
                        Spacer(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = with(density) { (Nexa.app.resources.displayMetrics.heightPixels * 0.25f).toDp() })
                                .pressable(remember { MutableInteractionSource() }) { surface.focusEnd() },
                        )
                    }
                }
            }
            // typing @ offers the people who have the note
            NoteMentionList(noteId, surface, sheetScroll, { sheetArea[0] }, redraw)
        }
        // what the caret is in, or the tray asked for, then the tools
        val shown = fish.nexa.ui.format.settledTray(tray, state)
        if (shown != null) {
            Column(Modifier.fillMaxWidth().background(c.bgSurface).topHairline(c.borderSubtle)) {
                TrayBody(shown, state, surface, setTray = { tray = it })
            }
        }
        Toolbar(state, tray, { tray = if (tray == it) null else it }, surface, Modifier.padding(bottom = 4.dp)) {
            ToolButton("ImagePlus", t("notes.editor.addPicture")) { pickMedia.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) }
            ToolButton("Paperclip", t("notes.editor.attachFile")) { pickFiles.launch(arrayOf("*/*")) }
        }
    }
}

/**
 * A note as someone who may only read it sees it (NoteReader): drawn as a
 * message is, files and all, and redrawn as the people writing it save.
 */
@Composable
private fun NoteReader(noteId: String, initial: NoteDoc, bridge: NoteBridge, narrow: Boolean, onTitle: (String) -> Unit, end: @Composable RowScope.() -> Unit) {
    val c = Nx.colors
    var doc by remember { mutableStateOf(initial) }
    bridge.onRemote = { next, _ ->
        doc = next
        onTitle(next.title)
        true
    }
    DisposableEffect(bridge) { onDispose { bridge.onRemote = { _, _ -> false } } }
    // the people it mentions, fetched if this device has not seen them, and drawn again once their names are here
    val mentioned = remember(doc.md) { fish.nexa.notes.NoteMentions.mentionedIds(doc.md) }
    LaunchedEffect(mentioned) { Nexa.session.ensureUsers(mentioned) }
    val known by Nexa.users.byId.collectAsState()
    val named = mentioned.count { known[it] != null }
    val ctx = remember(doc.files) {
        RenderCtx(
            files = true,
            max = NoteModel.MAX_CHARS,
            bodyPx = 16.5f,
            bodyLine = 28f,
            gap = 6.6.dp,
            renderFile = { id, name, width ->
                Box(Modifier.fillMaxWidth().padding(vertical = 16.dp)) { NoteFileView(doc.files[id], name, null, width) }
            },
        )
    }
    Column(Modifier.fillMaxSize().navigationBarsPadding()) {
        NoteBar(narrow, title = null, viewOnly = true, end = end)
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            Column(Modifier.widthIn(max = SHEET_MAX).fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 22.dp, bottom = 128.dp)) {
                val untitled = doc.title.isBlank()
                Txt(
                    NoteModel.name(doc.title),
                    style = Nx.type.title.copy(fontSize = Nx.type.sp(24f), lineHeight = Nx.type.sp(28.8f), fontWeight = FontWeight(720), letterSpacing = (-0.018).em),
                    color = if (untitled) c.textMuted else c.textStrong,
                    modifier = Modifier.semantics { heading() },
                )
                Byline(noteId)
                if (doc.md.isNotBlank()) androidx.compose.runtime.key(named) { MarkdownView(doc.md, ctx) }
                else Txt(t("notes.reader.empty"), style = Nx.type.body, color = c.textMuted)
            }
        }
    }
}
