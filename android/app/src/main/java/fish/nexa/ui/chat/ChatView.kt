package fish.nexa.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.layout.Layout
import fish.nexa.Nexa
import fish.nexa.data.KeyPins
import fish.nexa.net.Channel
import fish.nexa.ui.Icon
import fish.nexa.ui.bugs.openBugReport
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.shell.ChannelGlyph
import fish.nexa.ui.shell.NavButton
import fish.nexa.ui.shell.Names
import fish.nexa.ui.shell.openCreateDm
import fish.nexa.ui.shell.openEditGroup
import fish.nexa.ui.shell.openGroupInvite
import fish.nexa.ui.shell.openInvite
import fish.nexa.ui.shell.openProfile
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.boxShadow
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sheen

/**
 * ChatView.tsx: any text conversation (a server channel, a DM, a group, a
 * subchat). The header, then the list, the typing line and the composer,
 * which rides up with the keyboard.
 */
@Composable
fun ChatView(channelId: String) {
    val channels by Nexa.channels.byId.collectAsState()
    val channel = channels[channelId] ?: return
    DisposableEffect(channelId) {
        Nexa.ui.open(channel.serverId, channelId)
        onDispose { ChatUi.leftConversation(channelId) }
    }
    // a subchat with a password stays shut until this sign-in has typed it
    var unlocked by remember(channelId, channel.locked) { mutableStateOf(!channel.locked || SubchatLocks.isOpen(channelId)) }
    var lockFailed by remember(channelId) { mutableStateOf(false) }
    var recheck by remember(channelId) { mutableIntStateOf(0) }
    val ready by Nexa.session.ready.collectAsState()
    LaunchedEffect(channelId, channel.locked, recheck) {
        if (!channel.locked) return@LaunchedEffect
        lockFailed = false
        val open = SubchatLocks.check(channelId)
        if (open == null) lockFailed = true else unlocked = open
    }
    // a check that never got an answer is asked again once the connection is back
    LaunchedEffect(ready, lockFailed) { if (ready && lockFailed) recheck += 1 }
    Column(Modifier.fillMaxSize()) {
        ChatHeader(channel)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            val conversation = @Composable {
                Column(Modifier.fillMaxSize().imePadding().navigationBarsPadding()) {
                    if (channel.locked && !unlocked) LockedSubchat(channel, lockFailed, onRecheck = { recheck += 1 }) {
                        // a message that came in while it was shut left the list thinking it could not load
                        Nexa.messages.clearChannel(channelId)
                        unlocked = true
                    } else {
                        MessageList(channel, Modifier.weight(1f))
                        ComposerSlot(channel)
                    }
                }
            }
            // a DM's or group's call sits above its messages (its banner while others are in it)
            if (channel.serverId == null) fish.nexa.ui.voice.CallArea(callChannelOf(channel)) { conversation() } else conversation()
            ChatPanels(channel)
        }
    }
}

