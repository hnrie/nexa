package fish.nexa.ui.notes

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import fish.nexa.Nexa
import fish.nexa.notes.NoteInviteItem
import fish.nexa.notes.NoteItem
import fish.nexa.notes.NoteModel
import fish.nexa.notes.NoteRole
import fish.nexa.notes.NoteShare
import fish.nexa.notes.Notes
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.components.sink
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.markdown.Markdown
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.server.Loading
import fish.nexa.ui.server.SearchBox
import fish.nexa.ui.shell.NavButton
import fish.nexa.ui.shell.confirm
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.brandGradient
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.shadowHigh
import fish.nexa.ui.theme.shadowLow
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Narrower than this, the list and a note take turns rather than sitting side by side. */
private val SIDE_BY_SIDE = 820.dp

/** What the notes pages share between them. */
object NotesUi {
    /** A note just made: it opens with the caret in its title. */
    var freshId: String? = null
    var making by mutableStateOf(false)
        private set

    /** Makes a note and opens it. */
    fun make() {
        if (making) return
        making = true
        Nexa.scope.launch {
            try {
                val made = NoteShare.create()
                freshId = made.id
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { Nav.go(Route.Notes(made.id)) }
            } catch (e: Exception) {
                Nexa.ui.toast(NoteShare.error(e, t("notes.list.couldNotCreate")), "error")
            } finally {
                making = false
            }
        }
    }

    /** Back from a note to the list: through history when that is where it came from. */
    fun backToList() {
        if (Nav.previous == Route.Notes()) Nav.back() else Nav.go(Route.Notes())
    }
}

/**
 * Notes (NotesPage.tsx): the list of this account's notes beside the one
 * open, or, on a phone, the list until a note is opened and the note after.
 */
@Composable
fun NotesPage(route: Route.Notes) {
    LaunchedEffect(Unit) { Notes.load() }
    val status by Notes.status.collectAsState()
    val notes by Notes.notes.collectAsState()
    val invites by Notes.invites.collectAsState()
    val noteId = route.noteId
    BoxWithConstraints(Modifier.fillMaxSize().background(Nx.colors.bgBase)) {
        val split = maxWidth >= SIDE_BY_SIDE
        when {
            // nothing yet: the page is an invitation to start
            status == Notes.Status.READY && notes.isEmpty() && invites.isEmpty() && noteId == null -> FirstNote()
            split -> Row(Modifier.fillMaxSize()) {
                Box(
                    Modifier
                        .width(304.dp)
                        .fillMaxHeight()
                        .background(fish.nexa.ui.theme.mixOklab(Nx.colors.bgBase, Nx.colors.bgRaised, 0.45f))
                        .drawEndHairline(Nx.colors.borderSubtle),
                ) { NotesList(noteId) }
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    if (noteId != null) androidx.compose.runtime.key(noteId) { NoteScreen(noteId, narrow = false) }
                    else NoNoteOpen()
                }
            }
            noteId != null -> androidx.compose.runtime.key(noteId) { NoteScreen(noteId, narrow = true) }
            else -> NotesList(null)
        }
    }
}

/** The list's edge against the note (inset -1px 0 0 border-subtle). */
private fun Modifier.drawEndHairline(color: Color): Modifier = drawBehind {
    drawRect(color, topLeft = Offset(size.width - 1.dp.toPx(), 0f), size = Size(1.dp.toPx(), size.height))
}

/** Places a child at an offset from its parent's corner without taking up any room (an absolutely placed flag). */
private fun Modifier.pinned(x: Dp, y: Dp): Modifier = layout { measurable, _ ->
    val p = measurable.measure(Constraints())
    layout(0, 0) { p.place(x.roundToPx(), y.roundToPx()) }
}

/** Notes, and none of them open: where to go from here. */
@Composable
private fun NoNoteOpen() {
    Column(Modifier.fillMaxSize().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)) {
        Txt(t("notes.list.pick"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14.5f), lineHeight = Nx.type.sp(21.75f)), color = Nx.colors.textMuted, align = TextAlign.Center, modifier = Modifier.widthIn(max = 360.dp))
        NxButton(t("notes.list.new"), { NotesUi.make() }, kind = ButtonKind.SECONDARY, icon = "Plus", loading = NotesUi.making)
    }
}

/**
 * No notes at all (FirstNote): a page being written by two people, as small
 * as a picture, which is what a note here can be, and the way to make the first.
 */
