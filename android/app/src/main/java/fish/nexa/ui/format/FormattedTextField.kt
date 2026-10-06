package fish.nexa.ui.format

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import fish.nexa.ui.Icon
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.markdown.MarkdownView
import fish.nexa.ui.markdown.RenderCtx
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring

/**
 * FormattedText.tsx: a box for words that are shown formatted (a channel's
 * topic, a server's description), typed with markdown or put together in the
 * formatting editor, with how it will look a tap away, and how much room is
 * left.
 */
@Composable
fun FormattedTextField(value: String, onChange: (String) -> Unit, max: Int, placeholder: String?, title: String, serverId: String?, minLines: Int = 4) {
    val c = Nx.colors
    var preview by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (preview) Box(
            Modifier.fillMaxWidth().heightIn(min = 96.dp).background(c.bgInput, Radii.Sm).padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            if (value.isBlank()) Txt(t("format.field.nothing"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontStyle = FontStyle.Italic), color = c.textMuted)
            else MarkdownView(value, RenderCtx(serverId = serverId, surface = c.bgInput))
        } else NxTextField(
            value, { onChange(it.take(max)) },
            placeholder = placeholder,
            singleLine = false, minLines = minLines, imeAction = ImeAction.Default, capitalize = true, autoCorrect = true,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Tool("Type", t("format.field.format"), pressed = false) {
                openFormattingEditor(value, placeholder ?: "", { md -> onChange(md.take(max)) }, title = title, max = max)
            }
            Tool(if (preview) "EyeOff" else "Eye", if (preview) t("format.field.edit") else t("format.field.preview"), pressed = preview) { preview = !preview }
            Spacer(Modifier.weight(1f))
            Txt(
                t("format.field.left", "count" to max - value.length),
                style = Nx.type.hint,
                color = c.textMuted,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}

/** `.tool`: a small filled button; while on, ringed in the strong border. */
@Composable
private fun Tool(icon: String, label: String, pressed: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val down by interaction.collectIsPressedAsState()
    Row(
        Modifier
            .heightIn(min = 36.dp)
            .then(if (pressed) Modifier.ring(Radii.Sm, c.borderStrong) else Modifier)
            .clip(Radii.Sm)
            .background(if (down) c.bgSelected else c.bgActive)
            .pressable(interaction, onClick = onClick)
            .semantics { selected = pressed }
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, c.text, size = 16.dp)
        Txt(label, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = if (pressed) c.textStrong else c.text, maxLines = 1)
    }
}
