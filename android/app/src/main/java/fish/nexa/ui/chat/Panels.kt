package fish.nexa.ui.chat

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.Kdf
import fish.nexa.crypto.KdfParams
import fish.nexa.data.ChatMessage
import fish.nexa.data.Send
import fish.nexa.net.ApiError
import fish.nexa.net.Channel
import fish.nexa.net.Message
import fish.nexa.net.wireJson
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.ToggleLine
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.shell.Names
import fish.nexa.ui.shell.confirm
import fish.nexa.ui.shell.copyText
import fish.nexa.ui.shell.openProfile
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.boxShadow
import fish.nexa.ui.theme.brandGradient
import fish.nexa.ui.theme.mixSrgb
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.shadowHigh
import fish.nexa.ui.theme.topEdge
import fish.nexa.ui.threads.ThreadsPanel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** The panels that open over a conversation on a phone: pins, subchats (search has its own page). */
@Composable
fun BoxScope.ChatPanels(channel: Channel) {
    when (ChatUi.panel) {
        "pins" -> Scrim { PinsPanel(channel) }
        "subchats" -> Scrim { SubchatsPanel(channel) }
        "threads" -> Scrim { ThreadsPanel(channel) }
    }
}

/** A tap beside a panel closes it, and so does Back. */
@Composable
internal fun BoxScope.Scrim(content: @Composable BoxScope.() -> Unit) {
    BackHandler { ChatUi.panel = null }
    Box(Modifier.matchParentSize().pressable(remember { MutableInteractionSource() }) { ChatUi.panel = null }) { content() }
}

/** popDown: a panel drops in from the header, 200 ms. */
@Composable
internal fun Modifier.popDown(): Modifier {
    val reduced = Nx.motion.reduced
    val ease = Nx.motion.easeOut
    val p = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) { p.animateTo(1f, tween(200, easing = ease)) }
    return this.graphicsLayer {
        alpha = p.value
        translationY = (1f - p.value) * -6f * density
        val s = 0.98f + 0.02f * p.value
        scaleX = s; scaleY = s
    }
}

// ---------------------------------------------------------------------------
// pinned messages (PinsPanel)

@Composable
private fun BoxScope.PinsPanel(channel: Channel) {
    val c = Nx.colors
    var pins by remember(channel.id) { mutableStateOf<List<ChatMessage>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    // a pin changing anywhere reloads the list
    val all by Nexa.messages.channels.collectAsState()
    val pinnedNow = all[channel.id]?.byId?.values?.count { it.m.pinned } ?: 0
    LaunchedEffect(channel.id, reload, pinnedNow) {
        failed = false
        try {
            val list = wireJson.decodeFromJsonElement(ListSerializer(Message.serializer()), Nexa.api.get("/channels/${channel.id}/pins"))
            pins = withContext(Dispatchers.Default) { list.map { Nexa.messages.decrypt(it) } }
            Nexa.session.ensureUsers(list.map { it.authorId })
        } catch (_: Exception) {
            failed = true
        }
    }
    val server = channel.serverId?.let { Nexa.servers.get(it) }
    val ctx = ListCtx(channel, server, compact = false, selecting = false, meId = Nexa.users.meId ?: "")
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
            Txt(t("chat.chat.pinnedMessages"), style = Nx.type.headerTitle.copy(fontSize = Nx.type.sp(16f), fontWeight = FontWeight(660)), color = c.textStrong, modifier = Modifier.weight(1f))
            PanelClose(t("chat.pins.closePinnedMessages"), 18) { ChatUi.panel = null }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
        Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val list = pins
            when {
                failed -> Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    PanelNote(t("chat.pins.couldNotLoadPinnedMessages"))
                    NxButton(t("chat.messageList.tryAgain"), { reload += 1 }, kind = ButtonKind.LINK, inline = true)
                }
                list == null -> PanelNote(t("chat.pins.loading"))
                list.isEmpty() -> PanelNote(t("chat.pins.thisChannelDoesnTHaveAny"))
                else -> for (cm in list) {
                    if (Nexa.relationships.isBlocked(cm.authorId) && Nexa.settings.hideBlockedMessages) continue
                    PinCard(cm, ctx)
                }
            }
        }
    }
}

@Composable
internal fun PanelNote(text: String) = Txt(
    text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = Nx.colors.textMuted,
    align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp),
)