@Composable
private fun FirstNote() {
    val c = Nx.colors
    val rels by Nexa.relationships.byId.collectAsState()
    // a friend's name on the other caret, where there is a friend
    val friend = remember(rels) { rels.values.firstOrNull { it.type == "friend" }?.user }
    val name = friend?.let { it.displayName.ifEmpty { it.username } } ?: t("notes.first.friend")
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) { NavButton() }
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 64.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
        ) {
            SampleCard(name, friend?.id)
            Txt(
                t("notes.first.title"),
                style = Nx.type.title.copy(fontSize = Nx.type.sp(26f), lineHeight = Nx.type.sp(29.1f), fontWeight = FontWeight(740), letterSpacing = (-0.02).em),
                color = c.textStrong,
                align = TextAlign.Center,
                modifier = Modifier.padding(top = 18.dp).semantics { heading() },
            )
            Txt(
                t("notes.first.body"),
                style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), lineHeight = Nx.type.sp(22.5f)),
                color = c.textMuted,
                align = TextAlign.Center,
                modifier = Modifier.widthIn(max = 420.dp).padding(bottom = 10.dp),
            )
            NxButton(t("notes.list.new"), { NotesUi.make() }, size = ButtonSize.LG, icon = "NotebookPen", loading = NotesUi.making)
        }
    }
}

/**
 * The note in small (.sample): a tilted page with a title and lines, a
 * friend's caret writing the second line with their name on its flag, and
 * this page's own caret blinking at the end of the last.
 */
@Composable
private fun SampleCard(name: String, friendId: String?) {
    val c = Nx.colors
    val reduced = Nx.motion.reduced
    val who = Color(fish.nexa.notes.NoteHues.HUES[2])
    val typing = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!reduced) {
            delay(400)
            typing.animateTo(1f, tween(2600, easing = CubicBezierEasing(0.45f, 0f, 0.55f, 1f)))
        }
    }
    var blink by remember { mutableStateOf(true) }
    LaunchedEffect(reduced) {
        if (reduced) return@LaunchedEffect
        while (true) {
            delay(550)
            blink = !blink
        }
    }
    val shape = RoundedCornerShape(14.dp)
    val line = c.textMuted.copy(alpha = 0.45f)
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        val width = minOf(300.dp, maxWidth * 0.8f)
        Column(
            Modifier
                .width(width)
                .rotate(-2f)
                .shadowHigh(shape, c)
                .ring(shape, c.borderSubtle)
                .background(c.bgFloating, shape)
                .background(sheen(c), shape)
                .topEdge(shape, c.edgeLight)
                .padding(start = 24.dp, end = 24.dp, top = 24.dp, bottom = 26.dp)
                .clearAndSetSemantics {},
            verticalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Box(Modifier.padding(bottom = 6.dp).fillMaxWidth(0.58f).height(14.dp).background(c.textStrong.copy(alpha = 0.85f), RoundedCornerShape(4.dp)))
            Box(Modifier.fillMaxWidth(0.92f).height(7.dp).background(line, RoundedCornerShape(4.dp)))
            // the line the friend is writing, their caret and name at its end
            Box(Modifier.fillMaxWidth(0.22f + 0.42f * typing.value).height(7.dp).background(line, RoundedCornerShape(4.dp))) {
                Box(Modifier.align(Alignment.TopEnd).pinned(1.dp, (-5).dp).size(2.dp, 17.dp).background(who, RoundedCornerShape(1.dp)))
                // the square on its head, and the flag with their name over it
                Box(Modifier.align(Alignment.TopEnd).pinned((-1).dp, (-7).dp).size(6.dp).background(who, RoundedCornerShape(1.5.dp)))
                fish.nexa.ui.chat.PersonName(
                    friendId, name,
                    style = Nx.type.label.copy(fontSize = Nx.type.sp(12f), lineHeight = Nx.type.sp(16f), fontWeight = FontWeight(650)),
                    color = Color.White,
                    maxLines = 1,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .pinned((-1).dp, (-25).dp)
                        .background(who, RoundedCornerShape(topStart = 5.dp, topEnd = 5.dp, bottomEnd = 5.dp, bottomStart = 1.dp))
                        .padding(start = 7.dp, end = 7.dp, top = 1.dp, bottom = 2.dp),
                )
            }
            Box(Modifier.fillMaxWidth(0.78f).height(7.dp).background(line, RoundedCornerShape(4.dp)))
            // the end of this page's own words, its caret blinking there
            Box(Modifier.fillMaxWidth(0.34f).height(7.dp).background(line, RoundedCornerShape(4.dp))) {
                Box(Modifier.align(Alignment.TopEnd).pinned(2.dp, (-5).dp).size(2.dp, 17.dp).alpha(if (blink || reduced) 1f else 0f).background(c.brand, RoundedCornerShape(1.dp)))
            }
        }
    }
}

