package xyz.evilion.chat.ui.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.net.toUri
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import xyz.evilion.chat.crypto.AttachmentMeta
import xyz.evilion.chat.media.AttachmentStore
import xyz.evilion.chat.ui.theme.chatColors
import java.io.File

/**
 * Plays an attachment.
 *
 * The file is decrypted into the app's cache first: ExoPlayer reads plain
 * files, and nothing encrypted ever leaves this device in a form anyone else
 * could read anyway.
 */
@Composable
fun VideoPlayer(meta: AttachmentMeta) {
    val context = LocalContext.current
    var file by remember(meta.blobId) { mutableStateOf<File?>(null) }
    LaunchedEffect(meta.blobId) {
        file = runCatching { AttachmentStore.file(meta) }.getOrNull()
    }
    val local = file
    if (local == null) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            CircularProgressIndicator(Modifier.size(28.dp), color = chatColors.brand, strokeWidth = 2.dp)
        }
        return
    }
    val player = remember(local) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(local.toUri()))
            prepare()
            playWhenReady = true
            repeatMode = Player.REPEAT_MODE_OFF
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    AndroidView(
        factory = { ctx -> PlayerView(ctx).apply { this.player = player; useController = true } },
        modifier = Modifier.fillMaxSize(),
    )
}

/** A voice message or a music file, with a scrubber. */
@Composable
fun AudioPlayer(meta: AttachmentMeta) {
    val colors = chatColors
    val context = LocalContext.current
    var file by remember(meta.blobId) { mutableStateOf<File?>(null) }
    var loading by remember(meta.blobId) { mutableStateOf(false) }
    var playing by remember(meta.blobId) { mutableStateOf(false) }
    var position by remember(meta.blobId) { mutableStateOf(0f) }
    var duration by remember(meta.blobId) { mutableStateOf((meta.duration ?: 0.0).toFloat()) }

    val player = remember(file) {
        file?.let { local ->
            ExoPlayer.Builder(context).build().apply {
                setMediaItem(MediaItem.fromUri(local.toUri()))
                prepare()
                playWhenReady = true
            }
        }
    }
    DisposableEffect(player) { onDispose { player?.release() } }

    LaunchedEffect(player) {
        val p = player ?: return@LaunchedEffect
        playing = true
        while (true) {
            position = p.currentPosition / 1000f
            if (p.duration > 0) duration = p.duration / 1000f
            playing = p.isPlaying
            delay(200)
        }
    }

    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    IconButton(onClick = {
        val p = player
        when {
            p == null && !loading -> {
                loading = true
                xyz.evilion.chat.data.Session.scope.launch {
                    file = runCatching { AttachmentStore.file(meta) }.getOrNull()
                    loading = false
                }
            }
            p != null && p.isPlaying -> p.pause()
            p != null -> p.play()
        }
    }) {
        when {
            loading -> CircularProgressIndicator(Modifier.size(20.dp), color = colors.brand, strokeWidth = 2.dp)
            playing -> Icon(Icons.Filled.Pause, "Pause", tint = colors.icon)
            else -> Icon(Icons.Filled.PlayArrow, "Play", tint = colors.icon)
        }
    }
    Column(Modifier.weight(1f)) {
        Slider(
            value = if (duration > 0) (position / duration).coerceIn(0f, 1f) else 0f,
            onValueChange = { value -> player?.seekTo((value * duration * 1000).toLong()) },
            colors = SliderDefaults.colors(thumbColor = colors.brand, activeTrackColor = colors.brand, inactiveTrackColor = colors.border),
        )
        Row {
            Text(clock(position), color = colors.textMuted, fontSize = 11.sp)
            Spacer(Modifier.width(6.dp))
            Text(meta.name, color = colors.textMuted, fontSize = 11.sp, maxLines = 1)
            Spacer(Modifier.weight(1f))
            Text(clock(duration), color = colors.textMuted, fontSize = 11.sp)
        }
    }
    }
}

private fun clock(seconds: Float): String {
    val total = seconds.toInt().coerceAtLeast(0)
    return "%d:%02d".format(total / 60, total % 60)
}
