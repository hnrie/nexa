package fish.nexa.ui.media

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import fish.nexa.Nexa
import fish.nexa.crypto.AttachmentMeta
import fish.nexa.media.AUTO_LOAD_MAX
import fish.nexa.media.Downloads
import fish.nexa.media.MediaPrefs
import fish.nexa.media.Saving
import fish.nexa.media.loadPriority
import fish.nexa.media.rememberAttachmentLoad
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.sqrt

/** waveform.ts: a recording's loudness in 48 bars, decoded on the phone; flat when it cannot be. */
object Waveform {
    const val BARS = 48
    private const val MAX_BYTES = 15L * 1024 * 1024
    private const val CACHE_MAX = 300
    val FLAT = List(BARS) { 0.3f }
    private val cache = object : LinkedHashMap<String, List<Float>>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<Float>>?) = size > CACHE_MAX
    }

    /** RMS per bar over the first channel, the quietest shown at 12% (barsOf). */
    private fun bars(sums: DoubleArray, counts: LongArray): List<Float> {
        val out = DoubleArray(BARS) { if (counts[it] > 0) sqrt(sums[it] / counts[it]) else 0.0 }
        val peak = maxOf(out.maxOrNull() ?: 0.0, 1e-6)
        return out.map { (0.12 + 0.88 * minOf(1.0, it / peak)).toFloat() }
    }

    suspend fun of(key: String, file: File): List<Float>? = withContext(Dispatchers.Default) {
        synchronized(cache) { cache[key] }?.let { return@withContext it }
        if (file.length() > MAX_BYTES) return@withContext null
        val shape = runCatching { decode(file) }.getOrNull() ?: return@withContext null
        synchronized(cache) { cache[key] = shape }
        shape
    }

    private fun decode(file: File): List<Float>? {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(file.path)
            val track = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true } ?: return null
            ex.selectTrack(track)
            val format = ex.getTrackFormat(track)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: return null
            val rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            val durUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
            if (durUs <= 0) return null
            // where each sample goes is known from the length, so the samples are never all held at once
            val total = (durUs / 1_000_000.0 * rate).toLong().coerceAtLeast(1)
            val per = maxOf(1L, total / BARS)
            val sums = DoubleArray(BARS)
            val counts = LongArray(BARS)
            val codec = MediaCodec.createDecoderByType(mime)
            try {
                codec.configure(format, null, null, 0)
                codec.start()
                val info = MediaCodec.BufferInfo()
                var inputDone = false
                var index = 0L
                var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceAtLeast(1)
                var float = false
                while (true) {
                    if (!inputDone) {
                        val i = codec.dequeueInputBuffer(10_000)
                        if (i >= 0) {
                            val buf = codec.getInputBuffer(i)!!
                            val n = ex.readSampleData(buf, 0)
                            if (n < 0) {
                                codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputDone = true
                            } else {
                                codec.queueInputBuffer(i, 0, n, ex.sampleTime, 0)
                                ex.advance()
                            }
                        }
                    }
                    val o = codec.dequeueOutputBuffer(info, 10_000)
                    if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        val f = codec.outputFormat
                        channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceAtLeast(1)
                        float = f.containsKey(MediaFormat.KEY_PCM_ENCODING) && f.getInteger(MediaFormat.KEY_PCM_ENCODING) == android.media.AudioFormat.ENCODING_PCM_FLOAT
                    } else if (o >= 0) {
                        val buf = codec.getOutputBuffer(o)!!
                        buf.position(info.offset)
                        buf.limit(info.offset + info.size)
                        val order = buf.order(java.nio.ByteOrder.LITTLE_ENDIAN)
                        if (float) {
                            val fb = order.asFloatBuffer()
                            while (fb.remaining() >= channels) {
                                val s = fb.get().toDouble()
                                for (k in 1 until channels) fb.get()
                                val b = minOf(BARS - 1L, index / per).toInt()
                                sums[b] += s * s; counts[b]++; index++
                            }
                        } else {
                            val sb = order.asShortBuffer()
                            while (sb.remaining() >= channels) {
                                val s = sb.get() / 32768.0
                                for (k in 1 until channels) sb.get()
                                val b = minOf(BARS - 1L, index / per).toInt()
                                sums[b] += s * s; counts[b]++; index++
                            }
                        }
                        codec.releaseOutputBuffer(o, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                    }
                }
            } finally {
                runCatching { codec.stop() }
                codec.release()
            }
            return bars(sums, counts)
        } finally {
            ex.release()
        }
    }
}