/** The one button with the accent's light on it (.newBtn, .shareBtn): 36 high on a touch screen. */
@Composable
internal fun BrandPill(label: String?, icon: String, busy: Boolean = false, description: String? = null, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = RoundedCornerShape(9.dp)
    Row(
        Modifier
            .sink(pressed)
            .dropShadow(shape, Shadow(radius = 12.dp, color = c.brand.copy(alpha = 0.8f), spread = (-5).dp, offset = DpOffset(0.dp, 4.dp)))
            .background(if (pressed) androidx.compose.ui.graphics.SolidColor(c.brandActive) else brandGradient(c), shape)
            .topEdge(shape, Color.White.copy(alpha = 0.22f))
            .clip(shape)
            .alpha(if (busy) 0.7f else 1f)
            .pressable(interaction, enabled = !busy, onClick = onClick)
            .height(36.dp)
            .padding(start = if (label == null) 10.dp else 9.dp, end = if (label == null) 10.dp else 12.dp)
            .semantics { description?.let { contentDescription = it } },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon(icon, c.onBrand, size = 16.dp)
        if (label != null) Txt(label, style = Nx.type.label.copy(fontSize = Nx.type.sp(13.5f), fontWeight = FontWeight(650)), color = c.onBrand, maxLines = 1)
    }
}

/** The first words of a note, as plain text, for its row: its words, not the names of its files. */
private fun firstWords(n: NoteItem): String {
    val head = n.head ?: return ""
    val text = NoteModel.withoutFiles(head.preview, NoteModel.fileIds(head.preview).toSet())
    // a mention reads as the person's name, as it does in the note
    return Markdown.plainText(Markdown.parse(text), fish.nexa.ui.chat.AppNames).replace(Regex("\\s+"), " ").trim().take(240)
}

/** A clock that moves every half minute, for times said as "2 minutes ago". */
@Composable
internal fun minuteClock(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            now = System.currentTimeMillis()
        }
    }
    return now
}

/**
 * This account's notes (NotesList.tsx), the one written in last first: each
 * by its title, its first words, when it was last written in and who is in
 * it right now. Above them, the notes people have asked to share.
 */
@Composable
private fun NotesList(selected: String?) {
    val c = Nx.colors
    val status by Notes.status.collectAsState()
    val notes by Notes.notes.collectAsState()
    val invites by Notes.invites.collectAsState()
    var query by rememberSaveable { mutableStateOf("") }
    val now = minuteClock()
    val all = remember(notes) { Notes.sorted(notes) }
    val known by Nexa.users.byId.collectAsState()
    LaunchedEffect(all) { Nexa.session.ensureUsers(all.flatMap { n -> n.head?.let { fish.nexa.notes.NoteMentions.mentionedIds(it.preview) } ?: emptyList() }) }
    val words = remember(all, known) { all.associate { it.id to firstWords(it) } }
    val shown = remember(all, words, query) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) all else all.filter { "${it.head?.title ?: ""}\n${words[it.id] ?: ""}".lowercase().contains(q) }
    }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().height(52.dp).padding(start = 18.dp, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            NavButton()
            Txt(
                t("notes.title"),
                style = Nx.type.headerTitle.copy(fontSize = Nx.type.sp(17f), fontWeight = FontWeight(700), letterSpacing = (-0.01).em),
                color = c.textStrong,
                maxLines = 1,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            BrandPill(t("notes.list.new"), "Plus", busy = NotesUi.making) { NotesUi.make() }
        }
        if (all.size > 1) {
            SearchBox(query, { query = it }, t("notes.list.search"), Modifier.padding(start = 10.dp, end = 10.dp, bottom = 8.dp))
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 8.dp, end = 8.dp, top = 2.dp, bottom = 24.dp)) {
            if (invites.isNotEmpty()) {
                item("requests-title") {
                    Txt(
                        t("notes.requests.title"),
                        style = Nx.type.label.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(700)),
                        color = c.textMuted,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp).semantics { heading() },
                    )
                }
                items(invites, key = { "inv-" + it.id }) { RequestCard(it) }
                item("requests-gap") { Spacer(Modifier.height(12.dp)) }
            }
            if (status == Notes.Status.LOADING || status == Notes.Status.IDLE) item("loading") { Loading(t("notes.list.loading")) }
            if (status == Notes.Status.ERROR) item("error") {
                Column(Modifier.fillMaxWidth().padding(vertical = 28.dp, horizontal = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Txt(t("notes.list.couldNotLoad"), style = Nx.type.bodySmall, color = c.textMuted, align = TextAlign.Center)
                    NxButton(t("notes.page.tryAgain"), { Nexa.scope.launch { Notes.load(true) } }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
                }
            }
            if (status == Notes.Status.READY && all.isEmpty()) item("none") {
                Txt(t("notes.list.none"), style = Nx.type.bodySmall, color = c.textMuted, modifier = Modifier.padding(horizontal = 10.dp, vertical = 14.dp))
            }
            if (shown.isNotEmpty()) {
                items(shown, key = { it.id }) { n ->
                    NoteRow(n, words[n.id] ?: "", selected = n.id == selected, now = now)
                    Spacer(Modifier.height(2.dp))
                }
            } else if (status == Notes.Status.READY && all.isNotEmpty()) item("nomatch") {
                Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Txt(t("notes.list.noMatch", "query" to query.trim()), style = Nx.type.bodySmall, color = c.textMuted, align = TextAlign.Center)
                    NxButton(t("friends.clearTheSearch"), { query = "" }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
                }
            }
        }
    }
}

