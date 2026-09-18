package xyz.evilion.chat.ui.chat

import xyz.evilion.chat.i18n.Strings
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.icons.Lucide
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
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
import androidx.compose.foundation.interaction.MutableInteractionSource
import xyz.evilion.chat.data.SettingsStore
import androidx.compose.foundation.layout.offset

/** Messages from the same person within this long are drawn as one group. */
private const val GROUP_WINDOW_MS = 7 * 60 * 1000L

/**
 * The gutter the avatar hangs in, and the text that lines up beside it.
 *
 * These are the web client's phone numbers (Chat.module.css: `.msg` is padded
 * `64px 16px` below 768px, `.avatar` sits 12px in and is 40px across), so the
 * same conversation reads at the same rhythm in the browser and on the phone.
 */
private val ROW_START = 12.dp
private val ROW_END = 16.dp
private val AVATAR = 40.dp
private val GUTTER = 52.dp

@Composable
fun MessageRow(
    message: UiMessage,
    previous: UiMessage?,
    serverId: String?,
    /** Flashed for a moment after a jump landed on it, as the web client does. */
    highlight: Boolean = false,
    /** The first message you had not read when you opened the conversation. */
    firstUnread: Boolean = false,
    onLongPress: () -> Unit,
    onReact: () -> Unit,
    onReply: () -> Unit,
) {
    val colors = chatColors
    val me by AppState.me.collectAsState()
    val author = AppState.user(message.raw.authorId)
    // the same rule as web/src/components/chat/MessageList.tsx `shouldGroup`
    val grouped = previous != null &&
        previous.raw.authorId == message.raw.authorId &&
        !previous.raw.type.startsWith("system_") &&
        (message.raw.type == "default" || message.raw.type == "reply") &&
        message.raw.replyToId == null &&
        message.raw.createdAt - previous.raw.createdAt <= GROUP_WINDOW_MS &&
        sameDay(previous.raw.createdAt, message.raw.createdAt)

    if (message.raw.type.startsWith("system_")) {
        SystemMessage(message, serverId)
        return
    }

    val dayBreak = previous != null && !sameDay(previous.raw.createdAt, message.raw.createdAt)
    val mentionsMe = message.raw.mentionEveryone || (me?.id != null && me!!.id in message.raw.mentions)
    val ctx = rememberMdContext(serverId)
    val isReply = message.raw.replyToId != null
    // the account's font size, the same 12-20 px the web's slider sets
    val scale = SettingsStore.fontScale.coerceIn(0.75f, 1.25f)
    val text = MaterialTheme.typography.bodyLarge.copy(
        color = colors.text,
        fontSize = 16.sp * scale,
        lineHeight = 22.sp * scale,
    )

    Column(Modifier.fillMaxWidth()) {
    if (firstUnread) UnreadDivider()
    if (dayBreak || previous == null) DayDivider(message.raw.createdAt)

    // `.msg[data-group-start] { margin-top: 17px }` — a margin, not padding, so
    // the gap is outside the row's own background and a mentioned message does
    // not paint a purple band above itself.
    if (!grouped) Spacer(Modifier.height(17.dp))

    SwipeToReply(enabled = message.raw.type == "default" || message.raw.type == "reply", onReply = onReply) {
    Box(
        Modifier.fillMaxWidth().background(
            when {
                highlight -> colors.brand.copy(alpha = 0.4f)
                mentionsMe -> colors.mentionBg
                else -> Color.Transparent
            },
        ),
    ) {
    // the 2px rule the web draws down the leading edge of a message that pings you
    if (mentionsMe) Box(Modifier.align(Alignment.CenterStart).width(2.dp).fillMaxHeight().background(colors.warning))
    Column(
        Modifier.fillMaxWidth()
            // No ripple: a tap on a message does nothing, and a press that
            // lights up and then does nothing reads as a broken button. The
            // long press keeps its semantics, so TalkBack still offers the
            // actions — which are otherwise unreachable without sight.
            .combinedClickable(
                onClick = {},
                onLongClick = onLongPress,
                onLongClickLabel = t("messageActions.messageActions"),
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
            )
            .padding(start = ROW_START, end = ROW_END, top = 2.dp, bottom = 2.dp)
            .alpha(if (message.pending) 0.55f else 1f),
    ) {
        message.raw.replyToId?.let { ReplyPreview(it, message.raw.channelId, serverId) }

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            if (grouped) {
                Spacer(Modifier.width(GUTTER))
            } else {
                Avatar(
                    message.raw.authorId,
                    AppState.nameFor(message.raw.authorId, serverId),
                    author?.avatarId,
                    AVATAR,
                    Modifier.clickable { Nav.push(Layer.Profile(message.raw.authorId, serverId)) },
                )
                Spacer(Modifier.width(GUTTER - AVATAR))
            }
            Column(Modifier.weight(1f)) {
                if (!grouped) {
                    Row(
                        Modifier.height(22.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            AppState.nameFor(message.raw.authorId, serverId),
                            color = roleColor(serverId, message.raw.authorId) ?: colors.textStrong,
                            fontWeight = FontWeight.Medium,
                            fontSize = 16.sp,
                            modifier = Modifier.clickable { Nav.push(Layer.Profile(message.raw.authorId, serverId)) },
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            messageStamp(message.raw.createdAt),
                            color = colors.textMuted,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                        )
                        if (message.raw.flags and 1 != 0) {
                            Spacer(Modifier.width(4.dp))
                            Icon(Lucide.Pin, t("messageRow.pinned"), tint = colors.textMuted, modifier = Modifier.size(12.dp))
                        }
                    }
                }

                when {
                    message.decryptError == "no_key" -> Locked(t("chat.messageItem.waitingForTheEncryptionKey"))
                    message.decryptError == "bad" -> Locked(t("chat.messageItem.thisMessageCouldNotBeDecrypted"))
                    else -> {
                        val payload = message.payload
                        val nodes = remember(payload?.text) { Markdown.parse(payload?.text.orEmpty()) }
                        // one to three emoji get the big treatment; a wall of
                        // them shrinks so it still fits a line, the same three
                        // sizes web/src/components/chat/MessageItem.tsx picks
                        val jumbo = remember(nodes) {
                            when (val n = Markdown.onlyEmoji(nodes)) {
                                in 1..3 -> 48.dp
                                in 4..8 -> 36.dp
                                in 9..30 -> 28.dp
                                else -> null
                            }
                        }
                        if (!payload?.text.isNullOrEmpty()) {
                            MarkdownBlocks(
                                nodes = nodes,
                                ctx = ctx,
                                emojiSize = jumbo,
                                style = text,
                                edited = if (message.raw.editedAt != null) t("chat.messageItem.edited") else null,
                            )
                        } else if (message.raw.editedAt != null) {
                            Text(t("chat.messageItem.edited"), color = colors.textMuted, fontSize = 10.sp)
                        }
                        payload?.sticker?.let { StickerView(it) }
                        payload?.attachments?.let { if (it.isNotEmpty()) AttachmentList(it) }
                        payload?.embeds?.let { if (it.isNotEmpty() && message.raw.flags and 4 == 0) EmbedList(it) }
                    }
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

/**
 * The line above a reply that says what it is answering.
 *
 * It is the web client's `.replyLine`: the author's avatar and name, then as
 * much of the message as fits on one line, with a spine that hooks up out of
 * the avatar gutter into it so the two rows read as one thing. It used to be a
 * reply arrow and a name at an indent of its own, which lined up with nothing
 * and gave no sense of which message it belonged to.
 */
@Composable
private fun ReplyPreview(messageId: String, channelId: String, serverId: String?) {
    val colors = chatColors
    val messages by AppState.messages(channelId).collectAsState()
    val target = messages.firstOrNull { it.raw.id == messageId }
    val ctx = rememberMdContext(serverId)
    val author = target?.let { AppState.user(it.raw.authorId) }
    Row(
        Modifier.fillMaxWidth().height(24.dp).clickable {
            target?.let { Nav.jumpTo(channelId, it.raw.id) }
        },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Spine(Modifier.width(GUTTER).fillMaxHeight())
        if (target == null) {
            Text(
                t("chat.messageItem.originalMessageWasDeletedOrIs"),
                color = colors.textMuted,
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        } else {
            val name = AppState.nameFor(target.raw.authorId, serverId)
            Avatar(target.raw.authorId, name, author?.avatarId, 16.dp)
            Spacer(Modifier.width(6.dp))
            Text(
                name,
                color = colors.text,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                modifier = Modifier.clickable { Nav.push(Layer.Profile(target.raw.authorId, serverId)) },
            )
            Spacer(Modifier.width(6.dp))
            InlineMarkdown(
                nodes = remember(target.payload?.text) { Markdown.parseInline(target.payload?.text.orEmpty().take(120)) },
                ctx = ctx,
                emojiSize = 14.dp,
                style = MaterialTheme.typography.bodySmall.copy(color = colors.textMuted, fontSize = 14.sp),
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** The elbow that joins a reply line to the avatar of the message below it. */
@Composable
private fun Spine(modifier: Modifier) {
    val colors = chatColors
    Canvas(modifier) {
        val stroke = 2.dp.toPx()
        val x = 14.dp.toPx()
        val y = 11.dp.toPx()
        val radius = 6.dp.toPx()
        val path = Path().apply {
            moveTo(x, size.height)
            lineTo(x, y + radius)
            quadraticTo(x, y, x + radius, y)
            lineTo(size.width, y)
        }
        drawPath(path, colors.borderStrong, style = Stroke(width = stroke))
    }
}

/**
 * The reaction pills under a message, at the web client's size.
 *
 * A plain `Row` ran the fifth and later pills off the edge of a 360 dp phone
 * with no way to see or tap them; the web wraps its reaction row, so this does
 * too.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Reactions(message: UiMessage, onReact: () -> Unit) {
    val colors = chatColors
    FlowRow(
        Modifier.fillMaxWidth().padding(top = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for (reaction in message.raw.reactions.take(24)) {
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
                    .height(24.dp).padding(horizontal = 6.dp),
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
                Spacer(Modifier.width(6.dp))
                Text(
                    reaction.count.toString(),
                    color = if (reaction.me) colors.textStrong else colors.textSubtle,
                    fontSize = 14.sp,
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
                .height(24.dp).padding(horizontal = 6.dp),
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

/**
 * A join, a pin, a call, someone added or gone.
 *
 * These were five English sentences built by hand, so an Arabic reader got
 * Arabic chrome with "Bob joined." in the middle of it; they are the web
 * client's own strings now, with its icon in its gutter.
 */
@Composable
private fun SystemMessage(message: UiMessage, serverId: String?) {
    val colors = chatColors
    val actor = AppState.nameFor(message.raw.authorId, serverId)
    val target = message.raw.mentions.firstOrNull()?.let { AppState.nameFor(it, serverId) } ?: t("names.unknownUser")
    val icon = when (message.raw.type) {
        "system_pin" -> Lucide.Pin
        "system_call" -> Lucide.Phone
        "system_member_remove" -> Lucide.ArrowLeftFromLine
        else -> Lucide.ArrowRightToLine
    }
    val text = when (message.raw.type) {
        "system_join" -> t("chat.systemMessage.joined", "actor" to actor)
        "system_pin" -> t("chat.systemMessage.pinned", "actor" to actor, "message" to t("chat.systemMessage.aMessage"))
        "system_call" -> t("chat.systemMessage.startedACall", "actor" to actor)
        "system_member_add" -> t("chat.systemMessage.addedToGroup", "actor" to actor, "target" to target)
        "system_member_remove" ->
            if (message.raw.mentions.firstOrNull() == message.raw.authorId) t("chat.systemMessage.leftGroup", "actor" to actor)
            else t("chat.systemMessage.removedFromGroup", "actor" to actor, "target" to target)
        else -> message.payload?.text ?: t("chat.systemMessage.didSomething", "actor" to actor)
    }
    Row(
        Modifier.fillMaxWidth().padding(top = 17.dp, bottom = 2.dp).padding(start = ROW_START, end = ROW_END),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(GUTTER), Alignment.CenterStart) {
            Icon(icon, null, tint = colors.textMuted, modifier = Modifier.size(18.dp))
        }
        Text(
            text,
            color = colors.textMuted,
            fontSize = 16.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        Spacer(Modifier.width(4.dp))
        Text(messageStamp(message.raw.createdAt), color = colors.textMuted, fontSize = 12.sp)
    }
}

/**
 * Where you stopped reading.
 *
 * Opening a conversation with forty unread messages dropped you at the bottom
 * with nothing to say where the new ones began. The web draws this rule at the
 * boundary; the boundary is frozen when the conversation opens, so it does not
 * creep down the screen as the messages are marked read.
 */
@Composable
private fun UnreadDivider() {
    val colors = chatColors
    Box(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.danger).align(Alignment.Center))
        Text(
            t("chat.messageList.new").uppercase(),
            color = Color.White,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.align(Alignment.CenterEnd).offset(y = 8.dp)
                .clip(RoundedCornerShape(bottomStart = 2.dp, bottomEnd = 2.dp))
                .background(colors.danger).padding(horizontal = 4.dp),
        )
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

/**
 * A clock reading, in the form the language writes one.
 *
 * This was a hardcoded "HH:mm", so every message on the phone was on a 24-hour
 * clock while the same account in the browser showed "10:42 PM". The pattern
 * now comes from the language, so both agree and a locale that writes 24-hour
 * still gets 24-hour.
 */
fun shortTime(millis: Long): String = format(bestPattern("jmm")).format(Date(millis))

/** What the web client puts beside a name: "Today at 10:42 PM", or the date. */
fun messageStamp(millis: Long): String {
    val now = System.currentTimeMillis()
    return when {
        sameDay(millis, now) -> t("time.todayAt", "time" to shortTime(millis))
        sameDay(millis, now - 86_400_000L) -> t("time.yesterdayAt", "time" to shortTime(millis))
        else -> t("time.dateAt", "date" to format(bestPattern("yMMdd")).format(Date(millis)), "time" to shortTime(millis))
    }
}

/** How this language writes a date or a time made of these fields. */
private fun bestPattern(skeleton: String): String = runCatching {
    android.icu.text.DateTimePatternGenerator
        .getInstance(Locale.forLanguageTag(Strings.tag))
        .getBestPattern(skeleton)
}.getOrElse { if (skeleton.startsWith("j")) "HH:mm" else "dd/MM/yyyy" }

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
