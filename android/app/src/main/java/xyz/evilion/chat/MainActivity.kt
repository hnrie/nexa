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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
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
import xyz.evilion.chat.i18n.Strings
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.net.Api
import xyz.evilion.chat.ui.Layer
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.Route
import xyz.evilion.chat.ui.auth.AuthScreen
import xyz.evilion.chat.ui.common.LoadingBox
import xyz.evilion.chat.ui.main.MainScreen
import xyz.evilion.chat.ui.theme.NexaTheme
import xyz.evilion.chat.ui.theme.chatColors
import xyz.evilion.chat.voice.VoiceSession
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val captchaRequest = MutableStateFlow<CaptchaRequest?>(null)

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // the words before anything is drawn, so no screen starts in English and changes its mind
        Strings.init(this)
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
            val palette = xyz.evilion.chat.ui.theme.paletteFor(SettingsStore.theme)

            LaunchedEffect(Unit) { Session.bootstrap() }
            // the account's language, which the web client writes to the same
            // settings field, so one choice follows someone between devices
            LaunchedEffect(settings) {
                Strings.use(SettingsStore.locale)
                // Android keeps the name a notification channel was created
                // with, so it has to be told again once the language is known.
                xyz.evilion.chat.notify.Notifications.ensureChannels(this@MainActivity)
            }

            NexaTheme(colors = palette) {
                // Keyed on the language: a screen that built its words once —
                // a menu, an empty state — is built again rather than holding
                // the ones it was born with. Navigation lives in Nav, above
                // this, so nothing is lost by starting over.
                key(Strings.epoch) {
                    CompositionLocalProvider(
                        LocalLayoutDirection provides if (Strings.rtl) LayoutDirection.Rtl else LayoutDirection.Ltr,
                    ) {
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

/**
 * No server. It says so, shows that it is still trying, and offers to try now.
 *
 * A silent line of grey text over a five-second loop gave no sign the app was
 * doing anything, and no way to force a retry after switching to another
 * network — which is the moment someone is most likely to be looking at it.
 */
@Composable
private fun OfflineScreen() {
    val colors = chatColors
    var attempt by remember { mutableStateOf(0) }
    Box(Modifier.fillMaxSize().background(colors.bgBase), Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(Modifier.size(24.dp), color = colors.brand, strokeWidth = 2.dp)
            Spacer(Modifier.height(16.dp))
            Text(t("mainActivity.couldNotReachTheServerTrying"), color = colors.textMuted, fontSize = 15.sp)
            Spacer(Modifier.height(16.dp))
            Text(
                t("desktop.native.offlineRetry"),
                color = colors.textBrand,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(onClickLabel = t("desktop.native.offlineRetry"), role = Role.Button) { attempt++ }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            )
        }
    }
    // backs off 2s -> 30s rather than hammering a server that is down, and
    // starts again from the short wait whenever the button is pressed
    LaunchedEffect(attempt) {
        var wait = 2000L
        while (true) {
            Session.bootstrap()
            delay(wait)
            wait = (wait * 2).coerceAtMost(30_000L)
        }
    }
}

/**
 * The short notices the rest of the app raises.
 *
 * They queue rather than overwrite: the collector used to hold the coroutine
 * for the four seconds a message was on screen, and `toasts` buffers eight, so
 * three upload rejections in a row showed one. It also sits above the keyboard,
 * because the commonest notice of all — a message that would not send — is
 * raised while someone is typing.
 */
@Composable
private fun Toasts() {
    val colors = chatColors
    val queue = remember { mutableStateListOf<String>() }
    LaunchedEffect(Unit) {
        launch { Session.toasts.collect { queue.add(it) } }
        while (true) {
            if (queue.isEmpty()) {
                delay(100)
                continue
            }
            delay(4000)
            queue.removeAt(0)
        }
    }
    queue.firstOrNull()?.let {
        Box(
            Modifier.fillMaxSize()
                .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))
                .padding(16.dp),
            Alignment.BottomCenter,
        ) {
            val shape = RoundedCornerShape(10.dp)
            Box(
                // In the light theme bgFloating is white on a near-white page,
                // so without an edge a toast is an unreadable blank rectangle.
                Modifier.clip(shape).background(colors.bgFloating).border(1.dp, colors.borderSubtle, shape)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
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
