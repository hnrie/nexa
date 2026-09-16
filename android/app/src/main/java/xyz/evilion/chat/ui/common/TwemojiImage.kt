package xyz.evilion.chat.ui.common

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import xyz.evilion.chat.media.Twemoji

/**
 * One emoji, drawn with the same artwork the browser draws (media/Twemoji.kt).
 * Where the set has no picture for it — Twemoji trails Unicode — the phone's
 * own glyph is shown instead, which is what the web client does too.
 */
@Composable
fun TwemojiImage(text: String, size: Dp, modifier: Modifier = Modifier, fallbackSize: TextUnit = 16.sp) {
    LaunchedEffect(Unit) { Twemoji.ensureIndex() }
    val url = Twemoji.url(text)
    if (url == null) {
        Text(text, fontSize = fallbackSize, modifier = modifier)
        return
    }
    AsyncImage(model = url, contentDescription = text, modifier = modifier.size(size))
}
