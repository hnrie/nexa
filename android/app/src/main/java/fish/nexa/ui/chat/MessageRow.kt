package fish.nexa.ui.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.ChatMessage
import fish.nexa.data.DecryptFail
import fish.nexa.data.PendingMessage
import fish.nexa.data.Send
import fish.nexa.data.ServerState
import fish.nexa.net.Channel
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.media.Unfurl
import fish.nexa.media.isOnlyMediaLinks
import fish.nexa.ui.media.Attachments
import fish.nexa.ui.media.Embeds
import fish.nexa.ui.media.HookBody
import fish.nexa.ui.media.PressedImage
import fish.nexa.ui.media.UploadCard
import fish.nexa.ui.shell.Names
import fish.nexa.ui.shell.openProfile
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.boxShadow
import kotlinx.coroutines.delay

/** What every row in one conversation shares. */
data class ListCtx(
    val channel: Channel,
    val server: ServerState?,
    val compact: Boolean,
    val selecting: Boolean,
    val meId: String,
)

/** A message or a pending send, as the list lays it out. */
data class MsgItem(
    val key: String,
    val cm: ChatMessage? = null,
    val pending: PendingMessage? = null,
    val groupStart: Boolean,
    val mentionsMe: Boolean = false,
) {
    val authorId get() = cm?.authorId ?: pending!!.authorId
    val createdAt get() = cm?.m?.createdAt ?: pending!!.createdAt
    val replyToId get() = cm?.m?.replyToId ?: pending?.replyToId
}

/**
 * MessageItem.tsx on a phone: a flat row edge to edge, the avatar in a 64 dp
 * gutter on the first row of a group, then the name, tag and time, then what
 * was said. Every action is in the long-press menu; swiping it against the
 * reading direction replies.
 */
