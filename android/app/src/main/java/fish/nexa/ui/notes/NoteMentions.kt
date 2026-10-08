package fish.nexa.ui.notes

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.net.PublicUser
import fish.nexa.notes.NoteMentions
import fish.nexa.notes.Notes
import fish.nexa.notes.NotesApi
import fish.nexa.ui.chat.AcItem
import fish.nexa.ui.chat.AcRow
import fish.nexa.ui.components.Txt
import fish.nexa.ui.format.Cmd
import fish.nexa.ui.format.FormatSurface
import fish.nexa.ui.format.MentionAt
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.shadowHigh
import fish.nexa.ui.theme.topEdge

/** How wide the list is, how far it keeps from the edges, and how much room it wants under the caret before it opens above it. */
private val WIDTH = 320.dp
private val EDGE = 8.dp
private val ROOM = 300.dp

/**
 * Mentioning people while writing a note (web components/notes/NoteMentions.tsx):
 * typing @ offers the people who have the note, narrowed by what is typed
 * after it, in the list the message box uses, hung from the caret. A tap puts
 * the person in. Also fetches the profiles of everyone the note already
 * mentions and draws their mentions with their names once they arrive.
 *
 * Put it over the note's scrolling sheet: `area` is that box's place on the
 * screen, `scroll` the sheet's scroll, read so the list follows the caret.
 */
@Composable
fun NoteMentionList(noteId: String, surface: FormatSurface, scroll: ScrollState, area: () -> LayoutCoordinates?, changes: Int) {
    // who has the note, asked for again whenever that changes
    val sharing by Notes.sharing.collectAsState()
    val version = sharing[noteId] ?: 0
    var people by remember { mutableStateOf<List<PublicUser>>(emptyList()) }
    LaunchedEffect(noteId, version) {
        runCatching { NotesApi.sharing(noteId) }.onSuccess { sh ->
            val users = sh.members.map { it.user }
            Nexa.users.upsert(users)
            people = users
        }
    }
    // names for everyone already mentioned, people who have since left the note included
    LaunchedEffect(changes) { Nexa.session.ensureUsers(NoteMentions.mentionedIds(surface.markdown())) }
    val known by Nexa.users.byId.collectAsState()
    LaunchedEffect(known) { surface.relabelPeople() }

    val at by remember(surface) { derivedStateOf { surface.mentionAt() } }
    val open = at ?: return
    val meId = Nexa.users.meId
    val found = remember(open.query, people, meId) { NoteMentions.matches(people.filter { it.id != meId }, open.query) }
    if (found.isEmpty()) return

    val c = Nx.colors
    scroll.value // the list moves with the page
    val caret = caretIn(surface, open, area()) ?: return
    BoxWithConstraints(Modifier) {
        val d = androidx.compose.ui.platform.LocalDensity.current
        val wPx = with(d) { minOf(WIDTH, maxWidth - EDGE * 2).toPx() }
        val edge = with(d) { EDGE.toPx() }
        val left = (caret.left - with(d) { 12.dp.toPx() }).coerceIn(edge, maxOf(edge, constraints.maxWidth - wPx - edge))
        val below = caret.bottom + with(d) { ROOM.toPx() } <= constraints.maxHeight
        var height by remember { mutableStateOf(0) }
        val gap = with(d) { 6.dp.toPx() }
        val top = if (below) caret.bottom + gap else caret.top - gap - height
        val shape = Radii.Md
        Column(
            Modifier
                .offset { IntOffset(left.toInt(), top.toInt()) }
                .width(with(d) { wPx.toDp() })
                .heightIn(max = minOf(ROOM, maxHeight - EDGE * 2))
                .onGloballyPositioned { height = it.size.height }
                .shadowHigh(shape, c)
                .background(c.bgFloating, shape)
                .topEdge(shape, c.edgeLight)
                .verticalScroll(rememberScrollState())
                .padding(8.dp),
        ) {
            Txt(t("notes.share.peopleWithAccess"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(650)), color = c.textMuted, modifier = Modifier.padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 8.dp))
            found.forEachIndexed { i, u ->
                AcRow(AcItem("user", "", u.name, u.username, user = u), selected = i == 0) {
                    surface.command(Cmd.Mention("<@${u.id}>", "@" + u.name, open.query.length + 1))
                }
            }
        }
    }
}

/** The caret's line, in the coordinates of the box the list is drawn in. */
private fun caretIn(surface: FormatSurface, at: MentionAt, area: LayoutCoordinates?): Rect? {
    if (area == null || !area.isAttached) return null
    val coords = surface.placed[at.key] ?: return null
    if (!coords.isAttached) return null
    val laid = surface.laidOut[at.key]?.invoke() ?: return null
    val shown = surface.shownAt(at.key, at.offset).coerceIn(0, laid.layoutInput.text.length)
    return laid.getCursorRect(shown).translate(area.localPositionOf(coords, Offset.Zero))
}