private val SPEEDS = listOf(1f, 1.25f, 1.5f, 2f, 0.75f)

private fun clock(ms: Long): String {
    val total = maxOf(0L, ms) / 1000
    return "${total / 60}:${(total % 60).toString().padStart(2, '0')}"
}

/**
 * AudioPlayer.tsx on a phone: the round play button, the name and size over
 * the waveform (played bars in the accent; tap or drag to seek), then a second
 * row with the time and speed, mute and download.
 */
@OptIn(UnstableApi::class)
@Composable
fun AudioPlayer(source: Uri, name: String, fileSize: Long?, durationHint: Double?, waveFile: File?, waveKey: String?, onDownload: (() -> Unit)?) {
    val c = Nx.colors
    val context = LocalContext.current
    var playing by remember { mutableStateOf(false) }
    var position by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(((durationHint ?: 0.0) * 1000).toLong()) }
    var failed by remember { mutableStateOf(false) }
    var muted by remember { mutableStateOf(MediaPrefs.get().muted) }
    var speed by remember { mutableFloatStateOf(MediaPrefs.get().speed.takeIf { it in SPEEDS } ?: 1f) }
    var shape by remember { mutableStateOf(Waveform.FLAT) }
    val player = remember(source) {
        ExoPlayer.Builder(context).setMediaSourceFactory(androidx.media3.exoplayer.source.DefaultMediaSourceFactory(fish.nexa.media.Streams.factory())).build().apply {
            setMediaItem(MediaItem.fromUri(source))
            volume = if (muted) 0f else MediaPrefs.get().volume
            setPlaybackSpeed(speed)
            prepare()
        }
    }
    DisposableEffect(player) {
        val l = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                playing = isPlaying
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY && player.duration > 0) duration = player.duration
                if (state == Player.STATE_ENDED) {
                    player.pause()
                    player.seekTo(0)
                    position = 0
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                failed = true
            }
        }
        player.addListener(l)
        onDispose {
            player.removeListener(l)
            player.release()
        }
    }
    LaunchedEffect(player, playing) {
        while (playing) {
            position = player.currentPosition
            delay(200)
        }
        position = player.currentPosition
    }
    LaunchedEffect(waveKey, waveFile) {
        if (waveKey != null && waveFile != null) Waveform.of(waveKey, waveFile)?.let { shape = it }
    }
    fun seekTo(f: Float) {
        if (duration <= 0) return
        player.seekTo((f.coerceIn(0f, 1f) * duration).toLong())
        position = player.currentPosition
    }
    FlowRow(
        Modifier
            .padding(top = 4.dp)
            .widthIn(max = 400.dp)
            .fillMaxWidth()
            .ring(Radii.Sm, c.border)
            .background(c.bgSurface, Radii.Sm)
            .padding(8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(if (failed) c.bgActive else c.brand)
                .pressable(remember { MutableInteractionSource() }, enabled = !failed) { if (player.isPlaying) player.pause() else player.play() }
                .semantics { contentDescription = if (playing) t("chat.audioPlayer.pauseNamed", "name" to name) else t("chat.audioPlayer.playNamed", "name" to name) },
            contentAlignment = Alignment.Center,
        ) { Icon(if (playing) "Pause" else "Play", if (failed) c.textMuted else c.onBrand, size = 18.dp, filled = true) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Txt(name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                if (fileSize != null && fileSize > 0) Txt(Time.bytes(fileSize), style = Nx.type.hint, color = c.textMuted, maxLines = 1)
            }
            if (failed) Txt(t("chat.audioPlayer.thisAudioCannotBePlayedHere"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted)
            else {
                val played = if (duration > 0) position.toFloat() / duration else 0f
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(28.dp)
                        .pointerInput(duration) { detectTapGestures { o -> seekTo(o.x / size.width) } }
                        .pointerInput(duration) {
                            detectHorizontalDragGestures { ch, _ ->
                                ch.consume()
                                seekTo(ch.position.x / size.width)
                            }
                        }
                        .semantics {
                            contentDescription = t("chat.audioPlayer.seek")
                            stateDescription = "${clock(position)} / ${clock(duration)}"
                        },
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    shape.forEachIndexed { i, h ->
                        val on = i.toFloat() / shape.size <= played
                        Box(Modifier.weight(1f).fillMaxHeight(h).clip(RoundedCornerShape(1.dp)).background(if (on) c.brand else c.bgActive))
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Txt("${clock(position)} / ${clock(duration)}", style = Nx.type.hint.copy(fontFeatureSettings = "tnum"), color = c.textMuted)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.height(40.dp).clip(Radii.Xs).pressable(remember { MutableInteractionSource() }) {
                        speed = SPEEDS[(SPEEDS.indexOf(speed).coerceAtLeast(0) + 1) % SPEEDS.size]
                        player.setPlaybackSpeed(speed)
                        MediaPrefs.save(speed = speed)
                    }.padding(horizontal = 10.dp).semantics { contentDescription = t("chat.audioPlayer.playbackSpeed") },
                    contentAlignment = Alignment.Center,
                ) { Txt("${if (speed == Math.floor(speed.toDouble()).toFloat()) speed.toInt().toString() else speed.toString()}×", style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.textMuted) }
                Box(
                    Modifier.size(40.dp).clip(Radii.Xs).pressable(remember { MutableInteractionSource() }) {
                        muted = !muted
                        player.volume = if (muted) 0f else MediaPrefs.get().volume
                        MediaPrefs.save(muted = muted)
                    }.semantics { contentDescription = if (muted) t("chat.media.unmute") else t("chat.media.mute") },
                    contentAlignment = Alignment.Center,
                ) { Icon(if (muted) "VolumeX" else "Volume2", c.textMuted, size = 16.dp) }
                if (onDownload != null) Box(
                    Modifier.size(40.dp).clip(Radii.Xs).pressable(remember { MutableInteractionSource() }, onClick = onDownload)
                        .semantics { contentDescription = t("chat.attachments.downloadNamed", "name" to name) },
                    contentAlignment = Alignment.Center,
                ) { Icon("Download", c.textMuted, size = 16.dp) }
            }
        }
    }
}

