package fish.nexa.ui.chat

import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.content.MediaType
import androidx.compose.foundation.content.ReceiveContentListener
import androidx.compose.foundation.content.TransferableContent
import androidx.compose.foundation.content.consume
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.content.hasMediaType
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.text.input.placeCursorAtEnd
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.P
import fish.nexa.data.Send
import fish.nexa.data.SendOptions
import fish.nexa.data.Slowmode
import fish.nexa.data.Staged
import fish.nexa.data.Uploads
import fish.nexa.net.Channel
import fish.nexa.net.PublicUser
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.shell.Names
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.boxShadow
import fish.nexa.ui.theme.brandGradient
import fish.nexa.ui.theme.mixSrgb
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowHigh
import fish.nexa.ui.theme.shadowLow
import fish.nexa.ui.theme.shadowMedium
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** What the caret is right after, for autocomplete (Composer.tsx acToken). */
data class AcToken(val kind: String, val query: String, val start: Int)

fun acToken(text: String, caret: Int, channels: Boolean, smartEmoji: Boolean): AcToken? {
    val before = text.substring(0, caret.coerceIn(0, text.length))
    if (smartEmoji && Regex("(?:^|\\s):$").containsMatchIn(before)) return AcToken("emoji", "", caret - 1)
    val m = Regex("(?:^|\\s)(@[\\p{L}\\p{N}_.-]*|#[\\p{L}\\p{N}_-]*|:[\\w+-]{2,}|^/\\w*)$").find(before) ?: return null
    val token = m.groupValues[1]
    val start = caret - token.length
    return when {
        token.startsWith("@") -> AcToken("user", token.substring(1).lowercase(), start)
        token.startsWith("#") -> if (channels) AcToken("channel", token.substring(1).lowercase(), start) else null
        token.startsWith(":") -> AcToken("emoji", token.substring(1).lowercase(), start)
        start == 0 && token.startsWith("/") -> AcToken("command", token.substring(1).lowercase(), start)
        else -> null
    }
}

/** Typing events: on the first character, then at most every eight seconds; a stop when emptied, sent or left. */
private object TypingSender {
    private val lastSent = HashMap<String, Long>()

    fun typed(channelId: String, empty: Boolean) {
        val now = System.currentTimeMillis()
        if (empty) return stop(channelId)
        val last = lastSent[channelId] ?: 0L
        if (now - last < 8000) return
        lastSent[channelId] = now
        Nexa.session.send("typing", kotlinx.serialization.json.buildJsonObject { put("channel_id", kotlinx.serialization.json.JsonPrimitive(channelId)) })
    }

    fun stop(channelId: String) {
        if (lastSent.remove(channelId) == null) return
        Nexa.session.send("typing", kotlinx.serialization.json.buildJsonObject {
            put("channel_id", kotlinx.serialization.json.JsonPrimitive(channelId))
            put("stop", kotlinx.serialization.json.JsonPrimitive(true))
        })
    }
}

/** Files picked for a message: copied into the cache with their names and types, ready to encrypt. */
object Staging {
    private var seq = 0
    const val MAX_FILES = 10

    suspend fun stage(uri: Uri): Staged? = withContext(Dispatchers.IO) {
        val cr = Nexa.app.contentResolver
        var name = "file"
        var size = -1L
        runCatching {
            cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cur ->
                if (cur.moveToFirst()) {
                    cur.getString(0)?.let { name = it }
                    if (!cur.isNull(1)) size = cur.getLong(1)
                }
            }
        }
        val type = cr.getType(uri) ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
        if (size >= 0 && !Uploads.fits(size)) {
            Nexa.ui.toast(t("composer.composer.overServerLimit", "name" to name, "limit" to limitText()), "error")
            return@withContext null
        }
        val dir = File(Nexa.app.cacheDir, "staged").apply { mkdirs() }
        synchronized(this@Staging) { seq += 1 }
        val out = File(dir, "f$seq-${System.nanoTime()}")
        try {
            cr.openInputStream(uri)?.use { input -> out.outputStream().use { input.copyTo(it) } } ?: return@withContext null
        } catch (e: Exception) {
            Nexa.ui.toast(t("composer.composer.uploadFailed"), "error")
            return@withContext null
        }
        if (!Uploads.fits(out.length())) {
            out.delete()
            Nexa.ui.toast(t("composer.composer.overServerLimit", "name" to name, "limit" to limitText()), "error")
            return@withContext null
        }
        MetadataScrub.scrub(out, type)
        val preview = if (type.startsWith("image/") || type.startsWith("video/")) out.path else null
        Staged("f$seq", out, name, type, preview = preview)
    }

    /** A paste too long for a message, attached as message.txt instead. */
    fun textFile(text: String): Staged {
        val dir = File(Nexa.app.cacheDir, "staged").apply { mkdirs() }
        synchronized(this) { seq += 1 }
        val out = File(dir, "f$seq-${System.nanoTime()}").apply { writeText(text) }
        return Staged("f$seq", out, "message.txt", "text/plain")
    }

    private fun limitText(): String {
        val max = Nexa.auth.instance.value?.maxUploadBytes ?: (100L shl 20)
        val gb = max / (1024.0 * 1024 * 1024)
        return if (gb >= 1) t("composer.composer.gigabytes", "n" to (Math.round(gb * 10) / 10.0)) else t("composer.composer.megabytes", "n" to Math.round(max / (1024.0 * 1024)))
    }
}

/** Under the list: the typing line and the composer, or the bar for picked messages, or the muted notice. */
@Composable
fun ComposerSlot(channel: Channel) {
    val selecting = ChatUi.selecting == channel.id
    Column(Modifier.fillMaxWidth()) {
        if (selecting) SelectionBar(channel)
        else {
            TypingBar(channel)
            val muted = Nexa.users.me.collectAsState().value?.let { NexaRestrictions.mutedUntil(it) }
            if (muted != null) MutedBar(muted) else Composer(channel)
        }
    }
}

