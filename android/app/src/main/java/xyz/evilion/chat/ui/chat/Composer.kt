package xyz.evilion.chat.ui.chat

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.icons.Lucide
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import xyz.evilion.chat.crypto.AttachmentMeta
import xyz.evilion.chat.crypto.Embed
import xyz.evilion.chat.crypto.StickerRef
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.MessageService
import xyz.evilion.chat.data.Mentions
import xyz.evilion.chat.data.P
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.data.UiMessage
import xyz.evilion.chat.data.has
import xyz.evilion.chat.media.PickedFile
import xyz.evilion.chat.media.Uploads
import xyz.evilion.chat.net.AttachmentRef
import xyz.evilion.chat.net.ChannelsApi
import xyz.evilion.chat.ui.common.Avatar
import xyz.evilion.chat.ui.pickers.EmojiPickerSheet
import xyz.evilion.chat.ui.pickers.GifPickerSheet
import xyz.evilion.chat.ui.pickers.StickerPickerSheet
import xyz.evilion.chat.ui.theme.chatColors

/** A file waiting to be sent with the next message. */
/**
 * A file waiting to be sent. The id is its own, not the content URI: picking
 * the same photo twice is ordinary, and two rows with one key is what makes a
 * lazy list throw.
 */
private data class Staged(
    val file: PickedFile,
    var progress: Float = 0f,
    var error: String? = null,
    val id: Long = nextStagedId++,
)

private var nextStagedId = 1L

/**
 * The box you type in: attachments, emoji, stickers and GIFs, replies and
 * edits, with the draft kept per conversation.
 */
