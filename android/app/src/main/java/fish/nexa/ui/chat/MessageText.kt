// TEMPORARY: the markdown renderer (fish.nexa.ui.markdown) replaces this plain text once the parser lands.
package fish.nexa.ui.chat

import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import fish.nexa.ui.theme.Nx

@Composable
fun MessageText(source: String, color: Color, edited: String?, modifier: Modifier = Modifier) {
    val c = Nx.colors
    val text = buildAnnotatedString {
        append(source)
        if (edited != null) withStyle(SpanStyle(color = c.textMuted, fontSize = Nx.type.sp(10f))) { append(" $edited") }
    }
    BasicText(text, modifier, style = Nx.type.body.copy(color = color))
}

/** One line of a message for reply previews and the reply bar. */
fun excerptOf(source: String): String = source.replace(Regex("\\s+"), " ").trim()
