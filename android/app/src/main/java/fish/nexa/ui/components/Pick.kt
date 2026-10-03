package fish.nexa.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import fish.nexa.ui.Icon
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.boxShadow
import fish.nexa.ui.theme.brandGradient
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowHigh
import fish.nexa.ui.theme.topEdge

/**
 * stores/pick.ts: picking several things in one list at a time (servers,
 * conversations, friends, a server's members). On a phone it starts from a
 * row's "Select"; while it lasts, a tap picks or unpicks instead of opening.
 * Starting a pick in another list ends this one.
 */
object Pick {
    /** "servers", "dms", "friends" or "members:<server or group id>". */
    var list by mutableStateOf<String?>(null)
        private set
    val ids = mutableStateListOf<String>()
    /** Tap mode: picking lasts with nothing picked ("Tap to select") until Done. */
    var mode by mutableStateOf(false)
        private set

    fun picking(l: String) = list == l && (mode || ids.isNotEmpty())

    fun isPicked(l: String, id: String) = list == l && id in ids

    fun start(l: String, first: String? = null) {
        list = l
        ids.clear()
        if (first != null) ids += first
        mode = true
    }

    fun toggle(l: String, id: String) {
        if (list != l) {
            list = l
            ids.clear()
            mode = false
        }
        if (id in ids) ids.remove(id) else ids += id
        if (ids.isEmpty() && !mode) clear()
    }

    fun set(l: String, next: List<String>) {
        if (list != l) mode = false
        list = l
        ids.clear()
        ids.addAll(next.distinct())
    }

    /** Things that left the list (closed, left, unfriended) leave the pick. */
    fun drop(gone: Collection<String>) {
        if (ids.none { it in gone }) return
        ids.removeAll { it in gone }
        if (ids.isEmpty() && !mode) clear()
    }

    fun clear() {
        list = null
        ids.clear()
        mode = false
    }
}

/**
 * PickMark: the circle in front of a row while picking; filled with the
 * accent, a tick in it, when picked.
 */
@Composable
fun PickMark(on: Boolean, label: String, modifier: Modifier = Modifier, size: Dp = 20.dp) {
    val c = Nx.colors
    val scale by animateFloatAsState(if (on && !Nx.motion.reduced) 1.04f else 1f, tween(160, easing = Nx.motion.spring), label = "pick")
    Box(
        modifier
            .size(size)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .then(
                if (on) Modifier
                    .boxShadow(CircleShape, 2f, 10f, c.brand.copy(alpha = 0.7f), spread = -2f)
                    .ring(CircleShape, c.brand.copy(alpha = 0.6f))
                    .background(brandGradient(c), CircleShape)
                    .topEdge(CircleShape, Color.White.copy(alpha = 0.28f))
                else Modifier
                    .background(c.bgInput, CircleShape)
                    .ring(CircleShape, c.borderStrong, 1.5.dp),
            )
            .semantics {
                role = Role.Checkbox
                contentDescription = label
                toggleableState = ToggleableState(on)
            },
        contentAlignment = Alignment.Center,
    ) {
        if (on) Icon("Check", c.onBrand, size = 13.dp, stroke = 3.5f)
    }
}

/** One action in a pick bar: an icon that says what it does, for everyone picked. */
data class PickAction(val icon: String, val label: String, val danger: Boolean = false, val enabled: Boolean = true, val onClick: () -> Unit)

/**
 * Pick.tsx PickBar: floats at the foot of the list while picking. The count
 * (or "Tap to select") and Done, then the actions, all off while nothing is
 * picked.
 */
@Composable
fun PickBar(label: String, actions: List<PickAction>, modifier: Modifier = Modifier) {
    val c = Nx.colors
    val count = Pick.ids.size
    val reduced = Nx.motion.reduced
    val enter = remember { Animatable(if (reduced) 1f else 0f) }
    val ease = Nx.motion.easeOut
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(200, easing = ease)) }
    val shape = Radii.Md
    Column(
        modifier
            .padding(horizontal = 8.dp, vertical = 6.dp)
            .widthIn(max = 420.dp)
            .fillMaxWidth()
            .graphicsLayer {
                alpha = enter.value
                translationY = (1f - enter.value) * 8f * density
            }
            .shadowHigh(shape, c)
            .ring(shape, c.panelEdge)
            .background(c.bgFloating, shape)
            .topEdge(shape, c.edgeLight)
            .padding(6.dp)
            .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(
                if (count == 0) t("pick.tapToPick") else t("pick.count", "count" to count),
                style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), fontWeight = FontWeight(650)),
                color = c.textStrong,
                maxLines = 1,
                modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
            )
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            Row(
                Modifier
                    .height(36.dp)
                    .clip(Radii.Sm)
                    .background(if (pressed) c.bgHover else Color.Transparent)
                    .pressable(interaction) { Pick.clear() }
                    .padding(start = 10.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon("X", c.textMuted, size = 15.dp)
                Txt(t("pick.done"), style = Nx.type.label.copy(fontWeight = FontWeight(600)), color = c.textMuted)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            for (a in actions) PickButton(a, enabled = a.enabled && count > 0)
        }
    }
}

@Composable
private fun RowScope.PickButton(a: PickAction, enabled: Boolean) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .weight(1f)
            .heightIn(min = 42.dp)
            .clip(Radii.Sm)
            .background(if (pressed && enabled) c.bgHover else Color.Transparent)
            .alpha(if (enabled) 1f else 0.45f)
            .pressable(interaction, enabled = enabled, onClick = a.onClick)
            .semantics { contentDescription = a.label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(a.icon, if (a.danger) c.textDanger else c.icon, size = 18.dp)
    }
}
