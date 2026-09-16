package xyz.evilion.chat

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.AuthStatus
import xyz.evilion.chat.data.Captcha
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.net.Api
import xyz.evilion.chat.ui.Layer
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.Route
import xyz.evilion.chat.ui.auth.AuthScreen
import xyz.evilion.chat.ui.common.LoadingBox
import xyz.evilion.chat.ui.main.MainScreen
import xyz.evilion.chat.ui.theme.EvilionTheme
import xyz.evilion.chat.ui.theme.chatColors
import xyz.evilion.chat.voice.VoiceSession

class MainActivity : ComponentActivity() {
    private val captchaRequest = MutableStateFlow<CaptchaRequest?>(null)

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        Captcha.present = { action, siteKey ->
            val answer = CompletableDeferred<String?>()
            captchaRequest.value = CaptchaRequest(action, siteKey, answer)
            answer.await().also { captchaRequest.value = null }
        }

        if (android.os.Build.VERSION.SDK_INT >= 33) {
            notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }

        setContent {
            val status by Session.status.collectAsState()
            val settings by SettingsStore.doc.collectAsState()
            val dark = when (SettingsStore.theme) {
                "light" -> false
                "system" -> androidx.compose.foundation.isSystemInDarkTheme()
                else -> true
            }

            LaunchedEffect(Unit) { Session.bootstrap() }

            EvilionTheme(dark = dark) {
                Box(Modifier.fillMaxSize().background(chatColors.bgBase)) {
                    when (status) {
                        AuthStatus.LOADING -> LoadingBox()
                        AuthStatus.OFFLINE -> OfflineScreen()
                        AuthStatus.ANONYMOUS -> AuthScreen()
                        AuthStatus.LOCKED -> AuthScreen(locked = true)
                        AuthStatus.READY -> MainScreen()
                    }
                    Session.pendingRecoveryKey.collectAsState().value?.let { key ->
                        xyz.evilion.chat.ui.auth.RecoveryKeyOverlay(key) { Session.pendingRecoveryKey.value = null }
                    }
                    Toasts()
                    IncomingCall()
                    captchaRequest.collectAsState().value?.let { request ->
                        CaptchaDialog(request)
                    }
                }
            }
        }

        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** Links, and the taps on notifications. */
    private fun handleIntent(intent: Intent?) {
        val data: Uri? = intent?.data
        intent?.getStringExtra("channel_id")?.let { channelId ->
            val channel = AppState.channels.value[channelId]
            Nav.openChannel(channel?.serverId, channelId)
        }
        intent?.getStringExtra("call_channel_id")?.let { channelId ->
            Nav.push(Layer.Call(channelId))
        }
        if (data != null) {
            val parts = data.pathSegments
            when {
                parts.size >= 2 && parts[0] == "invite" -> Nav.go(Route.Invite(parts[1], data.fragment))
                parts.size >= 2 && parts[0] == "guest" -> Nav.go(Route.GuestCall(parts[1]))
                parts.size >= 2 && parts[0] == "stickers" -> Nav.go(Route.StickerPack(parts[1]))
                parts.size >= 3 && parts[0] == "channels" -> {
                    val serverId = parts[1].takeIf { it != "@me" }
                    Nav.openChannel(serverId, parts[2])
                }
            }
        }
    }
}

private data class CaptchaRequest(val action: String, val siteKey: String, val answer: CompletableDeferred<String?>)

/**
 * Turnstile, in a web view over the instance's own page.
 *
 * The server checks which hostname solved the challenge, so it has to come
 * from the site itself; this is the only web view in the app, and what it
 * shows is Cloudflare's widget, nothing of ours.
 */
@Composable
private fun CaptchaDialog(request: CaptchaRequest) {
    val colors = chatColors
    Dialog(onDismissRequest = { request.answer.complete(null) }) {
        Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(colors.bgFloating).padding(16.dp),
            contentAlignment = Alignment.Center,
        ) {
            AndroidView(factory = { context ->
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    setBackgroundColor(android.graphics.Color.TRANSPARENT)
                    addJavascriptInterface(object {
                        @JavascriptInterface
                        fun onToken(token: String) {
                            request.answer.complete(token)
                        }

                        @JavascriptInterface
                        fun onCancel() {
                            request.answer.complete(null)
                        }
                    }, "AndroidCaptcha")
                    loadUrl(Api.url("/native/captcha", mapOf("action" to request.action)).toString())
                }
            }, modifier = Modifier.fillMaxWidth().padding(4.dp))
        }
    }
}

@Composable
private fun OfflineScreen() {
    val colors = chatColors
    Box(Modifier.fillMaxSize().background(colors.bgBase), Alignment.Center) {
        Text("Could not reach the server. Trying again…", color = colors.textMuted, fontSize = 15.sp)
    }
    LaunchedEffect(Unit) {
        while (true) {
            delay(5000)
            Session.bootstrap()
        }
    }
}

/** The short notices the rest of the app raises. */
@Composable
private fun Toasts() {
    val colors = chatColors
    var message by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        Session.toasts.collect {
            message = it
            delay(4000)
            message = null
        }
    }
    message?.let {
        Box(Modifier.fillMaxSize().navigationBarsPadding().padding(16.dp), Alignment.BottomCenter) {
            Box(Modifier.clip(RoundedCornerShape(10.dp)).background(colors.bgFloating).padding(horizontal = 16.dp, vertical = 12.dp)) {
                Text(it, color = colors.text, fontSize = 14.sp)
            }
        }
    }
}

/** Somebody is calling: the screen that answers or declines. */
@Composable
private fun IncomingCall() {
    val ringing by Session.ringing.collectAsState()
    val call by VoiceSession.state.collectAsState()
    val (channelId, from) = ringing ?: return
    if (call.channelId == channelId) return
    xyz.evilion.chat.ui.voice.IncomingCallScreen(channelId, from)
}