/**
 * Composer.tsx on a phone: a raised box at the bottom (plus button, the text,
 * Message Options and Send), with whatever is waiting stacked on top of it as
 * one shape: a notice, a preview, the reply bar, the files to send. Enter is a
 * new line; Send is the only way to send.
 */
@Composable
fun Composer(channel: Channel) {
    val c = Nx.colors
    val channelId = channel.id
    val scope = rememberCoroutineScope()
    val st = channel.serverId?.let { Nexa.servers.get(it) }
    val canWrite = st == null || Nexa.servers.canI(st, P.SEND_MESSAGES, channelId)
    val canAttach = st == null || Nexa.servers.canI(st, P.ATTACH_FILES, channelId)
    val canPoll = st == null || (Nexa.servers.canI(st, P.SEND_MESSAGES, channelId) && Nexa.servers.canI(st, P.CREATE_POLLS, channelId))
    val state = remember(channelId) { TextFieldState(Nexa.settings.draft(channelId)) }
    val insert = ChatUi.inserts[channelId]
    LaunchedEffect(insert) {
        if (insert != null) {
            insertAtCaret(state, insert)
            ChatUi.inserts.remove(channelId)
        }
    }
    var notice by remember(channelId) { mutableStateOf<Notice?>(null) }
    var preview by remember { mutableStateOf(false) }
    var ac by remember(channelId) { mutableStateOf<AcToken?>(null) }
    var lastUnknown by remember(channelId) { mutableStateOf<String?>(null) }
    val tray = ChatUi.trays[channelId] ?: emptyList()
    val reply = ChatUi.reply[channelId]
    val slowUntil = Slowmode.until.collectAsState().value[channelId] ?: 0L
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(slowUntil) {
        while (System.currentTimeMillis() < slowUntil) {
            now = System.currentTimeMillis(); delay(250)
        }
        now = System.currentTimeMillis()
    }
    val slowLeft = ((slowUntil - now) / 1000.0).coerceAtLeast(0.0)

    // words shared from another app go in after what is already there
    val injected = ChatUi.inject[channelId]
    LaunchedEffect(injected) {
        val add = injected ?: return@LaunchedEffect
        ChatUi.inject.remove(channelId)
        state.edit {
            val sep = if (length > 0 && !asCharSequence().endsWith("\n")) "\n" else ""
            append(sep + add)
            placeCursorAtEnd()
        }
    }

    // drafts, typing and autocomplete follow the text
    LaunchedEffect(channelId) {
        snapshotFlow { state.text.toString() to state.selection.end }.distinctUntilChanged().collect { (text, caret) ->
            TypingSender.typed(channelId, text.isEmpty())
            ac = acToken(text, caret, st != null, Nexa.settings.smartEmoji)
        }
    }
    LaunchedEffect(channelId) {
        snapshotFlow { state.text.toString() }.distinctUntilChanged().collect { text ->
            delay(600)
            if (Nexa.settings.draft(channelId) != text) Nexa.settings.setDraft(channelId, text)
        }
    }
    DisposableEffect(channelId) {
        onDispose {
            val text = state.text.toString()
            if (Nexa.settings.draft(channelId) != text) Nexa.settings.setDraft(channelId, text)
            TypingSender.stop(channelId)
        }
    }

    fun addFiles(files: List<Staged>) {
        val cur = ChatUi.trays[channelId] ?: emptyList()
        val room = Staging.MAX_FILES - cur.size
        val kept = files.take(maxOf(0, room))
        val left = files.drop(kept.size)
        ChatUi.trays[channelId] = cur + kept
        if (left.isNotEmpty()) {
            left.forEach { it.file.delete() }
            notice = Notice.FilesLeftOut(left.first().name, left.size - 1)
        }
    }

    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        scope.launch { addFiles(uris.mapNotNull { Staging.stage(it) }) }
    }
    val pickMedia = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(Staging.MAX_FILES)) { uris ->
        scope.launch { addFiles(uris.mapNotNull { Staging.stage(it) }) }
    }

    /** Sends what the box holds; false when it could not go (slow mode, too long, an unknown command). */
    fun send(): Boolean {
        if (slowLeft > 0) {
            Nexa.ui.toast(t("composer.composer.slowModeOnSeconds", "seconds" to kotlin.math.ceil(slowLeft).toInt()), "error")
            return false
        }
        var text = state.text.toString()
        if (Send.tooLong(text)) {
            Nexa.ui.toast(Send.tooLongMessage(), "error")
            return false
        }
        when (val r = fish.nexa.ui.markdown.Commands.run(text)) {
            is fish.nexa.ui.markdown.Commands.Result.Command -> text = r.text
            is fish.nexa.ui.markdown.Commands.Result.Empty -> {
                Nexa.ui.toast(t("composer.composer.commandNeedsText", "name" to r.name), "error")
                return false
            }
            is fish.nexa.ui.markdown.Commands.Result.Unknown -> if (lastUnknown != text) {
                lastUnknown = text
                Nexa.ui.toast(t("composer.composer.noSuchCommand", "name" to r.name))
                return false
            }
            fish.nexa.ui.markdown.Commands.Result.Text -> Unit
        }
        val files = ChatUi.trays[channelId] ?: emptyList()
        if (text.isBlank() && files.isEmpty()) return false
        val opts = SendOptions(replyTo = reply?.messageId, ping = reply?.ping)
        state.clearText()
        Nexa.settings.setDraft(channelId, "")
        TypingSender.stop(channelId)
        ChatUi.reply.remove(channelId)
        ChatUi.trays.remove(channelId)
        lastUnknown = null
        notice = null
        ChatUi.snapToBottom(channelId)
        if (files.isNotEmpty()) Send.sendWithFiles(channelId, text, files, opts) else Send.sendMessage(channelId, text, opts)
        return true
    }

    val bottomPad = 8.dp
    Box(Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, bottom = bottomPad)) {
        Column(Modifier.fillMaxWidth()) {
            // the stacked bars join the box into one shape
            val stack = buildList {
                if (notice != null) add("notice")
                if (preview && state.text.isNotEmpty()) add("preview")
                if (reply != null) add("reply")
                if (tray.isNotEmpty()) add("tray")
            }
            fun topShape(name: String) = if (stack.firstOrNull() == name) RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp) else RoundedCornerShape(0.dp)
            notice?.let { n -> NoticeBar(n, topShape("notice"), canAttach, onDismiss = { notice = null }, onAction = { action ->
                when (n) {
                    is Notice.PasteTooLong -> when (action) {
                        "file" -> addFiles(listOf(Staging.textFile(n.text)))
                        "anyway" -> state.edit { replace(selection.min, selection.max, n.text) }
                    }
                    is Notice.FilesLeftOut -> Unit
                }
                notice = null
            }) }
            if ("preview" in stack) PreviewBox(state.text.toString(), channel.serverId) { preview = false }
            if (reply != null) ReplyBar(channel, reply, topShape("reply"))
            if (tray.isNotEmpty()) Tray(channelId, tray, topShape("tray"))
            val boxShape = if (stack.any { it != "preview" }) RoundedCornerShape(bottomStart = 14.dp, bottomEnd = 14.dp) else Radii.Md
            if (!canWrite) LockedBox(boxShape)
            else ComposerBox(
                channel, state, boxShape, borderTop = tray.isNotEmpty(),
                canAttach = canAttach, canPoll = canPoll,
                sendEnabled = (state.text.isNotBlank() || tray.isNotEmpty()) && slowLeft <= 0,
                optionsOn = preview,
                onAttach = { kind ->
                    when (kind) {
                        "files" -> pickFiles.launch(arrayOf("*/*"))
                        "media" -> pickMedia.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                        "poll" -> openCreatePoll(channelId)
                    }
                },
                onOptions = {
                    openMenu(
                        listOf(
                            MenuItem.Action(t("composer.more.formatting")) {
                                fish.nexa.ui.format.openFormattingEditor(
                                    state.text.toString(), composerPlaceholder(channel),
                                    onInsert = { state.setTextAndPlaceCursorAtEnd(it) },
                                    onSend = { md ->
                                        val was = state.text.toString()
                                        state.setTextAndPlaceCursorAtEnd(md)
                                        send().also { sent -> if (!sent) state.setTextAndPlaceCursorAtEnd(was) }
                                    },
                                    canSend = { slowLeft <= 0 },
                                )
                            },
                            MenuItem.Action(t("composer.preview.show"), checked = preview, toggle = true) { preview = !preview },
                            MenuItem.Action(t("composer.more.emoji")) { openExpressionPicker(channelId) { token -> insertAtCaret(state, "$token ") } },
                        ),
                        title = t("composer.more.label"),
                        haptic = false,
                    )
                },
                onPasteTooLong = { notice = Notice.PasteTooLong(it) },
                onContent = { uris -> scope.launch { addFiles(uris.mapNotNull { Staging.stage(it) }) } },
                onSend = { send() },
            )
            val text = state.text
            val left = Send.MAX_MESSAGE_LENGTH - text.length
            if (left < 200) Txt(
                left.toString(),
                style = Nx.type.hint.copy(fontWeight = if (left < 0) FontWeight(600) else FontWeight(400)),
                color = if (left < 0) c.textDanger else c.textMuted,
                align = androidx.compose.ui.text.style.TextAlign.End,
                modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 4.dp).semantics {
                    contentDescription = if (left < 0) t("composer.limit.over", "count" to -left) else t("composer.limit.left", "count" to left)
                },
            )
            val slow = channel.slowmodeSeconds
            if (slow > 0 && !(st != null && Nexa.servers.canI(st, P.MANAGE_MESSAGES, channelId))) {
                Row(Modifier.padding(start = 8.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon("Timer", c.textMuted, size = 14.dp)
                    if (slowLeft > 0) Txt(Time.shortDuration(slowLeft), style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.textWarning)
                    else Txt(t("composer.composer.slowModeIsEnabled"), style = Nx.type.hint, color = c.textMuted)
                }
            }
        }
        val token = ac
        if (token != null) Autocomplete(channel, token, Modifier.align(Alignment.TopCenter)) { insert ->
            state.edit {
                val end = selection.end
                replace(token.start, end, insert)
            }
            ac = null
        }
    }
}

