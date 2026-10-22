package fish.nexa.ui.threads

import fish.nexa.ui.theme.mixSrgb
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.layout.onPlaced
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.ChatMessage
import fish.nexa.data.P
import fish.nexa.net.ApiError
import fish.nexa.net.Channel
import fish.nexa.net.Message
import fish.nexa.net.ThreadSummary
import fish.nexa.net.wireJson
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.chat.ChatUi
import fish.nexa.ui.chat.PanelClose
import fish.nexa.ui.chat.PanelNote
import fish.nexa.ui.chat.ReplyExcerpt
import fish.nexa.ui.chat.popDown
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.ChoiceCard
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.SelectField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.dialogs.DialogHint
import fish.nexa.ui.dialogs.FooterButtons
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.shell.Names
import fish.nexa.ui.shell.confirm
import fish.nexa.ui.shell.openChannelSettings
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowHigh
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/** A thread in a channel's list of them, or a forum's posts (web ThreadListing). */
class ThreadListing(val channel: Channel, val memberCount: Int, val joined: Boolean, val memberIds: List<String>, val firstMessage: Message?)

/** One page of a channel's threads. */
class ThreadPage(val threads: List<ThreadListing>, val hasMore: Boolean, val pinnedPost: String?)

/** lib/threads.ts: who may start, join and manage threads, and the calls that do it. */
object ThreadsUi {
    /** How long a thread may go quiet before it closes itself, in minutes, as the server allows. */
    val AUTO_ARCHIVE = listOf(60, 1440, 4320, 10080)

    fun archiveLabel(minutes: Int): String = when (minutes) {
        60 -> t("threads.archive.hour")
        1440 -> t("threads.archive.day")
        4320 -> t("threads.archive.threeDays")
        else -> t("threads.archive.week")
    }

    /** Whether this account may start a thread in a channel (a private one when asked). */
    fun canStart(ch: Channel?, priv: Boolean = false): Boolean {
        val sid = ch?.serverId ?: return false
        if (!ch.holdsThreads || ch.isForum) return false
        val st = Nexa.servers.get(sid)
        if (priv) return ch.isText && Nexa.servers.canI(st, P.CREATE_PRIVATE_THREADS, ch.id)
        return Nexa.servers.canI(st, P.CREATE_PUBLIC_THREADS, ch.id)
    }

    /** Whether this account may manage a thread: close, lock, rename, delete and take people out of it. */
    fun canManage(thread: Channel?): Boolean {
        val sid = thread?.serverId ?: return false
        return Nexa.servers.canI(Nexa.servers.get(sid), P.MANAGE_THREADS, thread.id)
    }

    /** A name for a thread from what its message says: the start of its first line. */
    fun nameFromText(text: String): String {
        val line = text.replace(Regex("<[@#&:a][^>]*>"), "").split('\n').map { it.trim() }.firstOrNull { it.isNotEmpty() } ?: return ""
        return if (line.length > 60) line.take(57).trimEnd() + "…" else line
    }

    /** Starts a thread, from a message or on its own, and comes back with it once this app holds it. */
    suspend fun start(parent: Channel, name: String, messageId: String?, private: Boolean, autoArchive: Int): Channel {
        val res = Nexa.api.request("POST", "/channels/${parent.id}/threads", buildJsonObject {
            put("name", name)
            if (messageId != null) put("message_id", messageId)
            if (private) put("private", true)
            put("auto_archive", autoArchive)
        }) as JsonObject
        val thread = wireJson.decodeFromJsonElement(Channel.serializer(), res["thread"]!!)
        Nexa.channels.upsert(listOf(thread))
        Nexa.threads.setJoined(thread.id, true)
        val actions = res["key_actions"] as? JsonObject
        val needsKey = (actions?.get("needs_own_key") as? JsonPrimitive)?.booleanOrNull == true
        val conv = (actions?.get("conv_id") as? JsonPrimitive)?.contentOrNull
        if (needsKey && conv != null) Nexa.keys.ensureConvKey(conv)
        return thread
    }

