package xyz.evilion.chat.ui.friends

import xyz.evilion.chat.ui.icons.Lucide
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.net.ChannelsApi
import xyz.evilion.chat.net.RelationshipsApi
import xyz.evilion.chat.ui.Layer
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.common.Avatar
import xyz.evilion.chat.ui.common.EmptyState
import xyz.evilion.chat.ui.theme.chatColors

/** Friends, the people waiting on an answer, and the ones you blocked. */
@Composable
fun FriendsScreen(onOpenDrawer: () -> Unit) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val relationships by AppState.relationships.collectAsState()
    val presences by AppState.presences.collectAsState()
    var tab by remember { mutableStateOf("online") }
    var adding by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }

    val all = relationships.values.toList()
    val list = when (tab) {
        "online" -> all.filter { it.type == "friend" && (presences[it.user.id]?.status ?: "offline") != "offline" }
        "all" -> all.filter { it.type == "friend" }
        "pending" -> all.filter { it.type == "incoming" || it.type == "outgoing" }
        else -> all.filter { it.type == "blocked" }
    }.sortedBy { AppState.nameFor(it.user.id).lowercase() }

    Column(Modifier.fillMaxSize().background(colors.bgBase)) {
        Row(
            Modifier.fillMaxWidth().background(colors.bgRaised).statusBarsPadding().height(52.dp).padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onOpenDrawer) { Icon(Lucide.Menu, "Channels", tint = colors.icon) }
            Text("Friends", color = colors.textStrong, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
        }
        Row(
            Modifier.fillMaxWidth().background(colors.bgRaised).padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            for ((id, label) in listOf("online" to "Online", "all" to "All", "pending" to "Pending", "blocked" to "Blocked")) {
                val selected = tab == id
                val count = when (id) {
                    "pending" -> all.count { it.type == "incoming" }
                    else -> 0
                }
                Row(
                    Modifier.clip(RoundedCornerShape(8.dp))
                        .background(if (selected) colors.bgSelected else Color.Transparent)
                        .clickable { tab = id }.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(label, color = if (selected) colors.textStrong else colors.textMuted, fontSize = 14.sp)
                    if (count > 0) {
                        Spacer(Modifier.width(4.dp))
                        xyz.evilion.chat.ui.common.Badge(count)
                    }
                }
            }
        }

        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = adding,
                onValueChange = { adding = it; message = null },
                placeholder = { Text("Add a friend by username", color = colors.textPlaceholder) },
                singleLine = true,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = colors.bgInput, unfocusedContainerColor = colors.bgInput,
                    focusedTextColor = colors.text, unfocusedTextColor = colors.text, cursorColor = colors.brand,
                ),
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "Send",
                color = if (adding.isBlank()) colors.textMuted else colors.brand,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable(enabled = adding.isNotBlank()) {
                    scope.launch {
                        runCatching {
                            Session.guarded("friend_request") { captcha -> RelationshipsApi.request(adding.trim(), captcha) }
                        }.onSuccess {
                            message = "Request sent to @${adding.trim()}."
                            adding = ""
                        }.onFailure { message = it.message }
                    }
                }.padding(8.dp),
            )
        }
        message?.let {
            Text(it, color = colors.textMuted, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp))
        }

        if (list.isEmpty()) {
            EmptyState(Lucide.Users, "Nobody here yet", "Add someone by their username to get started.")
        } else {
            LazyColumn(Modifier.weight(1f)) {
                items(list.size, key = { list[it].user.id }) { index ->
                    val relationship = list[index]
                    val user = relationship.user
                    val status = presences[user.id]?.status ?: "offline"
                    Row(
                        Modifier.fillMaxWidth().clickable { Nav.push(Layer.Profile(user.id)) }
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(user.id, user.name, user.avatarId, 36.dp, status = status)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(AppState.nameFor(user.id), color = colors.text, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                            Text(
                                when (relationship.type) {
                                    "incoming" -> "Wants to be friends"
                                    "outgoing" -> "Request sent"
                                    "blocked" -> "Blocked"
                                    else -> presences[user.id]?.statusText?.ifEmpty { null } ?: status.replaceFirstChar { it.uppercase() }
                                },
                                color = colors.textMuted, fontSize = 12.sp,
                            )
                        }
                        when (relationship.type) {
                            "incoming" -> {
                                ActionIcon(Lucide.Check, colors.positive) {
                                    scope.launch { runCatching { RelationshipsApi.accept(user.id) } }
                                }
                                ActionIcon(Lucide.X, colors.danger) {
                                    scope.launch { runCatching { RelationshipsApi.remove(user.id) } }
                                }
                            }
                            "outgoing" -> ActionIcon(Lucide.X, colors.textMuted) {
                                scope.launch { runCatching { RelationshipsApi.remove(user.id) } }
                            }
                            "blocked" -> ActionIcon(Lucide.Ban, colors.textMuted) {
                                scope.launch { runCatching { RelationshipsApi.unblock(user.id) } }
                            }
                            else -> ActionIcon(Lucide.MessageCircle, colors.icon) {
                                scope.launch {
                                    runCatching {
                                        val channel = ChannelsApi.createDm(listOf(user.id))
                                        AppState.putChannel(channel)
                                        Nav.openChannel(null, channel.id)
                                    }
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
private fun ActionIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color, onClick: () -> Unit) {
    Box(
        Modifier.size(36.dp).clip(RoundedCornerShape(18.dp)).background(chatColors.bgSurface)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(18.dp))
    }
}
