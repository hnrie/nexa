package fish.nexa

import android.app.Application
import android.net.ConnectivityManager
import android.net.Network
import fish.nexa.data.AuthState
import kotlinx.coroutines.launch
import fish.nexa.ui.I18n
import fish.nexa.ui.Lucide
import fish.nexa.ui.auth.CaptchaHost

class NexaApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Nexa.init(this)
        I18n.init(this)
        I18n.use(null)
        Lucide.init(this)
        fish.nexa.media.Media.init(this)
        fish.nexa.media.Twemoji.init(this)
        fish.nexa.ui.markdown.EmojiAssets.init(this)
        // the picker offers only emoji Twemoji has drawn; the tables load off the main thread
        fish.nexa.ui.markdown.EmojiData.has = { fish.nexa.media.Twemoji.has(it) }
        Nexa.scope.launch(kotlinx.coroutines.Dispatchers.IO) {
            fish.nexa.ui.markdown.Shortcodes.preload()
            fish.nexa.ui.markdown.EmojiData.preload()
        }
        Nexa.auth.captcha = CaptchaHost
        fish.nexa.notify.Notifier.install()
        fish.nexa.search.SearchIndex.install()
        // notifications read a message's words as plain text, mentions as names
        fish.nexa.notify.Notifier.plainText = { src -> fish.nexa.ui.markdown.Markdown.plainText(fish.nexa.ui.markdown.Markdown.parse(src), fish.nexa.ui.chat.AppNames) }
        // signed in: stay connected in the background (Nexa has no push); signed out: stop
        Nexa.scope.launch {
            Nexa.auth.state.collect { s ->
                when (s) {
                    is AuthState.Ready -> fish.nexa.notify.ConnectionService.start(this@NexaApp)
                    AuthState.Anonymous -> fish.nexa.notify.ConnectionService.stop(this@NexaApp)
                    else -> Unit
                }
            }
        }
        Nexa.scope.launch { Nexa.auth.bootstrap() }
        watchNetwork()
    }

    /** When the network comes back: retry signing in if that failed offline, and reconnect at once. */
    private fun watchNetwork() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        runCatching {
            cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    if (Nexa.auth.state.value is AuthState.Offline) Nexa.scope.launch { Nexa.auth.bootstrap() }
                    else Nexa.session.wake()
                }
            })
        }
    }
}
