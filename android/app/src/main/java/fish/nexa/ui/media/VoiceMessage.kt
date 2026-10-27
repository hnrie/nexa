package fish.nexa.ui.media

import android.net.Uri
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import fish.nexa.data.Transcripts
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import fish.nexa.crypto.AttachmentMeta
import fish.nexa.data.VoiceMessages
import fish.nexa.media.MediaPrefs
import fish.nexa.media.loadPriority
import fish.nexa.media.rememberAttachmentLoad
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.brandGradient
import fish.nexa.ui.theme.glowBrand
import fish.nexa.ui.theme.shadowLow
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.delay
import java.io.File

private val FLAT = List(VoiceMessages.SHOWN_BARS) { 0.3f }
private val SPEEDS = listOf(1f, 1.25f, 1.5f, 2f, 0.75f)

/** A voice message's time, minutes and seconds (AudioPlayer.tsx's clock). */
internal fun voiceClock(ms: Long): String {
    val total = maxOf(0L, ms) / 1000
    return "${total / 60}:${(total % 60).toString().padStart(2, '0')}"
}

/** A voice message (VoiceAttachment in Attachments.tsx): always fetched by itself, drawn whole from the start. */
@Composable
fun VoiceAttachment(att: AttachmentMeta) {
    val load = rememberAttachmentLoad(att, true)
    Column(Modifier.widthIn(max = 360.dp).fillMaxWidth().loadPriority(load, att.blobId)) {
        if (load.error != null && load.file == null) LoadFailed(load.error!!, "audio") { load.retry() }
        else {
            VoiceMessage(load.file, att.duration, att.wave) { load.load() }
            Transcript(load.file)
        }
    }
}

/**
 * VoiceMessage.tsx: a pill with a round play button in the accent, the shape
 * of the voice to scrub along, its time and the speed. The shape and length
 * travel with the message, so it is drawn whole before the file is here; a
 * press before then plays it as soon as it arrives.
 */
