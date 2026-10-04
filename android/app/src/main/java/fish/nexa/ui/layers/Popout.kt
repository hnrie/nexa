package fish.nexa.ui.layers

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import fish.nexa.ui.components.pressable
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowHigh
import fish.nexa.ui.theme.topEdge
import androidx.compose.foundation.background
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Popout.tsx: a small card held to the thing that opened it, above it when
 * there is room and below when not, kept 4 dp inside the screen. Used where
 * the web keeps a card even on phones (who reacted, a sticker's pack, an
 * emoji's details, the typing style card). A tap elsewhere or Back closes it.
 */
fun openPopout(key: String, anchor: Rect, width: Dp, content: @Composable (close: () -> Unit) -> Unit) {
    lateinit var layer: Layer
    layer = Layer(key) { close -> PopoutCard(layer, anchor, width, close, content) }
    Layers.open(layer)
}

@Composable
private fun PopoutCard(layer: Layer, anchor: Rect, width: Dp, close: () -> Unit, content: @Composable (close: () -> Unit) -> Unit) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    val reduced = Nx.motion.reduced
    val ease = Nx.motion.easeOut
    val enter = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(120, easing = ease)) }
    layer.dismiss = {
        scope.launch {
            if (!reduced) enter.animateTo(0f, tween(90, easing = ease))
            Layers.remove(layer)
        }
    }
    var size by remember { mutableStateOf(IntSize.Zero) }
    var origin by remember { mutableStateOf(androidx.compose.ui.geometry.Offset.Zero) }
    val density = LocalDensity.current
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .onGloballyPositioned { origin = it.positionInWindow() }
            .pressable(remember { MutableInteractionSource() }) { close() },
    ) {
        val screenW = constraints.maxWidth
        val screenH = constraints.maxHeight
        val margin = with(density) { 4.dp.roundToPx() }
        val gap = with(density) { 6.dp.roundToPx() }
        val top = (anchor.top - origin.y).roundToInt()
        val bottom = (anchor.bottom - origin.y).roundToInt()
        val above = top - gap - size.height >= margin + with(density) { 24.dp.roundToPx() }
        val y = if (above) top - gap - size.height else minOf(bottom + gap, screenH - size.height - margin)
        val x = (anchor.left - origin.x).roundToInt().coerceIn(margin, maxOf(margin, screenW - size.width - margin))
        // the web's popout: medium corners, and nothing inside drawn past them (a banner across its top)
        val shape = Radii.Md
        Box(
            Modifier
                .offset { IntOffset(x, y) }
                .widthIn(max = width)
                .onSizeChanged { size = it }
                .graphicsLayer {
                    val p = enter.value
                    alpha = if (size == IntSize.Zero) 0f else p
                    translationY = (1f - p) * (if (above) 4f else -4f) * density.density
                    val s = 0.97f + 0.03f * p
                    scaleX = s; scaleY = s
                }
                .shadowHigh(shape, c)
                .ring(shape, c.borderSubtle)
                .background(c.bgFloating, shape)
                .topEdge(shape, c.edgeLight)
                .clip(shape)
                // taps inside the card stay inside it
                .pressable(remember { MutableInteractionSource() }) {},
        ) {
            content(close)
        }
    }
}

/** Remembers where a thing is on screen, for a popout to hold to. */
class AnchorRef {
    var rect: Rect = Rect.Zero
}

fun Modifier.anchor(ref: AnchorRef): Modifier = this.onGloballyPositioned { coords ->
    val p = coords.positionInWindow()
    ref.rect = Rect(p.x, p.y, p.x + coords.size.width, p.y + coords.size.height)
}
