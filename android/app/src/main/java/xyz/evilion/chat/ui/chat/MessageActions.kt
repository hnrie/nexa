package xyz.evilion.chat.ui.chat

import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.icons.Lucide
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import xyz.evilion.chat.ui.common.TwemojiImage
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.MessageService
import xyz.evilion.chat.data.P
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.data.UiMessage
import xyz.evilion.chat.data.has
import xyz.evilion.chat.net.Api
import xyz.evilion.chat.net.ChannelsApi
import xyz.evilion.chat.ui.pickers.EmojiPickerSheet
import xyz.evilion.chat.ui.theme.chatColors

private val QUICK = listOf("👍", "😂", "❤️", "🔥", "😮", "😢")

/** What a long press on a message offers. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessageActions(
    message: UiMessage,
    channelId: String,
    serverId: String?,
    onDismiss: () -> Unit,
    onReply: () -> Unit,
    onEdit: () -> Unit,
) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val clipboard = LocalClipboardManager.current
    val me by AppState.me.collectAsState()
    var pickingEmoji by remember { mutableStateOf(false) }

    val mine = message.raw.authorId == me?.id
    val perms = AppState.permissionsIn(channelId)
    val canManage = perms.has(P.MANAGE_MESSAGES)
    val canReact = message.raw.channelId.isNotEmpty() && (AppState.channels.value[channelId]?.isDm == true || perms.has(P.ADD_REACTIONS))
    val pinned = message.raw.flags and 1 != 0

    fun react(emoji: String) {
        scope.launch { runCatching { MessageService.react(channelId, message.raw.id, emoji, true) } }
        SettingsStore.rememberEmoji(emoji)
        onDismiss()
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = colors.bgFloating) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 8.dp)) {
            if (canReact) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val recents = SettingsStore.recentEmoji.filter { !it.startsWith("<") }.take(4)
                    for (emoji in (recents + QUICK).distinct().take(6)) {
                        TwemojiImage(emoji, 28.dp, modifier = Modifier.clickable { react(emoji) }.padding(4.dp), fallbackSize = 26.sp)
                    }
                    Icon(
                        Lucide.Smile, t("chat.chat.more"),
                        tint = colors.icon,
                        modifier = Modifier.size(26.dp).clickable { pickingEmoji = true },
                    )
                }
            }

            ActionRow(Lucide.Reply, t("chat.messageItem.reply")) { onReply() }
            if (mine && message.raw.ciphertext != null) ActionRow(Lucide.Pencil, t("pickers.stickerPicker.edit")) { onEdit() }
            if (!message.payload?.text.isNullOrEmpty()) {
                ActionRow(Lucide.Copy, t("messageActions.copyText")) {
                    clipboard.setText(AnnotatedString(message.payload?.text.orEmpty()))
                    onDismiss()
                }
            }
            ActionRow(Lucide.Link2, t("server.packEditor.copyLink")) {
                val base = Api.baseUrl.trimEnd('/')
                val path = if (serverId != null) "$base/channels/$serverId/$channelId/${message.raw.id}"
                else "$base/channels/@me/$channelId/${message.raw.id}"
                clipboard.setText(AnnotatedString(path))
                onDismiss()
            }
            ActionRow(Lucide.MessageCircleMore, t("messageActions.markUnread")) {
                scope.launch {
                    val previous = AppState.messages(channelId).value
                        .filter { (it.raw.id.toLongOrNull() ?: 0) < (message.raw.id.toLongOrNull() ?: 0) }
                        .maxByOrNull { it.raw.id.toLongOrNull() ?: 0 }
                    runCatching {
                        xyz.evilion.chat.net.MessagesApi.ack(channelId, previous?.raw?.id ?: "0")
                    }
                }
                onDismiss()
            }
            if (canManage || mine) {
                ActionRow(Lucide.Pin, if (pinned) t("chat.pins.unpin") else t("messageActions.pin")) {
                    scope.launch {
                        runCatching {
                            if (pinned) ChannelsApi.unpin(channelId, message.raw.id)
                            else ChannelsApi.pin(channelId, message.raw.id)
                        }.onFailure { Session.toasts.emit(it.message ?: t("passcode.thatDidNotWork")) }
                    }
                    onDismiss()
                }
            }
            if (mine || canManage) {
                ActionRow(Lucide.Trash2, t("chat.messageItem.delete"), colors.danger) {
                    scope.launch {
                        runCatching { MessageService.delete(channelId, message.raw.id) }
                            .onFailure { Session.toasts.emit(it.message ?: t("messageActions.thatMessageCouldNotBeDeleted")) }
                    }
                    onDismiss()
                }
            }
        }
    }

    if (pickingEmoji) {
        EmojiPickerSheet(
            serverId = serverId,
            onDismiss = { pickingEmoji = false },
            onPick = { token ->
                pickingEmoji = false
                // a custom emoji reacts by its key, not its markdown token
                val custom = Regex("^<(a)?:([^:]+):(\\d+)>$").find(token)
                react(if (custom != null) "${custom.groupValues[1]}:${custom.groupValues[2]}:${custom.groupValues[3]}" else token)
            },
        )
    }
}

@Composable
private fun ActionRow(icon: ImageVector, label: String, tint: Color? = null, onClick: () -> Unit) {
    val colors = chatColors
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = tint ?: colors.icon, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(16.dp))
        Text(label, color = tint ?: colors.text, fontSize = 15.sp)
    }
}