/** The 52 dp header: the menu button, what this is, then call, search and More. */
@Composable
fun ChatHeader(channel: Channel) {
    val c = Nx.colors
    Row(
        Modifier
            .fillMaxWidth()
            .height(52.dp)
            .boxShadow(RoundedCornerShape(0.dp), 8f, 16f, c.shadeAt(0.9f), spread = -14f)
            .background(c.bgRaised)
            .background(sheen(c))
            .padding(start = 18.dp, end = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        NavButton()
        val nameStyle = Nx.type.headerTitle.copy(fontSize = Nx.type.sp(16.5f), fontWeight = FontWeight(660))
        when (channel.type) {
            // the title takes all the room the buttons leave; a long name gives way before they do
            "dm" -> Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                val other = Names.otherOf(channel)
                if (other != null) {
                    val presence by Nexa.presence.byId.collectAsState()
                    val name = Names.shown(other)
                    Avatar(other, name, Nexa.users.get(other)?.avatarId, 24.dp, status = presence[other]?.status ?: "offline")
                    Txt(
                        name, style = nameStyle, color = c.textStrong, maxLines = 1,
                        modifier = Modifier.weight(1f, fill = false).padding(start = 4.dp).pressable(remember { MutableInteractionSource() }) { openProfile(other) },
                    )
                    KeyChip(other)
                }
            }
            "group_dm" -> Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                val interaction = remember { MutableInteractionSource() }
                val pressed by interaction.collectIsPressedAsState()
                Row(
                    Modifier
                        .clip(Radii.Sm)
                        .background(if (pressed) c.bgHover else Color.Transparent)
                        .pressable(interaction) { openEditGroup(channel.id) }
                        .semantics { contentDescription = t("chat.chat.editGroup") }
                        .padding(horizontal = 6.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val name = Names.channel(channel)
                    if (channel.iconId != null) Avatar(channel.id, name, channel.iconId, 24.dp, icon = true)
                    else Icon("Users", c.textMuted, size = 22.dp)
                    Txt(name, style = nameStyle, color = c.textStrong, maxLines = 1)
                }
            }
            "subchat" -> {
                Icon("MessageCircle", c.textMuted, size = 22.dp)
                // the name keeps its room; the way back to the conversation gives way first (`.hParent`)
                ShrinkPair(Modifier.weight(1f)) {
                    Txt(channel.name, style = nameStyle, color = c.textStrong, maxLines = 1)
                    channel.parentId?.let { pid ->
                        val parent = Nexa.channels.get(pid)
                        Row(
                            Modifier
                                .padding(start = 8.dp)
                                .pressable(remember { MutableInteractionSource() }) { Nav.go(Route.Dm(pid)) },
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Icon("ChevronLeft", c.textMuted, size = 14.dp)
                            Txt(t("chat.chatView.inConversation", "name" to (parent?.let { Names.channel(it) } ?: "")), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, maxLines = 1)
                        }
                    }
                }
            }
            "thread", "private_thread" -> {
                Icon("MessageSquareText", c.textMuted, size = 22.dp)
                // the name keeps its room; the way back to its channel gives way first (`.hParent`)
                ShrinkPair(Modifier.weight(1f)) {
                    Txt(channel.name, style = nameStyle, color = c.textStrong, maxLines = 1, modifier = Modifier.padding(start = 2.dp))
                    val parentId = channel.parentId
                    val label = fish.nexa.ui.threads.parentLabel(channel)
                    if (parentId != null && label != null && channel.serverId != null) Row(
                        Modifier
                            .padding(start = 8.dp)
                            .pressable(remember { MutableInteractionSource() }) { Nav.go(Route.Server(channel.serverId, parentId)) },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon("ChevronLeft", c.textMuted, size = 14.dp)
                        Txt(label, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, maxLines = 1)
                    }
                }
            }
            else -> Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                ChannelGlyph(channel, 22.dp, c.textMuted)
                Txt(channel.name, style = nameStyle, color = c.textStrong, maxLines = 1, modifier = Modifier.padding(start = 2.dp))
                // a topic can be formatted: the header gives its words on one line, the topic's sheet the whole of it
                val topicLine = remember(channel.topic) {
                    if (channel.topic.isBlank()) "" else fish.nexa.ui.markdown.Markdown.plainText(fish.nexa.ui.markdown.Markdown.parse(channel.topic), AppNames).replace(Regex("\\s+"), " ").trim()
                }
                if (topicLine.isNotEmpty()) {
                    Row(Modifier.weight(1f, fill = false).padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(1.dp, 20.dp).background(c.border))
                        Txt(
                            topicLine, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, maxLines = 1,
                            modifier = Modifier.padding(start = 8.dp).pressable(remember { MutableInteractionSource() }) { openChannelTopic(channel) },
                        )
                    }
                }
            }
        }
        if (channel.serverId == null) {
            HeaderButton("Phone", t("chat.chat.startVoiceCall")) { fish.nexa.voice.Calls.join(callChannelOf(channel)) }
            HeaderButton("Video", t("chat.chat.startVideoCall")) { fish.nexa.voice.Calls.join(callChannelOf(channel), video = true) }
        }
        HeaderButton("Search", t("chat.chat.searchMessages"), on = ChatUi.panel == "search") { ChatUi.panel = if (ChatUi.panel == "search") null else "search" }
        HeaderButton("MoreVertical", t("chat.chat.more")) { openMoreMenu(channel) }
    }
}

/** A subchat calls in its parent conversation. */
private fun callChannelOf(channel: Channel): String = if (channel.type == "subchat") channel.parentId ?: channel.id else channel.id

@Composable
private fun HeaderButton(icon: String, label: String, on: Boolean = false, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .size(40.dp)
            .graphicsLayer { val s = if (pressed) 0.94f else 1f; scaleX = s; scaleY = s }
            .clip(Radii.Sm)
            .background(if (on) c.brand.copy(alpha = 0.16f) else Color.Transparent)
            .pressable(interaction, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, if (on) c.textBrand else c.icon, size = 22.dp) }
}

