package fish.nexa.ui.notes

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Constraints
import fish.nexa.ui.chat.PersonName
import kotlin.math.roundToInt
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.notes.NoteHues
import fish.nexa.notes.Notes
import fish.nexa.notes.OpenNote
import fish.nexa.ui.format.CursorMark
import fish.nexa.ui.format.FieldKey
import fish.nexa.ui.format.FormatSurface
import fish.nexa.ui.format.PlaceMark
import fish.nexa.ui.markdown.format.CodeBlock
import fish.nexa.ui.markdown.format.FormatModel
import fish.nexa.ui.markdown.format.Pos
import fish.nexa.ui.markdown.format.TextBlock
import fish.nexa.ui.theme.Nx
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** How often this page's caret is sent at most while it moves. */
private const val SEND_EVERY = 150L
/** How long a name stays over a caret after it stops, and how long it takes to go. */
private const val NAME_FOR = 2400L
private const val NAME_FADE = 260L

/** Where someone's caret is, as it comes over the gateway (lib/notes/cursors.ts): which of their pages, and the selection, or that it closed. */
private sealed interface CursorMessage {
    val s: String

    class At(override val s: String, val mark: CursorMark) : CursorMessage
    class Gone(override val s: String) : CursorMessage
}

private val SID = Regex("^[A-Za-z0-9_-]{4,32}$")

