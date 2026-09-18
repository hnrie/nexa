package xyz.evilion.chat.ui.chat

import xyz.evilion.chat.i18n.Strings
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.icons.Lucide
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import xyz.evilion.chat.ui.common.TwemojiImage
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.MessageService
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.data.UiMessage
import xyz.evilion.chat.ui.Layer
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.common.Avatar
import xyz.evilion.chat.ui.markdown.InlineMarkdown
import xyz.evilion.chat.ui.markdown.MarkdownBlocks
import xyz.evilion.chat.ui.markdown.Markdown
import xyz.evilion.chat.ui.markdown.MdContext
import xyz.evilion.chat.ui.theme.chatColors
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Messages from the same person within this long are drawn as one group. */
private const val GROUP_WINDOW_MS = 7 * 60 * 1000L

@Composable
fun MessageRow(
    message: UiMessage,
    previous: UiMessage?,
    serverId: String?,
    onLongPress: () -> Unit,
    onReact: () -> Unit,
    onReply: () -> Unit,
) {
    val colors = chatColors
    val me by AppState.me.collectAsState()
    val author = AppState.user(message.raw.authorId)
    val grouped = previous != null &&
        previous.raw.authorId == message.raw.authorId &&
        previous.raw.type != "system_join" &&
        message.raw.type == "default" &&
        message.raw.replyToId == null &&
        message.raw.createdAt - previous.raw.createdAt < GROUP_WINDOW_MS

    if (message.raw.type.startsWith("system_")) {
        SystemMessage(message, serverId)
        return
    }

    val dayBreak = previous != null && !sameDay(previous.raw.createdAt, message.raw.createdAt)
    val mentionsMe = message.raw.mentionEveryone || (me?.id != null && me!!.id in message.raw.mentions)
    val ctx = rememberMdContext(serverId)

    Column(Modifier.fillMaxWidth()) {
    if (dayBreak || previous == null) DayDivider(message.raw.createdAt)

    SwipeToReply(enabled = message.raw.type == "default" || message.raw.type == "reply", onReply = onReply) {
    Column(
        Modifier.fillMaxWidth()
            .background(if (mentionsMe) colors.mentionBg.copy(alpha = 0.18f) else Color.Transparent)
            .combinedClickable(onClick = {}, onLongClick = onLongPress)
            .padding(horizontal = 12.dp, vertical = if (grouped) 1.dp else 4.dp),
    ) {
        message.raw.replyToId?.let { ReplyPreview(it, message.raw.channelId, serverId) }

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            if (grouped) {
                Spacer(Modifier.width(40.dp))
            } else {
                Avatar(
                    message.raw.authorId,
                    AppState.nameFor(message.raw.authorId, serverId),
                    author?.avatarId,
                    36.dp,
                    Modifier.clickable { Nav.push(Layer.Profile(message.raw.authorId, serverId)) },
                )
                Spacer(Modifier.width(4.dp))
            }
            Column(Modifier.weight(1f)) {
                if (!grouped) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            AppState.nameFor(message.raw.authorId, serverId),
                            color = roleColor(serverId, message.raw.authorId) ?: colors.textStrong,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 15.sp,
                            modifier = Modifier.clickable { Nav.push(Layer.Profile(message.raw.authorId, serverId)) },
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(shortTime(message.raw.createdAt), color = colors.textMuted, fontSize = 11.sp)
                        if (message.raw.flags and 1 != 0) {
                            Spacer(Modifier.width(4.dp))
                            Icon(Lucide.Pin, t("messageRow.pinned"), tint = colors.textMuted, modifier = Modifier.size(12.dp))
                        }
                    }
                }

                when {
                    message.decryptError == "no_key" -> Locked(t("messageRow.waitingForTheKeyToThis"))
                    message.decryptError == "bad" -> Locked(t("chat.messageItem.thisMessageCouldNotBeDecrypted"))
                    else -> {
                        val payload = message.payload
                        val nodes = remember(payload?.text) { Markdown.parse(payload?.text.orEmpty()) }
                        val onlyEmoji = remember(nodes) { Markdown.onlyEmoji(nodes) }
                        if (!payload?.text.isNullOrEmpty()) {
                            MarkdownBlocks(
                                nodes = nodes,
                                ctx = ctx,
                                emojiSize = if (onlyEmoji in 1..27) 40 else 20,
                                style = MaterialTheme.typography.bodyMedium.copy(color = colors.text),
                            )
                        }
                        payload?.sticker?.let { StickerView(it) }
                        payload?.attachments?.let { if (it.isNotEmpty()) AttachmentList(it, message.raw.channelId) }
                        payload?.embeds?.let { if (it.isNotEmpty() && message.raw.flags and 4 == 0) EmbedList(it) }
                    }
                }

                if (message.raw.editedAt != null) {
                    Text("edited", color = colors.textMuted, fontSize = 10.sp)
                }

                if (message.raw.reactions.isNotEmpty()) {
                    Reactions(message, onReact)
                }

                if (message.pending) {
                    Text(t("messageRow.sending"), color = colors.textMuted, fontSize = 11.sp)
                } else if (message.failed) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Lucide.CircleAlert, null, tint = colors.danger, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            t("messageRow.notSentTapToTryAgain"),
                            color = colors.danger,
                            fontSize = 11.sp,
                            modifier = Modifier.clickable {
                                Session.scope.launch {
                                    runCatching { MessageService.retry(message.raw.channelId, message.id) }
                                }
                            },
                        )
                        Spacer(Modifier.width(10.dp))
                        // Retrying is the only thing this offered, so a message
                        // the server will never take — no permission, too long —
                        // sat at the bottom of the conversation for good.
                        Text(
                            t("messageRow.discard"),
                            color = colors.textMuted,
                            fontSize = 11.sp,
                            modifier = Modifier.clickable {
                                MessageService.dropFailed(message.raw.channelId, message.id)
                            },
                        )
                    }
                }
            }
        }
    }
    }
    }
}

