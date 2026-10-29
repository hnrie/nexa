package fish.nexa

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.data.TypingStyle
import fish.nexa.ui.chat.StyledTyping
import fish.nexa.ui.components.NxCheckbox
import fish.nexa.ui.chat.PersonText
import fish.nexa.ui.chat.PERSON_SLOT
import fish.nexa.ui.chat.RoleName
import fish.nexa.ui.chat.StartTitle
import fish.nexa.ui.components.Txt
import fish.nexa.ui.markdown.MarkdownView
import fish.nexa.ui.markdown.RenderCtx
import fish.nexa.ui.theme.NexaTheme
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Palettes
import fish.nexa.ui.theme.look.Looks

/** Debug-only adversarial text fixture. Never available in release APKs. */
class TextLayoutAuditActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val theme = intent.getStringExtra("theme") ?: "dark"
        val payload = intent.getStringExtra("payload") ?: "wide"
        val page = intent.getIntExtra("page", 0)
        val text = when (payload) {
            "combining" -> "a" + "\u0301\u035c\u036f".repeat(33)
            "breaks" -> "name\n\r\u2028\u2029".repeat(12)
            "unbroken" -> "W".repeat(100)
            "rtl" -> "\u202e" + "اسم طويل ﷽".repeat(10) + "\u202c"
            "normal" -> "Alice and friends"
            else -> "﷽".repeat(100)
        }
        setContent {
            NexaTheme(Looks.preview(theme, emptyList()) ?: Palettes.dark, reducedMotion = true) {
                Column(Modifier.fillMaxSize().background(Nx.colors.bgRaised).statusBarsPadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    if (page == 2) {
                        StyledTyping(TypingStyle(emptyList(), "wave", words = text.take(32)), text)
                        Txt("Typing preview action", maxLines = 1)
                        NxCheckbox(false, {}, text)
                        Txt("Option action", maxLines = 1)
                        Txt(text, style = Nx.type.hint, maxLines = 2)
                        Txt(text, style = Nx.type.body, maxLines = 2)
                        Txt("Statistic action", maxLines = 1)
                        Txt(text, style = Nx.type.bodySmall, maxLines = 2)
                        Txt("Call actions", maxLines = 1)
                    } else if (page == 0) {
                        Row(Modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) {
                            RoleName(text, null, Nx.type.headerTitle, Nx.colors.textStrong, Modifier.weight(1f))
                            Txt("☎", modifier = Modifier.width(40.dp), maxLines = 1)
                            Txt("×", modifier = Modifier.width(40.dp), maxLines = 1)
                        }
                        StartTitle(text)
                        PersonText(null, "Welcome to $PERSON_SLOT. Messages here are end-to-end encrypted.", text, Nx.type.body, Nx.colors.textMuted, Modifier.fillMaxWidth())
                        Column(Modifier.fillMaxWidth().background(Nx.colors.bgSurface).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Txt(text, Modifier.weight(1f), style = Nx.type.name.copy(fontSize = Nx.type.sp(16.5f), lineHeight = Nx.type.sp(21.45f), fontWeight = FontWeight(680)), maxLines = 2)
                                Txt("Join", Modifier.padding(start = 16.dp), maxLines = 1)
                            }
                            Txt("3 members", style = Nx.type.hint, color = Nx.colors.textMuted)
                        }
                        RoleName(text, null, Nx.type.name, Nx.colors.textStrong, Modifier.fillMaxWidth())
                        Txt(text, style = Nx.type.name, maxLines = 2)
                    } else {
                        MarkdownView("# $text\n\n$text\n\n```\n" + "W".repeat(500) + "\n```\n\n| Name | Value |\n| --- | --- |\n| $text | " + "x".repeat(500) + " |", RenderCtx(inert = true), Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }
}