@Composable
fun Composer(
    channelId: String,
    serverId: String?,
    replyTo: UiMessage?,
    editing: UiMessage?,
    onClearReply: () -> Unit,
    onClearEdit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = chatColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val channels by AppState.channels.collectAsState()
    val users by AppState.users.collectAsState()
    val channel = channels[channelId]
    val me by AppState.me.collectAsState()
    var value by remember(channelId) { mutableStateOf(TextFieldValue(SettingsStore.draft(channelId))) }
    var staged by remember(channelId) { mutableStateOf(listOf<Staged>()) }
    var sending by remember(channelId) { mutableStateOf(false) }
    var picker by remember { mutableStateOf<String?>(null) }
    var lastTyping by remember(channelId) { mutableStateOf(0L) }
    var slowModeUntil by remember(channelId) { mutableStateOf(0L) }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }

    val canSend = channel?.isDm == true || AppState.permissionsIn(channelId).has(P.SEND_MESSAGES)
    val canAttach = channel?.isDm == true || AppState.permissionsIn(channelId).has(P.ATTACH_FILES)

    LaunchedEffect(editing) {
        editing?.let {
            value = TextFieldValue(Mentions.humanize(it.payload?.text.orEmpty(), users), TextRange(Int.MAX_VALUE))
        }
    }

    LaunchedEffect(slowModeUntil) {
        while (slowModeUntil > System.currentTimeMillis()) {
            now = System.currentTimeMillis()
            delay(500)
        }
        now = System.currentTimeMillis()
    }

    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris: List<Uri> ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        val limit = AppState.instance.value?.maxUploadBytes ?: (100L * 1024 * 1024)
        val picked = uris.mapNotNull { uri ->
            runCatching {
                context.contentResolver.takePersistableUriPermission(uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val described = runCatching { Uploads.describe(context, uri) }.getOrNull() ?: return@mapNotNull null
            if (!Uploads.fits(described.size, limit)) {
                scope.launch { Session.toasts.emit("${described.name} is larger than this server accepts.") }
                null
            } else {
                Staged(described)
            }
        }
        staged = staged + picked
    }

    fun doSend() {
        if (sending) return
        val text = value.text.trim()
        val files = staged
        if (text.isEmpty() && files.isEmpty()) return
        sending = true
        scope.launch {
            try {
                if (editing != null) {
                    MessageService.edit(channelId, editing.raw.id, text)
                    onClearEdit()
                } else {
                    val metas = mutableListOf<AttachmentMeta>()
                    val refs = mutableListOf<AttachmentRef>()
                    for (item in files) {
                        val (meta, ref) = Uploads.send(
                            context, channelId, item.file,
                            singleLimit = AppState.instance.value?.uploadSingleBytes?.takeIf { it > 0 } ?: (90L * 1024 * 1024),
                            chunkLimit = AppState.instance.value?.uploadChunkBytes?.takeIf { it > 0 } ?: (32L * 1024 * 1024),
                        ) { done ->
                            staged = staged.map { if (it === item) it.copy(progress = done) else it }
                        }
                        metas += meta
                        refs += ref
                    }
                    MessageService.send(
                        channelId, text,
                        replyTo = replyTo?.raw?.id,
                        attachments = metas,
                        attachmentRefs = refs,
                    )
                    onClearReply()
                }
                value = TextFieldValue("")
                staged = emptyList()
                SettingsStore.setDraft(channelId, "")
                val slow = channel?.slowmodeSeconds ?: 0
                if (slow > 0 && !AppState.permissionsIn(channelId).has(P.MANAGE_MESSAGES)) {
                    slowModeUntil = System.currentTimeMillis() + slow * 1000L
                }
            } catch (e: Exception) {
                Session.toasts.emit(e.message ?: t("composer.send.yourMessageCouldNotBeSent"))
            } finally {
                sending = false
            }
        }
    }

    Column(modifier.fillMaxWidth().background(colors.bgBase)) {
        if (replyTo != null) {
            Row(
                Modifier.fillMaxWidth().background(colors.bgSurface).padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    t("composer.replyingTo", "name" to AppState.nameFor(replyTo.raw.authorId, serverId)),
                    color = colors.textMuted, fontSize = 12.sp, modifier = Modifier.weight(1f),
                )
                Icon(
                    Lucide.X, t("composer.composer.cancelReply"), tint = colors.icon,
                    modifier = Modifier.size(16.dp).clickable(onClick = onClearReply),
                )
            }
        }
        if (editing != null) {
            Row(
                Modifier.fillMaxWidth().background(colors.bgSurface).padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(t("composer.editingMessage"), color = colors.warning, fontSize = 12.sp, modifier = Modifier.weight(1f))
                Icon(
                    Lucide.X, t("composer.cancelEdit"), tint = colors.icon,
                    modifier = Modifier.size(16.dp).clickable {
                        onClearEdit()
                        value = TextFieldValue("")
                    },
                )
            }
        }

        if (staged.isNotEmpty()) {
            LazyRow(
                Modifier.fillMaxWidth().padding(8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(staged.size, key = { staged[it].id }) { index ->
                    val item = staged[index]
                    Box(Modifier.size(72.dp).clip(RoundedCornerShape(8.dp)).background(colors.bgSurface)) {
                        if (item.file.mime.startsWith("image/")) {
                            AsyncImage(
                                model = item.file.uri,
                                contentDescription = item.file.name,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.size(72.dp),
                            )
                        } else {
                            Text(
                                item.file.name.takeLast(14),
                                color = colors.textMuted, fontSize = 10.sp,
                                modifier = Modifier.align(Alignment.Center).padding(4.dp),
                            )
                        }
                        if (sending && item.progress < 1f) {
                            Box(Modifier.size(72.dp).background(colors.bgOverlay), Alignment.Center) {
                                CircularProgressIndicator(
                                    progress = { item.progress },
                                    modifier = Modifier.size(28.dp),
                                    color = Color.White,
                                    strokeWidth = 2.dp,
                                )
                            }
                        } else {
                            Icon(
                                Lucide.X, t("composer.composer.remove"),
                                tint = Color.White,
                                modifier = Modifier.align(Alignment.TopEnd).padding(2.dp).size(18.dp)
                                    .clip(CircleShape).background(colors.bgOverlay)
                                    .clickable { staged = staged.filterNot { it === item } },
                            )
                        }
                    }
                }
            }
        }

        MentionSuggestions(value, serverId) { replacement -> value = replacement }

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            if (canAttach) {
                IconButton(onClick = { pickFiles.launch(arrayOf("*/*")) }, enabled = !sending) {
                    Icon(Lucide.CirclePlus, t("composer.attach"), tint = colors.icon)
                }
            }
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp, max = 160.dp)
                    .clip(RoundedCornerShape(22.dp)).background(colors.bgComposer)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                val waiting = ((slowModeUntil - now) / 1000).toInt()
                if (value.text.isEmpty()) {
                    Text(
                        when {
                            !canSend -> t("composer.youCannotSendMessagesHere")
                            waiting > 0 -> t("composer.slowModeSeconds", "seconds" to waiting)
                            editing != null -> t("composer.editYourMessage")
                            else -> t("composer.composer.messageGroup", "name" to (channel?.let { AppState.channelName(it, me?.id) } ?: ""))
                        },
                        color = colors.textPlaceholder, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                BasicTextField(
                    value = value,
                    onValueChange = { next ->
                        value = next
                        SettingsStore.setDraft(channelId, next.text)
                        val nowMs = System.currentTimeMillis()
                        if (next.text.isNotEmpty() && nowMs - lastTyping > 8000) {
                            lastTyping = nowMs
                            scope.launch { runCatching { ChannelsApi.typing(channelId) } }
                        }
                    },
                    enabled = canSend && slowModeUntil <= now,
                    textStyle = androidx.compose.ui.text.TextStyle(color = colors.text, fontSize = 15.sp),
                    cursorBrush = SolidColor(colors.brand),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            IconButton(onClick = { picker = "emoji" }) {
                Icon(Lucide.Smile, t("modals.customStatus.emoji"), tint = colors.icon)
            }
            if (value.text.isBlank() && staged.isEmpty()) {
                IconButton(onClick = { picker = "gif" }) {
                    Icon(Lucide.Sticker, t("composer.gifsAndStickers"), tint = colors.icon)
                }
            } else {
                IconButton(onClick = { doSend() }, enabled = canSend && !sending) {
                    if (sending) CircularProgressIndicator(Modifier.size(20.dp), color = colors.brand, strokeWidth = 2.dp)
                    else Icon(Lucide.Send, t("composer.send"), tint = colors.brand)
                }
            }
        }
    }

    when (picker) {
        "emoji" -> EmojiPickerSheet(
            serverId = serverId,
            onDismiss = { picker = null },
            onPick = { token ->
                val at = value.selection.start.coerceIn(0, value.text.length)
                val next = value.text.substring(0, at) + token + value.text.substring(at)
                value = TextFieldValue(next, TextRange(at + token.length))
                picker = null
            },
        )
        "gif" -> GifPickerSheet(
            onDismiss = { picker = null },
            onPickGif = { gif ->
                picker = null
                scope.launch {
                    runCatching {
                        MessageService.send(
                            channelId, gif.url,
                            embeds = listOf(Embed(url = gif.url, type = "gif", image = gif.url, imageW = gif.w, imageH = gif.h)),
                        )
                    }
                }
            },
            onOpenStickers = { picker = "sticker" },
        )
        "sticker" -> StickerPickerSheet(
            onDismiss = { picker = null },
            onPick = { sticker ->
                picker = null
                scope.launch {
                    runCatching {
                        MessageService.send(
                            channelId, "",
                            sticker = StickerRef(
                                id = sticker.id, blob = sticker.blobId, name = sticker.name,
                                width = sticker.width, height = sticker.height, animated = sticker.animated,
                            ),
                        )
                    }
                }
            },
        )
    }
}

/** The list that comes up while typing `@`. */
@Composable
private fun MentionSuggestions(value: TextFieldValue, serverId: String?, onPick: (TextFieldValue) -> Unit) {
    val colors = chatColors
    val users by AppState.users.collectAsState()
    val caret = value.selection.start.coerceIn(0, value.text.length)
    val before = value.text.substring(0, caret)
    val match = Regex("(?:^|\\s)@([a-zA-Z0-9_.]{0,32})$").find(before) ?: return
    val query = match.groupValues[1].lowercase()
    val candidates = remember(query, users.size, serverId) {
        val pool = if (serverId != null) {
            AppState.servers.value[serverId]?.members?.keys?.mapNotNull { users[it] } ?: users.values.toList()
        } else {
            users.values.toList()
        }
        pool.filter { it.username.lowercase().contains(query) || it.displayName.lowercase().contains(query) }
            .sortedBy { it.username }.take(8)
    }
    if (candidates.isEmpty()) return

    Column(Modifier.fillMaxWidth().background(colors.bgFloating).padding(vertical = 4.dp)) {
        for (user in candidates) {
            Row(
                Modifier.fillMaxWidth().clickable {
                    val start = caret - match.groupValues[1].length - 1
                    val next = value.text.substring(0, start) + "@${user.username} " + value.text.substring(caret)
                    onPick(TextFieldValue(next, TextRange(start + user.username.length + 2)))
                }.padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(user.id, user.name, user.avatarId, 24.dp)
                Spacer(Modifier.width(8.dp))
                Text(user.name, color = colors.text, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.width(6.dp))
                Text("@${user.username}", color = colors.textMuted, fontSize = 12.sp)
            }
        }
    }
}
