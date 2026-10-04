package fish.nexa.voice

import android.Manifest
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat
import fish.nexa.Nexa
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Keeps a call alive while the app is out of sight: a foreground service of
 * the types Android checks (microphone always, the camera while it is on, the
 * screen while it is shared, and phone call), with the call's ongoing
 * notification, a CallStyle one where the phone has it: mute and hang up from
 * the shade. Its types are worked out from the call each time, never from
 * whatever a caller happened to pass.
 */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            foreground = null
            stopSelf()
            ready.complete(false)
            return START_NOT_STICKY
        }
        val camera = intent?.getBooleanExtra(EXTRA_CAMERA, false) == true
        val screen = intent?.getBooleanExtra(EXTRA_SCREEN, false) == true
        try {
            val notification = CallNotifications.ongoing(this)
            if (Build.VERSION.SDK_INT >= 29) {
                try {
                    startForeground(NOTIFICATION_ID, notification, types(camera, screen, phone = true))
                } catch (e: SecurityException) {
                    // a phone that will not let this app hold a phone call's type still keeps the call
                    startForeground(NOTIFICATION_ID, notification, types(camera, screen, phone = false))
                }
            } else startForeground(NOTIFICATION_ID, notification)
            foreground = Types(camera, screen)
            ready.complete(true)
        } catch (e: Exception) {
            Log.w(TAG, "could not keep the call in the foreground", e)
            ready.complete(false)
            // a call already held in the foreground stays so, with what it had: only one that never got there stops
            if (foreground == null) stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun types(camera: Boolean, screen: Boolean, phone: Boolean): Int {
        var t = 0
        if (granted(Manifest.permission.RECORD_AUDIO)) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (camera && granted(Manifest.permission.CAMERA)) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        if (screen) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        if (phone) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
        return t
    }

    override fun onDestroy() {
        // gone (stopped, or ended by the system): the next change to the call starts it again
        foreground = null
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // swiped away from the recents: the call ends rather than going on unseen
        Calls.leave(true)
        stopSelf()
    }

    companion object {
        private const val TAG = "CallService"
        const val NOTIFICATION_ID = 0x0ca11
        private const val ACTION_STOP = "fish.nexa.voice.STOP"
        private const val EXTRA_CAMERA = "camera"
        private const val EXTRA_SCREEN = "screen"

        @Volatile private var running = false
        @Volatile private var ready = CompletableDeferred<Boolean>()

        /** The camera and the screen, as the service holds the foreground for them. */
        private data class Types(val camera: Boolean, val screen: Boolean)

        /** What the service holds the foreground with, once it does; null while it does not. */
        @Volatile private var foreground: Types? = null

        /** Brings the service in step with the call: started while in or joining one, gone otherwise. */
        fun update(camera: Boolean? = null, screen: Boolean? = null) {
            val st = Voice.state.value
            val inCall = Engine.current() != null || st.joining != null
            val context = Nexa.app
            if (!inCall) {
                if (running) {
                    running = false
                    runCatching { context.startService(Intent(context, CallService::class.java).setAction(ACTION_STOP)) }
                }
                foreground = null
                CallNotifications.cancelOngoing()
                return
            }
            val s = Engine.current()
            val want = Types(camera ?: (s?.camera != null), screen ?: (s?.screen != null))
            // Held in the foreground already with what the call needs: only its notification changes (muted, who
            // it is with). Starting the service again would be asked of Android from wherever the app is, and with
            // the app minimized a phone refuses it, or starts it again without the microphone.
            if (running && foreground == want) {
                CallNotifications.refreshOngoing(context)
                ready = CompletableDeferred(true)
                return
            }
            val intent = Intent(context, CallService::class.java)
                .putExtra(EXTRA_CAMERA, want.camera)
                .putExtra(EXTRA_SCREEN, want.screen)
            ready = CompletableDeferred()
            running = true
            runCatching { ContextCompat.startForegroundService(context, intent) }.onFailure { Log.w(TAG, "could not start the call service", it) }
        }

        /** Starts the service with the screen's type and waits until it is in the foreground. */
        suspend fun awaitForeground(screen: Boolean): Boolean {
            update(screen = screen)
            return withTimeoutOrNull(5_000) { ready.await() } ?: false
        }

        internal fun pending(context: Context, action: String, channelId: String?): PendingIntent {
            val i = Intent(context, CallActionReceiver::class.java).setAction(action).putExtra("channel", channelId)
            return PendingIntent.getBroadcast(context, (action + channelId).hashCode(), i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
    }
}