@Composable
internal fun PanelClose(label: String, icon: Int, onClick: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(Radii.Sm).pressable(remember { MutableInteractionSource() }, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon("X", Nx.colors.icon, size = icon.dp) }
}

/** One pin: who and when, the whole message as it reads in the conversation, then Jump and Unpin. */
@Composable
private fun PinCard(cm: ChatMessage, ctx: ListCtx) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    val shape = Radii.Md
    val sid = ctx.server?.server?.id
    Column(
        Modifier
            .fillMaxWidth()
            .ring(shape, c.borderSubtle)
            .background(c.bgRaised, shape)
            .topEdge(shape, c.edgeLight)
            .padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // a webhook's pin goes by the name and picture it was sent with; an app's, by its bot's
            val hook = fish.nexa.ui.markdown.Webhook.of(cm.hook)
            val hookId = cm.m.webhookId?.takeIf { hook != null }
            val name = if (hook != null && hookId != null) hook.name else Names.member(sid, cm.authorId)
            if (hook != null && hookId != null) fish.nexa.ui.media.HookAvatar(hook, hookId, 40.dp)
            else Avatar(cm.authorId, name, Nexa.users.get(cm.authorId)?.avatarId, 40.dp, modifier = Modifier.pressable(remember { MutableInteractionSource() }) { openProfile(cm.authorId) })
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (hook != null && hookId != null) {
                        Txt(name, style = Nx.type.body.copy(fontWeight = FontWeight(650)), color = c.textStrong, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                        fish.nexa.ui.media.HookTags({ fish.nexa.ui.media.openHookCard(hook, hookId) })
                    } else {
                        val color = ctx.server?.let { Nexa.servers.memberColor(it, cm.authorId) }?.let { Color(0xFF000000 or it) } ?: c.textStrong
                        fish.nexa.ui.chat.PersonName(cm.authorId, name, serverId = sid, style = Nx.type.body.copy(fontWeight = FontWeight(650)), color = color, maxLines = 1, modifier = Modifier.weight(1f, fill = false).pressable(remember { MutableInteractionSource() }) { openProfile(cm.authorId) })
                    }
                    Txt(Time.timestamp(cm.m.createdAt), style = Nx.type.timestamp, color = c.textMuted, maxLines = 1)
                }
                if (Nexa.relationships.isBlocked(cm.authorId)) Txt(t("people.blocked.replyPreview"), style = Nx.type.body.copy(fontStyle = FontStyle.Italic), color = c.textMuted)
                else MessageBody(MsgItem(cm.id, cm, groupStart = true), ctx, failed = false)
            }
        }
        Row(Modifier.fillMaxWidth().height(36.dp), horizontalArrangement = Arrangement.spacedBy(0.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            JumpPill {
                ChatUi.panel = null
                ChatUi.jumpTo(cm.channelId, cm.id)
            }
            if (canPin(cm.m)) {
                val interaction = remember { MutableInteractionSource() }
                val pressed by interaction.collectIsPressedAsState()
                var unpinning by remember { mutableStateOf(false) }
                Box(
                    Modifier
                        .size(48.dp)
                        .pressable(interaction, enabled = !unpinning) {
                            unpinning = true
                            scope.launch {
                                try {
                                    Send.setPinned(cm.channelId, cm.id, false)
                                } catch (e: Exception) {
                                    Nexa.ui.toast((e as? ApiError)?.message ?: t("chat.pins.thatMessageCouldNotBeUnpinned"), "error")
                                } finally {
                                    unpinning = false
                                }
                            }
                        }
                        .semantics { contentDescription = t("chat.pins.unpinThisMessage") },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier.size(36.dp).alpha(if (unpinning) 0.5f else 1f).background(if (pressed) c.danger else Color.Transparent, Radii.Xs),
                        contentAlignment = Alignment.Center,
                    ) { Icon("PinOff", if (pressed) c.onDanger else c.textMuted, size = 16.dp) }
                }
            }
        }
    }
}

@Composable
private fun JumpPill(onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = RoundedCornerShape(999.dp)
    Box(Modifier.height(48.dp).pressable(interaction, onClick = onClick), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .height(36.dp)
                .then(if (pressed) Modifier.background(brandGradient(c), shape) else Modifier.ring(shape, c.borderSubtle).background(c.bgSurface, shape))
                .padding(horizontal = 14.dp),
            contentAlignment = Alignment.Center,
        ) { Txt(t("chat.pins.jump"), style = Nx.type.label.copy(fontWeight = FontWeight(650)), color = if (pressed) c.onBrand else c.text) }
    }
}