@Composable
private fun Locked(text: String) {
    val colors = chatColors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Lucide.Lock, null, tint = colors.textMuted, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, color = colors.textMuted, fontSize = 13.sp, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)
    }
}

@Composable
fun rememberMdContext(serverId: String?): MdContext {
    val users by AppState.users.collectAsState()
    val channels by AppState.channels.collectAsState()
    val servers by AppState.servers.collectAsState()
    val me by AppState.me.collectAsState()
    val context = androidx.compose.ui.platform.LocalContext.current
    return remember(users.size, channels.size, servers.size, serverId, me?.id) {
        MdContext(
            nameOfUser = { id -> AppState.nameFor(id, serverId).takeIf { it != "Unknown" } },
            nameOfChannel = { id -> channels[id]?.name },
            roleName = { id ->
                servers[serverId]?.roles?.get(id)?.let { role ->
                    (if (role.id == serverId) "everyone" else role.name) to role.color
                }
            },
            onUser = { Nav.push(Layer.Profile(it, serverId)) },
            onChannel = { id ->
                val channel = channels[id] ?: return@MdContext
                if (!channel.isCategory) Nav.openChannel(channel.serverId, channel.id)
            },
            onLink = { url -> openLink(context, url) },
            meId = me?.id,
            myRoleIds = servers[serverId]?.me?.roleIds?.toSet() ?: emptySet(),
        )
    }
}

