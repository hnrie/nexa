package xyz.evilion.chat.ui.sheets

import xyz.evilion.chat.data.readable
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.icons.Lucide
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import xyz.evilion.chat.crypto.AttachmentMeta
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.media.Media
import xyz.evilion.chat.net.ChannelsApi
import xyz.evilion.chat.net.ExpressionsApi
import xyz.evilion.chat.net.ServersApi
import xyz.evilion.chat.net.StickerPack
import xyz.evilion.chat.net.UsersApi
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.common.Avatar
import xyz.evilion.chat.ui.theme.chatColors

/** A picture on its own, pinch to zoom. */
@Composable
fun ImageViewerLayer(blobId: String, name: String, onDismiss: () -> Unit) {
    val colors = chatColors
    var scale by remember { mutableStateOf(1f) }
    var offsetX by remember { mutableStateOf(0f) }
    var offsetY by remember { mutableStateOf(0f) }
    val meta = remember(blobId) { findAttachment(blobId) }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            AsyncImage(
                model = meta ?: Media.attachment(blobId),
                contentDescription = name,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize()
                    .graphicsLayer(scaleX = scale, scaleY = scale, translationX = offsetX, translationY = offsetY)
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(1f, 6f)
                            if (scale > 1f) {
                                offsetX += pan.x
                                offsetY += pan.y
                            } else {
                                offsetX = 0f
                                offsetY = 0f
                            }
                        }
                    },
            )
            Row(
                Modifier.fillMaxWidth().statusBarsPadding().padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Lucide.X, t("chat.attachments.close"), tint = Color.White,
                    modifier = Modifier.size(26.dp).clickable(onClick = onDismiss),
                )
                Spacer(Modifier.width(12.dp))
                Text(name, color = Color.White, fontSize = 14.sp, modifier = Modifier.weight(1f), maxLines = 1)
                val context = LocalContext.current
                val scope = rememberCoroutineScope()
                if (meta != null) {
                    Icon(
                        Lucide.Download, t("chat.lockedChannel.open"), tint = Color.White,
                        modifier = Modifier.size(24.dp).clickable {
                            scope.launch { xyz.evilion.chat.ui.chat.openAttachment(context, meta) }
                        },
                    )
                }
            }
        }
    }
}

/** Finds the attachment metadata for a blob among the messages on screen. */
private fun findAttachment(blobId: String): AttachmentMeta? {
    for (channelId in AppState.channels.value.keys) {
        val list = AppState.messagesOrNull(channelId)?.value ?: continue
        for (message in list.asReversed()) {
            message.payload?.attachments?.firstOrNull { it.blobId == blobId }?.let { return it }
        }
    }
    return null
}