// ---------------------------------------------------------------------------
// subchats (SubchatPanel)

/** The conversation a subchat belongs to (the subchat itself answers for its parent). */
private fun parentOf(channel: Channel): Channel = if (channel.type == "subchat") channel.parentId?.let { Nexa.channels.get(it) } ?: channel else channel

@Composable
private fun BoxScope.SubchatsPanel(channel: Channel) {
    val c = Nx.colors
    val parent = parentOf(channel)
    val all by Nexa.channels.byId.collectAsState()
    val reads by Nexa.readStates.byChannel.collectAsState()
    var loading by remember { mutableStateOf(true) }
    LaunchedEffect(parent.id) {
        // the server's list brings in any this device has not seen yet
        runCatching {
            val list = wireJson.decodeFromJsonElement(ListSerializer(Channel.serializer()), Nexa.api.get("/channels/${parent.id}/subchats"))
            Nexa.channels.upsert(list)
        }
        loading = false
    }
    val subs = all.values.filter { it.type == "subchat" && it.parentId == parent.id }
        .sortedWith { a, b -> fish.nexa.data.Ids.compare(b.lastMessageId ?: b.id, a.lastMessageId ?: a.id) }
    var name by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val shape = Radii.Md
    Column(
        Modifier
            .align(Alignment.TopCenter)
            .padding(start = 8.dp, end = 8.dp, top = 6.dp)
            .fillMaxWidth()
            .popDown()
            .shadowHigh(shape, c)
            .ring(shape, c.panelEdge)
            .background(c.bgFloating, shape)
            .topEdge(shape, c.edgeLight)
            .pressable(remember { MutableInteractionSource() }) {},
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 0.dp, top = 0.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon("MessageCircle", c.textStrong, size = 16.dp)
            Txt(t("chat.chat.subchats"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), fontWeight = FontWeight(700)), color = c.textStrong, modifier = Modifier.weight(1f))
            PanelClose(t("chat.subchat.closeSubchats"), 16) { ChatUi.panel = null }
        }
        Txt(t("chat.subchat.sideConversationsInsideThisChatEveryone"), style = Nx.type.hint.copy(lineHeight = Nx.type.sp(16.8f)), color = c.textMuted, modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp))
        Column(Modifier.heightIn(max = 280.dp).verticalScroll(rememberScrollState()).padding(horizontal = 6.dp)) {
            when {
                loading && subs.isEmpty() -> Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) { Spinner(size = 18.dp) }
                subs.isEmpty() -> Txt(t("chat.subchat.noSubchatsYet"), style = Nx.type.label.copy(fontWeight = FontWeight(400)), color = c.textMuted, align = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(12.dp))
                else -> for (s in subs) SubchatRow(s, open = s.id == channel.id, read = reads[s.id])
            }
        }
        // a new one: a name, then Create (or the dialog, for one with a password)
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
        var busy by remember { mutableStateOf(false) }
        fun create() {
            val n = name.trim()
            if (n.isEmpty() || busy) return
            busy = true
            scope.launch {
                try {
                    val ch = createSubchat(parent.id, n, null)
                    name = ""
                    ChatUi.panel = null
                    Nav.go(Route.Dm(ch.id))
                } catch (e: Exception) {
                    Nexa.ui.toast((e as? ApiError)?.message ?: t("chat.subchat.couldNotStartThatSubchat"), "error")
                } finally {
                    busy = false
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(start = 10.dp, end = 10.dp, top = 8.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val focus = remember { MutableInteractionSource() }
            val focused by focus.collectIsFocusedAsState()
            BasicTextField(
                name, { name = it.take(48) },
                modifier = Modifier
                    .weight(1f)
                    .height(40.dp)
                    .background(c.bgInput, Radii.Xs)
                    .border(1.dp, if (focused) c.brand else Color.Transparent, Radii.Xs)
                    .padding(horizontal = 10.dp)
                    .semantics { contentDescription = t("chat.subchat.newSubchatName") },
                textStyle = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), color = c.text),
                singleLine = true,
                interactionSource = focus,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { create() }),
                cursorBrush = SolidColor(c.brand),
                decorationBox = { inner ->
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) {
                        if (name.isEmpty()) Txt(t("chat.subchat.newSubchatName"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textPlaceholder, maxLines = 1)
                        inner()
                    }
                },
            )
            NewButton("Settings2", t("chat.subchat.newSubchatWithAPassword"), enabled = true) {
                ChatUi.panel = null
                openSubchatDialog(parent, null, name.trim())
            }
            NewButton("Plus", t("chat.subchat.createSubchat"), enabled = name.isNotBlank() && !busy) { create() }
        }
    }
}