/**
 * What may go into a message box: no paste that would push it past the
 * limit (that is offered as a notice instead), and no zalgo (lib/zalgo.ts):
 * an insertion stacking more than three marks on a letter is refused.
 */
private class ComposerInput(
    private val onPasteTooLong: (String) -> Unit,
    /** Whether this server has a custom emoji of that name (it is sent as that emoji, so the name stays). */
    private val ownEmoji: (String) -> Boolean = { false },
) : androidx.compose.foundation.text.input.InputTransformation {
    override fun androidx.compose.foundation.text.input.TextFieldBuffer.transformInput() {
        val text = asCharSequence().toString()
        if (Zalgo.tooStacked(text)) {
            revertAllChanges()
            Zalgo.refused()
            return
        }
        // the closing ":" of a known shortcode turns it into its emoji, in your skin tone
        if (text.length == originalText.length + 1 && changes.changeCount == 1) {
            val r = changes.getRange(0)
            if (r.end - r.start == 1 && text[r.start] == ':') {
                val closed = fish.nexa.ui.markdown.ShortcodeTyping.closeShortcode(text, selection.end, Nexa.settings.skinTone, ownEmoji)
                if (closed != null) {
                    replace(0, length, closed.first)
                    selection = androidx.compose.ui.text.TextRange(closed.second)
                    return
                }
            }
        }
        if (text.length > Send.MAX_MESSAGE_LENGTH && originalText.length <= Send.MAX_MESSAGE_LENGTH && text.length - originalText.length > 1) {
            val start = changes.let { if (it.changeCount > 0) it.getRange(0).start else 0 }
            val end = changes.let { if (it.changeCount > 0) it.getRange(0).end else 0 }
            val pasted = text.substring(start, end)
            revertAllChanges()
            onPasteTooLong(pasted)
        }
    }
}