    suspend fun setJoined(thread: Channel, join: Boolean) {
        Nexa.api.request(if (join) "PUT" else "DELETE", "/channels/${thread.id}/thread-members/@me")
        Nexa.threads.setJoined(thread.id, join)
    }

    suspend fun patch(thread: Channel, archived: Boolean? = null, locked: Boolean? = null) {
        val fresh = Nexa.api.request("PATCH", "/channels/${thread.id}", Channel.serializer(), buildJsonObject {
            if (archived != null) put("archived", archived)
            if (locked != null) put("locked", locked)
        })
        Nexa.channels.upsert(listOf(fresh))
    }

    fun parseListing(o: JsonObject): ThreadListing? {
        val ch = runCatching { wireJson.decodeFromJsonElement(Channel.serializer(), o) }.getOrNull() ?: return null
        val count = (o["member_count"] as? JsonPrimitive)?.intOrNull ?: 0
        val joined = (o["joined"] as? JsonPrimitive)?.booleanOrNull ?: false
        val ids = (o["member_ids"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()
        val first = o["first_message"]?.let { runCatching { wireJson.decodeFromJsonElement(Message.serializer(), it) }.getOrNull() }
        return ThreadListing(ch, count, joined, ids, first)
    }

    /** A page of a channel's threads, still going or closed, newest first. */
    suspend fun list(parentId: String, archived: Boolean = false, before: String? = null, q: String? = null, sort: String? = null, tags: List<String> = emptyList(), limit: Int = 25): ThreadPage {
        val query = buildList {
            if (archived) add("archived=1")
            if (before != null) add("before=$before")
            add("limit=$limit")
            if (!q.isNullOrBlank()) add("q=" + java.net.URLEncoder.encode(q, "UTF-8"))
            if (sort != null) add("sort=$sort")
            if (tags.isNotEmpty()) add("tags=" + tags.joinToString(","))
        }.joinToString("&")
        val res = Nexa.api.get("/channels/$parentId/threads?$query") as JsonObject
        val users = res["users"]?.let { runCatching { wireJson.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(fish.nexa.net.PublicUser.serializer()), it) }.getOrNull() } ?: emptyList()
        Nexa.users.upsert(users)
        val list = (res["threads"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let(::parseListing) } ?: emptyList()
        // what is still going is kept with the channels, so it opens like any other
        Nexa.channels.upsert(list.map { it.channel }.filter { it.thread?.archived != true })
        val more = (res["has_more"] as? JsonPrimitive)?.booleanOrNull ?: false
        val pinned = (res["pinned_post"] as? JsonPrimitive)?.contentOrNull
        return ThreadPage(list, more, pinned)
    }
}

// ---------------------------------------------------------------------------
// under a message (ThreadChip.tsx)

/**
 * The thread a message started, under it (ThreadChip.tsx): a line runs down
 * from the message's avatar and turns into a card with the thread's name,
 * how many messages it holds, and the newest of them: who said it, a line of
 * it and when. Pressing the card opens the thread. It is kept current from
 * the thread itself, as messages arrive in it. [spineFrom] is where the line
 * starts, in the message's column (below the avatar, or at the top of a row
 * that has none); null leaves it out (compact mode).
 */
@Composable
fun ThreadChip(serverId: String, summary: ThreadSummary, spineFrom: androidx.compose.ui.unit.Dp? = null) {
    val c = Nx.colors
    val channels by Nexa.channels.byId.collectAsState()
    val lasts by fish.nexa.data.ThreadLast.byThread.collectAsState()
    val live = channels[summary.id]
    val name = live?.name ?: summary.name
    val count = live?.thread?.messageCount ?: summary.messageCount
    val archived = live?.thread?.archived ?: summary.archived
    val last = lasts[summary.id]
    val sealed = summary.lastMessage
    LaunchedEffect(summary.id, sealed?.id) { if (sealed != null) fish.nexa.data.ThreadLast.openSummaryLast(summary.id, sealed) }
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = Radii.Sm
    val rtl = androidx.compose.ui.platform.LocalLayoutDirection.current == androidx.compose.ui.unit.LayoutDirection.Rtl
    var spineUp by remember { mutableStateOf(0f) }
    val spine = mixSrgb(c.textMuted, c.bgRaised, 0.54f)
    val density = androidx.compose.ui.platform.LocalDensity.current
    // where the card sits in the message's column, so the line reaches it however tall the message above it is
    BoxWithConstraints(
        Modifier
            .onPlaced { co -> if (spineFrom != null) spineUp = co.positionInParent().y + with(density) { 8.dp.toPx() } - with(density) { spineFrom.toPx() } }
            .padding(top = 8.dp)
            .fillMaxWidth(),
    ) {
        val minW = minOf(300.dp, maxWidth)
        Box(
            Modifier
                .widthIn(min = minW, max = minOf(560.dp, maxWidth))
                // the line from the avatar, curving into the card's middle (`.threadSpine`)
                .drawBehind {
                    if (spineFrom == null) return@drawBehind
                    val w = 2.dp.toPx()
                    val left = -33.dp.toPx()
                    val right = -1.dp.toPx()
                    val r = 10.dp.toPx()
                    val top = -spineUp.coerceAtLeast(0f)
                    val bottom = size.height / 2f
                    val x0 = if (rtl) size.width - left else left
                    val x1 = if (rtl) size.width - right else right
                    val dir = if (rtl) -1f else 1f
                    val path = androidx.compose.ui.graphics.Path().apply {
                        moveTo(x0 + dir * w / 2, top)
                        lineTo(x0 + dir * w / 2, bottom - r)
                        quadraticTo(x0 + dir * w / 2, bottom, x0 + dir * (w / 2 + r), bottom)
                        lineTo(x1, bottom)
                    }
                    drawPath(path, spine, style = androidx.compose.ui.graphics.drawscope.Stroke(width = w))
                },
        ) {
            Column(
                Modifier
                    .ring(shape, c.borderSubtle)
                    .background(if (pressed) mixSrgb(c.bgSurface, c.textStrong, 0.12f) else c.bgSurface, shape)
                    .topEdge(shape, c.edgeLight)
                    .clip(shape)
                    .pressable(interaction) { Nav.go(Route.Server(serverId, summary.id)) }
                    .semantics { contentDescription = t("threads.chip.open") + ", " + name }
                    .padding(start = 12.dp, end = 12.dp, top = 9.dp, bottom = 10.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    // the name has all the room the count leaves, with the Closed pill right after it
                    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Txt(name, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), lineHeight = Nx.type.sp(20f), fontWeight = FontWeight(650)), color = c.textStrong, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                        if (archived) ClosedPill()
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Txt(if (count == 0) t("threads.chip.open") else t("threads.card.count", "count" to count), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(650)), color = c.link, maxLines = 1)
                        Icon(if (rtl) "ChevronLeft" else "ChevronRight", c.link, size = 16.dp)
                    }
                }
                when {
                    last != null && count > 0 -> LastLine(serverId, summary.id, last)
                    count == 0 -> Txt(t("threads.chip.noMessages"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted)
                }
            }
        }
    }
}