fun openLink(context: android.content.Context, url: String) {
    runCatching {
        val invite = Regex("/invite/([A-Za-z0-9_-]+)").find(url)
        if (invite != null && url.startsWith(xyz.evilion.chat.net.Api.baseUrl)) {
            Nav.go(xyz.evilion.chat.ui.Route.Invite(invite.groupValues[1]))
            return
        }
        context.startActivity(
            android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

/** A role's colour for a name, if the member's highest coloured role has one. */
@Composable
private fun roleColor(serverId: String?, userId: String): Color? {
    val servers by AppState.servers.collectAsState()
    val state = servers[serverId ?: return null] ?: return null
    val member = state.members[userId] ?: return null
    val role = member.roleIds.mapNotNull { state.roles[it] }.filter { it.color != 0 }.maxByOrNull { it.position }
    return role?.let { Color(0xFF000000.toInt() or it.color) }
}

@Composable
private fun ReplyPreview(messageId: String, channelId: String, serverId: String?) {
    val colors = chatColors
    val messages by AppState.messages(channelId).collectAsState()
    val target = messages.firstOrNull { it.raw.id == messageId }
    val ctx = rememberMdContext(serverId)
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Lucide.Reply, null, tint = colors.textMuted, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(4.dp))
        if (target == null) {
            Text(t("messageRow.originalMessage"), color = colors.textMuted, fontSize = 12.sp)
        } else {
            val author = AppState.nameFor(target.raw.authorId, serverId)
            Text("$author  ", color = colors.textSubtle, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Box(Modifier.weight(1f)) {
                InlineMarkdown(
                    nodes = remember(target.payload?.text) { Markdown.parseInline(target.payload?.text.orEmpty().take(120)) },
                    ctx = ctx,
                    emojiSize = 14,
                    style = MaterialTheme.typography.bodySmall.copy(color = colors.textMuted, fontSize = 12.sp),
                )
            }
        }
    }
}

@Composable
private fun Reactions(message: UiMessage, onReact: () -> Unit) {
    val colors = chatColors
    Row(
        Modifier.fillMaxWidth().padding(top = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for (reaction in message.raw.reactions.take(12)) {
            val custom = Regex("^(a)?:([^:]+):(\\d+)$").find(reaction.emoji)
            Row(
                Modifier.clip(RoundedCornerShape(8.dp))
                    .background(if (reaction.me) colors.mentionBg else colors.bgSurface)
                    .border(1.dp, if (reaction.me) colors.brand else Color.Transparent, RoundedCornerShape(8.dp))
                    .clickable {
                        Session.scope.launch {
                            runCatching {
                                MessageService.react(message.raw.channelId, message.raw.id, reaction.emoji, !reaction.me)
                            }
                        }
                    }
                    .padding(horizontal = 6.dp, vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (custom != null) {
                    coil3.compose.AsyncImage(
                        model = xyz.evilion.chat.media.Media.emoji(custom.groupValues[3], 64),
                        contentDescription = custom.groupValues[2],
                        modifier = Modifier.size(16.dp),
                    )
                } else {
                    TwemojiImage(reaction.emoji, 16.dp, fallbackSize = 14.sp)
                }
                Spacer(Modifier.width(4.dp))
                Text(
                    reaction.count.toString(),
                    color = if (reaction.me) colors.textStrong else colors.textMuted,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
        // Adding a reaction that nobody has used yet was reachable only by
        // long-pressing the message, which is not something anyone discovers.
        // Beside reactions that are already there, a plus is obvious.
        Row(
            Modifier.clip(RoundedCornerShape(8.dp))
                .background(colors.bgSurface)
                .clickable(onClick = onReact)
                .padding(horizontal = 7.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Lucide.Smile,
                t("messageRow.addAReaction"),
                tint = colors.textMuted,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

@Composable
private fun SystemMessage(message: UiMessage, serverId: String?) {
    val colors = chatColors
    val name = AppState.nameFor(message.raw.authorId, serverId)
    val text = when (message.raw.type) {
        "system_join" -> "$name joined."
        "system_pin" -> "$name pinned a message."
        "system_call" -> "$name started a call."
        "system_member_add" -> "$name added someone to the group."
        "system_member_remove" -> "$name left the group."
        else -> message.payload?.text ?: ""
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = colors.textMuted, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.width(6.dp))
        Text(shortTime(message.raw.createdAt), color = colors.textPlaceholder, fontSize = 11.sp)
    }
}

@Composable
private fun DayDivider(timestamp: Long) {
    val colors = chatColors
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.weight(1f).height(1.dp).background(colors.borderSubtle))
        Text(
            dayLabel(timestamp),
            color = colors.textMuted,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        Box(Modifier.weight(1f).height(1.dp).background(colors.borderSubtle))
    }
}

/**
 * Dates and times in the language the app is set to, not the phone's.
 *
 * Someone reading Nexa in Arabic on an English phone wants Arabic months
 * beside Arabic words. A formatter is built once per language and kept, since
 * building one is the expensive part and a message list asks for hundreds.
 */
private val formats = HashMap<String, SimpleDateFormat>()

private fun format(pattern: String): SimpleDateFormat = synchronized(formats) {
    formats.getOrPut("${Strings.tag}:$pattern") {
        SimpleDateFormat(pattern, Locale.forLanguageTag(Strings.tag))
    }
}

/** The long date the profile sheet shows, in the app's language. */
fun longDate(millis: Long): String =
    java.text.DateFormat.getDateInstance(java.text.DateFormat.LONG, Locale.forLanguageTag(Strings.tag)).format(Date(millis))

fun shortTime(millis: Long): String = format("HH:mm").format(Date(millis))

fun dayLabel(millis: Long): String {
    val now = Calendar.getInstance()
    val then = Calendar.getInstance().apply { timeInMillis = millis }
    val sameYear = now.get(Calendar.YEAR) == then.get(Calendar.YEAR)
    val dayDelta = now.get(Calendar.DAY_OF_YEAR) - then.get(Calendar.DAY_OF_YEAR)
    return when {
        sameYear && dayDelta == 0 -> t("modals.customStatus.today")
        sameYear && dayDelta == 1 -> t("messageRow.yesterday")
        else -> format("d MMMM yyyy").format(Date(millis))
    }
}

fun sameDay(a: Long, b: Long): Boolean {
    val first = Calendar.getInstance().apply { timeInMillis = a }
    val second = Calendar.getInstance().apply { timeInMillis = b }
    return first.get(Calendar.YEAR) == second.get(Calendar.YEAR) &&
        first.get(Calendar.DAY_OF_YEAR) == second.get(Calendar.DAY_OF_YEAR)
}