/** Starting a conversation with someone. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewMessageSheet(onDismiss: () -> Unit) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val relationships by AppState.relationships.collectAsState()
    var query by remember { mutableStateOf("") }
    var found by remember { mutableStateOf<List<xyz.evilion.chat.net.PublicUser>>(emptyList()) }
    var picked by remember { mutableStateOf(setOf<String>()) }

    LaunchedEffect(query) {
        if (query.length >= 2) {
            runCatching { found = UsersApi.search(query) }
        } else {
            found = emptyList()
        }
    }

    val friends = relationships.values.filter { it.type == "friend" }.map { it.user }
    val list = (if (query.isBlank()) friends else (found + friends.filter { it.username.contains(query, true) }).distinctBy { it.id })

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = colors.bgFloating) {
        Column(Modifier.fillMaxWidth().height(520.dp).navigationBarsPadding()) {
            Text(t("notify.newMessage"), color = colors.textStrong, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(16.dp))
            OutlinedTextField(
                value = query, onValueChange = { query = it },
                placeholder = { Text(t("sheets.misc.findSomeoneByUsername"), color = colors.textPlaceholder) },
                singleLine = true,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = colors.bgInput, unfocusedContainerColor = colors.bgInput,
                    focusedTextColor = colors.text, unfocusedTextColor = colors.text, cursorColor = colors.brand,
                ),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            )
            LazyColumn(Modifier.weight(1f)) {
                items(list.size, key = { list[it].id }) { index ->
                    val user = list[index]
                    Row(
                        Modifier.fillMaxWidth().clickable {
                            picked = if (user.id in picked) picked - user.id else picked + user.id
                        }.padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(user.id, user.name, user.avatarId, 32.dp)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(user.name, color = colors.text, fontSize = 15.sp)
                            Text("@${user.username}", color = colors.textMuted, fontSize = 12.sp)
                        }
                        if (user.id in picked) {
                            Box(Modifier.size(18.dp).clip(RoundedCornerShape(9.dp)).background(colors.brand))
                        }
                    }
                }
            }
            Button(
                onClick = {
                    scope.launch {
                        runCatching {
                            val channel = ChannelsApi.createDm(picked.toList())
                            AppState.putChannel(channel)
                            Nav.openChannel(null, channel.id)
                            onDismiss()
                        }.onFailure { Session.toasts.emit(it.message ?: t("passcode.thatDidNotWork")) }
                    }
                },
                enabled = picked.isNotEmpty(),
                colors = ButtonDefaults.buttonColors(containerColor = colors.brand, contentColor = colors.onBrand),
                modifier = Modifier.fillMaxWidth().padding(16.dp),
            ) { Text(if (picked.size > 1) t("sheets.misc.startGroupOf", "count" to picked.size) else t("sheets.misc.startConversation")) }
        }
    }
}

/** Making a server, or joining one with a link. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateServerSheet(onDismiss: () -> Unit) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var name by remember { mutableStateOf("") }
    var invite by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = colors.bgFloating) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(20.dp)) {
            Text(t("main.sidebar.createAServer"), color = colors.textStrong, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = name, onValueChange = { name = it }, label = { Text(t("modals.createServer.serverName")) }, singleLine = true,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = colors.bgInput, unfocusedContainerColor = colors.bgInput,
                    focusedTextColor = colors.text, unfocusedTextColor = colors.text, cursorColor = colors.brand,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        runCatching {
                            val view = Session.guarded("create_server") { captcha -> ServersApi.create(name.trim(), captcha) }
                            AppState.putServerView(view, AppState.me.value?.id)
                            Nav.openChannel(view.id, view.channels.firstOrNull { it.isText }?.id)
                            onDismiss()
                        }.onFailure { error = it.readable("Misc") }
                        busy = false
                    }
                },
                enabled = !busy && name.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = colors.brand, contentColor = colors.onBrand),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(t("modals.createServer.create")) }

            Spacer(Modifier.height(24.dp))
            Text(t("sheets.misc.orJoinWithAnInvite"), color = colors.textStrong, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = invite, onValueChange = { invite = it },
                label = { Text(t("sheets.misc.inviteLinkOrCode")) }, singleLine = true,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = colors.bgInput, unfocusedContainerColor = colors.bgInput,
                    focusedTextColor = colors.text, unfocusedTextColor = colors.text, cursorColor = colors.brand,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = {
                    val (code, key) = xyz.evilion.chat.data.InviteLink.parse(invite)
                    onDismiss()
                    Nav.go(xyz.evilion.chat.ui.Route.Invite(code, key?.let { xyz.evilion.chat.data.InviteLink.encodeFragment(it) }))
                },
                enabled = invite.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = colors.bgSurface, contentColor = colors.text),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(t("chat.embeds.join")) }
            if (error != null) {
                Spacer(Modifier.height(8.dp))
                Text(error!!, color = colors.danger, fontSize = 13.sp)
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

/** A shared sticker pack, from a link. */
@Composable
fun StickerPackScreen(packId: String) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    var pack by remember(packId) { mutableStateOf<StickerPack?>(null) }
    var error by remember(packId) { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(packId) {
        runCatching { pack = ExpressionsApi.pack(packId) }.onFailure { error = it.readable("Misc") }
    }

    Column(Modifier.fillMaxSize().background(colors.bgBase).statusBarsPadding().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Lucide.X, t("modals.createServer.back"), tint = colors.icon,
                modifier = Modifier.size(24.dp).clickable { Nav.go(xyz.evilion.chat.ui.Route.Chat(null, null)) },
            )
            Spacer(Modifier.width(12.dp))
            Text(pack?.name ?: t("stickerPack.stickerPack"), color = colors.textStrong, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(12.dp))
        when {
            error != null -> Text(error!!, color = colors.danger)
            pack == null -> CircularProgressIndicator(color = colors.brand)
            else -> {
                Text(pack!!.description, color = colors.textMuted, fontSize = 14.sp)
                Spacer(Modifier.height(12.dp))
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(88.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    items(pack!!.stickers.size, key = { pack!!.stickers[it].id }) { index ->
                        val sticker = pack!!.stickers[index]
                        Box(Modifier.size(88.dp), Alignment.Center) {
                            AsyncImage(
                                model = Media.sticker(sticker.blobId, 160),
                                contentDescription = sticker.name,
                                modifier = Modifier.size(76.dp),
                            )
                        }
                    }
                }
                Button(
                    onClick = {
                        busy = true
                        scope.launch {
                            runCatching { ExpressionsApi.install(packId, !(pack?.installed ?: false)) }
                                .onSuccess { pack = pack?.copy(installed = !(pack?.installed ?: false)) }
                                .onFailure { Session.toasts.emit(it.message ?: t("passcode.thatDidNotWork")) }
                            busy = false
                        }
                    },
                    enabled = !busy,
                    colors = ButtonDefaults.buttonColors(containerColor = colors.brand, contentColor = colors.onBrand),
                    modifier = Modifier.fillMaxWidth().navigationBarsPadding(),
                ) { Text(if (pack?.installed == true) t("sheets.misc.removeFromYourPacks") else t("sheets.misc.addToYourPacks")) }
            }
        }
    }
}