/** KeyStatusChip, icon only: what this device knows of the other person's key. */
@Composable
private fun KeyChip(userId: String) {
    val c = Nx.colors
    val pending by Nexa.alerts.pending.collectAsState()
    val user = Nexa.users.get(userId) ?: return
    val verdict = if (pending.containsKey(userId)) KeyPins.Verdict.CHANGED else {
        val v = Nexa.pins.check(userId, user.publicKey)
        if (v == KeyPins.Verdict.SAME && Nexa.pins.learnedThisSession(userId)) KeyPins.Verdict.FIRST else v
    }
    if (verdict == KeyPins.Verdict.UNKNOWN) return
    val (icon, tint, label) = when (verdict) {
        KeyPins.Verdict.CHANGED -> Triple("ShieldAlert", c.textDanger, t("encryption.chipChanged"))
        KeyPins.Verdict.SAME -> Triple("ShieldCheck", c.textStrong, t("encryption.chipKnown"))
        else -> Triple("ShieldQuestion", c.textMuted, t("encryption.chipNew"))
    }
    val shape = RoundedCornerShape(999.dp)
    Box(
        Modifier
            .padding(start = 4.dp)
            .height(24.dp)
            .ring(shape, c.borderSubtle)
            .background(if (verdict == KeyPins.Verdict.CHANGED) c.danger.copy(alpha = 0.2f) else c.bgActive, shape)
            .pressable(remember { MutableInteractionSource() }) { openVerifyKey(userId) }
            .semantics { contentDescription = label }
            .padding(horizontal = 5.dp),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, tint, size = 13.dp) }
}

/** The More menu (phones only): what the desktop header shows as buttons. */
private fun openMoreMenu(channel: Channel) {
    val items = ArrayList<MenuItem>()
    // a thread's own choices come first: joining it, closing, locking, its settings
    if (channel.isThread) {
        val own = fish.nexa.ui.threads.threadMenuItems(channel)
        items += own.mapIndexed { i, it -> if (i == own.lastIndex && it is MenuItem.Action) it.copy(separatorAfter = true) else it }
    }
    items += MenuItem.Action(t("chat.chat.pinnedMessages")) { ChatUi.panel = "pins" }
    val server = channel.serverId != null
    if (server && (channel.isText || channel.isAnnouncement)) items += MenuItem.Action(t("threads.panel.title")) { ChatUi.panel = "threads" }
    if (channel.isAnnouncement) items += MenuItem.Action(t("follows.follow")) { fish.nexa.ui.follows.openFollow(channel.id) }
    if (!server) items += MenuItem.Action(t("chat.chat.subchats")) { ChatUi.panel = "subchats" }
    if (server) items += MenuItem.Action(t("chat.chat.invitePeople")) { openInvite(channel.serverId!!, channel.id) }
    else {
        val conv = if (channel.type == "subchat") channel.parentId?.let { Nexa.channels.get(it) } ?: channel else channel
        // the person already here comes along into the new group
        if (conv.type == "dm") items += MenuItem.Action(t("chat.chat.addFriendsToDm")) {
            fish.nexa.ui.dialogs.Dialogs.createDm(initial = listOfNotNull(conv.recipientIds.firstOrNull { it != fish.nexa.Nexa.users.meId }))
        }
        else items += MenuItem.Action(t("chat.chat.inviteToGroup")) { openGroupInvite(conv.id) }
    }
    if (server || channel.type == "group_dm") {
        items += MenuItem.Action(if (Nav.rightOpen) t("chat.chat.hideMembers") else t("chat.chat.showMembers")) { Nav.rightOpen = !Nav.rightOpen }
    }
    if (!server && fish.nexa.voice.Calls.inCallOf(callChannelOf(channel))) items += MenuItem.Action(t("chat.chat.inviteGuestsToCall")) { fish.nexa.voice.Calls.openGuestLink(callChannelOf(channel)) }
    if (!server) items += MenuItem.Action(t("bugs.report")) { openBugReport(if (channel.type == "dm") "dm" else "group") }
    openMenu(items, title = t("chat.chat.more"), haptic = false)
}

/**
 * Two things side by side that share what room there is the way CSS flex
 * shrinking shares it: the second gives way four times as fast as the first
 * and never takes more than 40% (Chat.module.css `.hParent`).
 */
@Composable
private fun ShrinkPair(modifier: Modifier, content: @Composable () -> Unit) {
    Layout(content, modifier) { measurables, constraints ->
        val w = constraints.maxWidth
        val first = measurables.getOrNull(0)
        val second = measurables.getOrNull(1)
        val h = constraints.maxHeight
        val a = first?.maxIntrinsicWidth(h) ?: 0
        val b = minOf(second?.maxIntrinsicWidth(h) ?: 0, (w * 0.4f).toInt())
        var aw = a
        var bw = b
        val over = a + b - w
        if (over > 0) {
            val share = a + 4f * b
            aw = (a - over * (a / share)).toInt().coerceAtLeast(0)
            bw = (w - aw).coerceAtLeast(0)
        }
        val pa = first?.measure(Constraints(maxWidth = aw, maxHeight = h))
        val pb = second?.measure(Constraints(maxWidth = bw, maxHeight = h))
        val height = maxOf(pa?.height ?: 0, pb?.height ?: 0)
        layout(w, height) {
            pa?.placeRelative(0, (height - pa.height) / 2)
            pb?.placeRelative(pa?.width ?: 0, (height - pb.height) / 2)
        }
    }
}
