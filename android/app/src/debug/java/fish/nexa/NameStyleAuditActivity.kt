package fish.nexa

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.data.NameStyle
import fish.nexa.ui.chat.RoleLook
import fish.nexa.ui.chat.RoleName
import fish.nexa.ui.components.Txt
import fish.nexa.ui.theme.NexaTheme
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Palettes

/** Debug-only visual fixture for comparing every name face/effect at real chat and profile sizes. */
class NameStyleAuditActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val page = intent.getIntExtra("page", 0)
        val effects = intent.getBooleanExtra("effects", false)
        val theme = intent.getStringExtra("theme") ?: "dark"
        setContent {
            NexaTheme(Palettes.byName(theme), reducedMotion = true) {
                Column(Modifier.fillMaxSize().background(Nx.colors.bgRaised).statusBarsPadding().padding(8.dp)) {
                    if (effects) for (effect in NameStyle.EFFECTS) {
                        Sample(effect.id, NameStyle("", effect.id, effect.start))
                    } else for (font in NameStyle.FONTS.drop(page * 10).take(10)) {
                        Sample(font.label.ifEmpty { "Default" }, NameStyle(font.id, "solid", emptyList()))
                    }
                }
            }
        }
    }
}

@Composable
private fun Sample(label: String, own: NameStyle) {
    Row(Modifier.fillMaxWidth().height(64.dp), verticalAlignment = Alignment.CenterVertically) {
        Txt(label, style = Nx.type.bodySmall, color = Nx.colors.textMuted, modifier = Modifier.width(80.dp), maxLines = 1)
        for ((size, width) in listOf(14f to 90, 16f to 90, 28f to 130)) {
            Box(Modifier.width(width.dp)) {
                RoleName("Agyp", RoleLook(color = null, own = own), Nx.type.name.copy(fontSize = Nx.type.sp(size), lineHeight = Nx.type.sp(size * 1.4f), fontWeight = FontWeight(700)), Nx.colors.text)
            }
        }
    }
}
