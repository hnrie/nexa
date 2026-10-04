package fish.nexa.ui.server

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.rgbColor

/** `#rrggbb` for a 0xRRGGBB colour. */
fun hexOf(v: Long): String = "#" + (v and 0xFFFFFF).toString(16).padStart(6, '0')

/** A colour typed as `#rgb` or `#rrggbb` (the # optional), or null. */
fun parseHex(s: String): Long? {
    val h = s.trim().removePrefix("#")
    return when {
        h.length == 6 && h.all { it.isLetterOrDigit() } -> h.toLongOrNull(16)
        h.length == 3 && h.all { it.isLetterOrDigit() } -> h.map { "$it$it" }.joinToString("").toLongOrNull(16)
        else -> null
    }
}

/**
 * The colour well's picker (`<input type="color">`): brightness and
 * saturation in a square, the hue on a strip under it, the hex code to type.
 */
fun openColourPick(title: String, start: Long, onPick: (Long) -> Unit) {
    lateinit var layer: Layer
    layer = Layer("colourPick") { close -> ColourSheet(layer, title, start, onPick, close) }
    Layers.open(layer)
}

@Composable
private fun ColourSheet(layer: Layer, title: String, start: Long, onPick: (Long) -> Unit, close: () -> Unit) {
    val c = Nx.colors
    val hsv0 = remember {
        FloatArray(3).also { android.graphics.Color.colorToHSV((0xFF000000L or (start and 0xFFFFFF)).toInt(), it) }
    }
    var hue by remember { mutableFloatStateOf(hsv0[0]) }
    var sat by remember { mutableFloatStateOf(hsv0[1]) }
    var value by remember { mutableFloatStateOf(hsv0[2]) }
    fun current(): Long = (android.graphics.Color.HSVToColor(floatArrayOf(hue, sat, value)).toLong() and 0xFFFFFF)
    var hex by remember { mutableStateOf(hexOf(start)) }
    fun fromHsv() {
        hex = hexOf(current())
    }
    Sheet(
        layer,
        title = title,
        maxWidth = 420.dp,
        footer = {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                NxButton(t("chat.editMessage.cancel"), close, kind = ButtonKind.GHOST)
                NxButton(t("common.imageCrop.apply"), {
                    close()
                    onPick(parseHex(hex) ?: current())
                })
            }
        },
    ) {
        // saturation across, brightness down
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1.6f)
                .clip(Radii.Sm)
                .pointerInput(Unit) {
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        NoSwipe.active = true
                        fun at(p: Offset) {
                            sat = (p.x / size.width).coerceIn(0f, 1f)
                            value = 1f - (p.y / size.height).coerceIn(0f, 1f)
                            fromHsv()
                        }
                        at(down.position)
                        while (true) {
                            val ev = awaitPointerEvent()
                            val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                            if (!ch.pressed) break
                            ch.consume()
                            at(ch.position)
                        }
                        NoSwipe.active = false
                    }
                }
                .semantics { contentDescription = title },
        ) {
            Canvas(Modifier.fillMaxWidth().aspectRatio(1.6f)) {
                val pure = Color(android.graphics.Color.HSVToColor(floatArrayOf(hue, 1f, 1f)))
                drawRect(Brush.horizontalGradient(listOf(Color.White, pure)))
                drawRect(Brush.verticalGradient(listOf(Color.Transparent, Color.Black)))
                val p = Offset(sat * size.width, (1f - value) * size.height)
                drawCircle(Color.White, radius = 9.dp.toPx(), center = p, style = Stroke(2.5.dp.toPx()))
                drawCircle(Color.Black.copy(alpha = 0.35f), radius = 11.dp.toPx(), center = p, style = Stroke(1.dp.toPx()))
            }
        }
        // the hue strip
        Box(
            Modifier
                .fillMaxWidth()
                .height(28.dp)
                .clip(Radii.Pill)
                .pointerInput(Unit) {
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        NoSwipe.active = true
                        fun at(p: Offset) {
                            hue = (p.x / size.width).coerceIn(0f, 1f) * 360f
                            fromHsv()
                        }
                        at(down.position)
                        while (true) {
                            val ev = awaitPointerEvent()
                            val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                            if (!ch.pressed) break
                            ch.consume()
                            at(ch.position)
                        }
                        NoSwipe.active = false
                    }
                },
        ) {
            Canvas(Modifier.fillMaxWidth().height(28.dp)) {
                drawRect(Brush.horizontalGradient((0..6).map { Color(android.graphics.Color.HSVToColor(floatArrayOf(it * 60f, 1f, 1f))) }))
                val x = hue / 360f * size.width
                drawCircle(Color.White, radius = 10.dp.toPx(), center = Offset(x.coerceIn(10.dp.toPx(), size.width - 10.dp.toPx()), size.height / 2), style = Stroke(2.5.dp.toPx()))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(44.dp).background(rgbColor(parseHex(hex) ?: current()), CircleShape).border(1.dp, c.borderStrong, CircleShape))
            Column(Modifier.weight(1f)) {
                NxTextField(hex, { v ->
                    hex = v.take(7)
                    parseHex(v)?.let { col ->
                        val hsv = FloatArray(3)
                        android.graphics.Color.colorToHSV((0xFF000000L or col).toInt(), hsv)
                        hue = hsv[0]
                        sat = hsv[1]
                        value = hsv[2]
                    }
                }, mono = true, error = if (parseHex(hex) == null) t("composer.format.colourHexInvalid") else null)
            }
        }
    }
}