/** lib/zalgo.ts: an insertion that would stack more than three marks on a letter is refused, with a toast at most every 2.5 s. */
object Zalgo {
    private var lastToast = 0L

    fun tooStacked(text: String): Boolean = fish.nexa.ui.markdown.Zalgo.has(text)

    fun refused() {
        val now = System.currentTimeMillis()
        if (now - lastToast < 2500) return
        lastToast = now
        Nexa.ui.toast(t("zalgo.refused"), "error")
    }
}

/** Pictures and files a keyboard or the clipboard hands over (stickers, GIFs, screenshots) go to the tray. */
private fun composerContentReceiver(onContent: (List<Uri>) -> Unit): Modifier = Modifier.contentReceiver(object : ReceiveContentListener {
    override fun onReceive(transferableContent: TransferableContent): TransferableContent? {
        if (!transferableContent.hasMediaType(MediaType.All)) return transferableContent
        val clip = transferableContent.clipEntry.clipData
        val uris = (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
        if (uris.isEmpty()) return transferableContent
        onContent(uris)
        return transferableContent.consume { it.uri != null }
    }
})

private fun insertAtCaret(state: TextFieldState, text: String) {
    state.edit {
        replace(selection.min, selection.max, text)
    }
}

sealed interface Notice {
    data class PasteTooLong(val text: String) : Notice
    data class FilesLeftOut(val name: String, val more: Int) : Notice
}

@Composable
private fun ComposerBox(
    channel: Channel,
    state: TextFieldState,
    shape: androidx.compose.ui.graphics.Shape,
    borderTop: Boolean,
    canAttach: Boolean,
    canPoll: Boolean,
    sendEnabled: Boolean,
    optionsOn: Boolean,
    onAttach: (String) -> Unit,
    onOptions: () -> Unit,
    onPasteTooLong: (String) -> Unit,
    onContent: (List<Uri>) -> Unit,
    onSend: () -> Unit,
) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val ring = if (focused) mixSrgb(c.borderSubtle, c.focusRing, 0.45f) else c.borderSubtle
    val maxH = (LocalConfiguration.current.screenHeightDp * 0.5f).dp
    Row(
        Modifier
            .fillMaxWidth()
            .shadowMedium(shape, c)
            .then(if (focused) Modifier.ring(shape, c.focusRing.copy(alpha = 0.10f), 4.dp) else Modifier)
            .ring(shape, ring)
            .background(c.bgComposer, shape)
            .topEdge(shape, c.edgeLight)
            .then(if (borderTop) Modifier.topEdge(shape, c.borderSubtle) else Modifier)
            .heightIn(min = 48.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        // the plus button: a menu when it offers two things, the thing itself when one, a gap when none
        val options = buildList { if (canAttach) { add("files"); add("media") }; if (canPoll) add("poll") }
        if (options.isEmpty()) Spacer(Modifier.width(16.dp))
        else {
            val pressed = remember { MutableInteractionSource() }
            Box(
                Modifier
                    .size(48.dp)
                    .pressable(pressed) {
                        if (options.size == 1) onAttach(options[0])
                        else openMenu(
                            buildList {
                                if (canAttach) {
                                    add(MenuItem.Action(t("android.composer.photosAndVideos")) { onAttach("media") })
                                    add(MenuItem.Action(t("composer.composer.uploadAFile")) { onAttach("files") })
                                }
                                if (canPoll) add(MenuItem.Action(t("poll.create.title")) { onAttach("poll") })
                            },
                            title = t("composer.plus.label"),
                            haptic = false,
                        )
                    }
                    .semantics { contentDescription = if (canAttach && canPoll) t("composer.plus.label") else if (canAttach) t("composer.composer.uploadAFile") else t("poll.create.title") },
                contentAlignment = Alignment.Center,
            ) { Icon("CirclePlus", c.icon, size = 24.dp) }
        }
        val placeholder = composerPlaceholder(channel)
        Box(Modifier.weight(1f).padding(top = 13.dp, bottom = 13.dp, end = 8.dp)) {
            BasicTextField(
                state = state,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = maxH)
                    .semantics { contentDescription = placeholder }
                    .then(composerContentReceiver(onContent)),
                textStyle = Nx.type.body.copy(color = c.text),
                cursorBrush = SolidColor(c.text),
                interactionSource = interaction,
                lineLimits = TextFieldLineLimits.MultiLine(1, Int.MAX_VALUE),
                inputTransformation = remember(channel.id) {
                    ComposerInput(onPasteTooLong) { name ->
                        channel.serverId?.let { sid -> Nexa.expressions.emojis.value[sid]?.any { it.name.equals(name, ignoreCase = true) } } == true
                    }
                },
                decorator = { inner ->
                    Box {
                        if (state.text.isEmpty()) Txt(placeholder, style = Nx.type.body, color = c.textPlaceholder, maxLines = 1)
                        inner()
                    }
                },
            )
        }
        Row(Modifier.height(48.dp).padding(end = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            ComposerIconButton("ChevronUp", t("composer.more.label"), on = optionsOn, onClick = onOptions)
            SendButton(sendEnabled, onSend)
        }
    }
}

@Composable
private fun ComposerIconButton(icon: String, label: String, on: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .size(44.dp)
            .graphicsLayer { val s = if (pressed) 0.92f else 1f; scaleX = s; scaleY = s }
            .clip(Radii.Sm)
            .background(if (on) c.brand.copy(alpha = 0.14f) else Color.Transparent)
            .pressable(interaction, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, if (on) c.textBrand else c.icon, size = 24.dp) }
}

@Composable
private fun SendButton(enabled: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .size(44.dp)
            .graphicsLayer { val s = if (pressed && enabled) 0.92f else 1f; scaleX = s; scaleY = s }
            .then(
                if (enabled) Modifier
                    .boxShadow(CircleShape, 4f, 12f, c.brand.copy(alpha = 0.8f), spread = -4f)
                    .background(brandGradient(c), CircleShape)
                    .topEdge(CircleShape, Color.White.copy(alpha = 0.22f))
                else Modifier,
            )
            .pressable(interaction, enabled = enabled, onClick = onClick)
            .semantics { contentDescription = t("composer.composer.sendMessage") },
        contentAlignment = Alignment.Center,
    ) { Icon("SendHorizontal", if (enabled) c.onBrand else c.textMuted, size = 22.dp) }
}

