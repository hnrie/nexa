package xyz.evilion.chat.ui.invite

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.InviteLink
import xyz.evilion.chat.data.KeyService
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.net.InvitePreview
import xyz.evilion.chat.net.ServersApi
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.Route
import xyz.evilion.chat.ui.common.ServerIcon
import xyz.evilion.chat.ui.theme.chatColors

/** What an invite link leads to, and the way in. */
@Composable
fun InviteScreen(code: String, guest: Boolean = false, fragment: String? = null) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    var preview by remember(code) { mutableStateOf<InvitePreview?>(null) }
    var error by remember(code) { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(code) {
        runCatching { preview = ServersApi.invitePreview(code) }
            .onFailure { error = "This invite is not valid any more." }
    }

    Box(Modifier.fillMaxSize().background(colors.bgBase), Alignment.Center) {
        Column(
            Modifier.fillMaxWidth().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when {
                error != null -> {
                    Text(error!!, color = colors.danger, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = { Nav.go(Route.Chat(null, null)) }) { Text("Back", color = colors.textMuted) }
                }
                preview == null -> CircularProgressIndicator(color = colors.brand)
                else -> {
                    val server = preview!!.server
                    val group = preview!!.group
                    ServerIcon(
                        server?.id ?: group?.id ?: code,
                        server?.name ?: group?.name ?: "Invite",
                        server?.iconId ?: group?.iconId,
                        80.dp,
                    )
                    Spacer(Modifier.height(16.dp))
                    Text("You have been invited to", color = colors.textMuted, fontSize = 14.sp)
                    Text(
                        server?.name ?: group?.name ?: "a conversation",
                        color = colors.textStrong, fontSize = 22.sp, fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                    server?.let {
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "${it.memberCount} ${if (it.memberCount == 1) "member" else "members"} · ${it.onlineCount} online",
                            color = colors.textMuted, fontSize = 13.sp,
                        )
                        if (it.description.isNotEmpty()) {
                            Spacer(Modifier.height(8.dp))
                            Text(it.description, color = colors.textSubtle, fontSize = 14.sp, textAlign = TextAlign.Center)
                        }
                    }
                    Spacer(Modifier.height(24.dp))
                    Button(
                        onClick = {
                            busy = true
                            scope.launch {
                                runCatching {
                                    val joined = Session.guarded("join_server") { captcha -> ServersApi.joinInvite(code, captcha) }
                                    val view = joined.server
                                    AppState.putUsers(joined.users)
                                    AppState.putServerView(view, AppState.me.value?.id)
                                    // the link's own key opens the history at once, rather than
                                    // waiting for someone online to hand it over
                                    InviteLink.parseFragment(fragment.orEmpty())?.let { key ->
                                        KeyService.adopt(view.id, key.epoch, key.root)
                                    }
                                    Nav.openChannel(view.id, view.channels.firstOrNull { it.isText }?.id)
                                }.onFailure { error = it.message }
                                busy = false
                            }
                        },
                        enabled = !busy,
                        colors = ButtonDefaults.buttonColors(containerColor = colors.brand, contentColor = colors.onBrand),
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) { Text(if (busy) "Joining…" else "Accept invite", fontWeight = FontWeight.SemiBold) }
                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = { Nav.go(Route.Chat(null, null)) }) { Text("Not now", color = colors.textMuted) }
                }
            }
        }
    }
}
