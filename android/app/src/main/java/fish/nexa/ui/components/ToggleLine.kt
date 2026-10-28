package fish.nexa.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.ui.theme.Nx

/**
 * Toggle.tsx as a dialog draws it: a sentence-case label (and a description)
 * with the switch at the end, the whole row one target, a hairline under it.
 */
@Composable
fun ToggleLine(label: String, checked: Boolean, onChange: (Boolean) -> Unit, description: String? = null, enabled: Boolean = true, descriptionBelow: Boolean = false) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .alpha(if (enabled) 1f else 0.5f)
                .pressable(remember { MutableInteractionSource() }, enabled = enabled, role = Role.Switch) { onChange(!checked) }
                .padding(vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Txt(label, style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(550)), color = c.text)
                if (description != null && !descriptionBelow) Txt(description, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(18.9f)), color = c.textMuted)
            }
            NxToggle(checked, onChange, enabled = enabled, label = label)
        }
        if (description != null && descriptionBelow) Txt(description, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(18.9f)), color = c.textMuted, modifier = Modifier.padding(bottom = 14.dp).alpha(if (enabled) 1f else 0.5f))
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
    }
}