/** Who said the newest thing in a thread, a line of it, and when. */
@Composable
private fun LastLine(serverId: String, threadId: String, last: fish.nexa.data.ThreadLast.Last) {
    val c = Nx.colors
    val st = Nexa.servers.get(serverId)
    val name = fish.nexa.ui.shell.Names.member(serverId, last.authorId)
    val own = st?.members?.get(last.authorId)?.avatarId
    val look = fish.nexa.ui.chat.RoleLooks.withOwn(st?.let { fish.nexa.ui.chat.RoleLooks.of(it, last.authorId) }, Nexa.users.get(last.authorId)?.nameStyle)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        fish.nexa.ui.components.Avatar(last.authorId, name, own ?: Nexa.users.get(last.authorId)?.avatarId, 16.dp)
        Box(Modifier.widthIn(max = 120.dp)) {
            fish.nexa.ui.chat.RoleName(name, look, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20f), fontWeight = FontWeight(600)), fallback = c.textStrong)
        }
        Txt(last.text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20f)), color = c.text, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
        Txt(fish.nexa.ui.Time.relative(last.createdAt), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted, maxLines = 1)
    }
}

@Composable
private fun ClosedPill() {
    val c = Nx.colors
    Txt(
        t("threads.chip.closed"),
        style = Nx.type.hint.copy(fontWeight = FontWeight(600)),
        color = c.textMuted,
        modifier = Modifier.background(c.bgActive, RoundedCornerShape(999.dp)).padding(horizontal = 7.dp, vertical = 1.dp),
    )
}