/** `.subNew button`: a square in the accent, greyed while it cannot act. */
@Composable
private fun NewButton(icon: String, label: String, enabled: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .size(40.dp)
            .clip(Radii.Xs)
            .background(if (!enabled) c.bgActive else if (pressed) c.brandHover else c.brand)
            .pressable(interaction, enabled = enabled, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, if (enabled) c.onBrand else c.textMuted, size = 16.dp) }
}

@Composable
private fun SubchatRow(s: Channel, open: Boolean, read: fish.nexa.data.ReadMark?) {
    val c = Nx.colors
    val unread = fish.nexa.ui.shell.Unread.isUnread(read, s.lastMessageId) && !open
    val count = if (fish.nexa.ui.shell.Unread.isUnread(read, s.lastMessageId)) maxOf(read?.unread ?: 0, read?.mentions ?: 0) else 0
    Row(
        Modifier
            .fillMaxWidth()
            .height(40.dp)
            .clip(Radii.Xs)
            .background(if (open) c.bgActive else Color.Transparent)
            .pressable(remember { MutableInteractionSource() }, onLongClick = { subchatMenu(s) }) {
                ChatUi.panel = null
                Nav.go(Route.Dm(s.id))
            }
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(if (s.locked) "Lock" else "MessageCircle", if (unread) c.textStrong else c.textMuted, size = 16.dp)
        Txt(
            s.name, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = if (unread) FontWeight(600) else FontWeight(400)),
            color = if (open || unread) c.textStrong else c.textSubtle, maxLines = 1, modifier = Modifier.weight(1f),
        )
        if (count > 0) fish.nexa.ui.components.CountBadge(count)
    }
}

/** subchatMenuItems: edit its name and password, or delete it for everyone. */
private fun subchatMenu(s: Channel) {
    val items = ArrayList<MenuItem>()
    items += MenuItem.Action(t("chat.subchat.editSubchat")) { openSubchatDialog(parentOf(s), s, s.name) }
    items += MenuItem.Action(t("chat.subchat.deleteSubchat"), danger = true) {
        confirm(t("chat.subchat.deleteNamed", "name" to s.name), t("chat.subchat.theSubchatAndEveryMessageIn"), t("chat.subchat.deleteSubchat")) {
            try {
                Nexa.api.request("DELETE", "/channels/${s.id}")
                Nexa.channels.remove(s.id)
                if ((Nav.route as? Route.Dm)?.channelId == s.id) s.parentId?.let { Nav.go(Route.Dm(it), replace = true) }
            } catch (e: Exception) {
                Nexa.ui.toast((e as? ApiError)?.message ?: t("chat.subchat.couldNotDeleteThatSubchat"), "error")
            }
        }
    }
    if (Nexa.settings.developerMode) items += MenuItem.Action(t("sidebar.dmMenu.copyChannelId")) { copyText(s.id) }
    openMenu(items, title = s.name)
}

/** lib/subchatLock.ts passwordProblem. */
private fun passwordProblem(pw: String): String? = when {
    pw.length < 4 -> t("appLock.useAtLeastCharacters", "count" to 4)
    pw.length > 128 -> t("appLock.thatIsTooLong")
    else -> null
}

/** lib/subchatLock.ts newLock: the password stretched exactly as an account password is. */
private suspend fun lockFor(password: String): JsonObject = withContext(Dispatchers.Default) {
    val salt = Bytes.random(16)
    val p = Kdf.DEFAULT
    val key = Kdf.authKey(Kdf.deriveMaster(password, salt, p))
    buildJsonObject {
        put("password_key", Bytes.b64(key))
        put("password_salt", Bytes.b64(salt))
        put("password_params", buildJsonObject { put("m", p.m); put("t", p.t); put("p", p.p); put("v", p.v) })
    }
}

