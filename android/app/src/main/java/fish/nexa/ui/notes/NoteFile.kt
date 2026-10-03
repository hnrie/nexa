package fish.nexa.ui.notes

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import fish.nexa.crypto.AttachmentMeta
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.markdown.Markdown
import fish.nexa.ui.media.Attachments
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.dangerGradient
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.topEdge
import kotlin.math.roundToInt

/** A file on its way into a note from this device. */
data class PendingNoteFile(val name: String, val progress: Float, val error: String?)

/** The sizes offered at a tap, in percent of the line. */
private val SIZES = listOf(33 to "notes.file.small", 50 to "notes.file.medium", 75 to "notes.file.large", 100 to "notes.file.fullWidth")

/**
 * A file where a note's text has it (NoteFile.tsx). Once it is up it is drawn
 * the way a message draws its files, a picture or a video as wide as the note
 * says (dragged wider or narrower by its edges, or set at a tap from its
 * toolbar), a sound to play, a file to download. While it goes up from this
 * device it shows how far it has got. One the note names but nobody has the
 * file for says so.
 */
@Composable
fun NoteFileView(
    meta: AttachmentMeta?,
    name: String,
    pending: PendingNoteFile?,
    width: Int?,
    onResize: ((Int) -> Unit)? = null,
    onRemove: (() -> Unit)? = null,
    onRetry: (() -> Unit)? = null,
) {
    val visual = meta != null && (meta.isImage || meta.isVideo)
    val resizable = visual && onResize != null
    val set = width ?: 100
    var live by remember { mutableStateOf<Int?>(null) }
    val shown = live ?: set
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        val line = maxWidth
        // a picture or a video takes the whole width its line gives it; a percentage of the line when made smaller
        val frame = if (visual) Modifier.width(line * (shown.coerceIn(Markdown.FILE_MIN_WIDTH, 100) / 100f)) else Modifier.fillMaxWidth()
        Box(frame) {
            when {
                meta != null -> Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(if (visual) Modifier.weight(1f) else Modifier.weight(1f, fill = false)) { Attachments(listOf(meta), null, null, fill = visual) }
                    // a file that is not a picture keeps its remove button beside it
                    if (!visual && onRemove != null) Box(Modifier.padding(top = 4.dp)) { RemoveButton(name, onRemove, onPicture = false) }
                }
                pending != null -> WaitCard(name, pending, onRetry)
                else -> MissingCard(name)
            }
            if (resizable) {
                Grip(name, start = true, line = line, width = set, onLive = { live = it }) { w -> live = null; if (w != set) onResize(w) }
                Grip(name, start = false, line = line, width = set, onLive = { live = it }) { w -> live = null; if (w != set) onResize(w) }
            }
            live?.let { w ->
                Txt(
                    "$w%",
                    style = Nx.type.label.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(700), fontFeatureSettings = "tnum"),
                    color = Color.White,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp).background(Color(0xD10E0B14), RoundedCornerShape(50)).padding(horizontal = 9.dp, vertical = 3.dp),
                )
            }
            if (visual && (resizable || onRemove != null)) {
                FileBar(name, shown, narrow = line * (shown / 100f) <= 380.dp, onSize = if (resizable) onResize else null, onRemove = onRemove, modifier = Modifier.align(Alignment.TopEnd).padding(8.dp))
            }
        }
    }
}

/** A handle on each side of a picture (.grip), to drag it wider or narrower; the picture is centred, so it grows on both sides. */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.Grip(name: String, start: Boolean, line: androidx.compose.ui.unit.Dp, width: Int, onLive: (Int) -> Unit, onDone: (Int) -> Unit) {
    val density = LocalDensity.current
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    var now by remember { mutableStateOf(width) }
    Box(
        Modifier
            .align(if (start) Alignment.CenterStart else Alignment.CenterEnd)
            .padding(horizontal = 4.dp)
            .size(28.dp, 72.dp)
            .pointerInput(width, line) {
                var start0 = 0f
                var moved = 0f
                detectHorizontalDragGestures(
                    onDragStart = {
                        start0 = with(density) { (line * (width / 100f)).toPx() }
                        moved = 0f
                        now = width
                    },
                    onDragEnd = { onDone(now) },
                    onDragCancel = { onDone(width) },
                ) { change, dx ->
                    change.consume()
                    moved += dx
                    // dragging the end handle outwards widens; the start handle the other way round
                    val sign = if (start != rtl) -2f else 2f
                    val full = with(density) { line.toPx() }.coerceAtLeast(1f)
                    now = ((start0 + sign * moved) / full * 100f).roundToInt().coerceIn(Markdown.FILE_MIN_WIDTH, 100)
                    onLive(now)
                }
            }
            .semantics {
                contentDescription = t("notes.file.width", "name" to name)
                stateDescription = "$width%"
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(12.dp, 56.dp)
                .ring(RoundedCornerShape(5.dp), Color(0x40000000))
                .background(Color.White.copy(alpha = 0.92f * 0.9f), RoundedCornerShape(5.dp)),
        )
    }
}

