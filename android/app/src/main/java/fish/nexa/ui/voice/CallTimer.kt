package fish.nexa.ui.voice

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.CallTimer as CallClock
import fish.nexa.data.ServerClock
import fish.nexa.ui.Time
import fish.nexa.ui.components.Txt
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.ring
import fish.nexa.voice.CallConnection
import fish.nexa.voice.Voice
import kotlinx.coroutines.delay

/**
 * How long the call in a channel has been going, "12:04", ticking once a
 * second (CallTimer.tsx). Nothing while nobody is in the call. While this
 * device's own call to it is reconnecting the time holds still and greys,
 * since nothing is getting through. `pill` sets it in the small tag a call's
 * line uses; plain, it is just the digits.
 */
@Composable
fun CallTimer(channelId: String, modifier: Modifier = Modifier, pill: Boolean = false, fontSize: Float = 12f) {
    val byUser by Nexa.voiceStates.byUser.collectAsState()
    val state by Voice.state.collectAsState()
    val since = CallClock.since(byUser, channelId) ?: return
    val held = state.connection == CallConnection.RECONNECTING && state.mine?.channelId == channelId
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(held) {
        while (!held) {
            now = System.currentTimeMillis()
            delay(1000 - now % 1000)
        }
    }
    val secs = CallClock.seconds(since, ServerClock.now(now))
    val c = Nx.colors
    val color = when {
        held -> c.textPlaceholder
        pill -> mixOklab(c.text, c.positive, 0.7f)
        else -> c.textMuted
    }
    val label = t("voice.callTimer.label", "length" to formatCallLength(secs))
    val style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(fontSize), fontWeight = FontWeight(600), fontFeatureSettings = "tnum")
    val text = Time.duration(secs.toDouble())
    if (pill) {
        val shape = RoundedCornerShape(10.dp)
        Box(
            modifier.height(20.dp).ring(shape, c.borderSubtle).background(c.bgSurface, shape).padding(horizontal = 7.dp).semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) { Txt(text, style = style, color = color, maxLines = 1) }
    } else {
        Txt(text, modifier.semantics { contentDescription = label }, style = style, color = color, maxLines = 1)
    }
}
