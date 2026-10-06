package fish.nexa.ui.settings

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.look.Colour
import fish.nexa.ui.theme.look.Looks
import fish.nexa.ui.theme.ring

/** Hue (0–360), saturation and value (0–1). */
private data class Hsv(val h: Float, val s: Float, val v: Float)

private fun hsvOf(hex: String): Hsv {
    val rgb = Colour.parseColour(hex)?.rgb ?: return Hsv(0f, 0f, 0f)
    val r = (rgb.r / 255).toFloat()
    val g = (rgb.g / 255).toFloat()
    val b = (rgb.b / 255).toFloat()
    val max = maxOf(r, g, b)
    val d = max - minOf(r, g, b)
    val h = when {
        d == 0f -> 0f
        max == r -> 60f * (((g - b) / d) % 6f)
        max == g -> 60f * ((b - r) / d + 2f)
        else -> 60f * ((r - g) / d + 4f)
    }.let { if (it < 0) it + 360f else it }
    return Hsv(h, if (max == 0f) 0f else d / max, max)
}

private fun rgbOf(c: Hsv): Colour.Rgb {
    val f = { n: Float ->
        val k = (n + c.h / 60f) % 6f
        c.v - c.v * c.s * maxOf(0f, minOf(k, 4f - k, 1f))
    }
    return Colour.Rgb(f(5f) * 255.0, f(3f) * 255.0, f(1f) * 255.0)
}

/** Light and dark squares behind a see-through colour. */
private fun DrawScope.checkerboard(cell: Float, a: Color, b: Color) {
    drawRect(a)
    var y = 0f
    var row = 0
    while (y < size.height) {
        var x = if (row % 2 == 0) 0f else cell
        while (x < size.width) {
            drawRect(b, Offset(x, y), Size(cell, cell))
            x += cell * 2
        }
        y += cell
        row++
    }
}

/**
 * The app's own colour picker, where the web has the system's: a square of
 * shades, a strip of hues, opacity for a see-through colour, and the hex code
 * to type. Every move is handed over as it happens, as the web's picker does.
 */