/** What can be done with a note from its row's menu or the menu on its page (noteMenu.ts). */
internal fun noteMenuItems(note: NoteItem, inList: Boolean, onHistory: (() -> Unit)? = null, onGone: (() -> Unit)? = null): List<MenuItem> {
    val owner = note.role == NoteRole.OWNER
    val title = NoteModel.name(note.head?.title)
    val items = ArrayList<MenuItem>()
    if (inList) items += MenuItem.Action(t("notes.menu.open")) { Nav.go(Route.Notes(note.id)) }
    items += MenuItem.Action(if (owner) t("notes.menu.share") else t("notes.menu.whoHasAccess"), separatorAfter = onHistory == null) { openShareNote(note.id) }
    if (onHistory != null) items += MenuItem.Action(t("notes.menu.history"), separatorAfter = true, onClick = onHistory)
    val remove: suspend () -> Unit = {
        try {
            NoteShare.remove(note)
        } catch (e: Exception) {
            throw fish.nexa.ui.ReadableError(NoteShare.error(e))
        }
        onGone?.let { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { it() } }
    }
    items += if (owner) MenuItem.Action(t("notes.menu.delete"), danger = true) {
        confirm(t("notes.menu.deleteTitle"), t("notes.menu.deleteBody", "title" to title), t("notes.menu.delete"), danger = true, onConfirm = remove)
    } else MenuItem.Action(t("notes.menu.leave"), danger = true) {
        confirm(t("notes.menu.leaveTitle"), t("notes.menu.leaveBody", "title" to title), t("notes.menu.leave"), danger = true, onConfirm = remove)
    }
    return items
}

@Composable
private fun NoteRow(note: NoteItem, words: String, selected: Boolean, now: Long) {
    val c = Nx.colors
    val here by Notes.here.collectAsState()
    val meId = Nexa.users.meId
    val users by Nexa.users.byId.collectAsState()
    val title = NoteModel.name(note.head?.title)
    val untitled = note.head?.title?.isBlank() != false
    val live = Notes.peopleHere(here[note.id], now).filter { it != meId }
    val shared = note.members > 1
    val viewOnly = note.role < NoteRole.EDITOR
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = Radii.Md
    Column(
        Modifier
            .fillMaxWidth()
            .then(
                if (selected) Modifier.shadowLow(shape, c).background(c.bgSelected, shape).background(sheen(c), shape).topEdge(shape, c.edgeLight)
                else Modifier.background(if (pressed) c.bgHover else Color.Transparent, shape),
            )
            .clip(shape)
            .pressable(interaction, onLongClick = { openMenu(noteMenuItems(note, inList = true), title = title) }) { Nav.go(Route.Notes(note.id)) }
            .padding(horizontal = 10.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Txt(
                title,
                style = Nx.type.name.copy(fontSize = Nx.type.sp(15f), lineHeight = Nx.type.sp(19.5f), fontWeight = FontWeight(if (untitled) 600 else 660)),
                color = if (untitled) c.textMuted else c.textStrong,
                maxLines = 1,
                modifier = Modifier.weight(1f),
            )
            Txt(Time.listWhen(note.updatedAt, now), style = Nx.type.hint.copy(fontFeatureSettings = "tnum", lineHeight = Nx.type.sp(19.5f)), color = c.textMuted, maxLines = 1)
        }
        Txt(
            if (note.head != null) words.ifEmpty { t("notes.card.empty") } else t("notes.card.locked"),
            style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(19.2f)),
            color = if (selected) c.textSubtle else c.textMuted,
            maxLines = 2,
        )
        if (live.isNotEmpty() || shared || viewOnly) {
            Row(Modifier.padding(top = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (live.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy((-3).dp)) {
                        for (id in live.take(3)) {
                            val u = users[id]
                            Face(note.id, id, u?.let { it.displayName.ifEmpty { it.username } } ?: "", u?.avatarId, 16.dp, small = true)
                        }
                    }
                }
                if (shared) MetaWord("Users", t("notes.link.people", "count" to note.members), t("notes.card.sharedWith", "count" to note.members))
                if (viewOnly) MetaWord("Eye", t("notes.page.viewOnly"), null)
            }
        }
    }
}

