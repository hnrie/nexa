package fish.nexa.ui.media

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import fish.nexa.data.PendingMessage
import fish.nexa.data.PendingUpload
import fish.nexa.data.Send
import fish.nexa.media.Media
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.boxShadow
import fish.nexa.ui.theme.brandGradient
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowLow
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import java.io.File

/**
 * UploadCard.tsx: files on their way up, in place of the attachments of the
 * message being sent: the first picture (with "+N" for more), the name and
 * total, a bar with the accent's glow, the speed and how much has gone, and a
 * cancel while it runs. A failure says why in red; the row offers Retry.
 */
@Composable
fun UploadCard(channelId: String, p: PendingMessage, up: PendingUpload) {
    val c = Nx.colors
    val failed = p.status == "failed"
    val files = up.files
    val first = files.firstOrNull()
    val name = if (files.size == 1) first?.name ?: "" else t("chat.upload.files", "count" to files.size)
    val fraction = if (up.total > 0) minOf(1f, up.loaded.toFloat() / up.total) else if (up.done) 1f else 0f
    val pct = if (up.done) 100 else (fraction * 100).toInt()
    val shown by animateFloatAsState(if (failed) maxOf(pct, 2) / 100f else pct / 100f, tween(if (Nx.motion.reduced) 0 else 200, easing = LinearEasing), label = "upload")
    val picture = files.firstOrNull { it.preview != null && it.type.startsWith("image/") }
    val going = !up.done && !failed
    val shape = Radii.Md
    Row(
        Modifier
            .padding(top = 4.dp)
            .widthIn(max = 440.dp)
            .fillMaxWidth()
            .shadowLow(shape, c)
            .ring(shape, c.borderSubtle)
            .background(c.bgSurface, shape)
            .background(sheen(c), shape)
            .topEdge(shape, c.edgeLight)
            .padding(start = 12.dp, end = 10.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(48.dp).clip(Radii.Xs).background(c.bgInput), contentAlignment = Alignment.Center) {
            if (picture?.preview != null) AsyncImage(File(picture.preview), null, imageLoader = Media.loader, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            else Icon(
                when {
                    first?.type?.startsWith("video/") == true -> "FileVideo"
                    first?.type?.startsWith("audio/") == true -> "FileAudio"
                    else -> "File"
                },
                c.textMuted, size = 22.dp,
            )
            if (files.size > 1) Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(2.dp)
                    .background(Color(0xA6000000), RoundedCornerShape(6.dp))
                    .padding(horizontal = 4.dp),
            ) { Txt("+${files.size - 1}", style = Nx.type.hint.copy(fontSize = Nx.type.sp(11f), fontWeight = FontWeight(700), lineHeight = Nx.type.sp(16f)), color = Color.White) }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                Txt(name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(500)), color = c.textStrong, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                Txt(Time.bytes(up.total), style = Nx.type.hint, color = c.textMuted, maxLines = 1)
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(c.bgActive)
                    .semantics {
                        contentDescription = t("chat.upload.uploading", "name" to name)
                        progressBarRangeInfo = ProgressBarRangeInfo(pct / 100f, 0f..1f)
                    },
            ) {
                Box(
                    Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(shown.coerceIn(0f, 1f))
                        .then(if (failed) Modifier.background(c.danger, RoundedCornerShape(3.dp)) else Modifier.boxShadow(RoundedCornerShape(3.dp), 0f, 10f, c.brand.copy(alpha = 0.6f)).background(brandGradient(c), RoundedCornerShape(3.dp))),
                )
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val stats = Nx.type.hint.copy(fontFeatureSettings = "tnum")
                when {
                    failed && up.error != null -> Txt(up.error, style = stats, color = c.textDanger, maxLines = 1, modifier = Modifier.weight(1f))
                    up.done -> Txt(t("messageRow.sending"), style = stats, color = c.textMuted, maxLines = 1, modifier = Modifier.weight(1f))
                    else -> Txt(
                        "$pct%" + if (up.speed > 0) " · " + t("chat.upload.speed", "size" to Time.bytes(up.speed.toLong())) else "",
                        style = stats, color = c.textMuted, maxLines = 1, modifier = Modifier.weight(1f),
                    )
                }
                if (going) Txt(t("chat.upload.ofTotal", "sent" to Time.bytes(up.loaded), "total" to Time.bytes(up.total)), style = stats, color = c.textMuted, maxLines = 1)
            }
        }
        if (going) {
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            Box(
                Modifier
                    .align(Alignment.Top)
                    .size(40.dp)
                    .pressable(interaction) { Send.discardPending(channelId, p.tmpId) }
                    .semantics { contentDescription = t("chat.upload.cancel") },
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(28.dp).clip(CircleShape).background(if (pressed) c.bgHover else Color.Transparent), contentAlignment = Alignment.Center) {
                    Icon("X", if (pressed) c.danger else c.textMuted, size = 16.dp)
                }
            }
        }
    }
}
