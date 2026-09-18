package xyz.evilion.chat.ui.sheets

import xyz.evilion.chat.data.readable
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.detached
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.InviteKey
import xyz.evilion.chat.data.InviteLink
import xyz.evilion.chat.data.KeyService
import xyz.evilion.chat.data.MessageService
import xyz.evilion.chat.data.P
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.data.UiMessage
import xyz.evilion.chat.data.has
import xyz.evilion.chat.net.Api
import xyz.evilion.chat.net.ChannelsApi
import xyz.evilion.chat.net.ServersApi
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.chat.rememberMdContext
import xyz.evilion.chat.ui.chat.shortTime
import xyz.evilion.chat.ui.common.Avatar
import xyz.evilion.chat.ui.common.EmptyState
import xyz.evilion.chat.ui.markdown.InlineMarkdown
import xyz.evilion.chat.ui.markdown.Markdown
import xyz.evilion.chat.ui.theme.chatColors

/** Everyone in a server, or in a group conversation. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MembersSheet(channelId: String, onDismiss: () -> Unit) {
    val colors = chatColors
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val channels by AppState.channels.collectAsState()
    val servers by AppState.servers.collectAsState()
    val presences by AppState.presences.collectAsState()
    val channel = channels[channelId]
    val serverId = channel?.serverId
    val scope = rememberCoroutineScope()

    LaunchedEffect(serverId) {
        if (serverId != null) {
            runCatching {
                val members = ServersApi.members(serverId, limit = 200)
                AppState.updateServer(serverId) { state ->
                    state.copy(members = state.members + members.associateBy { it.userId })
                }
            }
        }
    }

    val ids = if (serverId != null) servers[serverId]?.members?.keys?.toList().orEmpty() else channel?.recipientIds.orEmpty()
    val sorted = ids.sortedWith(
        compareByDescending<String> { (presences[it]?.status ?: "offline") != "offline" }
            .thenBy { AppState.nameFor(it, serverId).lowercase() },
    )

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = colors.bgFloating) {
        Column(Modifier.fillMaxWidth().height(520.dp).navigationBarsPadding()) {
            Text(
                t("sheets.channelSheets.membersCount", "count" to (servers[serverId]?.memberCount ?: sorted.size)),
                color = colors.textStrong, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            )
            LazyColumn(Modifier.weight(1f)) {
                items(sorted.size, key = { sorted[it] }) { index ->
                    val id = sorted[index]
                    val user = AppState.user(id)
                    val status = presences[id]?.status ?: "offline"
                    Row(
                        Modifier.fillMaxWidth().clickable { Nav.push(xyz.evilion.chat.ui.Layer.Profile(id, serverId)) }
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(id, user?.name ?: "?", user?.avatarId, 32.dp, status = status)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                AppState.nameFor(id, serverId),
                                color = if (status == "offline") colors.textMuted else colors.text,
                                fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                            presences[id]?.statusText?.takeIf { it.isNotEmpty() }?.let {
                                Text(it, color = colors.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** What has been pinned here. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PinsSheet(channelId: String, onDismiss: () -> Unit) {
    val colors = chatColors
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var pins by remember { mutableStateOf<List<UiMessage>?>(null) }
    val ctx = rememberMdContext(AppState.channels.value[channelId]?.serverId)

    LaunchedEffect(channelId) {
        pins = runCatching { ChannelsApi.pins(channelId).map { MessageService.decrypt(it) } }.getOrDefault(emptyList())
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = colors.bgFloating) {
        Column(Modifier.fillMaxWidth().height(520.dp).navigationBarsPadding()) {
            Text(
                t("chatScreen.pinnedMessages"),
                color = colors.textStrong, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            )
            when {
                pins == null -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = colors.brand) }
                pins!!.isEmpty() -> EmptyState(Lucide.Pin, t("sheets.channelSheets.nothingPinnedYet"), t("sheets.channelSheets.longPressAMessageToPin"))
                else -> LazyColumn(Modifier.weight(1f)) {
                    items(pins!!.size, key = { pins!![it].raw.id }) { index ->
                        val message = pins!![index]
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Avatar(
                                    message.raw.authorId,
                                    AppState.nameFor(message.raw.authorId),
                                    AppState.user(message.raw.authorId)?.avatarId,
                                    24.dp,
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(AppState.nameFor(message.raw.authorId), color = colors.textStrong, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                Spacer(Modifier.width(6.dp))
                                Text(shortTime(message.raw.createdAt), color = colors.textMuted, fontSize = 11.sp)
                            }
                            Spacer(Modifier.height(2.dp))
                            InlineMarkdown(
                                nodes = remember(message.payload?.text) { Markdown.parseInline(message.payload?.text.orEmpty()) },
                                ctx = ctx,
                                style = androidx.compose.ui.text.TextStyle(color = colors.textSubtle, fontSize = 14.sp),
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Searching what this device has decrypted of a conversation. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchSheet(channelId: String, onDismiss: () -> Unit) {
    val colors = chatColors
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val messages by AppState.messages(channelId).collectAsState()
    var query by remember { mutableStateOf("") }
    val ctx = rememberMdContext(AppState.channels.value[channelId]?.serverId)
    val results = remember(query, messages) {
        if (query.length < 2) emptyList()
        else messages.filter { it.payload?.text?.contains(query, true) == true }.asReversed().take(60)
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = colors.bgFloating) {
        Column(Modifier.fillMaxWidth().height(520.dp).navigationBarsPadding()) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text(t("sheets.channelSheets.searchThisConversation"), color = colors.textPlaceholder) },
                singleLine = true,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = colors.bgInput,
                    unfocusedContainerColor = colors.bgInput,
                    focusedTextColor = colors.text,
                    unfocusedTextColor = colors.text,
                    cursorColor = colors.brand,
                ),
                modifier = Modifier.fillMaxWidth().padding(12.dp),
            )
            if (results.isEmpty()) {
                EmptyState(
                    Lucide.Search,
                    if (query.length < 2) t("sheets.channelSheets.typeToSearch") else t("sheets.channelSheets.nothingFound"),
                    t("sheets.channelSheets.onlyMessagesThisDeviceHasDecrypted"),
                )
            } else {
                LazyColumn(Modifier.weight(1f)) {
                    items(results.size, key = { results[it].raw.id }) { index ->
                        val message = results[index]
                        Column(
                            Modifier.fillMaxWidth().clickable { onDismiss() }.padding(horizontal = 16.dp, vertical = 8.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(AppState.nameFor(message.raw.authorId), color = colors.textStrong, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                Spacer(Modifier.width(6.dp))
                                Text(shortTime(message.raw.createdAt), color = colors.textMuted, fontSize = 11.sp)
                            }
                            InlineMarkdown(
                                nodes = remember(message.payload?.text) { Markdown.parseInline(message.payload?.text.orEmpty().take(300)) },
                                ctx = ctx,
                                style = androidx.compose.ui.text.TextStyle(color = colors.textSubtle, fontSize = 14.sp),
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Channel settings a phone actually needs: name, topic, slow mode, notifications. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelSettingsSheet(channelId: String, onDismiss: () -> Unit) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val channels by AppState.channels.collectAsState()
    val channel = channels[channelId] ?: return
    val canManage = channel.serverId == null || AppState.permissionsIn(channelId).has(P.MANAGE_CHANNELS)
    var name by remember(channelId) { mutableStateOf(channel.name) }
    var topic by remember(channelId) { mutableStateOf(channel.topic) }
    var saving by remember { mutableStateOf(false) }
    val muted = SettingsStore.mutedChannels.contains(channelId)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = colors.bgFloating) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp)) {
            Text(t("server.invites.channel"), color = colors.textStrong, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
            Spacer(Modifier.height(12.dp))
            if (canManage) {
                OutlinedTextField(
                    value = name, onValueChange = { name = it }, label = { Text(t("modals.subchat.name")) }, singleLine = true,
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = colors.bgInput, unfocusedContainerColor = colors.bgInput,
                        focusedTextColor = colors.text, unfocusedTextColor = colors.text, cursorColor = colors.brand,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = topic, onValueChange = { topic = it }, label = { Text(t("sheets.channelSheets.topic")) },
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = colors.bgInput, unfocusedContainerColor = colors.bgInput,
                        focusedTextColor = colors.text, unfocusedTextColor = colors.text, cursorColor = colors.brand,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = {
                        saving = true
                        detached {
                            runCatching {
                                val updated = ChannelsApi.patch(channelId, buildJsonObject {
                                    put("name", name)
                                    put("topic", topic)
                                })
                                AppState.putChannel(updated)
                                onDismiss()
                            }.onFailure { Session.toasts.emit(it.message ?: t("server.serverSettingsScreen.thatDidNotSave")) }
                            saving = false
                        }
                    },
                    enabled = !saving,
                    colors = ButtonDefaults.buttonColors(containerColor = colors.brand, contentColor = colors.onBrand),
                ) { Text(t("chat.editMessage.save")) }
                Spacer(Modifier.height(16.dp))
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(t("sheets.channelSheets.muteThisConversation"), color = colors.text, fontSize = 15.sp, modifier = Modifier.weight(1f))
                Switch(
                    checked = muted,
                    onCheckedChange = { on ->
                        val current = SettingsStore.mutedChannels
                        val next = if (on) current + channelId else current - channelId
                        SettingsStore.putIn(
                            "notifications", "muted",
                            kotlinx.serialization.json.JsonArray(next.distinct().map { kotlinx.serialization.json.JsonPrimitive(it) }),
                        )
                    },
                    colors = SwitchDefaults.colors(checkedThumbColor = colors.brand),
                )
            }
            if (channel.serverId != null && AppState.permissionsIn(channelId).has(P.CREATE_INSTANT_INVITE)) {
                Spacer(Modifier.height(8.dp))
                Row(
                    Modifier.fillMaxWidth().clickable { Nav.push(xyz.evilion.chat.ui.Layer.InviteSheet(channelId)) }
                        .padding(vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Lucide.UserPlus, null, tint = colors.icon, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(12.dp))
                    Text(t("sheets.channelSheets.invitePeople"), color = colors.text, fontSize = 15.sp)
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

/** Makes an invite link and hands it over. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteSheet(channelId: String, onDismiss: () -> Unit) {
    val colors = chatColors
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val clipboard = LocalClipboardManager.current
    var code by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    var link by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(channelId) {
        runCatching { ServersApi.createInvite(channelId, maxUses = 0, expiresIn = 7 * 24 * 3600) }
            .onSuccess {
                code = it.code
                // the link carries the conversation key, so whoever joins can read
                // the history straight away; fragments never reach the server
                val conv = AppState.convFor(channelId)
                val key = KeyService.ring.latest(conv)?.let { (epoch, root) -> InviteKey(epoch, root) }
                link = InviteLink.url(Api.baseUrl, it.code, key)
            }
            .onFailure { error = it.readable("ChannelSheets") }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = colors.bgFloating) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(20.dp)) {
            Text(t("sheets.channelSheets.invitePeople"), color = colors.textStrong, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
            Spacer(Modifier.height(12.dp))
            when {
                error != null -> Text(error!!, color = colors.danger, fontSize = 14.sp)
                code == null -> CircularProgressIndicator(color = colors.brand)
                else -> {
                    val shown = link ?: "${Api.baseUrl.trimEnd('/')}/invite/${code}"
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(colors.bgInput).padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(shown, color = colors.text, fontSize = 14.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Icon(
                            Lucide.Copy, t("modals.groupInvite.copy"), tint = colors.icon,
                            modifier = Modifier.size(20.dp).clickable { clipboard.setText(AnnotatedString(shown)) },
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(t("sheets.channelSheets.anyoneWithThisLinkCanJoin"), color = colors.textMuted, fontSize = 12.sp)
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