// ---------------------------------------------------------------------------
// starting one (CreateThreadModal.tsx)

/** Starting a thread: from a message (named after what it says, to change) or on its own, where it can be private. */
fun openCreateThread(channelId: String, messageId: String? = null) =
    fish.nexa.ui.dialogs.open("createThread") { layer, close -> CreateThreadSheet(layer, channelId, messageId, close) }

@Composable
private fun CreateThreadSheet(layer: Layer, channelId: String, messageId: String?, close: () -> Unit) {
    val parent = Nexa.channels.get(channelId) ?: return
    val starter = messageId?.let { Nexa.messages.get(channelId).byId[it] }
    var name by remember { mutableStateOf(ThreadsUi.nameFromText(starter?.payload?.t ?: "")) }
    var priv by remember { mutableStateOf(false) }
    var archive by remember { mutableIntStateOf(parent.defaultAutoArchive ?: 4320) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val mayPrivate = messageId == null && ThreadsUi.canStart(parent, true)
    val mayPublic = ThreadsUi.canStart(parent, false)
    fun create() {
        val clean = name.trim()
        if (clean.isEmpty() || busy || (!priv && !mayPublic)) return
        busy = true
        scope.launch {
            try {
                val th = ThreadsUi.start(parent, clean, messageId, priv, archive)
                close()
                Nav.go(Route.Server(parent.serverId ?: return@launch, th.id))
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("threads.create.failed")), "error")
            } finally {
                busy = false
            }
        }
    }
    Sheet(layer, title = t("threads.create.title"), maxWidth = 460.dp, footer = {
        FooterButtons(t("threads.create.title"), ::create, close, enabled = name.isNotBlank() && (priv || mayPublic), busy = busy)
    }) {
        DialogHint(t("threads.create.in", "name" to parent.name))
        NxTextField(
            name, { name = it.take(100) },
            label = t("threads.create.name"),
            required = true,
            placeholder = t("threads.create.namePlaceholder"),
            imeAction = ImeAction.Done,
            onIme = ::create,
            capitalize = true,
        )
        if (mayPrivate) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(t("threads.create.who"), style = Nx.type.label, color = Nx.colors.textSubtle)
            ChoiceCard(!priv, t("threads.create.public"), t("threads.create.publicDesc"), icon = "MessageSquareText") { priv = false }
            ChoiceCard(priv, t("threads.create.private"), t("threads.create.privateDesc"), icon = "Lock") { priv = true }
        }
        SelectField(t("threads.create.closeAfter"), ThreadsUi.AUTO_ARCHIVE.map { it to ThreadsUi.archiveLabel(it) }, archive) { archive = it }
        Txt(t("threads.create.closeHint"), style = Nx.type.hint, color = Nx.colors.textMuted)
    }
}

// ---------------------------------------------------------------------------
// the top of a thread (ThreadIntro.tsx)

/**
 * The top of a thread: its name, who started it and where, a forum post's
 * tags, and the message a thread grew from, which opens it in its channel.
 */