@Composable
fun MessageRow(item: MsgItem, ctx: ListCtx, flashSeq: Int?, picked: Boolean, canPick: Boolean) {
    val c = Nx.colors
    val cm = item.cm
    val p = item.pending
    val reply = item.replyToId
    val start = item.groupStart || reply != null
    val showHead = start && !ctx.compact || (ctx.compact && start)
    val failed = p?.status == "failed"
    val uploading = p?.upload != null && p.upload.done.not()
    val swipe = rememberRowSwipe()
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val density = androidx.compose.ui.platform.LocalDensity.current.density
    val menuOpen = cm != null && ChatUi.menuFor == cm.id

    // jump-to flash: the accent fading out over two seconds (a steady tint with reduced motion)
    val flash = remember { Animatable(0f) }
    val reduced = Nx.motion.reduced
    val ease = Nx.motion.easeOut
    LaunchedEffect(flashSeq) {
        if (flashSeq == null) return@LaunchedEffect
        if (reduced) {
            flash.snapTo(1f); delay(2000); flash.snapTo(0f)
        } else {
            flash.snapTo(1f); flash.animateTo(0f, tween(2000, easing = ease))
        }
    }
    val tint = when {
        picked -> c.bgSelected
        menuOpen -> c.bgMessageHover
        item.mentionsMe -> c.brand.copy(alpha = 0.09f)
        else -> Color.Transparent
    }
    val flashColor = if (reduced) c.mentionBg else c.brand.copy(alpha = 0.40f)

    val startPad = when {
        ctx.selecting && ctx.compact -> 48.dp
        ctx.selecting -> 98.dp
        ctx.compact -> 16.dp
        else -> 64.dp
    }
    val avatarStart = if (ctx.selecting) 46.dp else 12.dp
    val label = if (!start && cm != null) t("chat.messageItem.whoWhen", "name" to Names.member(ctx.server?.server?.id, item.authorId), "time" to Time.timestamp(item.createdAt)) else null

    Box(
        Modifier
            .fillMaxWidth()
            .padding(top = if (start && !ctx.compact) 17.dp else 0.dp)
            .background(tint)
            .then(if (flash.value > 0f) Modifier.background(flashColor.copy(alpha = flashColor.alpha * flash.value)) else Modifier)
            .then(if (label != null) Modifier.semantics { contentDescription = label } else Modifier)
            .then(
                if (ctx.selecting && canPick) Modifier.pressable(remember { MutableInteractionSource() }) { ChatUi.togglePick(cm!!.id) }
                else Modifier.rowTouch(
                    enabled = cm != null && !ctx.selecting,
                    canReply = cm != null && canSend(ctx),
                    swipe = swipe,
                    onLongPress = { cm?.let { openMessageMenu(it, ctx, PressedImage.take()) } },
                    onReply = { cm?.let { ChatUi.reply[ctx.channel.id] = ChatUi.Reply(it.id, ping = it.authorId != ctx.meId) } },
                ),
            ),
    ) {
        if (item.mentionsMe) MentionBar()
        // the reply arrow that shows as the row is pulled
        if (swipe.offset.value != 0f) {
            val pulled = kotlin.math.abs(swipe.offset.value) / (REPLY_AT_DP * density)
            Icon(
                "Reply", if (pulled >= 1f) c.textBrand else c.textMuted, size = 20.dp,
                modifier = Modifier
                    .align(if (rtl) Alignment.CenterStart else Alignment.CenterEnd)
                    .padding(horizontal = 18.dp)
                    .graphicsLayer {
                        alpha = pulled.coerceIn(0f, 1f)
                        val s = 0.6f + 0.4f * pulled.coerceIn(0f, 1f)
                        scaleX = s; scaleY = s
                    },
            )
        }
        Box(Modifier.graphicsLayer { translationX = swipe.offset.value }) {
            if (ctx.selecting) PickCircle(picked, canPick, top = if (reply != null) 35.dp else if (start) 11.dp else 3.dp)
            if (start && !ctx.compact) {
                // a webhook's message goes by the name and picture it was sent with, and a tap says what the sender is
                val hook = fish.nexa.data.Hooks.of(item.cm?.hook)
                val hookId = item.cm?.m?.webhookId
                val authorName = Names.member(ctx.server?.server?.id, item.authorId)
                val user = if (item.authorId == ctx.meId) Nexa.users.me.value?.let { fish.nexa.net.PublicUser(it.id, it.username, it.displayName, it.avatarId) } else Nexa.users.get(item.authorId)
                val interaction = remember { MutableInteractionSource() }
                val pressed by interaction.collectIsPressedAsState()
                Box(
                    Modifier
                        .padding(start = avatarStart, top = if (reply != null) 26.dp else 2.dp)
                        .graphicsLayer { val s = if (pressed) 0.95f else 1f; scaleX = s; scaleY = s }
                        .pressable(interaction) { if (hook != null && hookId != null) fish.nexa.ui.media.openHookCard(hook, hookId) else openProfile(item.authorId) },
                ) {
                    if (hook != null && hookId != null) fish.nexa.ui.media.HookAvatar(hook, hookId, 40.dp)
                    else Avatar(item.authorId, authorName, user?.avatarId, 40.dp)
                }
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(start = startPad, end = 16.dp, top = 2.dp, bottom = 2.dp)
                    .heightIn(min = 22.dp)
                    .alpha(if (p != null && !failed) (if (uploading) 0.8f else 0.55f) else 1f),
            ) {
                if (reply != null) ReplyLine(ctx, reply)
                if (showHead) MessageHeader(item, ctx)
                MessageBody(item, ctx, failed)
                if (failed && p != null) FailedRow(ctx.channel.id, p.tmpId)
                if (cm != null) ReactionsRow(cm, ctx)
            }
        }
    }
}

/** A mention of you: a 3 dp bar of the focus colour on the start edge, glowing. */
@Composable
private fun BoxScope.MentionBar() {
    val c = Nx.colors
    val shape = RoundedCornerShape(3.dp)
    Box(
        Modifier
            .matchParentSize()
            .padding(vertical = 3.dp)
            .wrapContentWidth(Alignment.Start)
            .width(3.dp)
            .boxShadow(shape, 0f, 8f, c.focusRing.copy(alpha = 0.6f))
            .background(c.focusRing, shape),
    )
}