private fun readPlace(x: JsonElement?): PlaceMark? {
    val o = x as? JsonObject ?: return null
    val b = (o["b"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: return null
    val off = (o["o"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: return null
    if (b < 0 || off < 0 || b > 1_000_000 || off > 1_000_000) return null
    val k = (o["k"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull ?: return null
    if (k.length > 16) return null
    val cell = o["cell"]
    if (cell != null) {
        val arr = cell as? JsonArray ?: return null
        val nums = arr.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> !p.isString }?.intOrNull }
        if (arr.size != 2 || nums.size != 2 || nums.any { it < 0 || it >= 10_000 }) return null
        return PlaceMark(b, off, nums[0] to nums[1], k)
    }
    return PlaceMark(b, off, null, k)
}

/** A cursor someone else sent, read as carefully as anything from the wire; null for anything else. */
private fun readCursor(x: JsonElement?): CursorMessage? {
    val o = x as? JsonObject ?: return null
    val s = (o["s"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull ?: return null
    if (!SID.matches(s)) return null
    if ((o["gone"] as? JsonPrimitive)?.booleanOrNull == true) return CursorMessage.Gone(s)
    val a = readPlace(o["a"]) ?: return null
    val f = readPlace(o["f"]) ?: return null
    return CursorMessage.At(s, CursorMark(a, f))
}

private fun placeJson(p: PlaceMark): JsonObject = buildJsonObject {
    put("b", p.b)
    put("o", p.o)
    p.cell?.let { (r, c) -> putJsonArray("cell") { add(JsonPrimitive(r)); add(JsonPrimitive(c)) } }
    put("k", p.k)
}

/** Someone's caret: from which of their pages, where, and when it last moved (which is when its name shows). */
private class Remote(val userId: String, val page: String, val mark: CursorMark, val moved: Long)

/** The caret drawing and its non-interactive, composable identity labels share one sheet origin. */
class LiveCursorOverlay(val modifier: Modifier, val labels: @Composable (Modifier) -> Unit)

/**
 * Everyone else's caret and selection in a note (LiveCursors.tsx), as they
 * move, and this page's sent to them. A caret is a line in its person's
 * colour with their name over it while it moves; a selection is a wash of
 * the same colour. Positions go sealed with the note's key, through the
 * gateway, only while someone else has the note open.
 */
@Composable
fun rememberLiveCursors(noteId: String, note: OpenNote, surface: FormatSurface, titleFocused: Boolean, redraw: () -> Int): LiveCursorOverlay {
    val here by Notes.here.collectAsState()
    val users by Nexa.users.byId.collectAsState()
    val meId = Nexa.users.meId
    val scope = rememberCoroutineScope()
    // each person's caret, from whichever of their pages moved it last: a page that closed without
    // saying so (a tab closed, the app taken off the screen) leaves no caret behind once the one in its place moves
    val remote = remember { mutableStateMapOf<String, Remote>() }
    /** This page, among its person's other pages with the note open. */
    val sid = remember { Bytes.b64url(Bytes.random(9)) }
    val state = remember { object { var sent: CursorMark? = null; var lastSend = 0L; var timer: Job? = null } }
    var frame by remember { mutableLongStateOf(0L) }
    val others = Notes.peopleHere(here[noteId]).filter { it != meId }
    val anyone = others.isNotEmpty()

    fun send(always: Boolean = false) {
        if (Notes.peopleHere(Notes.here.value[noteId]).none { it != meId }) return
        val mark = surface.cursor()
        if (!always && mark == state.sent) return
        state.sent = mark
        state.lastSend = System.currentTimeMillis()
        note.sendCursor(buildJsonObject {
            put("s", sid)
            put("a", placeJson(mark.a))
            put("f", placeJson(mark.f))
        })
    }

    fun moved() {
        if (state.timer?.isActive == true || !anyone) return
        state.timer = scope.launch {
            delay(maxOf(0L, state.lastSend + SEND_EVERY - System.currentTimeMillis()))
            send()
        }
    }

    // this page's caret or words moved: the others' carets are placed again, and this one is sent a moment later
    val tick = redraw()
    LaunchedEffect(surface.sel, surface.blocks, tick, titleFocused) {
        frame = System.currentTimeMillis()
        moved()
    }

    // what the others send
    DisposableEffect(note) {
        note.onCursor = { d ->
            scope.launch {
                val raw = note.openCursor(d.data) ?: return@launch
                val msg = readCursor(raw) ?: return@launch
                // this person's own other pages are not drawn as somebody else
                if (d.userId == Nexa.users.meId) return@launch
                when (msg) {
                    is CursorMessage.Gone -> if (remote[d.userId]?.page == msg.s) remote.remove(d.userId)
                    is CursorMessage.At -> remote[d.userId] = Remote(d.userId, msg.s, msg.mark, System.currentTimeMillis())
                }
            }
        }
        note.onPresence = { d ->
            if (!d.here) remote.remove(d.userId)
            // someone has just opened the note: they see where this caret is at once
            else if (d.hello) send(always = true)
        }
        onDispose {
            note.onCursor = null
            note.onPresence = null
            state.timer?.cancel()
            // leaving the note says so, so the others' copies drop this caret at once
            if (Notes.peopleHere(Notes.here.value[noteId]).any { it != Nexa.users.meId }) {
                note.sendCursor(buildJsonObject {
                    put("s", sid)
                    put("gone", true)
                })
            }
        }
    }

    // whoever is no longer here takes their caret with them, and whoever has just come sees this one
    val hereKey = others.joinToString(",")
    LaunchedEffect(hereKey) {
        val still = others.toSet()
        remote.entries.filter { it.value.userId !in still }.map { it.key }.forEach { remote.remove(it) }
        if (still.isNotEmpty()) send(always = true)
    }

    // names fade a moment after their caret stops: drawn again each frame while one is going
    val newest = remote.values.maxOfOrNull { it.moved } ?: 0L
    LaunchedEffect(newest) {
        while (System.currentTimeMillis() - newest < NAME_FOR + NAME_FADE) {
            withFrameMillis { frame = System.currentTimeMillis() }
        }
        frame = System.currentTimeMillis()
    }

    val nameStyle = TextStyle(fontFamily = Nx.type.text, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight(650), color = Color.White)
    val sheetAt = remember { object { var coords: LayoutCoordinates? = null } }
    val caretModifier = Modifier
        .onGloballyPositioned { sheetAt.coords = it }
        .drawWithContent {
            drawContent()
            // the time the carets were last placed: moved on whenever the words move, and each frame while a name goes
            @Suppress("UNUSED_VARIABLE") val now = frame
            val sheetCoords = sheetAt.coords ?: return@drawWithContent
            if (!sheetCoords.isAttached) return@drawWithContent
            for ((_, r) in remote) {
                val hue = Color(NoteHues.of(noteId, r.userId))
                drawSelection(surface, sheetCoords, r.mark, hue)
                val caret = caretRect(surface, sheetCoords, r.mark.f) ?: continue
                drawCaret(caret, hue)
            }
        }
    return LiveCursorOverlay(caretModifier) { modifier ->
        val now = frame
        val visible = remote.values.filter { maxOf(0L, now - it.moved) < NAME_FOR + NAME_FADE }
        // Only the identity label is composed. The selection/caret stay in the existing draw pass;
        // no pointer or focus modifier is installed on this layer.
        Layout(
            modifier = modifier.clearAndSetSemantics {},
            content = {
                for (r in visible) {
                    val age = maxOf(0L, now - r.moved)
                    val alpha = if (age <= NAME_FOR) 1f else 1f - (age - NAME_FOR).toFloat() / NAME_FADE
                    val hue = Color(NoteHues.of(noteId, r.userId))
                    val name = users[r.userId]?.let { it.displayName.ifEmpty { it.username } } ?: ""
                    Box(
                        Modifier
                            .graphicsLayer { this.alpha = alpha; translationY = 3.dp.toPx() * (1f - alpha) }
                            .background(hue, RoundedCornerShape(topStart = 5.dp, topEnd = 5.dp, bottomEnd = 5.dp, bottomStart = 1.dp))
                            .padding(start = 7.dp, end = 7.dp, top = 1.dp, bottom = 2.dp),
                    ) {
                        PersonName(r.userId, name, nameStyle, Color.White)
                    }
                }
            },
        ) { measurables, constraints ->
            val labels = measurables.map { it.measure(Constraints(maxWidth = constraints.maxWidth)) }
            layout(constraints.maxWidth, constraints.maxHeight) {
                val sheetCoords = sheetAt.coords
                if (sheetCoords != null && sheetCoords.isAttached) {
                    labels.forEachIndexed { index, label ->
                        val caret = caretRect(surface, sheetCoords, visible[index].mark.f)
                        if (caret != null) label.place(
                            (caret.left - 2.dp.toPx()).roundToInt(),
                            (caret.top - 1.dp.toPx() - label.height).roundToInt(),
                        )
                    }
                }
            }
        }
    }
}

/** Where a field's text is drawn on the sheet, and the offset in what is drawn for an offset in the field's own text. */
private fun fieldGeometry(surface: FormatSurface, sheet: LayoutCoordinates, key: FieldKey, offset: Int): Pair<Offset, Int>? {
    val coords = surface.placed[key] ?: return null
    if (!coords.isAttached) return null
    val laid = surface.laidOut[key]?.invoke() ?: return null
    val text = surface.field(key)?.text ?: return null
    val mapped = surface.shownAt(key, offset.coerceIn(0, text.length))
    val origin = sheet.localPositionOf(coords, Offset.Zero)
    return origin to mapped.coerceIn(0, laid.layoutInput.text.length)
}

/** Someone's caret, in the sheet's coordinates. */
private fun caretRect(surface: FormatSurface, sheet: LayoutCoordinates, mark: PlaceMark): Rect? {
    val p = surface.locate(mark) ?: return null
    val key = surface.fieldAt(p) ?: return null
    val (origin, at) = fieldGeometry(surface, sheet, key, p.o) ?: return null
    val laid = surface.laidOut[key]?.invoke() ?: return null
    return laid.getCursorRect(at).translate(origin)
}

private fun DrawScope.drawCaret(r: Rect, hue: Color) {
    val w = 2.dp.toPx()
    drawRoundRect(hue, topLeft = Offset(r.left - w / 2, r.top), size = Size(w, r.height), cornerRadius = CornerRadius(1.dp.toPx()))
    // the square on its head that stays when the name has gone
    val s = 6.dp.toPx()
    drawRoundRect(hue, topLeft = Offset(r.left - w / 2 - 2.dp.toPx(), r.top - 2.dp.toPx()), size = Size(s, s), cornerRadius = CornerRadius(1.5.dp.toPx()))
}

/** A selection someone has made: a wash of their colour over what it covers. */
private fun DrawScope.drawSelection(surface: FormatSurface, sheet: LayoutCoordinates, mark: CursorMark, hue: Color) {
    val a = surface.locate(mark.a) ?: return
    val f = surface.locate(mark.f) ?: return
    if (FormatModel.comparePos(a, f) == 0 && a.cell == f.cell) return
    val (from, to) = if (FormatModel.comparePos(a, f) <= 0) a to f else f to a
    for (b in from.b..to.b) {
        val block = surface.blocks.getOrNull(b) ?: continue
        if (block !is TextBlock && block !is CodeBlock) continue
        val key = FieldKey(block.id)
        val size = FormatModel.sizeAt(surface.blocks, Pos(b, 0))
        val start = if (b == from.b) from.o else 0
        val end = if (b == to.b) to.o else size
        if (end <= start) continue
        val (origin, s) = fieldGeometry(surface, sheet, key, start) ?: continue
        val (_, e) = fieldGeometry(surface, sheet, key, end) ?: continue
        val laid = surface.laidOut[key]?.invoke() ?: continue
        val path = laid.getPathForRange(s, e)
        translate(origin.x, origin.y) { drawPath(path, hue.copy(alpha = 0.26f)) }
    }
}