@Composable
fun ThreadIntro(thread: Channel) {
    val c = Nx.colors
    val parent = thread.parentId?.let { Nexa.channels.get(it) }
    val post = parent?.isForum == true
    val sid = thread.serverId
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 8.dp)) {
        Box(
            Modifier
                .padding(bottom = 14.dp)
                .size(60.dp)
                .ring(CircleShape, c.borderSubtle, 5.dp)
                .ring(CircleShape, c.bgRaised, 4.dp)
                .background(c.bgSurface, CircleShape),
            contentAlignment = Alignment.Center,
        ) { Icon(if (post) "MessagesSquare" else "MessageSquareText", c.textStrong, size = 28.dp) }
        Txt(thread.name, style = Nx.type.title.copy(fontSize = Nx.type.sp(28f), lineHeight = Nx.type.sp(30.8f), fontWeight = FontWeight(700)), color = c.textStrong)
        val tags = if (post) (thread.thread?.appliedTags ?: emptyList()).mapNotNull { id -> parent?.forum?.tags?.firstOrNull { it.id == id } } else emptyList()
        if (tags.isNotEmpty()) FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (tag in tags) TagChip(tag.name, tag.emoji)
        }
        Spacer(Modifier.height(8.dp))
        val owner = thread.ownerId
        val where = when {
            parent == null -> ""
            post -> parent.name
            else -> "#${parent.name}"
        }
        val key = when {
            post -> "chat.messageList.postStart"
            thread.type == "private_thread" -> "chat.messageList.privateThreadStart"
            else -> "chat.messageList.threadStart"
        }
        val line = if (owner != null) boldValues(t(key, "name" to MARK_NAME, "where" to MARK_WHERE), Names.member(sid, owner), where) else AnnotatedString("")
        androidx.compose.foundation.text.BasicText(
            buildAnnotatedString {
                append(line)
                if (line.isNotEmpty()) append(" ")
                append(t("chat.messageList.endToEnd"))
            },
            modifier = Modifier.widthIn(max = 560.dp),
            style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), lineHeight = Nx.type.sp(23.25f), color = c.textMuted),
        )
        val from = thread.thread?.starterId
        if (!post && parent != null && from != null && sid != null) StarterCard(sid, parent.id, from)
    }
}

private const val MARK_NAME = "\u0001"
private const val MARK_WHERE = "\u0002"

/** A sentence with the person and the place in bold, wherever the language puts them. */
private fun boldValues(text: String, name: String, where: String): AnnotatedString = buildAnnotatedString {
    var i = 0
    while (i < text.length) {
        val ch = text[i]
        when (ch) {
            '\u0001' -> withStyle(SpanStyle(fontWeight = FontWeight(700))) { append(name) }
            '\u0002' -> withStyle(SpanStyle(fontWeight = FontWeight(700))) { append(where) }
            else -> append(ch)
        }
        i++
    }
}

@Composable
private fun TagChip(name: String, emoji: String) {
    val c = Nx.colors
    Row(
        Modifier.heightIn(min = 26.dp).background(c.bgActive, RoundedCornerShape(999.dp)).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (emoji.isNotEmpty()) fish.nexa.media.TwemojiImage(emoji, 14.dp)
        Txt(name, style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1)
    }
}

/** Starter messages read from channels the list does not hold, by id. */
private object Starters {
    private val held = java.util.concurrent.ConcurrentHashMap<String, ChatMessage>()
    private val gone: MutableSet<String> = java.util.concurrent.ConcurrentHashMap.newKeySet()

    sealed interface Result {
        data class Found(val cm: ChatMessage) : Result
        data object Gone : Result
        data object Failed : Result
    }

    suspend fun load(channelId: String, messageId: String): Result {
        held[messageId]?.let { return Result.Found(it) }
        if (messageId in gone) return Result.Gone
        return try {
            val m = Nexa.api.get("/channels/$channelId/messages/$messageId", Message.serializer())
            val cm = withContext(Dispatchers.Default) { Nexa.messages.decrypt(m) }
            Nexa.session.ensureUsers(listOf(m.authorId))
            held[messageId] = cm
            Result.Found(cm)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: ApiError) {
            if (e.status == 404 || e.status == 403) {
                gone += messageId
                Result.Gone
            } else Result.Failed
        } catch (_: Exception) {
            Result.Failed
        }
    }
}