/** canSend: DMs always; servers need Send Messages. */
fun canSend(ctx: ListCtx): Boolean {
    val st = ctx.server ?: return true
    return Nexa.servers.canI(st, fish.nexa.data.P.SEND_MESSAGES, ctx.channel.id)
}

@Composable
private fun PickCircle(picked: Boolean, enabled: Boolean, top: androidx.compose.ui.unit.Dp) {
    val c = Nx.colors
    if (!enabled) return
    Box(
        Modifier
            .padding(start = 12.dp, top = top)
            .size(22.dp)
            .clip(CircleShape)
            .background(if (picked) c.brand else Color.Transparent)
            .border(2.dp, if (picked) c.brand else c.borderStrong, CircleShape)
            .semantics { contentDescription = if (picked) t("chat.messageItem.unselectMessage") else t("chat.messageItem.selectMessage") },
        contentAlignment = Alignment.Center,
    ) {
        if (picked) Icon("Check", c.onBrand, size = 14.dp)
    }
}

/** HeaderTime: the time beside the name; a tap shows the exact second for four seconds. */
@Composable
private fun HeaderTime(ms: Long) {
    val c = Nx.colors
    var exact by remember { mutableStateOf(false) }
    LaunchedEffect(exact) {
        if (exact) {
            delay(4000); exact = false
        }
    }
    Txt(
        if (exact) Time.exact(ms) else Time.timestamp(ms),
        style = Nx.type.timestamp.copy(fontWeight = FontWeight(500)),
        color = if (exact) c.text else c.textMuted,
        maxLines = 1,
        modifier = Modifier.pressable(remember { MutableInteractionSource() }) { exact = true },
    )
}

@Composable
private fun MessageHeader(item: MsgItem, ctx: ListCtx) {
    val c = Nx.colors
    val sid = ctx.server?.server?.id
    val hook = fish.nexa.data.Hooks.of(item.cm?.hook)
    val hookId = item.cm?.m?.webhookId?.takeIf { hook != null }
    val name = hook?.name ?: Names.member(sid, item.authorId)
    // a webhook has no roles, so no role colour
    val color = if (hookId != null) c.textStrong else ctx.server?.let { Nexa.servers.memberColor(it, item.authorId) }?.let { Color(0xFF000000 or it) } ?: c.textStrong
    val user = Nexa.users.get(item.authorId)
    val open = { if (hook != null && hookId != null) fish.nexa.ui.media.openHookCard(hook, hookId) else openProfile(item.authorId) }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 22.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Txt(
            name,
            style = Nx.type.body.copy(fontWeight = FontWeight(650)),
            color = color,
            maxLines = 1,
            modifier = Modifier.weight(1f, fill = false).pressable(remember { MutableInteractionSource() }, onClick = open),
        )
        if (hookId != null) fish.nexa.ui.media.HookTags(open)
        else user?.serverTag?.takeIf { it.text.isNotEmpty() }?.let { ServerTagChip(it, small = false) }
        HeaderTime(item.createdAt)
    }
}

