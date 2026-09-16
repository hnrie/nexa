package xyz.evilion.chat.ui.common

import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import xyz.evilion.chat.ui.icons.Lucide

/**
 * The hang-up glyph: a handset turned down, the way every call app draws it
 * and the way the web client draws it (web/src/components/voice/HangUp.tsx).
 * Lucide's phone-off puts a slash corner to corner, which fills more of the
 * box than the icons beside it and leaves the handset sitting off to one side.
 */
@Composable
fun HangUpIcon(contentDescription: String, tint: Color, size: Dp = 24.dp, modifier: Modifier = Modifier) {
    Icon(Lucide.Phone, contentDescription, tint = tint, modifier = modifier.size(size).rotate(135f))
}
