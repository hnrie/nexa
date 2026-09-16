package xyz.evilion.chat.ui.main

import xyz.evilion.chat.R

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.P
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.data.has
import xyz.evilion.chat.net.Channel
import xyz.evilion.chat.ui.Layer
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.Route
import xyz.evilion.chat.ui.common.Avatar
import xyz.evilion.chat.ui.common.Badge
import xyz.evilion.chat.ui.common.ServerIcon
import xyz.evilion.chat.ui.theme.chatColors

/** The rail of servers and, beside it, the channels of the one that is open. */
@Composable
fun Sidebar(route: Route, onPick: () -> Unit) {
    val colors = chatColors
    Row(Modifier.fillMaxSize().background(colors.bgRaised)) {
        ServerRail(route)
        Box(Modifier.weight(1f).fillMaxHeight().background(colors.bgRaised)) {
            when {
                route is Route.Chat && route.serverId != null -> ServerChannels(route.serverId, route.channelId, onPick)
                else -> DirectMessages((route as? Route.Chat)?.channelId, onPick)
            }
        }
    }
}

@Composable
private fun ServerRail(route: Route) {
    val colors = chatColors
    val servers by AppState.servers.collectAsState()
    val order = SettingsStore.serverOrder
    val list = servers.values.sortedWith(compareBy({ order.indexOf(it.id).let { i -> if (i < 0) Int.MAX_VALUE else i } }, { it.server.name }))
    val activeServer = (route as? Route.Chat)?.serverId

    Column(
        Modifier.width(72.dp).fillMaxHeight().background(colors.bgBase).statusBarsPadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 12.dp),
        ) {
            item {
                RailButton(
                    selected = route is Route.Friends || (route is Route.Chat && route.serverId == null),
                    onClick = { Nav.go(Route.Chat(null, (route as? Route.Chat)?.channelId)) },
                ) {
                    Icon(painterResource(R.drawable.nexa_mark), "Direct messages", tint = colors.text, modifier = Modifier.size(28.dp))
                }
            }
            item { Box(Modifier.width(32.dp).height(2.dp).clip(CircleShape).background(colors.borderSubtle)) }
            items(list, key = { it.id }) { state ->
                val (unread, mentions) = AppState.serverUnread(state.id)
                val selected = state.id == activeServer
                Box {
                    RailButton(selected = selected, onClick = {
                        val first = AppState.channelsOf(state.id).firstOrNull {
                            it.isText && AppState.permissionsIn(it.id).has(P.VIEW_CHANNEL)
                        }
                        Nav.openChannel(state.id, first?.id)
                    }) {
                        ServerIcon(state.id, state.server.name, state.server.iconId, 48.dp, selected)
                    }
                    if (unread && mentions == 0) {
                        Box(
                            Modifier.align(Alignment.CenterStart).offset(x = (-14).dp)
                                .size(8.dp).clip(CircleShape).background(colors.textStrong),
                        )
                    }
                    if (mentions > 0) Badge(mentions, Modifier.align(Alignment.BottomEnd))
                }
            }
            item {
                RailButton(selected = false, onClick = { Nav.push(Layer.CreateServer) }) {
                    Icon(Icons.Filled.Add, "Create a server", tint = colors.positive, modifier = Modifier.size(24.dp))
                }
            }
        }
    }
}

@Composable
private fun RailButton(selected: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    val colors = chatColors
    Box(contentAlignment = Alignment.Center) {
        if (selected) {
            Box(
                Modifier.align(Alignment.CenterStart).width(4.dp).height(32.dp)
                    .clip(RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp)).background(colors.textStrong),
            )
        }
        Box(
            Modifier.size(48.dp).clip(RoundedCornerShape(if (selected) 16.dp else 24.dp))
                .background(colors.bgSurface).clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) { content() }
    }
}

