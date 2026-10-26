package fish.nexa.ui.chat

import android.Manifest
import android.media.MediaPlayer
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.VoiceMessages
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.media.voiceClock
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.boxShadow
import fish.nexa.ui.theme.brandGradient
import fish.nexa.ui.theme.topEdge
import fish.nexa.voice.Permissions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** How many bars of the live shape fit along the bar: it scrolls in from the end as the voice comes. */
private const val LIVE_BARS = 40

/**
 * VoiceRecordBar.tsx: the message box while a voice message is made, laid
 * over it in its own shape. It records at once (asking for the microphone the
 * first time): a red dot, the time and the voice's shape as it comes. Stop
 * gives a moment to listen back; Send goes straight from either; the bin
 * throws it away, as Back does.
 */
@Composable
internal fun VoiceRecordBar(modifier: Modifier, shape: Shape, onClose: () -> Unit, onSend: (VoiceMessages.Recording) -> Unit) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var recorder by remember { mutableStateOf<VoiceMessages.Recorder?>(null) }
    var phase by remember { mutableStateOf("starting") }
    var elapsed by remember { mutableDoubleStateOf(0.0) }
    var live by remember { mutableStateOf(List(LIVE_BARS) { 0f }) }
    var kept by remember { mutableStateOf<VoiceMessages.Recording?>(null) }
    var sent by remember { mutableStateOf(false) }
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    var playing by remember { mutableStateOf(false) }
    var playedMs by remember { mutableIntStateOf(0) }

    fun stop(): VoiceMessages.Recording? {
        val r = recorder ?: return kept
        recorder = null
        val out = r.stop()
        if (out == null) {
            Nexa.ui.toast(t("voiceMessage.tooShort"))
            onClose()
            return null
        }
        kept = out
        phase = "review"
        return out
    }
    fun send() {
        if (sent) return
        val out = if (phase == "review") kept else stop()
        if (out == null) return
        sent = true
        player?.release()
        player = null
        onSend(out)
    }
    fun discard() {
        sent = true
        recorder?.cancel()
        recorder = null
        kept?.file?.delete()
        onClose()
    }

    LaunchedEffect(Unit) {
        val granted = Permissions.request(arrayOf(Manifest.permission.RECORD_AUDIO))[Manifest.permission.RECORD_AUDIO] == true
        if (!granted) {
            Nexa.ui.toast(t("voiceMessage.micBlocked"), "error")
            onClose()
            return@LaunchedEffect
        }
        val r = withContext(Dispatchers.IO) { runCatching { VoiceMessages.Recorder() }.getOrNull() }
        if (r == null) {
            Nexa.ui.toast(t("voiceMessage.micFailed"), "error")
            onClose()
            return@LaunchedEffect
        }
        recorder = r
        phase = "recording"
        var tick = 0
        while (recorder === r) {
            val level = r.sample()
            if (tick++ % 2 == 0) {
                elapsed = r.elapsed()
                live = (live + level).takeLast(LIVE_BARS)
            }
            if (r.elapsed() >= VoiceMessages.MAX_SECONDS) {
                stop()
                break
            }
            delay(50)
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            recorder?.cancel()
            player?.release()
            if (!sent) kept?.file?.delete()
        }
    }
    LaunchedEffect(player, playing) {
        val p = player ?: return@LaunchedEffect
        while (playing) {
            playedMs = runCatching { p.currentPosition }.getOrDefault(0)
            delay(100)
        }
    }
    androidx.activity.compose.BackHandler { discard() }

    fun togglePlay() {
        val k = kept ?: return
        val p = player ?: MediaPlayer().apply {
            setDataSource(k.file.path)
            setOnCompletionListener {
                playing = false
                playedMs = 0
            }
            prepare()
        }.also { player = it }
        if (p.isPlaying) {
            p.pause()
            playing = false
        } else {
            p.start()
            playing = true
        }
    }

    val shapeNow = if (phase == "review") VoiceMessages.decodeWave(kept?.wave) ?: emptyList() else live
    val total = kept?.duration ?: elapsed
    val pct = if (phase == "review" && total > 0) playedMs / 1000.0 / total else 0.0
    val nearLimit = phase == "recording" && VoiceMessages.MAX_SECONDS - elapsed <= 30
    Row(
        modifier
            .background(c.bgComposer, shape)
            .padding(horizontal = 6.dp)
            .semantics { contentDescription = t("voiceMessage.recording") },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        RoundButton("Trash2", t("voiceMessage.discard"), 44, Color.Transparent, c.icon) { discard() }
        if (phase == "review") RoundButton(if (playing) "Pause" else "Play", if (playing) t("voiceMessage.pause") else t("voiceMessage.play"), 40, c.bgActive, c.textStrong, filled = true) { togglePlay() }
        else {
            // the red dot breathes while the microphone is open
            val breathe by rememberInfiniteTransition(label = "rec").animateFloat(1f, 0.55f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "dot")
            Box(Modifier.padding(horizontal = 11.dp).size(10.dp).alpha(if (phase == "recording" && !Nx.motion.reduced) breathe else 1f).background(c.danger, CircleShape))
        }
        Txt(
            voiceClock(((if (phase == "review" && (playing || playedMs > 0)) playedMs / 1000.0 else total) * 1000).toLong()),
            style = Nx.type.body.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(650), fontFeatureSettings = "tnum"),
            color = if (nearLimit) c.textDanger else c.textStrong, maxLines = 1,
            modifier = Modifier.widthIn(min = 40.dp),
        )
        Row(Modifier.weight(1f).height(28.dp), horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            val off = c.textMuted.copy(alpha = 0.45f)
            shapeNow.forEachIndexed { i, h ->
                val on = phase == "recording" || (i + 0.5) / shapeNow.size <= pct
                Box(Modifier.weight(1f).widthIn(max = 4.dp).fillMaxHeight(0.10f + h * 0.90f).clip(RoundedCornerShape(2.dp)).background(if (on) c.textBrand else off))
            }
        }
        if (phase == "recording") RoundButton("Square", t("voiceMessage.stop"), 40, c.bgActive, c.textStrong, iconSize = 14, filled = true) { stop() }
        val interaction = remember { MutableInteractionSource() }
        val pressed by interaction.collectIsPressedAsState()
        val ready = phase != "starting"
        Box(
            Modifier
                .size(44.dp)
                .graphicsLayer { val s = if (pressed && ready) 0.92f else 1f; scaleX = s; scaleY = s; alpha = if (ready) 1f else 0.5f }
                .boxShadow(CircleShape, 4f, 12f, c.brand.copy(alpha = 0.8f), spread = -4f)
                .background(brandGradient(c), CircleShape)
                .topEdge(CircleShape, Color.White.copy(alpha = 0.22f))
                .pressable(interaction, enabled = ready) { scope.launch { send() } }
                .semantics { contentDescription = t("voiceMessage.send") },
            contentAlignment = Alignment.Center,
        ) { Icon("SendHorizontal", c.onBrand, size = 20.dp) }
    }
}

@Composable
private fun RoundButton(icon: String, label: String, size: Int, fill: Color, tint: Color, iconSize: Int = 20, filled: Boolean = false, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .size(size.dp)
            .graphicsLayer { val s = if (pressed) 0.92f else 1f; scaleX = s; scaleY = s }
            .clip(CircleShape)
            .background(fill)
            .pressable(interaction, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, tint, size = iconSize.dp, filled = filled) }
}