@Composable
private fun LockedBox(shape: androidx.compose.ui.graphics.Shape) {
    val c = Nx.colors
    Box(
        Modifier
            .fillMaxWidth()
            .shadowMedium(shape, c)
            .ring(shape, c.borderSubtle)
            .background(c.bgComposer, shape)
            .heightIn(min = 48.dp)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Txt(t("composer.composer.youDoNotHavePermissionTo"), style = Nx.type.body, color = c.textMuted, align = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

/** The reply bar: who you are answering and what they said, whether they get a mention, and a close. */
@Composable
private fun ReplyBar(channel: Channel, reply: ChatUi.Reply, shape: androidx.compose.ui.graphics.Shape) {
    val c = Nx.colors
    val target = Nexa.messages.get(channel.id).byId[reply.messageId]
    val reduced = Nx.motion.reduced
    val enter = remember(reply.messageId) { Animatable(if (reduced) 1f else 0f) }
    val ease = Nx.motion.easeOut
    LaunchedEffect(reply.messageId) { enter.animateTo(1f, tween(180, easing = ease)) }
    val authorId = target?.authorId
    val name = authorId?.let { Names.member(channel.serverId, it) } ?: ""
    val other = authorId != null && authorId != Nexa.users.meId && target.m.webhookId == null
    Row(
        Modifier
            .fillMaxWidth()
            .graphicsLayer { translationY = (1f - enter.value) * 6f * density }
            .ring(shape, c.borderSubtle)
            .background(mixSrgb(c.bgSurface, c.brand, 0.09f), shape)
            .topEdge(shape, c.edgeLight)
            .height(38.dp)
            .padding(start = 16.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val line = buildAnnotatedString {
            val s = t("composer.replyingTo", "name" to "\u0000")
            val at = s.indexOf('\u0000')
            if (at >= 0) {
                append(s.substring(0, at))
                withStyle(SpanStyle(color = c.text, fontWeight = FontWeight(600))) { append(name) }
                append(s.substring(at + 1))
            } else append(s)
        }
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            androidx.compose.foundation.text.BasicText(line, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), color = c.textMuted), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            if (target != null) ReplyExcerpt(target, channel.serverId, Modifier.weight(1f, fill = false))
        }
        if (other) {
            Box(
                Modifier
                    .heightIn(min = 36.dp)
                    .widthIn(min = 40.dp)
                    .pressable(remember { MutableInteractionSource() }) { ChatUi.reply[channel.id] = reply.copy(ping = !reply.ping) }
                    .semantics { contentDescription = t("composer.composer.replyPing") }
                    .padding(horizontal = 6.dp),
                contentAlignment = Alignment.Center,
            ) {
                Txt(
                    if (reply.ping) t("composer.composer.pingOn") else t("composer.composer.pingOff"),
                    style = Nx.type.hint.copy(fontWeight = FontWeight(700)),
                    color = if (reply.ping) c.textBrand else c.textMuted,
                )
            }
        }
        Box(
            Modifier
                .size(40.dp, 36.dp)
                .pressable(remember { MutableInteractionSource() }) { ChatUi.reply.remove(channel.id) }
                .semantics { contentDescription = t("composer.composer.cancelReply") },
            contentAlignment = Alignment.Center,
        ) { Icon("X", c.textMuted, size = 16.dp) }
    }
}

/** The files waiting to go: a count and total, then a card for each with spoiler and remove. */
@Composable
private fun Tray(channelId: String, files: List<Staged>, shape: androidx.compose.ui.graphics.Shape) {
    val c = Nx.colors
    Column(
        Modifier
            .fillMaxWidth()
            .ring(shape, c.borderSubtle)
            .background(c.bgComposer, shape)
            .topEdge(shape, c.edgeLight),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Txt(t("composer.composer.trayCount", "count" to files.size, "max" to Staging.MAX_FILES), style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.textMuted)
            Txt(Time.bytes(files.sumOf { it.size }), style = Nx.type.hint.copy(fontWeight = FontWeight(500), fontFeatureSettings = "tnum"), color = c.textMuted)
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(16.dp, 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for (f in files) TrayCard(channelId, f)
        }
    }
}

@Composable
private fun TrayCard(channelId: String, f: Staged) {
    val c = Nx.colors
    val shape = Radii.Sm
    Box(Modifier.width(150.dp)) {
        Column(
            Modifier
                .fillMaxWidth()
                .shadowLow(shape, c)
                .ring(shape, c.borderSubtle)
                .background(c.bgSurface, shape)
                .padding(8.dp),
        ) {
            Box(Modifier.fillMaxWidth().height(100.dp).clip(Radii.Sm).background(c.bgInput), contentAlignment = Alignment.Center) {
                if (f.preview != null && f.type.startsWith("image/")) {
                    AsyncImage(File(f.preview), f.name, Modifier.fillMaxWidth().height(100.dp).then(if (f.spoiler) Modifier.blur(20.dp) else Modifier), contentScale = ContentScale.Fit)
                } else if (f.preview != null && f.type.startsWith("video/")) {
                    AsyncImage(File(f.preview), f.name, Modifier.fillMaxWidth().height(100.dp).then(if (f.spoiler) Modifier.blur(20.dp) else Modifier), contentScale = ContentScale.Fit)
                } else Icon("File", c.textMuted, size = 26.dp)
            }
            Txt(f.name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.text, maxLines = 1, modifier = Modifier.padding(top = 6.dp))
            Txt(Time.bytes(f.size), style = Nx.type.hint, color = c.textMuted)
        }
        Row(
            Modifier
                .align(Alignment.TopEnd)
                .offset(x = 8.dp, y = (-8).dp)
                .shadowMedium(Radii.Sm, c)
                .background(c.bgFloating, Radii.Sm),
        ) {
            val list = { ChatUi.trays[channelId] ?: emptyList() }
            IconTile(if (f.spoiler) "EyeOff" else "Eye", t("composer.composer.spoilerNamed", "name" to f.name), if (f.spoiler) c.textBrand else c.icon) {
                ChatUi.trays[channelId] = list().map { if (it.id == f.id) it.copy(spoiler = !it.spoiler) else it }
            }
            IconTile("Trash2", t("composer.composer.removeNamed", "name" to f.name), c.icon, pressedTint = c.danger) {
                f.file.delete()
                val next = list().filter { it.id != f.id }
                if (next.isEmpty()) ChatUi.trays.remove(channelId) else ChatUi.trays[channelId] = next
            }
        }
    }
}

@Composable
private fun IconTile(icon: String, label: String, tint: Color, pressedTint: Color? = null, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier.size(40.dp).pressable(interaction, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, if (pressed && pressedTint != null) pressedTint else tint, size = 16.dp) }
}

/** The notice bar: a paste held back, or files left out, with what can be done about it. */
@Composable
private fun NoticeBar(n: Notice, shape: androidx.compose.ui.graphics.Shape, canAttach: Boolean, onDismiss: () -> Unit, onAction: (String) -> Unit) {
    val c = Nx.colors
    Column(
        Modifier
            .fillMaxWidth()
            .background(c.bgSurface, shape)
            .padding(start = 0.dp),
    ) {
        Row(Modifier.fillMaxWidth().heightIn(min = 40.dp)) {
            Box(Modifier.width(3.dp).heightIn(min = 40.dp).background(c.warning))
            Row(Modifier.weight(1f).padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                val text = when (n) {
                    is Notice.PasteTooLong -> t("composer.composer.pasteTooLong", "count" to n.text.length)
                    is Notice.FilesLeftOut -> if (n.more == 0) t("composer.composer.fileLeftOut", "max" to Staging.MAX_FILES, "name" to n.name)
                    else t("composer.composer.filesLeftOut", "max" to Staging.MAX_FILES, "name" to n.name, "count" to n.more)
                }
                Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(18.9f)), color = c.text, modifier = Modifier.weight(1f))
                IconTile("X", t("composer.composer.dismiss"), c.textMuted, onClick = onDismiss)
            }
        }
        if (n is Notice.PasteTooLong) Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 8.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
        ) {
            if (canAttach) NoticeButton(t("composer.composer.attachAsFile"), primary = true) { onAction("file") }
            NoticeButton(t("composer.composer.pasteAnyway"), primary = false) { onAction("anyway") }
        }
    }
}

