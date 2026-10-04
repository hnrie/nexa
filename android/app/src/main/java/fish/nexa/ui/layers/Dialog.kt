package fish.nexa.ui.layers

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowHigh
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.launch

/**
 * Modal.tsx's centred form, for the few dialogs the web keeps centred even on
 * a phone (What's New, the update prompt): the card pops up out of the dimmed
 * page, title at the top, the body scrolling, and a footer shelf a step below.
 */
fun openDialog(
    key: String,
    title: String,
    width: Dp = 560.dp,
    dismissible: Boolean = true,
    onClosed: (() -> Unit)? = null,
    footer: (@Composable (close: () -> Unit) -> Unit)? = null,
    content: @Composable ColumnScope.(close: () -> Unit) -> Unit,
) {
    lateinit var layer: Layer
    layer = Layer(key, canClose = { dismissible }) { close -> CenterDialog(layer, title, width, dismissible, onClosed, footer, content, close) }
    Layers.open(layer)
}

@Composable
private fun CenterDialog(
    layer: Layer,
    title: String,
    width: Dp,
    dismissible: Boolean,
    onClosed: (() -> Unit)?,
    footer: (@Composable (close: () -> Unit) -> Unit)?,
    content: @Composable ColumnScope.(close: () -> Unit) -> Unit,
    close: () -> Unit,
) {
    val c = Nx.colors
    val reduced = Nx.motion.reduced
    val ease = Nx.motion.easeOut
    val scope = rememberCoroutineScope()
    val shown = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) { shown.animateTo(1f, tween(240, easing = ease)) }
    layer.dismiss = {
        scope.launch {
            if (!reduced) shown.animateTo(0f, tween(160, easing = ease))
            Layers.remove(layer)
            onClosed?.invoke()
        }
    }
    val shape = Radii.Lg
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .graphicsLayer { alpha = shown.value.coerceIn(0f, 1f) }
            .background(c.bgOverlay)
            .pressable(remember { MutableInteractionSource() }) { if (dismissible) close() }
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(16.dp),
        contentAlignment = Alignment.Center,
    ) {
        val maxH = maxHeight
        Column(
            Modifier
                .widthIn(max = width)
                .fillMaxWidth()
                .heightIn(max = maxH)
                .graphicsLayer {
                    val p = shown.value
                    translationY = (1f - p) * 10f * density
                    val s = 0.97f + 0.03f * p
                    scaleX = s; scaleY = s
                }
                .shadowHigh(shape, c)
                .ring(shape, c.panelEdge)
                .background(c.bgFloating, shape)
                .topEdge(shape, c.edgeLight)
                // the footer's own tint keeps to the card's rounded corners
                .clip(shape)
                // taps on the card stay on the card
                .pressable(remember { MutableInteractionSource() }) {},
        ) {
            Txt(
                title,
                style = Nx.type.sheetTitle.copy(fontSize = Nx.type.sp(21f), fontWeight = androidx.compose.ui.text.font.FontWeight(680)),
                color = c.textStrong,
                modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp).semantics { heading() },
            )
            Column(
                Modifier
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
            ) { content(close) }
            if (footer != null) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(mixOklab(c.bgFloating, c.bgBase, 0.55f))
                        .topEdge(androidx.compose.ui.graphics.RectangleShape, c.borderSubtle)
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                ) { footer(close) }
            }
        }
    }
}
