package xyz.evilion.chat.ui.chat

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import coil3.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import xyz.evilion.chat.crypto.AttachmentMeta
import xyz.evilion.chat.crypto.Embed
import xyz.evilion.chat.crypto.StickerRef
import xyz.evilion.chat.media.AttachmentStore
import xyz.evilion.chat.media.Media
import xyz.evilion.chat.ui.Layer
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.theme.chatColors

/** What a message carries besides words: pictures, video, sound and files. */
@Composable
fun AttachmentList(attachments: List<AttachmentMeta>, channelId: String) {
    Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (attachment in attachments) {
            when {
                attachment.type.startsWith("image/") -> ImageAttachment(attachment)
                attachment.type.startsWith("video/") -> VideoAttachment(attachment)
                attachment.type.startsWith("audio/") -> AudioAttachment(attachment)
                else -> FileAttachment(attachment)
            }
        }
    }
}

@Composable
private fun ImageAttachment(meta: AttachmentMeta) {
    val colors = chatColors
    var revealed by remember(meta.blobId) { mutableStateOf(!meta.spoiler) }
    val ratio = if (meta.width != null && meta.height != null && meta.height > 0) {
        (meta.width.toFloat() / meta.height).coerceIn(0.4f, 2.5f)
    } else {
        1.4f
    }
    Box(
        Modifier.widthIn(max = 320.dp).fillMaxWidth().aspectRatio(ratio)
            .clip(RoundedCornerShape(8.dp)).background(colors.bgSurface)
            .clickable {
                if (revealed) Nav.push(Layer.ImageViewer(meta.blobId, meta.name)) else revealed = true
            },
    ) {
        AsyncImage(
            model = meta,
            contentDescription = meta.name,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxWidth().then(if (revealed) Modifier else Modifier.blur(28.dp)),
        )
        if (!revealed) {
            Box(Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) {
                Row(
                    Modifier.clip(RoundedCornerShape(20.dp)).background(colors.bgOverlay).padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.VisibilityOff, null, tint = Color.White, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Spoiler", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun VideoAttachment(meta: AttachmentMeta) {
    val colors = chatColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var playing by remember(meta.blobId) { mutableStateOf(false) }
    var busy by remember(meta.blobId) { mutableStateOf(false) }
    val ratio = if (meta.width != null && meta.height != null && meta.height > 0) {
        (meta.width.toFloat() / meta.height).coerceIn(0.5f, 2.2f)
    } else {
        16f / 9f
    }

    Box(
        Modifier.widthIn(max = 340.dp).fillMaxWidth().aspectRatio(ratio)
            .clip(RoundedCornerShape(8.dp)).background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        if (playing) {
            VideoPlayer(meta)
        } else {
            AsyncImage(
                model = meta,
                contentDescription = meta.name,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxWidth(),
            )
            Box(
                Modifier.size(52.dp).clip(CircleShape).background(colors.bgOverlay)
                    .clickable {
                        busy = true
                        scope.launch {
                            runCatching { AttachmentStore.file(meta) }
                            busy = false
                            playing = true
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (busy) CircularProgressIndicator(Modifier.size(24.dp), color = Color.White, strokeWidth = 2.dp)
                else Icon(Icons.Filled.PlayArrow, "Play", tint = Color.White, modifier = Modifier.size(30.dp))
            }
        }
    }
}

@Composable
private fun AudioAttachment(meta: AttachmentMeta) {
    val colors = chatColors
    Box(
        Modifier.widthIn(max = 340.dp).fillMaxWidth().clip(RoundedCornerShape(8.dp))
            .background(colors.bgSurface).padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        AudioPlayer(meta)
    }
}

@Composable
private fun FileAttachment(meta: AttachmentMeta) {
    val colors = chatColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var progress by remember(meta.blobId) { mutableStateOf<Float?>(null) }
    Row(
        Modifier.widthIn(max = 340.dp).fillMaxWidth().clip(RoundedCornerShape(8.dp))
            .background(colors.bgSurface).border(1.dp, colors.borderSubtle, RoundedCornerShape(8.dp))
            .clickable {
                if (progress != null) return@clickable
                progress = 0f
                scope.launch {
                    runCatching { openAttachment(context, meta) { done -> progress = done } }
                    progress = null
                }
            }
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Description, null, tint = colors.textBrand, modifier = Modifier.size(28.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(meta.name, color = colors.link, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(formatSize(meta.size), color = colors.textMuted, fontSize = 12.sp)
        }
        if (progress != null) {
            CircularProgressIndicator(Modifier.size(20.dp), color = colors.brand, strokeWidth = 2.dp)
        } else {
            Icon(Icons.Filled.Download, "Open", tint = colors.icon, modifier = Modifier.size(20.dp))
        }
    }
}

/** Decrypts the file, then hands it to whatever app opens that kind. */
suspend fun openAttachment(context: Context, meta: AttachmentMeta, onProgress: (Float) -> Unit = {}) {
    val file = withContext(Dispatchers.IO) {
        AttachmentStore.file(meta) { done, total -> onProgress(if (total > 0) done.toFloat() / total else 0f) }
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, meta.type)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    runCatching { context.startActivity(Intent.createChooser(intent, meta.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

@Composable
fun StickerView(sticker: StickerRef) {
    val blob = sticker.blob ?: sticker.id
    Box(Modifier.padding(top = 4.dp).size(160.dp)) {
        AsyncImage(
            model = Media.sticker(blob, 320),
            contentDescription = sticker.name ?: "Sticker",
            modifier = Modifier.size(160.dp),
        )
    }
}

/** The link previews the sender generated; the server never makes one. */
@Composable
fun EmbedList(embeds: List<Embed>) {
    val colors = chatColors
    val context = LocalContext.current
    Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (embed in embeds.take(4)) {
            Row(
                Modifier.widthIn(max = 380.dp).fillMaxWidth().clip(RoundedCornerShape(6.dp))
                    .background(colors.embedBg).clickable { openLink(context, embed.url) },
            ) {
                Box(Modifier.width(4.dp).heightIn(min = 48.dp).background(
                    embed.color?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() } ?: colors.brand,
                ))
                Column(Modifier.padding(10.dp)) {
                    embed.siteName?.let { Text(it, color = colors.textMuted, fontSize = 11.sp) }
                    embed.title?.let {
                        Text(it, color = colors.link, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    embed.description?.let {
                        Text(it, color = colors.textSubtle, fontSize = 13.sp, maxLines = 4, overflow = TextOverflow.Ellipsis)
                    }
                    val image = embed.image
                    if (image != null) {
                        Spacer(Modifier.height(6.dp))
                        val ratio = if (embed.imageW != null && embed.imageH != null && embed.imageH > 0) {
                            (embed.imageW.toFloat() / embed.imageH).coerceIn(0.5f, 2.5f)
                        } else {
                            16f / 9f
                        }
                        AsyncImage(
                            model = image,
                            contentDescription = embed.title,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxWidth().aspectRatio(ratio).clip(RoundedCornerShape(4.dp)),
                        )
                    }
                }
            }
        }
    }
}

fun formatSize(bytes: Long): String = when {
    bytes >= 1024L * 1024 * 1024 -> "%.1f GB".format(bytes / (1024.0 * 1024 * 1024))
    bytes >= 1024 * 1024 -> "%.1f MB".format(bytes / (1024.0 * 1024))
    bytes >= 1024 -> "%.0f KB".format(bytes / 1024.0)
    else -> "$bytes B"
}