@Composable
private fun NoticeButton(label: String, primary: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    Box(
        Modifier
            .heightIn(min = 40.dp)
            .clip(Radii.Sm)
            .then(if (primary) Modifier.background(brandGradient(c)) else Modifier.background(c.bgActive))
            .pressable(remember { MutableInteractionSource() }, onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Txt(label, style = Nx.type.label.copy(fontWeight = FontWeight(600)), color = if (primary) c.onBrand else c.text) }
}

/** MessagePreview: your words as they will look, which only you can see. */
@Composable
private fun PreviewBox(text: String, serverId: String?, onHide: () -> Unit) {
    val c = Nx.colors
    val me = Nexa.users.me.collectAsState().value ?: return
    val shape = Radii.Md
    Column(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .border(1.dp, c.borderStrong, shape)
            .background(c.bgSurface, shape)
            .heightIn(max = 320.dp)
            .verticalScroll(rememberScrollState()),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 10.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon("Eye", c.textMuted, size = 14.dp)
            Txt(t("composer.preview.onlyYou"), style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.textMuted, modifier = Modifier.weight(1f))
            IconTile("X", t("composer.preview.hide"), c.textMuted, onClick = onHide)
        }
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Avatar(me.id, me.name, me.avatarId, 40.dp)
            Column(Modifier.weight(1f)) {
                Txt(me.name, style = Nx.type.body.copy(fontWeight = FontWeight(500)), color = c.textStrong)
                fish.nexa.ui.markdown.MarkdownView(text, fish.nexa.ui.markdown.RenderCtx(serverId = serverId, inert = true, surface = c.bgSurface))
            }
        }
    }
}

/** The autocomplete card above the composer: people, roles, channels, emoji or commands. */
@Composable
private fun Autocomplete(channel: Channel, token: AcToken, modifier: Modifier, pick: (String) -> Unit) {
    val c = Nx.colors
    val sections = remember(token, channel) { suggestions(channel, token) }
    if (sections.all { it.second.isEmpty() }) return
    val maxH = minOf(456f, LocalConfiguration.current.screenHeightDp * 0.45f).dp
    val reduced = Nx.motion.reduced
    val enter = remember { Animatable(if (reduced) 1f else 0f) }
    val ease = Nx.motion.easeOut
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(160, easing = ease)) }
    val shape = Radii.Md
    BoxWithConstraints(modifier.fillMaxWidth()) {
        Column(
            Modifier
                .padding(horizontal = 16.dp)
                .offset { androidx.compose.ui.unit.IntOffset(0, -(10 * density).toInt()) }
                .graphicsLayer {
                    alpha = enter.value
                    translationY = (1f - enter.value) * 6f * density - size.height
                }
                .fillMaxWidth()
                .heightIn(max = maxH)
                .shadowHigh(shape, c)
                .background(c.bgFloating, shape)
                .topEdge(shape, c.edgeLight)
                .verticalScroll(rememberScrollState())
                .padding(8.dp),
        ) {
            var first = true
            for ((heading, rows) in sections) {
                if (rows.isEmpty()) continue
                Txt(heading, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12.5f), fontWeight = FontWeight(650)), color = c.textMuted, modifier = Modifier.padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 8.dp))
                for (row in rows) {
                    AcRow(row, selected = first) { pick(row.insert) }
                    first = false
                }
            }
        }
    }
}

