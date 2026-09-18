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
import xyz.evilion.chat.ui.pickers.ExpressionMode
import xyz.evilion.chat.ui.pickers.ExpressionSheet
import xyz.evilion.chat.ui.pickers.Expressions
import xyz.evilion.chat.ui.detached
import xyz.evilion.chat.ui.pickers.Pick
import xyz.evilion.chat.ui.theme.chatColors
import xyz.evilion.chat.ui.sheets.rememberSheetDismiss

/** What a long press on a message offers. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessageActions(
    message: UiMessage,
    channelId: String,
    serverId: String?,
    /** Opened by the `+` on the reaction row: skip the menu, show the picker. */
    startReacting: Boolean = false,
    onDismiss: () -> Unit,
    onReply: () -> Unit,
    onEdit: () -> Unit,
) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val dismiss = rememberSheetDismiss(sheet, onDismiss)
    val clipboard = LocalClipboardManager.current
    val me by AppState.me.collectAsState()
    val settings by SettingsStore.doc.collectAsState()
    var reacting by remember { mutableStateOf(startReacting) }

    val mine = message.raw.authorId == me?.id
    val perms = AppState.permissionsIn(channelId)
    val canManage = perms.has(P.MANAGE_MESSAGES)
    val canReact = message.raw.channelId.isNotEmpty() && (AppState.channels.value[channelId]?.isDm == true || perms.has(P.ADD_REACTIONS))
    val pinned = message.raw.flags and 1 != 0

    fun react(key: String) {
        detached { runCatching { MessageService.react(channelId, message.raw.id, key, true) } }
        dismiss()
    }

    /**
     * The picker replaces this sheet rather than stacking on top of it.
     *
     * A second `ModalBottomSheet` used to be mounted with this one still behind
     * it, scrimmed: two sheets, two scrims, and Back closing the wrong one.
     */
    if (reacting) {
        ExpressionSheet(
            serverId = serverId,
            mode = ExpressionMode.Reaction(AppState.nameFor(message.raw.authorId, serverId)),
            onDismiss = onDismiss,
            onEmoji = { key -> react(key) },
        )
        return
    }

    ModalBottomSheet(onDismissRequest = dismiss, sheetState = sheet, containerColor = colors.bgFloating) {
        Column(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
            if (canReact) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val recents = remember(settings) { Expressions.recentUnicode(settings).take(4) }
                    for (emoji in (recents + Expressions.QUICK).distinct().take(6)) {
                        TwemojiImage(
                            emoji, 28.dp,
                            modifier = Modifier.clickable {
                                Expressions.remember(Pick.Unicode(emoji, emoji))
                                react(emoji)
                            }.padding(4.dp),
                            fallbackSize = 26.sp,
                        )
                    }
                    Icon(
                        Lucide.Smile, t("chat.chat.more"),
                        tint = colors.icon,
                        modifier = Modifier.size(26.dp).clickable {
                            scope.launch {
                                sheet.hide()
                                reacting = true
                            }
                        },
                    )
                }
            }

            ActionRow(Lucide.Reply, t("chat.messageItem.reply")) { onReply() }
            if (mine && message.raw.ciphertext != null) ActionRow(Lucide.Pencil, t("pickers.stickerPicker.edit")) { onEdit() }
            if (!message.payload?.text.isNullOrEmpty()) {
                ActionRow(Lucide.Copy, t("messageActions.copyText")) {
                    clipboard.setText(AnnotatedString(message.payload?.text.orEmpty()))
                    dismiss()
                }
            }
            ActionRow(Lucide.Link2, t("server.packEditor.copyLink")) {
                val base = Api.baseUrl.trimEnd('/')
                val path = if (serverId != null) "$base/channels/$serverId/$channelId/${message.raw.id}"
                else "$base/channels/@me/$channelId/${message.raw.id}"
                clipboard.setText(AnnotatedString(path))
                dismiss()
            }
            ActionRow(Lucide.MessageCircleMore, t("messageActions.markUnread")) {
                detached {
                    val previous = AppState.messages(channelId).value
                        .filter { (it.raw.id.toLongOrNull() ?: 0) < (message.raw.id.toLongOrNull() ?: 0) }
                        .maxByOrNull { it.raw.id.toLongOrNull() ?: 0 }
                    val upTo = previous?.raw?.id ?: "0"
                    // show it straight away, as the web does, rather than
                    // waiting for the round trip to say nothing
                    AppState.putReadState(
                        (AppState.readStates.value[channelId] ?: xyz.evilion.chat.net.ReadState(channelId))
                            .copy(lastReadMessageId = upTo, unreadCount = 1),
                    )
                    runCatching {
                        xyz.evilion.chat.net.MessagesApi.ack(channelId, upTo, manual = true)
                    }
                }
                dismiss()
            }
            if (canManage || mine) {
                ActionRow(Lucide.Pin, if (pinned) t("chat.pins.unpin") else t("messageActions.pin")) {
                    detached {
                        runCatching {
                            if (pinned) ChannelsApi.unpin(channelId, message.raw.id)
                            else ChannelsApi.pin(channelId, message.raw.id)
                        }.onFailure { Session.toasts.emit(it.message ?: t("passcode.thatDidNotWork")) }
                    }
                    dismiss()
                }
            }
            if (mine || canManage) {
                ActionRow(Lucide.Trash2, t("chat.messageItem.delete"), colors.danger) {
                    detached {
                        runCatching { MessageService.delete(channelId, message.raw.id) }
                            .onFailure { Session.toasts.emit(it.message ?: t("messageActions.thatMessageCouldNotBeDeleted")) }
                    }
                    dismiss()
                }
            }
        }
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