/** The message a thread was started from, as it is now in its channel. */
@Composable
private fun StarterCard(serverId: String, parentId: String, messageId: String) {
    val c = Nx.colors
    val all by Nexa.messages.channels.collectAsState()
    val inList = all[parentId]?.byId?.get(messageId)
    var attempt by remember { mutableIntStateOf(0) }
    val fetched by produceState<Starters.Result?>(null, messageId, inList == null, attempt) {
        if (inList == null) value = Starters.load(parentId, messageId)
    }
    val cm = inList ?: (fetched as? Starters.Result.Found)?.cm
    val shape = Radii.Sm
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Column(
        Modifier
            .padding(top = 14.dp)
            .widthIn(max = 560.dp)
            .fillMaxWidth()
            .ring(shape, if (pressed) c.border else c.borderSubtle)
            .clip(shape)
            .background(if (pressed) c.bgHover else c.bgSurface, shape)
            .pressable(interaction) {
                when {
                    cm != null -> Nav.go(Route.Server(serverId, parentId, jumpTo = messageId))
                    fetched == Starters.Result.Failed -> attempt += 1
                }
            }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        when {
            cm != null -> {
                val name = Names.member(serverId, cm.authorId)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Avatar(cm.authorId, name, Nexa.users.get(cm.authorId)?.avatarId, 20.dp)
                    Txt(name, style = Nx.type.bodySmall.copy(fontWeight = FontWeight(650)), color = c.textStrong, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                    Txt(Time.timestamp(cm.m.createdAt), style = Nx.type.timestamp, color = c.textMuted, maxLines = 1)
                }
                if (Nexa.relationships.isBlocked(cm.authorId)) Txt(t("people.blocked.replyPreview"), style = Nx.type.bodySmall, color = c.textMuted)
                else ReplyExcerpt(cm, serverId)
            }
            fetched == Starters.Result.Gone -> Txt(t("threads.intro.starterDeleted"), style = Nx.type.bodySmall, color = c.textMuted)
            fetched == Starters.Result.Failed -> Txt(t("chat.messageItem.originalFailed"), style = Nx.type.bodySmall, color = c.textMuted)
            else -> Box(Modifier.size(220.dp, 10.dp).background(c.bgHover, RoundedCornerShape(5.dp)))
        }
    }
}

// ---------------------------------------------------------------------------
// in a thread's header and its More menu (ThreadBar.tsx)

/** In a thread's header: the channel it belongs to, the way back to it. */
fun parentLabel(thread: Channel): String? {
    val parent = thread.parentId?.let { Nexa.channels.get(it) } ?: return null
    return if (parent.isForum) t("threads.bar.inForum", "name" to parent.name) else t("threads.bar.inChannel", "name" to parent.name)
}

/** Join or Leave, and what else can be done with a thread, for whoever may. */
fun threadMenuItems(thread: Channel): List<MenuItem> {
    val items = ArrayList<MenuItem>()
    val joined = Nexa.threads.isJoined(thread.id)
    val manage = ThreadsUi.canManage(thread)
    val own = thread.ownerId != null && thread.ownerId == Nexa.users.meId
    val meta = thread.thread
    fun act(fn: suspend () -> Unit) = Nexa.scope.launch {
        try {
            fn()
        } catch (e: Exception) {
            Nexa.ui.toast(describeError(e, t("threads.bar.changeFailed")), "error")
        }
    }
    items += MenuItem.Action(if (joined) t("threads.bar.leave") else t("threads.bar.join")) { act { ThreadsUi.setJoined(thread, !joined) } }
    if (manage || own) items += MenuItem.Action(if (meta?.archived == true) t("threads.bar.open") else t("threads.bar.close")) { act { ThreadsUi.patch(thread, archived = meta?.archived != true) } }
    if (manage) items += MenuItem.Action(if (meta?.locked == true) t("threads.bar.unlock") else t("threads.bar.lock")) { act { ThreadsUi.patch(thread, locked = meta?.locked != true) } }
    if (manage || own) {
        items += MenuItem.Action(t("threads.bar.settings")) { openChannelSettings(thread.id) }
        items += MenuItem.Action(t("threads.bar.delete"), danger = true) {
            confirm(t("threads.bar.deleteTitle"), t("threads.bar.deleteBody", "name" to thread.name), t("threads.bar.delete")) {
                try {
                    Nexa.api.request("DELETE", "/channels/${thread.id}")
                    val parent = thread.parentId
                    if (parent != null && thread.serverId != null) Nav.go(Route.Server(thread.serverId, parent), replace = true)
                } catch (e: Exception) {
                    Nexa.ui.toast(describeError(e, t("threads.bar.deleteFailed")), "error")
                }
            }
        }
    }
    return items
}

