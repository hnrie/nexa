package xyz.evilion.chat.ui.chat

import xyz.evilion.chat.ui.icons.Lucide
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.MessageService
import xyz.evilion.chat.data.P
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.data.UiMessage
import xyz.evilion.chat.data.has
import xyz.evilion.chat.ui.Layer
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.common.Avatar
import xyz.evilion.chat.ui.common.EmptyState
import xyz.evilion.chat.ui.theme.chatColors

/**
 * One conversation: what has been said, and the box to say something.
 *
 * History is fetched a page at a time and decrypted on this device; a message
 * whose key has not arrived yet says so rather than pretending to be empty.
 */
@Composable
fun ChatScreen(serverId: String?, channelId: String, onOpenDrawer: () -> Unit) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val channels by AppState.channels.collectAsState()
    val channel = channels[channelId]
    val messages by AppState.messages(channelId).collectAsState()
    val loaded by AppState.loadedChannels.collectAsState()
    val me by AppState.me.collectAsState()
    val listState = rememberLazyListState()
    var loadingOlder by remember(channelId) { mutableStateOf(false) }
    var failedLoad by remember(channelId) { mutableStateOf<String?>(null) }
    var replyTo by remember(channelId) { mutableStateOf<UiMessage?>(null) }
    var editing by remember(channelId) { mutableStateOf<UiMessage?>(null) }
    var actionsFor by remember(channelId) { mutableStateOf<UiMessage?>(null) }

    DisposableEffect(channelId) {
        Session.Focus.activeChannel = channelId
        onDispose { if (Session.Focus.activeChannel == channelId) Session.Focus.activeChannel = null }
    }

    LaunchedEffect(channelId) {
        if (!loaded.containsKey(channelId)) {
            failedLoad = null
            runCatching { MessageService.loadInitial(channelId) }
                .onFailure { failedLoad = it.message }
        }
    }

    // mark as read once the newest message is on screen
    LaunchedEffect(channelId, messages.lastOrNull()?.id, listState.firstVisibleItemIndex) {
        val newest = messages.lastOrNull { !it.pending } ?: return@LaunchedEffect
        if (listState.firstVisibleItemIndex <= 2) {
            delay(250)
            MessageService.ack(channelId, newest.raw.id)
        }
    }

    // older pages as the reader goes up
    val nearTop by remember { derivedStateOf { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 } }
    LaunchedEffect(nearTop, messages.size) {
        val atTop = loaded[channelId] == true
        if (!atTop && !loadingOlder && messages.isNotEmpty() && nearTop >= messages.size - 6) {
            loadingOlder = true
            runCatching { MessageService.loadOlder(channelId) }
            loadingOlder = false
        }
    }

    Column(Modifier.fillMaxSize().background(colors.bgBase).imePadding()) {
        ChatHeader(serverId, channelId, onOpenDrawer)

        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                channel == null -> EmptyState(Lucide.Hash, "This conversation is not available.")
                failedLoad != null -> EmptyState(Lucide.Hash, "Could not load messages", failedLoad)
                messages.isEmpty() && !loaded.containsKey(channelId) ->
                    Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.brand) }
                messages.isEmpty() -> EmptyState(
                    Lucide.Hash,
                    "This is the beginning of #${AppState.channelName(channel, me?.id)}",
                    "Say something to start it off.",
                )
                else -> LazyColumn(
                    state = listState,
                    reverseLayout = true,
                    contentPadding = PaddingValues(vertical = 8.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    val ordered = messages.asReversed()
                    items(count = ordered.size, key = { ordered[it].id }) { index ->
                        val message = ordered[index]
                        MessageRow(
                            message = message,
                            previous = ordered.getOrNull(index + 1),
                            serverId = serverId,
                            onLongPress = { actionsFor = message },
                            onReply = { replyTo = message },
                        )
                    }
                    if (loadingOlder) {
                        item {
                            Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) {
                                CircularProgressIndicator(Modifier.size(20.dp), color = colors.brand, strokeWidth = 2.dp)
                            }
                        }
                    }
                }
            }

            if (listState.firstVisibleItemIndex > 4) {
                Box(
                    Modifier.align(Alignment.BottomEnd).padding(12.dp)
                        .size(40.dp).clip(CircleShape).background(colors.bgFloating)
                        .clickable { scope.launch { listState.animateScrollToItem(0) } },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Lucide.ChevronDown, "Jump to the newest", tint = colors.icon, modifier = Modifier.size(22.dp))
                }
            }
        }

        TypingBar(channelId, serverId)

        Composer(
            channelId = channelId,
            serverId = serverId,
            replyTo = replyTo,
            editing = editing,
            onClearReply = { replyTo = null },
            onClearEdit = { editing = null },
            modifier = Modifier.navigationBarsPadding(),
        )
    }

    actionsFor?.let { message ->
        MessageActions(
            message = message,
            channelId = channelId,
            serverId = serverId,
            onDismiss = { actionsFor = null },
            onReply = { replyTo = message; actionsFor = null },
            onEdit = { editing = message; actionsFor = null },
        )
    }
}

