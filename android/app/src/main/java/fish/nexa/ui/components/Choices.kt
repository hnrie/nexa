package fish.nexa.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.brandGradient
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sunken
import fish.nexa.ui.theme.topEdge

/** Toggle.tsx: the words (and what they mean) beside a switch, the whole row its target, a rule under it. */
@Composable
fun ToggleRow(checked: Boolean, onChange: (Boolean) -> Unit, label: String, description: String? = null, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val c = Nx.colors
    Row(
        modifier
            .fillMaxWidth()
            .alpha(if (enabled) 1f else 0.5f)
            .pressable(remember { MutableInteractionSource() }, enabled = enabled, role = Role.Switch) { onChange(!checked) }
            .drawBehind { drawRect(c.borderSubtle, androidx.compose.ui.geometry.Offset(0f, size.height - 1.dp.toPx()), androidx.compose.ui.geometry.Size(size.width, 1.dp.toPx())) }
            .padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Txt(label, style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(550)), color = c.text)
            if (description != null) Txt(description, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(18.9f)), color = c.textMuted)
        }
        NxToggle(checked, onChange, enabled = enabled, label = label)
    }
}

/** One of a few big choices (ServerModals.module.css .type and .radio): a card with its words, lit in the accent when chosen. */
@Composable
fun ChoiceCard(on: Boolean, label: String, description: String?, icon: String? = null, radioFirst: Boolean = false, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = Radii.Md
    val radio = @Composable {
        Box(
            Modifier
                .size(18.dp)
                .then(
                    if (on) Modifier.background(brandGradient(c), CircleShape).topEdge(CircleShape, Color.White.copy(alpha = 0.28f))
                    else Modifier.ring(CircleShape, c.borderStrong, 1.5.dp),
                ),
            contentAlignment = Alignment.Center,
        ) { if (on) Box(Modifier.size(7.dp).background(c.onBrand, CircleShape)) }
    }
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .then(if (on) Modifier.ring(shape, c.brand.copy(alpha = 0.8f), 2.dp) else Modifier.ring(shape, if (pressed) c.borderStrong else c.borderSubtle))
            .background(if (on) fish.nexa.ui.theme.mixSrgb(c.bgFloating, c.brand, 0.12f) else fish.nexa.ui.theme.mixOklab(c.bgFloating, c.bgBase, 0.6f), shape)
            .clip(shape)
            .pressable(interaction, role = Role.RadioButton, onClick = onClick)
            .semantics { selected = on }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (radioFirst) radio()
        if (icon != null) fish.nexa.ui.Icon(icon, if (on) c.textBrand else c.textMuted, size = 22.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Txt(label, style = Nx.type.body.copy(fontWeight = FontWeight(500)), color = c.text)
            if (description != null) Txt(description, style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(17.5f)), color = c.textMuted)
        }
        if (!radioFirst) radio()
    }
}

/**
 * The web's Select on a phone: every choice in view in one sunken group, a
 * round mark on each and the chosen one lit with the accent, a tap away
 * rather than behind a dropdown.
 */
@Composable
fun <T> ChoiceList(label: String?, options: List<Pair<T, String>>, selected: T, modifier: Modifier = Modifier, onSelect: (T) -> Unit) {
    val c = Nx.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (label != null) Txt(label, style = Nx.type.label, color = c.textSubtle)
        Column(
            Modifier
                .fillMaxWidth()
                .sunken(Radii.Sm, c)
                .ring(Radii.Sm, c.borderSubtle)
                .padding(4.dp)
                .semantics { if (label != null) contentDescription = label },
        ) {
            for ((value, text) in options) {
                val on = value == selected
                val interaction = remember { MutableInteractionSource() }
                val pressed by interaction.collectIsPressedAsState()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp)
                        .clip(Radii.Xs)
                        .background(if (pressed) c.bgHover else Color.Transparent)
                        .pressable(interaction, role = Role.RadioButton) { onSelect(value) }
                        .semantics { this.selected = on }
                        .padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(
                        Modifier
                            .size(18.dp)
                            .then(
                                if (on) Modifier.background(brandGradient(c), CircleShape).topEdge(CircleShape, Color.White.copy(alpha = 0.28f))
                                else Modifier.ring(CircleShape, c.borderStrong, 1.5.dp),
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (on) Box(Modifier.size(7.dp).background(c.onBrand, CircleShape))
                    }
                    Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(if (on) 600 else 450)), color = if (on) c.textStrong else c.text)
                }
            }
        }
    }
}