/** Above a thread's composer, when it is closed or locked: what that means for writing in it. */
@Composable
fun ThreadStateBar(thread: Channel) {
    val c = Nx.colors
    val meta = thread.thread ?: return
    val text = when {
        meta.locked && ThreadsUi.canManage(thread) -> t("threads.bar.lockedMod")
        meta.locked -> t("threads.bar.locked")
        meta.archived -> t("threads.bar.closed")
        else -> return
    }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp)
            .background(c.bgSurface, RoundedCornerShape(topStart = Radii.sm, topEnd = Radii.sm))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(if (meta.locked) "Lock" else "Archive", c.textMuted, size = 16.dp)
        Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted)
    }
}

// ---------------------------------------------------------------------------
// a channel's threads (ThreadsPanel.tsx)

@Composable
fun BoxScope.ThreadsPanel(channel: Channel) {
    val c = Nx.colors
    var q by remember(channel.id) { mutableStateOf("") }
    // the ones still going and the closed ones, both asked for again as the search changes
    var active by remember(channel.id) { mutableStateOf<List<ThreadListing>?>(null) }
    var activeMore by remember(channel.id) { mutableStateOf(false) }
    var closed by remember(channel.id) { mutableStateOf<List<ThreadListing>?>(null) }
    var closedMore by remember(channel.id) { mutableStateOf(false) }
    var failed by remember(channel.id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val joined by Nexa.threads.joined.collectAsState()
    val sid = channel.serverId
    LaunchedEffect(channel.id, q, reload) {
        // a moment after typing stops
        if (q.isNotEmpty()) kotlinx.coroutines.delay(300)
        failed = false
        val term = q.trim().ifEmpty { null }
        try {
            val a = ThreadsUi.list(channel.id, archived = false, q = term, limit = 100)
            active = a.threads
            activeMore = a.hasMore
            val b = ThreadsUi.list(channel.id, archived = true, q = term)
            closed = b.threads
            closedMore = b.hasMore
        } catch (_: Exception) {
            failed = true
        }
    }
    fun loadMore(archived: Boolean) {
        val list = (if (archived) closed else active) ?: return
        if (busy) return
        busy = true
        scope.launch {
            try {
                val last = list.lastOrNull()?.channel
                val before = if (archived) last?.thread?.archivedAt?.toString() else last?.let { it.lastMessageId ?: it.id }
                val p = ThreadsUi.list(channel.id, archived = archived, before = before, q = q.trim().ifEmpty { null }, limit = if (archived) 25 else 100)
                val merged = list + p.threads.filter { n -> list.none { it.channel.id == n.channel.id } }
                if (archived) {
                    closed = merged
                    closedMore = p.hasMore
                } else {
                    active = merged
                    activeMore = p.hasMore
                }
            } catch (_: Exception) {
                failed = true
            } finally {
                busy = false
            }
        }
    }
    val shape = Radii.Lg
    Column(
        Modifier
            .align(Alignment.TopCenter)
            .padding(start = 8.dp, end = 8.dp, top = 6.dp)
            .fillMaxWidth()
            .heightIn(max = 640.dp)
            .popDown()
            .shadowHigh(shape, c)
            .ring(shape, c.panelEdge)
            .background(c.bgFloating, shape)
            .topEdge(shape, c.edgeLight)
            .pressable(remember { MutableInteractionSource() }) {},
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Txt(t("threads.panel.title"), style = Nx.type.headerTitle.copy(fontSize = Nx.type.sp(16f), fontWeight = FontWeight(660)), color = c.textStrong, modifier = Modifier.weight(1f))
            if (ThreadsUi.canStart(channel)) NxButton(t("threads.panel.create"), {
                ChatUi.panel = null
                openCreateThread(channel.id)
            }, size = ButtonSize.SM, icon = "Plus")
            PanelClose(t("threads.panel.close"), 18) { ChatUi.panel = null }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
        Box(Modifier.padding(start = 12.dp, end = 12.dp, top = 10.dp)) {
            fish.nexa.ui.server.SearchBox(q, { q = it }, t("threads.panel.search"))
        }
        Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val now = active
            val gone = closed
            // the ones this account is in first, then the rest
            val mine = now.orEmpty().filter { it.channel.id in joined || it.joined }
            val others = now.orEmpty().filter { it !in mine }
            if (mine.isNotEmpty()) Group(t("threads.panel.joined")) {
                for (th in mine) ThreadListRow(sid, th)
            }
            if (others.isNotEmpty()) Group(if (mine.isNotEmpty()) t("threads.panel.otherActive") else t("threads.panel.active")) {
                for (th in others) ThreadListRow(sid, th)
                if (activeMore) MoreButton(busy) { loadMore(false) }
            }
            if (!gone.isNullOrEmpty()) Group(t("threads.panel.closed")) {
                for (th in gone) ThreadListRow(sid, th)
                if (closedMore) MoreButton(busy) { loadMore(true) }
            }
            when {
                failed -> Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    PanelNote(if (now != null) t("threads.panel.closedFailed") else t("forum.failed"))
                    NxButton(t("chat.messageList.tryAgain"), { reload += 1 }, kind = ButtonKind.LINK, inline = true)
                }
                now == null || gone == null -> PanelNote(t("forum.loading"))
                now.isEmpty() && gone.isEmpty() -> Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon("MessageSquareText", c.textMuted, size = 28.dp)
                    Txt(if (q.isNotBlank()) t("threads.panel.noMatches") else t("threads.panel.none"), style = Nx.type.body.copy(fontWeight = FontWeight(600)), color = c.text, align = TextAlign.Center)
                    if (q.isBlank() && ThreadsUi.canStart(channel)) Txt(t("threads.panel.noneHint"), style = Nx.type.bodySmall, color = c.textMuted, align = TextAlign.Center, modifier = Modifier.widthIn(max = 300.dp))
                }
            }
        }
    }
}