fun openColourPicker(name: String, value: String, alpha: Boolean, onChange: (String) -> Unit) {
    val start = Colour.parseColour(value)
    var hsv by mutableStateOf(hsvOf(start?.let { Colour.toHex(it.rgb) } ?: "#000000"))
    var opacity by mutableFloatStateOf(if (alpha) (start?.alpha ?: 1.0).toFloat() else 1f)
    fun current() = Colour.toThemeHex(rgbOf(hsv), if (alpha) opacity.toDouble() else 1.0)
    fun push() = onChange(current())
    openSettingsSheet("colour-picker", SheetCtl(t("settings.themeBuilder.pick", "name" to name))) { sheet ->
        val c = Nx.colors
        val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
        val pure = Looks.color(Colour.toHex(rgbOf(Hsv(hsv.h, 1f, 1f))))
        // the square: saturation across, brightness down
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1.6f)
                .ring(Radii.Md, c.borderSubtle)
                .clip(Radii.Md)
                .semantics { contentDescription = t("android.look.shade") }
                .pointerInput(Unit) {
                    fun at(p: Offset) {
                        val x = (p.x / size.width).coerceIn(0f, 1f)
                        val y = (p.y / size.height).coerceIn(0f, 1f)
                        hsv = hsv.copy(s = if (rtl) 1f - x else x, v = 1f - y)
                        push()
                    }
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        at(down.position)
                        while (true) {
                            val ev = awaitPointerEvent()
                            val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                            if (!ch.pressed) break
                            ch.consume()
                            at(ch.position)
                        }
                    }
                },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                drawRect(pure)
                drawRect(Brush.horizontalGradient(if (rtl) listOf(Color.Transparent, Color.White) else listOf(Color.White, Color.Transparent)))
                drawRect(Brush.verticalGradient(listOf(Color.Transparent, Color.Black)))
                val x = (if (rtl) 1f - hsv.s else hsv.s) * size.width
                val y = (1f - hsv.v) * size.height
                drawCircle(Color.Black.copy(alpha = 0.35f), radius = 13.dp.toPx(), center = Offset(x, y + 1.dp.toPx()))
                drawCircle(Color.White, radius = 12.dp.toPx(), center = Offset(x, y), style = Stroke(3.dp.toPx()))
            }
        }
        Strip(t("android.look.hue"), hsv.h / 360f, "${hsv.h.toInt()}°", { f ->
            hsv = hsv.copy(h = f * 360f)
            push()
        }) {
            drawRect(Brush.horizontalGradient((0..6).map { Looks.color(Colour.toHex(rgbOf(Hsv(it * 60f % 360f, 1f, 1f)))) }.let { if (rtl) it.reversed() else it }))
        }
        if (alpha) {
            val solid = Looks.color(Colour.toHex(rgbOf(hsv)))
            Strip(t("settings.themeBuilder.opacityOf", "name" to name), opacity, "${(opacity * 100).toInt()}%", { f ->
                opacity = (Math.round(f * 100) / 100f)
                push()
            }) {
                checkerboard(7.dp.toPx(), c.bgSurface, c.bgActive)
                drawRect(Brush.horizontalGradient(if (rtl) listOf(solid, solid.copy(alpha = 0f)) else listOf(solid.copy(alpha = 0f), solid)))
            }
            Txt(t("settings.themeBuilder.opacity", "value" to (opacity * 100).toInt()), style = Nx.type.hint, color = c.textMuted)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(48.dp).ring(Radii.Sm, c.borderSubtle).clip(Radii.Sm)) {
                Canvas(Modifier.fillMaxSize()) {
                    checkerboard(6.dp.toPx(), c.bgSurface, c.bgActive)
                    drawRect(Looks.color(current()))
                }
            }
            var text by remember { mutableStateOf(current()) }
            var bad by remember { mutableStateOf(false) }
            // a value changed from the square or the strips shows here too
            val shown = current()
            LaunchedEffect(shown) {
                text = shown
                bad = false
            }
            fun commit(raw: String) {
                val p = Colour.parseColour(raw)
                if (p == null) {
                    bad = raw.isNotBlank()
                    return
                }
                bad = false
                hsv = hsvOf(Colour.toHex(p.rgb))
                if (alpha) opacity = p.alpha.toFloat()
                push()
            }
            NxTextField(
                text,
                {
                    text = it
                    if (Regex("^#?([0-9a-f]{6}|[0-9a-f]{8})$", RegexOption.IGNORE_CASE).matches(it.trim())) commit(it)
                },
                modifier = Modifier.weight(1f),
                label = t("settings.themeBuilder.hexFor", "name" to name),
                error = if (bad) "" else null,
                mono = true,
                imeAction = ImeAction.Done,
                onIme = { commit(text) },
            )
        }
        NxButton(t("modals.serverNotifications.done"), { sheet.close() }, size = ButtonSize.LG, block = true)
    }
}

/** A strip to drag along (hue, opacity), drawn by [paint], with a ring for where it is. */
@Composable
private fun Strip(label: String, fraction: Float, valueText: String, onChange: (Float) -> Unit, paint: DrawScope.() -> Unit) {
    val c = Nx.colors
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val shape = RoundedCornerShape(50)
    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            .height(48.dp)
            .semantics {
                contentDescription = label
                stateDescription = valueText
            }
            .pointerInput(rtl) {
                fun at(p: Offset) {
                    val f = (p.x / size.width).coerceIn(0f, 1f)
                    onChange(if (rtl) 1f - f else f)
                }
                awaitEachGesture {
                    val down = awaitFirstDown()
                    at(down.position)
                    while (true) {
                        val ev = awaitPointerEvent()
                        val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                        if (!ch.pressed) break
                        ch.consume()
                        at(ch.position)
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.fillMaxWidth().height(28.dp).ring(shape, c.borderSubtle).clip(shape)) {
            Canvas(Modifier.fillMaxSize()) { paint() }
        }
        Canvas(Modifier.fillMaxSize()) {
            val f = if (rtl) 1f - fraction else fraction
            val r = 13.dp.toPx()
            val x = r + f * (size.width - 2 * r)
            drawCircle(Color.Black.copy(alpha = 0.35f), radius = r + 1.dp.toPx(), center = Offset(x, size.height / 2 + 1.dp.toPx()))
            drawCircle(Color.White, radius = r, center = Offset(x, size.height / 2), style = Stroke(3.dp.toPx()))
        }
    }
}