/** An uploaded recording: opened first (small ones by themselves), then played from this device. */
@Composable
fun AudioAttachment(att: AttachmentMeta) {
    val c = Nx.colors
    Saving.Track()
    val auto = att.size <= AUTO_LOAD_MAX
    val load = rememberAttachmentLoad(att, auto)
    val file = load.file
    val download = {
        Saving.save(att.name, att.type, picture = false, write = { out -> Downloads.writeAttachment(att, out) {} }) { err ->
            if (err != null) Nexa.ui.toast(t("chat.attachments.couldNotDownloadThatFile"), "error") else Nexa.ui.toast(t("android.media.savedToDownloads"), "success")
        }
    }
    Box(Modifier.widthIn(max = 400.dp).fillMaxWidth().loadPriority(load, att.blobId)) {
        when {
            file != null -> AudioPlayer(Uri.fromFile(file), att.name, att.size, att.duration, file, att.blobId, download)
            load.error != null -> LoadFailed(load.error!!, "audio") { load.retry() }
            load.wanted || auto -> Txt(
                if (att.plain) t("chat.attachments.loadingFile", "name" to att.name) else t("chat.attachments.decrypting", "name" to att.name),
                style = Nx.type.hint, color = c.textMuted, modifier = Modifier.padding(top = 4.dp),
            )
            else -> LoadButton(t("chat.attachments.loadNamed", "name" to att.name, "size" to Time.bytes(att.size)), "Play") { load.load() }
        }
    }
}