/** What can be done to a picture (.fileBar): its sizes, and taking it out. Always shown on a touch screen. */
@Composable
private fun FileBar(name: String, shown: Int, narrow: Boolean, onSize: ((Int) -> Unit)?, onRemove: (() -> Unit)?, modifier: Modifier) {
    val shape = RoundedCornerShape(10.dp)
    Row(
        modifier
            .ring(shape, Color.White.copy(alpha = 0.08f))
            .background(Color(0xC70E0B14), shape)
            .padding(3.dp)
            .semantics { contentDescription = t("notes.file.tools", "name" to name) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        if (onSize != null) for ((w, key) in SIZES) {
            val on = shown == w
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            Box(
                Modifier
                    .height(32.dp)
                    .clip(RoundedCornerShape(7.dp))
                    .background(if (on) Nx.colors.brand else if (pressed) Color.White.copy(alpha = 0.12f) else Color.Transparent)
                    .pressable(interaction) { onSize(w) }
                    .padding(horizontal = if (narrow) 7.dp else 9.dp)
                    .semantics {
                        contentDescription = t(key)
                        selected = on
                    },
                contentAlignment = Alignment.Center,
            ) {
                // on a narrow picture the sizes say how wide, which needs no words
                Txt(
                    if (narrow) "$w%" else t(key),
                    style = Nx.type.label.copy(fontSize = Nx.type.sp(if (narrow) 12f else 12.5f), fontWeight = FontWeight(650)),
                    color = if (on) Nx.colors.onBrand else Color.White.copy(alpha = 0.82f),
                    maxLines = 1,
                )
            }
        }
        if (onRemove != null) RemoveButton(name, onRemove, onPicture = true)
    }
}

@Composable
private fun RemoveButton(name: String, onRemove: () -> Unit, onPicture: Boolean) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = RoundedCornerShape(7.dp)
    Box(
        Modifier
            .size(if (onPicture) 34.dp else 40.dp, if (onPicture) 32.dp else 40.dp)
            .then(
                if (onPicture) Modifier.background(if (pressed) dangerGradient(c) else androidx.compose.ui.graphics.SolidColor(Color.Transparent), shape)
                else Modifier.ring(shape, c.borderSubtle).background(if (pressed) dangerGradient(c) else androidx.compose.ui.graphics.SolidColor(c.bgSurface), shape).topEdge(shape, c.edgeLight),
            )
            .clip(shape)
            .pressable(interaction, onClick = onRemove)
            .semantics { contentDescription = t("notes.file.remove", "name" to name) },
        contentAlignment = Alignment.Center,
    ) {
        Icon("Trash2", if (pressed) c.onDanger else if (onPicture) Color.White.copy(alpha = 0.82f) else c.textMuted, size = 15.dp)
    }
}

/** A file going up (.fileWait): its name and how far it has got, or why it did not make it and the way to try again. */
@Composable
private fun WaitCard(name: String, pending: PendingNoteFile, onRetry: (() -> Unit)?) {
    val c = Nx.colors
    val shape = Radii.Md
    val failed = pending.error != null
    Row(
        Modifier
            .widthIn(max = 360.dp)
            .fillMaxWidth()
            .ring(shape, if (failed) c.danger.copy(alpha = 0.45f) else c.borderSubtle)
            .background(c.bgSurface, shape)
            .topEdge(shape, c.edgeLight)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(if (failed) "CircleAlert" else "File", if (failed) c.textDanger else c.textMuted, size = 20.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Txt(name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(600)), color = c.text, maxLines = 1)
            if (pending.error != null) {
                Txt(pending.error, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textDanger)
            } else {
                val percent = (pending.progress * 100).roundToInt()
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(c.bgInput)
                        .semantics {
                            contentDescription = t("notes.file.uploading", "name" to name)
                            progressBarRangeInfo = ProgressBarRangeInfo(pending.progress, 0f..1f)
                        },
                ) {
                    Box(Modifier.fillMaxWidth(maxOf(4, percent) / 100f).height(4.dp).background(c.brand, RoundedCornerShape(2.dp)))
                }
            }
        }
        if (failed && onRetry != null) {
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            Box(
                Modifier
                    .size(40.dp)
                    .clip(Radii.Sm)
                    .background(if (pressed) c.bgHover else Color.Transparent)
                    .pressable(interaction, onClick = onRetry)
                    .semantics { contentDescription = t("notes.file.retry", "name" to name) },
                contentAlignment = Alignment.Center,
            ) { Icon("RotateCw", if (pressed) c.textStrong else c.textSubtle, size = 16.dp) }
        }
    }
}

/** A file the note names but nobody has the file for (someone else's still on its way, or one that never made it up). */
@Composable
private fun MissingCard(name: String) {
    val c = Nx.colors
    val shape = Radii.Md
    Row(
        Modifier
            .widthIn(max = 360.dp)
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .ring(shape, c.borderSubtle)
            .background(c.bgSurface, shape)
            .topEdge(shape, c.edgeLight)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon("File", c.textMuted, size = 20.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Txt(name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(600)), color = c.text, maxLines = 1)
            Txt(t("notes.file.notHere"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted)
        }
    }
}
