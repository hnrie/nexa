package fish.nexa.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowLow
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.sunken
import fish.nexa.ui.theme.topEdge

/**
 * The sunken strip of tabs (Friends, profile sections): each tab as wide as
 * its words at least, the strip's spare width shared out between them
 * (`flex: 1 0 auto`), sliding sideways only when they cannot all fit.
 */
@Composable
fun <T> TabStrip(
    tabs: List<Pair<T, String>>,
    selected: T,
    label: String,
    modifier: Modifier = Modifier,
    tabHeight: Dp = 38.dp,
    /** A number beside a tab's name (the Mutuals tab's count). */
    count: (T) -> Int? = { null },
    onSelect: (T) -> Unit,
) {
    val c = Nx.colors
    val stripShape = RoundedCornerShape(12.dp)
    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .sunken(stripShape, c)
            .ring(stripShape, c.borderSubtle)
            .semantics { contentDescription = label },
    ) {
        val inner = maxWidth - 6.dp
        val narrow = maxWidth < 420.dp
        Box(Modifier.sidewaysScroll().padding(3.dp)) {
            ShareRow(inner, gap = 2.dp) {
                for ((key, text) in tabs) StripTab(text, key == selected, tabHeight, if (narrow) 8.dp else 12.dp, count(key)) { onSelect(key) }
            }
        }
    }
}

/** Lays children out at their own widths, then grows each by an equal share of what is left of [fill]. */
@Composable
private fun ShareRow(fill: Dp, gap: Dp, content: @Composable () -> Unit) {
    Layout(content) { measurables, constraints ->
        val gapPx = gap.roundToPx()
        val natural = measurables.map { it.maxIntrinsicWidth(constraints.maxHeight) }
        val used = natural.sum() + gapPx * (measurables.size - 1).coerceAtLeast(0)
        val spare = (fill.roundToPx() - used).coerceAtLeast(0)
        val share = if (measurables.isEmpty()) 0 else spare / measurables.size
        val placeables = measurables.mapIndexed { i, m ->
            val w = natural[i] + share
            m.measure(Constraints.fixedWidth(w).copy(minHeight = 0, maxHeight = constraints.maxHeight))
        }
        val height = placeables.maxOfOrNull { it.height } ?: 0
        val width = placeables.sumOf { it.width } + gapPx * (placeables.size - 1).coerceAtLeast(0)
        layout(width, height) {
            var x = 0
            for (p in placeables) {
                p.placeRelative(x, 0)
                x += p.width + gapPx
            }
        }
    }
}

@Composable
private fun StripTab(text: String, on: Boolean, height: Dp, pad: Dp, count: Int?, onClick: () -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(9.dp)
    Box(
        Modifier
            .height(height)
            .then(if (on) Modifier.shadowLow(shape, c).ring(shape, c.borderSubtle).background(c.bgSurface, shape).background(sheen(c), shape).topEdge(shape, c.edgeLight) else Modifier)
            .clip(shape)
            .pressable(remember { MutableInteractionSource() }, role = Role.Tab, onClick = onClick)
            .semantics { selected = on }
            .padding(horizontal = pad),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Txt(text, style = Nx.type.button.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(600)), color = if (on) c.textStrong else c.textMuted, maxLines = 1)
            if (count != null) Box(
                Modifier.heightIn(min = 18.dp).widthIn(min = 18.dp).background(c.bgActive, RoundedCornerShape(9.dp)).padding(horizontal = 5.dp),
                contentAlignment = Alignment.Center,
            ) {
                Txt(java.text.NumberFormat.getIntegerInstance(fish.nexa.ui.I18n.locale).format(count), style = Nx.type.hint.copy(fontSize = Nx.type.sp(11.5f), fontWeight = FontWeight(700), fontFeatureSettings = "tnum"), color = c.textSubtle, maxLines = 1)
            }
        }
    }
}