/** The curved line from the avatar column up into the replied-to message, then who and what. */
@Composable
private fun ReplyLine(ctx: ListCtx, replyId: String) {
    val c = Nx.colors
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val original = Nexa.messages.get(ctx.channel.id).byId[replyId]
    val stroke = c.borderStrong
    Box(Modifier.fillMaxWidth().height(24.dp)) {
        // ::before: 32 wide, 15 tall, from 38 dp before the content, a 2 dp border on its start and top, 6 dp corner
        Canvas(Modifier.offset(x = if (rtl) 0.dp else (-38).dp, y = 11.dp).size(32.dp, 15.dp)) {
            val w = 2.dp.toPx()
            val r = 6.dp.toPx()
            val path = Path().apply {
                if (!rtl) {
                    moveTo(w / 2, size.height)
                    lineTo(w / 2, r)
                    quadraticTo(w / 2, w / 2, r, w / 2)
                    lineTo(size.width, w / 2)
                } else {
                    moveTo(size.width - w / 2, size.height)
                    lineTo(size.width - w / 2, r)
                    quadraticTo(size.width - w / 2, w / 2, size.width - r, w / 2)
                    lineTo(0f, w / 2)
                }
            }
            drawPath(path, stroke, style = Stroke(width = w))
        }
        Row(
            Modifier
                .fillMaxWidth()
                .height(22.dp)
                .pressable(remember { MutableInteractionSource() }) { ChatUi.jumpTo(ctx.channel.id, replyId) }
                .semantics { contentDescription = t("chat.messageItem.goToOriginal") },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (original == null) {
                Txt(t("chat.messageItem.originalMessageWasDeletedOrIs"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, maxLines = 1)
            } else {
                val blocked = Nexa.relationships.isBlocked(original.authorId)
                if (blocked) {
                    Txt(t("people.blocked.replyPreview"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, maxLines = 1)
                } else {
                    val hook = fish.nexa.data.Hooks.of(original.hook)
                    val hookId = original.m.webhookId?.takeIf { hook != null }
                    val who = hook?.name ?: Names.member(ctx.server?.server?.id, original.authorId)
                    if (hook != null && hookId != null) fish.nexa.ui.media.HookAvatar(hook, hookId, 16.dp)
                    else Avatar(original.authorId, who, Nexa.users.get(original.authorId)?.avatarId, 16.dp)
                    Txt(
                        who, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(500)), color = c.text, maxLines = 1,
                        // a webhook has no profile; its message is where to go
                        modifier = Modifier.widthIn(max = 160.dp).pressable(remember { MutableInteractionSource() }) {
                            if (hookId != null) ChatUi.jumpTo(ctx.channel.id, replyId) else openProfile(original.authorId)
                        },
                    )
                    ReplyExcerpt(original, ctx.server?.server?.id, Modifier.weight(1f, fill = false))
                }
            }
        }
    }
}

/** ReplyWords as plain text: the original in one line, or what it holds when it has no words. */
fun replyWords(cm: ChatMessage): String {
    if (cm.error != null) return t("chat.messageItem.encryptedMessage")
    val p = cm.payload
    p?.poll?.let { poll -> return (listOf(poll.question) + poll.answers.map { it.text }).joinToString(" ") }
    val text = p?.t?.takeIf { it.isNotBlank() }
    if (text != null) return fish.nexa.ui.markdown.Markdown.plainText(fish.nexa.ui.markdown.Markdown.parse(text, inline = true), AppNames).replace(Regex("\\s+"), " ").trim()
    return t("chat.messageItem.clickToSeeAttachment")
}

/** ReplyWords: the original in one line with its formatting kept but inert (spoilers stay covered). */
@Composable
fun ReplyExcerpt(cm: ChatMessage, serverId: String?, modifier: Modifier = Modifier) {
    val c = Nx.colors
    val style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f))
    val text = cm.payload?.t?.takeIf { it.isNotBlank() && cm.error == null && cm.payload.poll == null }
    if (text != null) fish.nexa.ui.markdown.MarkdownLine(text, c.textMuted, style, modifier, serverId)
    else Txt(replyWords(cm), style = style, color = c.textMuted, maxLines = 1, modifier = modifier)
}

/** Names as the app knows them, for plain-text versions of messages (copying, notifications, previews). */
object AppNames : fish.nexa.ui.markdown.NameLookup {
    override fun user(id: String): fish.nexa.ui.markdown.UserName? {
        val u = Nexa.users.get(id) ?: Nexa.users.me.value?.takeIf { it.id == id }?.let { fish.nexa.net.PublicUser(it.id, it.username, it.displayName) } ?: return null
        return fish.nexa.ui.markdown.UserName(u.displayName, u.username)
    }
    override fun channel(id: String): String? = Nexa.channels.get(id)?.name
    override fun role(id: String): String? = Nexa.servers.byId.value.values.firstNotNullOfOrNull { it.roles[id]?.name }
}