@Composable
private fun MetaWord(icon: String, text: String, description: String?) {
    val c = Nx.colors
    Row(
        Modifier.semantics(mergeDescendants = true) { if (description != null) contentDescription = description },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(icon, c.textMuted, size = 13.dp)
        Txt(text, style = Nx.type.hint, color = c.textMuted, maxLines = 1)
    }
}

/** Someone in a note: their face, ringed in the colour their caret has (.face). */
@Composable
internal fun Face(noteId: String, userId: String, name: String, avatarId: String?, size: Dp, small: Boolean = false) {
    val c = Nx.colors
    val who = Color(fish.nexa.notes.NoteHues.of(noteId, userId))
    val gap = if (small) 1.5.dp else 2.dp
    val ringW = if (small) 1.5.dp else 2.dp
    Box(
        Modifier
            .ring(CircleShape, who, gap + ringW)
            .ring(CircleShape, c.bgRaised, gap),
    ) {
        Avatar(userId, name, avatarId, size)
    }
}

/** A request to share a note (.request): who asks, the note's title, and the answers. */
@Composable
private fun RequestCard(invite: NoteInviteItem) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    val from = invite.from.displayName.ifEmpty { invite.from.username }
    val shape = Radii.Md
    fun accept() {
        busy = "yes"
        scope.launch {
            try {
                val it = NoteShare.accept(invite)
                Nav.go(Route.Notes(it.id))
            } catch (e: Exception) {
                Nexa.ui.toast(NoteShare.error(e, t("notes.requests.couldNotAccept")), "error")
                busy = null
            }
        }
    }
    fun decline() {
        busy = "no"
        scope.launch {
            try {
                NoteShare.decline(invite)
            } catch (e: Exception) {
                Nexa.ui.toast(NoteShare.error(e, t("notes.requests.couldNotDecline")), "error")
                busy = null
            }
        }
    }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 4.dp)
            .shadowLow(shape, c)
            .ring(shape, c.borderSubtle)
            .background(c.bgFloating, shape)
            .background(sheen(c), shape)
            .topEdge(shape, c.edgeLight)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Avatar(invite.from.id, from, invite.from.avatarId, 32.dp)
        Column(Modifier.weight(1f)) {
            Txt(
                invite.head?.let { NoteModel.name(it.title) } ?: t("notes.card.locked"),
                style = Nx.type.name.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(660)),
                color = c.textStrong,
                maxLines = 1,
            )
            fish.nexa.ui.chat.PersonText(
                invite.from.id, if (invite.role == NoteRole.EDITOR) t("notes.requests.toEdit", "name" to fish.nexa.ui.chat.PERSON_SLOT) else t("notes.requests.toView", "name" to fish.nexa.ui.chat.PERSON_SLOT), from,
                style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f), lineHeight = Nx.type.sp(16.9f)),
                color = c.textMuted,
                modifier = Modifier.padding(top = 1.dp),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            RoundAct("Check", t("notes.requests.accept"), yes = true, enabled = busy == null) { accept() }
            RoundAct("X", t("notes.requests.decline"), yes = false, enabled = busy == null) { decline() }
        }
    }
}

/** An answer to a request (.act): round, quiet until pressed, then green or red. */
@Composable
private fun RoundAct(icon: String, label: String, yes: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .size(38.dp)
            .sink(pressed)
            .ring(CircleShape, c.borderSubtle)
            .background(
                if (pressed) (if (yes) fish.nexa.ui.theme.positiveGradient(c) else fish.nexa.ui.theme.dangerGradient(c)) else androidx.compose.ui.graphics.SolidColor(c.bgSurface),
                CircleShape,
            )
            .topEdge(CircleShape, c.edgeLight)
            .clip(CircleShape)
            .alpha(if (enabled) 1f else 0.55f)
            .pressable(interaction, enabled = enabled, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, if (pressed) (if (yes) c.onPositive else c.onDanger) else c.textSubtle, size = 18.dp)
    }
}
