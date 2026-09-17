package xyz.evilion.chat

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkRequest
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.launch
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.CrashReport
import xyz.evilion.chat.data.SecureStore
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.media.AttachmentStore
import xyz.evilion.chat.media.Images
import xyz.evilion.chat.i18n.Strings
import xyz.evilion.chat.net.Api
import xyz.evilion.chat.notify.Notifications
import xyz.evilion.chat.service.GatewayService
import xyz.evilion.chat.voice.FrameCryptoNative
import xyz.evilion.chat.voice.VoiceEngine

/**
 * Everything that has to exist before the first screen: where the keys are
 * kept, where pictures come from, and the socket that brings messages in.
 */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this

        // The catalogue first: the notification channels below are named from
        // it, Android remembers those names, and it never asks again.
        Strings.init(this)
        // Then the crash reporter, so anything below that goes wrong is recorded.
        CrashReport.install(this)
        SecureStore.init(this)
        SettingsStore.init(this)
        AttachmentStore.init(this)
        Images.install(this)
        VoiceEngine.init(this)
        if (!FrameCryptoNative.load()) {
            // Calls seal their frames in native code. Without it there is no
            // call, and finding that out here beats finding it out mid-join.
            android.util.Log.e("Nexa", "the call frame crypto did not load; calls are unavailable")
        }
        Notifications.ensureChannels(this)

        Api.baseUrl = SecureStore.serverUrl() ?: BuildConfig.DEFAULT_SERVER
        Api.token = SecureStore.token()
        Session.start()
        // What took the app down last time, now that there is a connection for it.
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch { CrashReport.sendPending() }

        // Messages that arrive while the app is not on screen become notifications.
        Session.messageHooks += { raw, decrypted, mine ->
            if (!mine && (!Session.Focus.foreground || Session.Focus.activeChannel != raw.channelId)) {
                Notifications.message(this, raw, decrypted)
            }
        }
        Session.ringHooks += { channelId, from -> Notifications.ringing(this, channelId, from) }
        Session.callEndHooks += { channelId -> Notifications.clearRing(this, channelId) }

        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                Session.Focus.foreground = true
                GatewayService.stop(this@App)
                Session.gateway.connect()
            }

            override fun onStop(owner: LifecycleOwner) {
                Session.Focus.foreground = false
                // The socket keeps going in a foreground service, which is how a
                // message can arrive without a push service in the middle.
                if (AppState.me.value != null && SettingsStore.deviceBool("notifications", true)) {
                    GatewayService.start(this@App)
                }
            }
        })

        watchNetwork()
    }

    /** A phone that changes network gets its socket back at once rather than on the next beat. */
    private fun watchNetwork() {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        runCatching {
            manager.registerNetworkCallback(
                NetworkRequest.Builder().addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET).build(),
                object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        Session.gateway.networkBack()
                    }
                },
            )
        }
    }

    companion object {
        lateinit var instance: App
            private set
    }
}