private suspend fun createSubchat(parentId: String, name: String, lock: JsonObject?): Channel {
    val body = buildJsonObject {
        put("name", name)
        if (lock != null) for ((k, v) in lock) put(k, v)
    }
    val ch = wireJson.decodeFromJsonElement(Channel.serializer(), Nexa.api.request("POST", "/channels/$parentId/subchats", body))
    Nexa.channels.upsert(listOf(ch))
    return ch
}

/**
 * SubchatModal: a name, and a password everyone types once per sign-in if
 * asked for. Editing one that has a password keeps it unless the switch goes
 * off, or a new one is typed.
 */
private fun openSubchatDialog(parent: Channel, editing: Channel?, startName: String) {
    val locked = editing?.locked == true
    var name by mutableStateOf(startName)
    var wants by mutableStateOf(locked)
    var password by mutableStateOf("")
    var again by mutableStateOf("")
    var error by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
    fun save(close: () -> Unit) {
        if (busy) return
        val trimmed = name.trim()
        if (trimmed.isEmpty()) { error = t("modals.subchat.giveTheSubchatAName"); return }
        val changing = wants && (!locked || password.isNotEmpty())
        val removing = locked && !wants
        if (changing) {
            passwordProblem(password)?.let { error = it; return }
            if (password != again) { error = t("modals.subchat.thoseTwoPasswordsAreDifferent"); return }
        }
        busy = true
        error = null
        Nexa.scope.launch {
            try {
                val lock = when {
                    changing -> lockFor(password)
                    removing -> buildJsonObject { put("password_remove", true) }
                    else -> null
                }
                if (editing != null) {
                    val body = buildJsonObject {
                        put("name", trimmed)
                        if (lock != null) for ((k, v) in lock) put(k, v)
                    }
                    val next = wireJson.decodeFromJsonElement(Channel.serializer(), Nexa.api.request("PATCH", "/channels/${editing.id}", body))
                    Nexa.channels.upsert(listOf(next))
                    close()
                } else {
                    val ch = createSubchat(parent.id, trimmed, lock)
                    close()
                    Nav.go(Route.Dm(ch.id))
                }
            } catch (e: Exception) {
                error = (e as? ApiError)?.message ?: t("modals.subchat.thatCouldNotBeSaved")
            } finally {
                busy = false
            }
        }
    }
    openSheet("subchat", title = if (editing == null) t("modals.subchat.newSubchat") else t("chat.subchat.editSubchat"), footer = { close ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            NxButton(t("chat.editMessage.cancel"), close, kind = ButtonKind.GHOST)
            NxButton(if (editing == null) t("modals.subchat.createSubchat") else t("chat.editMessage.save"), { save(close) }, loading = busy, enabled = name.isNotBlank())
        }
    }) { close ->
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            NxTextField(name, { name = it.take(48) }, label = t("modals.subchat.name"), required = true, imeAction = ImeAction.Done, onIme = { save(close) })
            ToggleLine(t("modals.subchat.askForAPassword"), wants, {
                wants = it
                password = ""
                again = ""
            }, description = t("modals.subchat.everyoneInTheSubchatTypesIt"))
            if (wants) {
                NxTextField(
                    password, { password = it },
                    label = if (locked) t("settings.account.newPassword") else t("chat.lockedChannel.password"),
                    placeholder = if (locked) t("modals.subchat.leaveEmptyToKeepTheCurrent") else null,
                    password = true, imeAction = ImeAction.Done, onIme = { save(close) },
                )
                if (password.isNotEmpty()) NxTextField(again, { again = it }, label = t("modals.subchat.typeItAgain"), password = true, imeAction = ImeAction.Done, onIme = { save(close) })
            }
            error?.let { Txt(it, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = Nx.colors.textDanger, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
        }
    }
}

// ---------------------------------------------------------------------------
// a locked subchat (LockedChannel)

/** Whether this sign-in has opened a password-protected subchat, asked of the server. */
object SubchatLocks {
    private val opened = HashSet<String>()
    private var owner: String? = null

    /** What this sign-in has opened (a new sign-in starts with none). */
    private fun mine(): HashSet<String> {
        val me = Nexa.users.meId
        if (me != owner) {
            opened.clear()
            owner = me
        }
        return opened
    }

    fun isOpen(id: String) = synchronized(opened) { id in mine() }

