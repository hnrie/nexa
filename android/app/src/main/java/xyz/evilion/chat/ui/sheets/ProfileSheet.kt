package xyz.evilion.chat.ui.sheets

import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.chat.longDate
import xyz.evilion.chat.ui.detached
import xyz.evilion.chat.ui.icons.Lucide
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import xyz.evilion.chat.ui.common.TwemojiImage
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.media.Media
import xyz.evilion.chat.net.ChannelsApi
import xyz.evilion.chat.net.RelationshipsApi
import xyz.evilion.chat.net.UsersApi
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.common.Avatar
import xyz.evilion.chat.ui.common.avatarColor
import xyz.evilion.chat.ui.markdown.InlineMarkdown
import xyz.evilion.chat.ui.markdown.Markdown
import xyz.evilion.chat.ui.chat.rememberMdContext
import xyz.evilion.chat.ui.theme.chatColors
import java.util.Date

/** Someone's profile: the banner, what they wrote about themselves, and what you can do. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileSheet(userId: String, serverId: String?, onDismiss: () -> Unit) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val users by AppState.users.collectAsState()
    val me by AppState.me.collectAsState()
    val relationships by AppState.relationships.collectAsState()
    val servers by AppState.servers.collectAsState()
    var busy by remember { mutableStateOf(false) }
    val user = users[userId] ?: me?.takeIf { it.id == userId }?.toPublic()
    val relationship = relationships[userId]
    val presence = AppState.presences.value[userId]
    val ctx = rememberMdContext(serverId)

    LaunchedEffect(userId) {
        if (users[userId] == null) runCatching { AppState.putUser(UsersApi.user(userId)) }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = colors.bgFloating) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding()) {
            val accent = user?.accentColor?.let { Color(0xFF000000.toInt() or it) } ?: avatarColor(userId)
            val accent2 = user?.accentColor2?.let { Color(0xFF000000.toInt() or it) }
            Box(Modifier.fillMaxWidth().height(110.dp).background(
                if (accent2 != null) Brush.linearGradient(listOf(accent, accent2)) else Brush.linearGradient(listOf(accent, accent)),
            )) {
                Media.banner(user?.bannerId, 1024)?.let { url ->
                    AsyncImage(url, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().height(110.dp))
                }
            }
            Box(Modifier.padding(start = 16.dp).offset(y = (-36).dp)) {
                Avatar(
                    userId, user?.name ?: "?", user?.avatarId, 76.dp,
                    status = presence?.status ?: "offline",
                )
            }
            Column(Modifier.padding(horizontal = 16.dp).offset(y = (-24).dp)) {
                Text(user?.name ?: t("modals.quickSwitcher.unknown"), color = colors.textStrong, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("@${user?.username ?: ""}", color = colors.textMuted, fontSize = 14.sp)
                    if (!user?.pronouns.isNullOrEmpty()) {
                        Text("  •  ${user?.pronouns}", color = colors.textMuted, fontSize = 13.sp)
                    }
                }
                if (!presence?.statusText.isNullOrEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        presence?.statusEmoji?.takeIf { it.isNotEmpty() }?.let { TwemojiImage(it, 16.dp, fallbackSize = 14.sp) }
                        Text(presence?.statusText.orEmpty(), color = colors.textSubtle, fontSize = 14.sp)
                    }
                }
                if (!user?.aboutMe.isNullOrEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    Text(t("sheets.profileSheet.aboutMe"), color = colors.textMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    InlineMarkdown(
                        nodes = remember(user?.aboutMe) { Markdown.parseInline(user?.aboutMe.orEmpty()) },
                        ctx = ctx,
                        style = androidx.compose.ui.text.TextStyle(color = colors.text, fontSize = 14.sp),
                    )
                }
                val member = serverId?.let { servers[it]?.members?.get(userId) }
                if (member != null) {
                    Spacer(Modifier.height(12.dp))
                    Text("ROLES", color = colors.textMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (roleId in member.roleIds.take(6)) {
                            val role = servers[serverId]?.roles?.get(roleId) ?: continue
                            Row(
                                Modifier.clip(RoundedCornerShape(10.dp)).background(colors.bgSurface)
                                    .padding(horizontal = 8.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    Modifier.size(8.dp).clip(RoundedCornerShape(4.dp))
                                        .background(if (role.color != 0) Color(0xFF000000.toInt() or role.color) else colors.textMuted),
                                )
                                Spacer(Modifier.width(6.dp))
                                Text(role.name, color = colors.textSubtle, fontSize = 12.sp)
                            }
                        }
                    }
                }
                user?.createdAt?.takeIf { it > 0 }?.let {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        t("sheets.profileSheet.joinedOn", "date" to longDate(it)),
                        color = colors.textMuted, fontSize = 12.sp,
                    )
                }

                if (userId != me?.id) {
                    Spacer(Modifier.height(16.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                busy = true
                                detached {
                                    runCatching {
                                        val channel = ChannelsApi.createDm(listOf(userId))
                                        AppState.putChannel(channel)
                                        Nav.openChannel(null, channel.id)
                                        onDismiss()
                                    }
                                    busy = false
                                }
                            },
                            enabled = !busy,
                            colors = ButtonDefaults.buttonColors(containerColor = colors.brand, contentColor = colors.onBrand),
                        ) {
                            Icon(Lucide.MessageCircle, null, Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(t("profile.profileCard.message"))
                        }
                        when (relationship?.type) {
                            "friend" -> OutlineAction(t("sheets.profileSheet.removeFriend"), Lucide.UserMinus, colors.danger) {
                                detached { runCatching { RelationshipsApi.remove(userId) } }
                            }
                            "incoming" -> OutlineAction(t("voice.incomingCall.accept"), Lucide.UserPlus, colors.positive) {
                                detached { runCatching { RelationshipsApi.accept(userId) } }
                            }
                            "outgoing" -> OutlineAction(t("sheets.profileSheet.cancelRequest"), Lucide.UserMinus, colors.textMuted) {
                                scope.launch { runCatching { RelationshipsApi.remove(userId) } }
                            }
                            "blocked" -> OutlineAction(t("friends.unblock"), Lucide.Ban, colors.textMuted) {
                                detached { runCatching { RelationshipsApi.unblock(userId) } }
                            }
                            else -> OutlineAction(t("sheets.profileSheet.addFriend"), Lucide.UserPlus, colors.positive) {
                                detached {
                                    runCatching {
                                        Session.guarded("friend_request") { captcha ->
                                            RelationshipsApi.request(user?.username.orEmpty(), captcha)
                                        }
                                    }.onFailure { Session.toasts.emit(it.message ?: t("passcode.thatDidNotWork")) }
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun OutlineAction(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color, onClick: () -> Unit) {
    val colors = chatColors
    Row(
        Modifier.clip(RoundedCornerShape(8.dp)).background(colors.bgSurface)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, color = colors.text, fontSize = 14.sp)
    }
}