@OptIn(UnstableApi::class)
@Composable
fun VoiceMessage(file: File?, durationHint: Double?, wave: String?, onLoad: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    var playing by remember { mutableStateOf(false) }
    var position by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(((durationHint ?: 0.0) * 1000).toLong()) }
    var failed by remember { mutableStateOf(false) }
    var queued by remember { mutableStateOf(false) }
    var speed by remember { mutableFloatStateOf(MediaPrefs.get().speed.takeIf { it in SPEEDS } ?: 1f) }
    val shape = remember(wave) { VoiceMessages.decodeWave(wave)?.let { VoiceMessages.shapeOf(it, VoiceMessages.SHOWN_BARS) } ?: FLAT }
    val player = remember(file) {
        file?.let {
            ExoPlayer.Builder(context).build().apply {
                setMediaItem(MediaItem.fromUri(Uri.fromFile(it)))
                volume = if (MediaPrefs.get().muted) 0f else MediaPrefs.get().volume
                setPlaybackSpeed(speed)
                prepare()
            }
        }
    }
    DisposableEffect(player) {
        val p = player ?: return@DisposableEffect onDispose {}
        val l = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                playing = isPlaying
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY && p.duration > 0) duration = p.duration
                if (state == Player.STATE_ENDED) {
                    p.pause()
                    p.seekTo(0)
                    position = 0
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                failed = true
            }
        }
        p.addListener(l)
        if (queued) {
            queued = false
            p.play()
        }
        onDispose {
            p.removeListener(l)
            p.release()
        }
    }
    LaunchedEffect(player, playing) {
        val p = player ?: return@LaunchedEffect
        while (playing) {
            position = p.currentPosition
            delay(100)
        }
        position = p.currentPosition
    }
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    fun seekTo(f: Float) {
        val p = player ?: return
        if (duration <= 0) return
        p.seekTo(((if (rtl) 1f - f else f).coerceIn(0f, 1f) * duration).toLong())
        position = p.currentPosition
    }
    val pill = RoundedCornerShape(percent = 50)
    Row(
        Modifier
            .padding(top = 4.dp)
            .fillMaxWidth()
            .semantics { contentDescription = t("voiceMessage.label") }
            .shadowLow(pill, c)
            .background(c.bgSurface, pill)
            .topEdge(pill, c.edgeLight)
            .padding(start = 6.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        val interaction = remember { MutableInteractionSource() }
        val pressed by interaction.collectIsPressedAsState()
        Box(
            Modifier
                .size(44.dp)
                .graphicsLayer { val s = if (pressed) 0.94f else 1f; scaleX = s; scaleY = s }
                .then(if (playing) Modifier.glowBrand(CircleShape, c) else Modifier)
                .clip(CircleShape)
                .then(if (failed) Modifier.background(c.bgActive) else Modifier.background(brandGradient(c)))
                .pressable(interaction, enabled = !failed) {
                    val p = player
                    if (p == null) {
                        queued = true
                        onLoad()
                    } else if (p.isPlaying) p.pause() else p.play()
                }
                .semantics { contentDescription = if (playing) t("voiceMessage.pause") else t("voiceMessage.play") },
            contentAlignment = Alignment.Center,
        ) {
            if (queued && player == null) Spinner(size = 18.dp)
            else Icon(if (playing) "Pause" else "Play", if (failed) c.textMuted else c.onBrand, size = 18.dp, filled = true, modifier = if (playing) Modifier else Modifier.padding(start = 2.dp))
        }
        if (failed) Txt(t("chat.audioPlayer.thisAudioCannotBePlayedHere"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, modifier = Modifier.weight(1f))
        else {
            val played = if (duration > 0) position.toFloat() / duration else 0f
            val muted = c.textMuted.copy(alpha = 0.55f)
            Row(
                Modifier
                    .weight(1f)
                    .height(30.dp)
                    .pointerInput(duration, player) { detectTapGestures { o -> seekTo(o.x / size.width) } }
                    .pointerInput(duration, player) {
                        detectHorizontalDragGestures { ch, _ ->
                            ch.consume()
                            seekTo(ch.position.x / size.width)
                        }
                    }
                    .semantics {
                        contentDescription = t("chat.audioPlayer.seek")
                        stateDescription = "${voiceClock(position)} / ${voiceClock(duration)}"
                    },
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                shape.forEachIndexed { i, h ->
                    val on = (i + 0.5f) / shape.size <= played
                    Box(Modifier.width(3.dp).fillMaxHeight(0.14f + h * 0.86f).clip(RoundedCornerShape(2.dp)).background(if (on) c.textBrand else muted))
                }
            }
        }
        // while it plays, the time counts up; still, it says how long it is
        Txt(voiceClock(if (playing || position > 0) position else duration), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600), fontFeatureSettings = "tnum"), color = c.textMuted, maxLines = 1)
        Box(
            Modifier.height(32.dp).clip(Radii.Pill).background(c.bgActive).pressable(remember { MutableInteractionSource() }) {
                speed = SPEEDS[(SPEEDS.indexOf(speed).coerceAtLeast(0) + 1) % SPEEDS.size]
                player?.setPlaybackSpeed(speed)
                MediaPrefs.save(speed = speed)
            }.padding(horizontal = 8.dp).semantics { contentDescription = t("chat.audioPlayer.playbackSpeed") },
            contentAlignment = Alignment.Center,
        ) { Txt("${if (speed == Math.floor(speed.toDouble()).toFloat()) speed.toInt().toString() else speed.toString()}×", style = Nx.type.hint.copy(fontWeight = FontWeight(700)), color = c.textSubtle) }
    }
}

@Composable
private fun Transcript(file: File?) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var job by remember(file) { mutableStateOf<Job?>(null) }
    var working by remember(file) { mutableStateOf(false) }
    var progress by remember(file) { mutableStateOf(0) }
    var text by remember(file) { mutableStateOf<String?>(null) }
    var failed by remember(file) { mutableStateOf(false) }
    DisposableEffect(file) { onDispose { job?.cancel() } }
    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
        fish.nexa.ui.components.NxButton(t(if (job != null) "voiceMessage.cancelTranscript" else "voiceMessage.transcribe"), {
            if (job != null) { job?.cancel(); job = null }
            else if (file != null) {
                working = false; failed = false; progress = 0
                job = scope.launch {
                    try { text = Transcripts.transcribe(file, progress = { progress = it }) { working = true } }
                    catch (e: kotlinx.coroutines.CancellationException) { throw e }
                    catch (_: Exception) { failed = true }
                    finally { if (job == kotlinx.coroutines.currentCoroutineContext()[Job]) job = null }
                }
            }
        }, kind = fish.nexa.ui.components.ButtonKind.GHOST, enabled = file != null)
        if (job != null) Txt(if (working) t("voiceMessage.transcribing") else t("voiceMessage.downloading", "percent" to progress), style = Nx.type.hint, color = c.textMuted)
        if (failed) Txt(t("voiceMessage.transcriptFailed"), style = Nx.type.hint, color = c.textMuted)
        text?.let { SelectionContainer { Txt(it.ifBlank { t("voiceMessage.noSpeech") }, style = Nx.type.body, color = c.text) } }
    }
}