@Composable
private fun ChatHeader(serverId: String?, channelId: String, onOpenDrawer: () -> Unit) {
    val colors = chatColors
    val channels by AppState.channels.collectAsState()
    val me by AppState.me.collectAsState()
    val channel = channels[channelId] ?: return
    val name = AppState.channelName(channel, me?.id)
    val other = if (channel.type == "dm") channel.recipientIds.firstOrNull { it != me?.id } else null

    Column(Modifier.fillMaxWidth().background(colors.bgRaised).statusBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onOpenDrawer) {
                Icon(Lucide.Menu, "Channels", tint = colors.icon)
            }
            if (other != null) {
                val user = AppState.user(other)
                Avatar(other, user?.name ?: "?", user?.avatarId, 26.dp, status = AppState.presences.value[other]?.status ?: "offline")
                Spacer(Modifier.width(8.dp))
            } else if (channel.serverId != null) {
                Icon(
                    if (channel.isVoice) Lucide.Volume2 else Lucide.Hash,
                    null, tint = colors.textChannel, modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(4.dp))
            }
            Column(Modifier.weight(1f).clickable { Nav.push(Layer.ChannelSettings(channelId)) }) {
                Text(
                    name,
                    color = colors.textStrong,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (channel.topic.isNotEmpty()) {
                    Text(
                        channel.topic,
                        color = colors.textMuted,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (channel.isDm || AppState.permissionsIn(channelId).has(P.CONNECT)) {
                IconButton(onClick = { Nav.push(Layer.Call(channelId)) }) {
                    Icon(Lucide.Phone, "Start a call", tint = colors.icon)
                }
            }
            IconButton(onClick = { Nav.push(Layer.Pins(channelId)) }) {
                Icon(Lucide.Pin, "Pinned messages", tint = colors.icon)
            }
            IconButton(onClick = { Nav.push(Layer.Search(channelId)) }) {
                Icon(Lucide.Search, "Search", tint = colors.icon)
            }
            if (serverId != null || channel.type == "group_dm") {
                IconButton(onClick = { Nav.push(Layer.Members(channelId)) }) {
                    Icon(Lucide.Users, "Members", tint = colors.icon)
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.borderSubtle))
    }
}

/** "Alice is typing…", as the web client shows it. */
@Composable
private fun TypingBar(channelId: String, serverId: String?) {
    val colors = chatColors
    val typing by AppState.typing.collectAsState()
    val now = remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(typing) {
        while (true) {
            delay(1000)
            now.value = System.currentTimeMillis()
        }
    }
    val users = typing[channelId].orEmpty().filterValues { it > now.value }.keys.toList()
    if (users.isEmpty()) return
    val names = users.take(3).map { AppState.nameFor(it, serverId) }
    val text = when {
        users.size == 1 -> "${names[0]} is typing…"
        users.size <= 3 -> "${names.dropLast(1).joinToString(", ")} and ${names.last()} are typing…"
        else -> "Several people are typing…"
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = colors.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
