package fish.nexa.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import fish.nexa.media.Media
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.ring
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** lib/avatarColor.ts: one of six colours, by the id's hash. */
object AvatarColor {
    private val PALETTE = listOf(0x5865f2, 0x3d9e60, 0xfdb833, 0xda3e44, 0xeb459f, 0x8b5cf6)

    fun of(id: String): Color {
        var h = 0L
        for (ch in id) h = (h * 31 + ch.code) and 0xffffffffL
        return Color(0xFF000000L or PALETTE[(h % PALETTE.size).toInt()].toLong())
    }

    /** The first grapheme, upper-cased ("?" when empty). */
    fun initials(name: String): String {
        val t = name.trim()
        if (t.isEmpty()) return "?"
        val bi = android.icu.text.BreakIterator.getCharacterInstance()
        bi.setText(t)
        val end = bi.next()
        val first = t.substring(0, if (end > 0) end else 1)
        val upper = first.uppercase()
        return if (upper.length == first.length) upper else first
    }
}

/** Dot and cut ring for an avatar size (Avatar.tsx). */
private fun dotFor(size: Float): Pair<Float, Float> {
    val dot = max(8f, min(size * 0.3125f, 10f + (size - 32f) * 0.125f)).roundToInt().toFloat()
    val ring = max(2f, (dot * 0.3f).roundToInt().toFloat())
    return dot to ring
}

/**
 * A circle with someone's picture or their initial on their colour, and,
 * when asked, their presence dot floating in a gap cut out of it.
 */
@Composable
fun Avatar(
    id: String,
    name: String,
    avatarId: String?,
    size: Dp,
    modifier: Modifier = Modifier,
    status: String? = null,
    dot: Dp? = null,
    icon: Boolean = false,
    shape: Shape = CircleShape,
    speaking: Boolean = false,
) {
    val c = Nx.colors
    val density = LocalDensity.current
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val px = size.value
    val (dotDp, ringDp) = dot?.let { it.value to max(2f, (it.value * 0.3f).roundToInt().toFloat()) } ?: dotFor(px)
    val url = remember(avatarId, size, density.density, icon) {
        if (icon) Media.iconUrl(avatarId, px.toInt(), density.density) else Media.avatarUrl(avatarId, px.toInt(), density.density)
    }
    val statusColor = status?.let { c.statusColor(it) }
    Box(
        modifier
            .size(size)
            .then(if (speaking) Modifier.ring(shape, c.positive, 2.dp) else Modifier)
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
            .drawWithContent {
                drawContent()
                if (statusColor != null) {
                    val d = dotDp * density.density
                    val r = ringDp * density.density
                    val center = Offset(if (rtl) d / 2 else this.size.width - d / 2, this.size.height - d / 2)
                    drawCircle(Color.Black, radius = d / 2 + r, center = center, blendMode = BlendMode.Clear)
                    drawPresence(status ?: "offline", statusColor, center, d)
                }
            },
    ) {
        if (url != null) {
            AsyncImage(
                model = url,
                imageLoader = Media.loader,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().clip(shape).background(c.bgSurface),
            )
        } else {
            val bg = AvatarColor.of(id)
            Box(
                Modifier
                    .fillMaxSize()
                    .clip(shape)
                    .background(bg)
                    .background(Brush.verticalGradient(0f to Color.White.copy(alpha = 0.10f), 0.12f to Color.Transparent, 0.7f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.22f))),
                contentAlignment = Alignment.Center,
            ) {
                BasicText(
                    AvatarColor.initials(name),
                    style = TextStyle(
                        fontFamily = Nx.type.display,
                        fontWeight = FontWeight(660),
                        fontSize = (max(10f, px * 0.42f) / density.fontScale).sp,
                        color = Color.White,
                        textAlign = TextAlign.Center,
                        shadow = androidx.compose.ui.graphics.Shadow(Color.Black.copy(alpha = 0.2f), Offset(0f, 1f * density.density), 2f * density.density),
                    ),
                )
            }
        }
    }
}

/** online: a dot; idle: a crescent; dnd: a dot with a bar cut out; offline: a ring (Avatar.module.css masks). */
fun DrawScope.drawPresence(status: String, color: Color, center: Offset, d: Float) {
    val r = d / 2
    when (status) {
        "online" -> drawCircle(color, r, center)
        "idle" -> {
            drawCircle(color, r, center)
            val holeR = d * 0.375f
            drawCircle(Color.Black, holeR, Offset(center.x - r + d * 0.25f, center.y - r + d * 0.25f), blendMode = BlendMode.Clear)
        }
        "dnd" -> {
            drawCircle(color, r, center)
            drawRect(Color.Black, Offset(center.x - r + d * 0.25f, center.y - d * 0.125f), Size(d * 0.5f, d * 0.25f), blendMode = BlendMode.Clear)
        }
        else -> drawCircle(color, r * 0.75f, center, style = Stroke(width = r * 0.5f))
    }
}

/** A presence dot on its own (status pickers, member rows' word). */
@Composable
fun PresenceDot(status: String, size: Dp, modifier: Modifier = Modifier) {
    val color = Nx.colors.statusColor(status)
    Canvas(modifier.size(size).graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }) {
        drawPresence(status, color, center, this.size.minDimension)
    }
}

/** A server's or group's icon: its picture, or its initial on the surface. Square-ish tiles round to 16. */
@Composable
fun ServerIcon(id: String, name: String, iconId: String?, size: Dp, modifier: Modifier = Modifier, radius: Dp = 16.dp) {
    Avatar(id, name, iconId, size, modifier, icon = true, shape = RoundedCornerShape(radius))
}