@Composable
private fun ServerChannels(serverId: String, activeChannel: String?, onPick: () -> Unit) {
    val colors = chatColors
    val servers by AppState.servers.collectAsState()
    val channelMap by AppState.channels.collectAsState()
    val state = servers[serverId] ?: return
    val collapsed = SettingsStore.collapsedCategories
    val channels = AppState.channelsOf(serverId).filter { AppState.permissionsIn(it.id).has(P.VIEW_CHANNEL) }
    val byParent = channels.groupBy { it.parentId }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().clickable { Nav.go(Route.ServerSettings(serverId)) }
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                state.server.name,
                color = colors.textStrong,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(Icons.Filled.Settings, "Server settings", tint = colors.icon, modifier = Modifier.size(18.dp))
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.borderSubtle))
        LazyColumn(Modifier.weight(1f), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)) {
            // channels with no category first, as the web sidebar shows them
            items(byParent[null]?.filter { !it.isCategory } ?: emptyList(), key = { it.id }) { channel ->
                ChannelRow(channel, channel.id == activeChannel, serverId, onPick)
            }
            for (category in channels.filter { it.isCategory }) {
                val children = byParent[category.id].orEmpty()
                val isCollapsed = category.id in collapsed
                item(key = "cat-${category.id}") {
                    Row(
                        Modifier.fillMaxWidth().clickable { SettingsStore.toggleCategory(category.id) }
                            .padding(start = 8.dp, end = 12.dp, top = 12.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            if (isCollapsed) Icons.Filled.ExpandMore else Icons.Filled.ExpandLess,
                            null, tint = colors.textChannel, modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(2.dp))
                        Text(
                            category.name.uppercase(),
                            color = colors.textChannel,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                if (!isCollapsed) {
                    items(children, key = { it.id }) { channel ->
                        ChannelRow(channel, channel.id == activeChannel, serverId, onPick)
                    }
                } else {
                    items(children.filter { it.id == activeChannel || AppState.unreadOf(it.id).first }, key = { "u-${it.id}" }) { channel ->
                        ChannelRow(channel, channel.id == activeChannel, serverId, onPick)
                    }
                }
            }
        }
        SelfPanel()
    }
}

@Composable
private fun ChannelRow(channel: Channel, selected: Boolean, serverId: String, onPick: () -> Unit) {
    val colors = chatColors
    val (unread, mentions) = AppState.unreadOf(channel.id)
    val voice = AppState.voiceIn(channel.id)
    val private = xyz.evilion.chat.data.Permissions.isPrivateChannel(serverId, channel.overwrites)

    Column {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 1.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(if (selected) colors.bgSelected else Color.Transparent)
                .clickable {
                    if (channel.isVoice) {
                        Nav.push(Layer.Call(channel.id))
                    } else {
                        Nav.openChannel(serverId, channel.id)
                        onPick()
                    }
                }
                .padding(horizontal = 8.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                when {
                    channel.isVoice -> Icons.AutoMirrored.Filled.VolumeUp
                    private -> Icons.Filled.Lock
                    else -> Icons.Filled.Tag
                },
                null,
                tint = if (selected || unread) colors.text else colors.textChannel,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text(
                channel.name,
                color = if (selected || unread) colors.textStrong else colors.textChannel,
                fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                fontSize = 15.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (mentions > 0) Badge(mentions)
        }
        for (state in voice) {
            val user = AppState.user(state.userId)
            Row(
                Modifier.fillMaxWidth().padding(start = 40.dp, end = 12.dp, top = 2.dp, bottom = 2.dp)
                    .clickable { Nav.push(Layer.Profile(state.userId)) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(state.userId, user?.name ?: state.user?.displayName ?: "?", user?.avatarId ?: state.user?.avatarId, 20.dp)
                Spacer(Modifier.width(6.dp))
                Text(
                    AppState.nameFor(state.userId, serverId),
                    color = colors.textMuted,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun DirectMessages(activeChannel: String?, onPick: () -> Unit) {
    val colors = chatColors
    val channels by AppState.channels.collectAsState()
    val me by AppState.me.collectAsState()
    val dms = AppState.dmChannels()

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Direct messages", color = colors.textStrong, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Icon(
                Icons.Filled.Add, "New message",
                tint = colors.icon,
                modifier = Modifier.size(20.dp).clickable { Nav.push(Layer.NewMessage) },
            )
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.borderSubtle))
        LazyColumn(Modifier.weight(1f), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)) {
            item {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp).clip(RoundedCornerShape(6.dp))
                        .clickable { Nav.go(Route.Friends); onPick() }.padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.Group, null, tint = colors.icon, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Friends", color = colors.text, fontSize = 15.sp, modifier = Modifier.weight(1f))
                    val pending = AppState.relationships.value.values.count { it.type == "incoming" }
                    if (pending > 0) Badge(pending)
                }
            }
            items(dms, key = { it.id }) { channel ->
                val other = channel.recipientIds.firstOrNull { it != me?.id }
                val (unread, mentions) = AppState.unreadOf(channel.id)
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 1.dp).clip(RoundedCornerShape(6.dp))
                        .background(if (channel.id == activeChannel) colors.bgSelected else Color.Transparent)
                        .clickable { Nav.openChannel(null, channel.id); onPick() }
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (channel.type == "group_dm") {
                        xyz.evilion.chat.ui.common.ServerIcon(channel.id, channel.name.ifEmpty { "G" }, channel.iconId, 32.dp)
                    } else {
                        val user = other?.let { AppState.user(it) }
                        Avatar(other ?: channel.id, user?.name ?: "?", user?.avatarId, 32.dp, status = other?.let {
                            AppState.presences.value[it]?.status ?: "offline"
                        })
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(
                        AppState.channelName(channel, me?.id),
                        color = if (unread) colors.textStrong else colors.textChannel,
                        fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                        fontSize = 15.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    val count = AppState.readStates.value[channel.id]?.unreadCount ?: 0
                    if (mentions > 0) Badge(mentions) else if (count > 0) Badge(count)
                }
            }
        }
        SelfPanel()
    }
}

/** The strip at the bottom: who you are, and the way into settings. */
@Composable
private fun SelfPanel() {
    val colors = chatColors
    val me by AppState.me.collectAsState()
    val presence = me?.let { AppState.presences.value[it.id]?.status } ?: "online"
    Row(
        Modifier.fillMaxWidth().background(colors.bgSurface).padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(me?.id ?: "0", me?.name ?: "?", me?.avatarId, 32.dp, status = presence)
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(me?.name ?: "", color = colors.textStrong, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            Text(
                me?.statusText?.ifEmpty { null } ?: "@${me?.username ?: ""}",
                color = colors.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        Icon(
            Icons.Filled.Settings, "Settings",
            tint = colors.icon,
            modifier = Modifier.size(22.dp).clickable { Nav.go(Route.Settings()) },
        )
    }
}