@Composable
internal fun MessageBody(item: MsgItem, ctx: ListCtx, failed: Boolean) {
    val c = Nx.colors
    val cm = item.cm
    val payload = cm?.payload ?: item.pending?.payload
    if (cm != null && cm.error != null && cm.call == null) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon("Lock", c.textMuted, size = 14.dp)
            Txt(
                if (cm.error == DecryptFail.NO_KEY) t("chat.messageItem.waitingForTheEncryptionKey") else t("chat.messageItem.thisMessageCouldNotBeDecrypted"),
                style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontStyle = androidx.compose.ui.text.font.FontStyle.Italic),
                color = c.textMuted,
            )
        }
        return
    }
    val embeds = if (cm != null && !cm.m.suppressEmbeds) payload?.embeds?.takeIf { it.isNotEmpty() } else null
    // a GIF or picture link shows only the picture, the way an uploaded one does (isOnlyMediaLinks)
    val doc by Nexa.settings.doc.collectAsState()
    val mediaOnly = embeds != null && remember(doc) { Nexa.settings.imagePreviews } &&
        remember(payload?.t, embeds) { isOnlyMediaLinks(payload?.t ?: "", embeds.mapNotNull { Unfurl.of(it) }) }
    val text = if (mediaOnly) null else payload?.t
    val edited = cm?.m?.editedAt?.let { t("chat.messageItem.edited") }
    if (cm != null && ChatUi.editing[cm.channelId]?.messageId == cm.id) EditMessage(cm)
    else if (!text.isNullOrEmpty()) fish.nexa.ui.markdown.MarkdownView(
        text,
        fish.nexa.ui.markdown.RenderCtx(serverId = ctx.server?.server?.id, color = if (failed) c.textDanger else null, edited = edited, surface = c.bgRaised),
    )
    payload?.sticker?.let { StickerView(it) }
    payload?.poll?.let { if (cm != null) PollCard(cm, ctx) }
    // files on their way up show their progress until the message is in (Sending… once they are up)
    val up = item.pending?.upload
    if (up != null) UploadCard(ctx.channel.id, item.pending, up)
    else payload?.att?.takeIf { it.isNotEmpty() }?.let { Attachments(it, cm, ctx) }
    if (cm != null && embeds != null) Embeds(embeds, cm, ctx)
    if (cm?.hook != null) HookBody(cm, ctx)
    // cards for the Nexa invites and profiles the message links to (none once its embeds were removed)
    if (cm != null && !cm.m.suppressEmbeds) {
        val sealed = remember(embeds, cm.hook) {
            (embeds ?: fish.nexa.data.Hooks.of(cm.hook)?.linkEmbeds?.takeIf { it.isNotEmpty() })?.mapNotNull { Unfurl.of(it) } ?: emptyList()
        }
        InviteCards(payload?.t, sealed)
        ProfileCards(payload?.t, sealed)
        fish.nexa.ui.notes.NoteCards(payload?.t)
    }
}

/** The failed-send line: what happened, then Retry and Delete. */
@Composable
private fun FailedRow(channelId: String, tmpId: String) {
    val c = Nx.colors
    Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Txt(t("chat.messageItem.messageFailedToSend"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textDanger, modifier = Modifier.weight(1f, fill = false))
        FailedButton("RotateCw", t("chat.messageItem.retry"), c.brand, c.onBrand) { Send.retryPending(channelId, tmpId) }
        FailedButton(null, t("chat.messageItem.delete"), c.danger, Color.White) { Send.discardPending(channelId, tmpId) }
    }
}

@Composable
private fun FailedButton(icon: String?, label: String, pressedBg: Color, pressedFg: Color, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        Modifier
            .height(32.dp)
            .clip(Radii.Xs)
            .background(if (pressed) pressedBg else c.bgActive)
            .pressable(interaction, onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) Icon(icon, if (pressed) pressedFg else c.text, size = 13.dp)
        Txt(label, style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = if (pressed) pressedFg else c.text)
    }
}