/** `.group`: a heading and its rows, set apart from the group above. */
@Composable
private fun Group(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        GroupHead(title)
        content()
    }
}

@Composable
private fun MoreButton(busy: Boolean, onClick: () -> Unit) = Box(Modifier.fillMaxWidth().padding(top = 6.dp), contentAlignment = Alignment.Center) {
    NxButton(t("threads.panel.loadMore"), onClick, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, loading = busy)
}

@Composable
private fun GroupHead(text: String) = Txt(
    text,
    style = Nx.type.label.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(650)),
    color = Nx.colors.textMuted,
    modifier = Modifier.padding(start = 8.dp, end = 8.dp, bottom = 2.dp).semantics { heading() },
)

@Composable
private fun ThreadListRow(serverId: String?, th: ThreadListing) {
    val c = Nx.colors
    val ch = th.channel
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(Radii.Sm)
            .background(if (pressed) c.bgHover else Color.Transparent)
            .pressable(interaction) {
                ChatUi.panel = null
                if (serverId != null) {
                    Nexa.channels.upsert(listOf(ch))
                    Nav.go(Route.Server(serverId, ch.id))
                }
            }
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(36.dp).background(c.bgSurface, CircleShape), contentAlignment = Alignment.Center) {
            Icon(if (ch.type == "private_thread") "Lock" else "MessageSquareText", c.textMuted, size = 18.dp)
        }
        Column(Modifier.weight(1f)) {
            Txt(ch.name, style = Nx.type.body.copy(fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ch.ownerId?.let { Txt(t("threads.panel.startedBy", "name" to Names.member(serverId, it)), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1, modifier = Modifier.weight(1f, fill = false)) }
                val count = ch.thread?.messageCount ?: 0
                Txt(if (count == 0) t("threads.chip.noMessages") else t("threads.chip.messages", "count" to count), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1)
            }
        }
    }
}