    /** null when it could not be told (offline). */
    suspend fun check(id: String): Boolean? = try {
        val o = Nexa.api.get("/channels/$id/lock").jsonObject
        val locked = (o["locked"] as? JsonPrimitive)?.content == "true"
        val unlocked = (o["unlocked"] as? JsonPrimitive)?.content == "true"
        (!locked || unlocked).also { open -> synchronized(opened) { if (open) mine() += id else mine() -= id } }
    } catch (_: Exception) {
        null
    }

    /** lib/subchatLock.ts unlockSubchat: stretched the way this subchat's password was, then the proof. */
    suspend fun unlock(id: String, password: String) {
        val o = Nexa.api.get("/channels/$id/lock").jsonObject
        val salt = (o["salt"] as? JsonPrimitive)?.contentOrNull
        val pj = o["params"] as? JsonObject
        if ((o["locked"] as? JsonPrimitive)?.content != "true" || salt == null || pj == null) {
            synchronized(opened) { mine() += id }
            return
        }
        fun num(k: String) = (pj[k] as? JsonPrimitive)?.intOrNull ?: 0
        val p = KdfParams(num("m"), num("t"), num("p"), 1)
        // weak parameters from the server would hand the password over, as they would at sign-in
        if (!Kdf.acceptable(p)) throw ApiError(0, "weak_kdf", t("auth.theServerAskedToProtectYourPassword"))
        val key = withContext(Dispatchers.Default) { Kdf.authKey(Kdf.deriveMaster(password, Bytes.unb64(salt), p)) }
        Nexa.api.request("POST", "/channels/$id/unlock", buildJsonObject { put("password_key", Bytes.b64(key)) })
        synchronized(opened) { mine() += id }
    }
}

/**
 * LockedChannel: the subchat's name and its password field, in place of the
 * list and the composer. A check that never got an answer offers Try Again
 * instead, since asking for a password could hide one this sign-in opened.
 */
@Composable
fun LockedSubchat(channel: Channel, checkFailed: Boolean, onRecheck: () -> Unit, onOpen: () -> Unit) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    fun open() {
        if (password.isEmpty() || busy) return
        busy = true
        error = null
        scope.launch {
            try {
                SubchatLocks.unlock(channel.id, password)
                password = ""
                onOpen()
            } catch (e: Exception) {
                error = (e as? ApiError)?.message ?: t("chat.lockedChannel.thatCouldNotBeCheckedTry")
            } finally {
                busy = false
            }
        }
    }
    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), contentAlignment = Alignment.Center) {
        val shape = Radii.Lg
        Column(
            Modifier
                .align(Alignment.Center)
                .widthIn(max = 360.dp)
                .fillMaxWidth()
                .shadowHigh(shape, c)
                .ring(shape, c.panelEdge)
                .background(c.bgSurface, shape)
                .background(sheen(c), shape)
                .topEdge(shape, c.edgeLight)
                .padding(start = 24.dp, end = 24.dp, top = 28.dp, bottom = 24.dp)
                .semantics { testTag = "locked-subchat" },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val iconShape = RoundedCornerShape(20.dp)
            Box(
                Modifier
                    .size(60.dp)
                    .boxShadow(iconShape, 10f, 24f, c.brand.copy(alpha = 0.8f), spread = -12f)
                    .background(mixSrgb(c.bgRaised, c.brand, 0.18f), iconShape)
                    .topEdge(iconShape, c.edgeLight),
                contentAlignment = Alignment.Center,
            ) { Icon("Lock", c.textBrand, size = 28.dp) }
            Txt(channel.name, style = Nx.type.heading.copy(fontSize = Nx.type.sp(21f), lineHeight = Nx.type.sp(26f), fontWeight = FontWeight(680)), color = c.textStrong, align = TextAlign.Center)
            if (checkFailed) {
                Txt(t("chat.lockedChannel.thatCouldNotBeCheckedTry"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, align = TextAlign.Center)
                NxButton(t("chat.messageList.tryAgain"), onRecheck, block = true)
            } else {
                Txt(t("chat.lockedChannel.thisSubchatAsksForItsPassword"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, align = TextAlign.Center)
                NxTextField(password, { password = it }, label = t("chat.lockedChannel.password"), password = true, error = error, imeAction = ImeAction.Done, onIme = { open() })
                NxButton(t("chat.lockedChannel.open"), { open() }, block = true, loading = busy, enabled = password.isNotEmpty())
            }
        }
    }
}