data class AcItem(val kind: String, val insert: String, val title: String, val sub: String = "", val user: PublicUser? = null, val color: Long? = null, val emoji: String? = null)

@Composable
private fun AcRow(item: AcItem, selected: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    val shape = Radii.Sm
    Row(
        Modifier
            .fillMaxWidth()
            .height(40.dp)
            .then(if (selected) Modifier.ring(shape, c.brand.copy(alpha = 0.24f)).background(c.brand.copy(alpha = 0.18f), shape) else Modifier)
            .clip(shape)
            .pressable(remember { MutableInteractionSource() }, onClick = onClick)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        val roleTint = item.color?.let { mixSrgb(c.textStrong, Color(0xFF000000 or it), 0.72f) }
        when (item.kind) {
            "user" -> item.user?.let { Avatar(it.id, it.name, it.avatarId, 24.dp) }
            "role", "everyone" -> Icon("AtSign", roleTint ?: c.icon, size = 18.dp)
            "channel" -> Icon("Hash", c.textMuted, size = 18.dp)
            "emoji" -> item.emoji?.let { EmojiGlyph(it, 22.dp) }
            "command" -> Unit
        }
        Txt(item.title, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f)), color = roleTint ?: c.text, maxLines = 1, modifier = Modifier.weight(1f, fill = false).widthIn(max = 220.dp))
        Spacer(Modifier.weight(1f))
        if (item.sub.isNotEmpty()) Txt(item.sub, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
    }
}

private fun suggestions(channel: Channel, token: AcToken): List<Pair<String, List<AcItem>>> {
    val st = channel.serverId?.let { Nexa.servers.get(it) }
    val q = token.query
    return when (token.kind) {
        "user" -> {
            val pool = if (st != null) st.members.keys.mapNotNull { Nexa.users.get(it) }
            else channel.recipientIds.mapNotNull { Nexa.users.get(it) }
            val here = Nexa.messages.get(channel.id)
            val recent = fish.nexa.ui.markdown.People.recentSpeakers(here.ids.takeLast(100).asReversed().mapNotNull { here.byId[it]?.authorId }, Nexa.users.meId)
            val people = fish.nexa.ui.markdown.People.rank(q, pool, { fish.nexa.ui.markdown.People.Person(it.id, it.username, it.displayName) }, { st?.members?.get(it)?.nickname ?: "" }, recent, fish.nexa.ui.I18n.locale).take(8)
                .map { AcItem("user", "@${it.username} ", it.name, it.username, user = it) }
            val everyRole = st != null && Nexa.servers.canI(st, P.MENTION_EVERYONE, channel.id)
            val roles = st?.roles?.values?.filter { it.id != st.server.id && (it.mentionable || everyRole) && it.name.lowercase().contains(q) }
                ?.sortedBy { if (it.name.lowercase().startsWith(q)) 0 else 1 }?.take(5)
                ?.map { AcItem("role", "@${it.name} ", it.name, t("composer.autocomplete.notifyRole"), color = it.color.takeIf { c -> c != 0L }) } ?: emptyList()
            val every = if (everyRole) listOf(
                AcItem("everyone", "@everyone ", "@everyone", t("composer.composer.notifyEveryoneWhoCanSeeThis")),
                AcItem("everyone", "@here ", "@here", t("composer.composer.notifyEveryoneOnlineInThisChannel")),
            ).filter { it.title.substring(1).startsWith(q) } else emptyList()
            listOf(t("server.serverSettings.members") to (every + people), t("server.members.roles") to roles)
        }
        "channel" -> {
            val sid = channel.serverId ?: return emptyList()
            val list = Nexa.channels.byId.value.values.filter { it.serverId == sid && it.isText && it.type == "text" && Nexa.servers.canI(st, P.VIEW_CHANNEL, it.id) && it.name.lowercase().contains(q) }
                .sortedWith(compareBy({ if (it.name.lowercase().startsWith(q)) 0 else 1 }, { it.position }))
                .take(8)
                .map { ch -> AcItem("channel", "#${ch.name} ", ch.name, ch.parentId?.let { Nexa.channels.get(it)?.name } ?: "") }
            listOf(t("servers.defaults.textChannels") to list)
        }
        "emoji" -> listOf((if (q.isEmpty()) t("composer.autocomplete.frequentlyUsed") else t("server.emoji.emoji")) to emojiSuggestions(channel, q))
        "command" -> listOf(t("composer.autocomplete.commands") to fish.nexa.ui.markdown.Commands.LIST.filter { it.first.startsWith(q) }.map { (name, desc) -> AcItem("command", "/$name ", "/$name", t(desc)) })
        else -> emptyList()
    }
}

/**
 * Emoji for ":" (Composer.tsx): with Smart Emoji, one list of everything
 * ranked by how well it matches and how much you use it (a lone ":" offers
 * your frequent ones); without, this server's own custom emoji first, then
 * other servers' and packs' (up to four in all), filled with standard ones.
 */
