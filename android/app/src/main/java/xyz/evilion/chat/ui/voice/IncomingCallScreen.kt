package xyz.evilion.chat.ui.voice

import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.ui.common.HangUpIcon
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.net.VoiceApi
import xyz.evilion.chat.notify.Notifications
import xyz.evilion.chat.ui.Layer
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.common.Avatar
import xyz.evilion.chat.ui.theme.chatColors

/** Someone is calling. */
@Composable
fun IncomingCallScreen(channelId: String, fromUserId: String) {
    val colors = chatColors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val user = AppState.user(fromUserId)

    Dialog(onDismissRequest = { }, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = false)) {
        Column(
            Modifier.fillMaxSize().background(colors.bgBase).padding(32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Avatar(fromUserId, user?.name ?: "?", user?.avatarId, 120.dp)
            Spacer(Modifier.height(20.dp))
            Text(AppState.nameFor(fromUserId), color = colors.textStrong, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text("is calling", color = colors.textMuted, fontSize = 15.sp)
            Spacer(Modifier.height(48.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                Box(
                    Modifier.size(68.dp).clip(CircleShape).background(colors.danger).clickable {
                        Session.ringing.value = null
                        Notifications.clearRing(context, channelId)
                        detached { runCatching { VoiceApi.decline(channelId) } }
                    },
                    contentAlignment = Alignment.Center,
                ) {
                    HangUpIcon(t("voice.incomingCall.decline"), tint = Color.White, size = 30.dp)
                }
                Box(
                    Modifier.size(68.dp).clip(CircleShape).background(colors.positive).clickable {
                        Session.ringing.value = null
                        Notifications.clearRing(context, channelId)
                        Nav.push(Layer.Call(channelId))
                    },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Lucide.Phone, t("notifications.answer"), tint = Color.White, modifier = Modifier.size(30.dp))
                }
            }
        }
    }
}