private fun emojiSuggestions(channel: Channel, query: String): List<AcItem> {
    val md = fish.nexa.ui.markdown.EmojiData
    if (!md.loaded()) {
        md.preload()
        return emptyList()
    }
    val ex = Nexa.expressions
    val sid = channel.serverId
    val tone = Nexa.settings.skinTone
    val packEmoji = ex.packs.value.values.filter { it.kind == "emoji" }.flatMap { p ->
        p.stickers.map { r -> fish.nexa.net.Emoji(r.id, "", r.name, r.blobId, r.animated, r.creatorId, r.createdAt) }
    }
    fun custom(e: fish.nexa.net.Emoji) = AcItem("emoji", fish.nexa.ui.markdown.CustomEmoji.token(e) + " ", ":${e.name}:", emoji = fish.nexa.ui.markdown.CustomEmoji.reactionKey(e))
    fun std(e: fish.nexa.ui.markdown.EmojiEntry, name: String) = md.withTone(e, tone).let { u -> AcItem("emoji", "$u ", ":$name:", emoji = u) }
    if (Nexa.settings.smartEmoji) {
        val candidates = ArrayList<fish.nexa.ui.markdown.EmojiSuggest.Candidate>()
        if (sid != null) ex.emojis.value[sid]?.forEach { candidates += fish.nexa.ui.markdown.EmojiSuggest.Candidate.Custom(it, own = true) }
        for ((id, list) in ex.emojis.value) if (id != sid) list.forEach { candidates += fish.nexa.ui.markdown.EmojiSuggest.Candidate.Custom(it) }
        packEmoji.forEach { candidates += fish.nexa.ui.markdown.EmojiSuggest.Candidate.Custom(it) }
        md.all().filter { md.has(it.unicode) }.forEach { candidates += fish.nexa.ui.markdown.EmojiSuggest.Candidate.Unicode(it) }
        val now = System.currentTimeMillis().toDouble()
        val usage = fish.nexa.ui.markdown.EmojiUsage.sanitize(Nexa.settings.doc.value["emojiUsage"], now)
        return fish.nexa.ui.markdown.EmojiSuggest.suggest(query, candidates, usage, Nexa.settings.recentEmoji, now).map { s ->
            when (val c = s.candidate) {
                is fish.nexa.ui.markdown.EmojiSuggest.Candidate.Custom -> custom(c.emoji)
                is fish.nexa.ui.markdown.EmojiSuggest.Candidate.Unicode -> std(c.entry, s.name)
            }
        }
    }
    val q = query.lowercase()
    val own = if (sid != null) (ex.emojis.value[sid] ?: emptyList()).filter { it.name.lowercase().contains(q) }.sortedBy { if (it.name.lowercase().startsWith(q)) 0 else 1 }.take(4) else emptyList()
    val others = ex.emojis.value.filterKeys { it != sid }.values.flatten().filter { it.name.lowercase().contains(q) }.sortedBy { if (it.name.lowercase().startsWith(q)) 0 else 1 }.take(4 - own.size)
    val customs = (own + others)
    val packs = packEmoji.filter { it.name.lowercase().contains(q) }.take(4 - minOf(customs.size, 4))
    val all = (customs + packs).map { custom(it) }
    return all + md.search(q, maxOf(2, 8 - all.size)).map { std(it, it.shortcodes.firstOrNull() ?: it.label) }
}

/** The bar that stands in for the composer while picking messages to delete. */
@Composable
private fun SelectionBar(channel: Channel) {
    val c = Nx.colors
    val count = ChatUi.picked.size
    val shape = Radii.Md
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 8.dp)
            .shadowMedium(shape, c)
            .ring(shape, c.panelEdge)
            .background(c.bgComposer, shape)
            .topEdge(shape, c.edgeLight)
            .heightIn(min = 48.dp)
            .padding(start = 4.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            Modifier.size(36.dp).clip(Radii.Xs).pressable(remember { MutableInteractionSource() }) { ChatUi.stopSelecting() }
                .semantics { contentDescription = t("chat.selectionBar.stopSelecting") },
            contentAlignment = Alignment.Center,
        ) { Icon("X", c.icon, size = 20.dp) }
        Txt(
            if (count == 0) t("chat.selectionBar.selectMessagesToDelete") else t("chat.selectionBar.messagesSelected", "count" to count),
            style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(500)), color = c.text, maxLines = 1, modifier = Modifier.weight(1f),
        )
        fish.nexa.ui.components.NxButton(t("chat.messageItem.delete"), {
            val ids = ChatUi.picked.toList()
            fish.nexa.ui.shell.confirm(
                if (ids.size == 1) t("chat.selectionBar.deleteMessages", "count" to 1) else t("chat.selectionBar.deleteMessages", "count" to ids.size),
                t("chat.selectionBar.areYouSureDeleteMessages", "count" to ids.size),
                t("chat.messageItem.delete"),
            ) {
                Send.deleteMany(channel.id, ids)
                ChatUi.stopSelecting()
            }
        }, kind = fish.nexa.ui.components.ButtonKind.DANGER, size = fish.nexa.ui.components.ButtonSize.SM, icon = "Trash2", enabled = count > 0)
    }
}

/** When moderators have muted the account (NexaNotices MutedBar), this stands where the composer was. */
@Composable
private fun MutedBar(until: Long) {
    val c = Nx.colors
    val shape = Radii.Sm
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, bottom = 16.dp)
            .border(1.dp, c.warning.copy(alpha = 0.35f), shape)
            .background(mixSrgb(c.bgComposer, c.warning, 0.10f), shape)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon("MessageSquareOff", c.warning, size = 22.dp)
        Column(Modifier.weight(1f)) {
            val title = t("nexa.muted.title")
            androidx.compose.foundation.text.BasicText(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight(700), color = c.textStrong)) { append(title) }
                    append(" " + t("nexa.muted.body"))
                },
                style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(19.6f), color = c.text),
            )
            Txt(
                if (until == Long.MAX_VALUE) t("nexa.muted.untilLifted") else t("nexa.muted.until", "when" to Time.full(until), "rel" to Time.relative(until)),
                style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

/** The account's moderation state, as the shell knows it. */
object NexaRestrictions {
    /** When the account's mute ends (Long.MAX_VALUE until lifted), or null when it can talk. */
    fun mutedUntil(me: fish.nexa.net.MeUser): Long? {
        val mute = (me.nexa as? kotlinx.serialization.json.JsonObject)?.get("mute") as? kotlinx.serialization.json.JsonObject ?: return null
        val until = (mute["until"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull()
        if (until != null && until <= System.currentTimeMillis()) return null
        return until ?: Long.MAX_VALUE
    }
}

/** What the message box says while empty: "Message #general", "Message @Alice". */
fun composerPlaceholder(channel: fish.nexa.net.Channel): String = when (channel.type) {
    "dm" -> t("composer.composer.messageUser", "name" to (Names.otherOf(channel)?.let { Names.shown(it) } ?: ""))
    "group_dm", "subchat" -> t("composer.composer.messageGroup", "name" to Names.channel(channel))
    else -> t("composer.composer.messageChannel", "name" to channel.name)
}
