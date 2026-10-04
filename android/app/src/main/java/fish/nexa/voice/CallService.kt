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
 * whatever a caller happened to pass. The call outlives the app's window:
 * swiped away from the recents, it goes on, and its notification brings the
 * call back or ends it.
 */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
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
            ready.complete(true)
        } catch (e: Exception) {
            Log.w(TAG, "could not keep the call in the foreground", e)
            ready.complete(false)
            stopSelf()
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

    companion object {
        private const val TAG = "CallService"
        const val NOTIFICATION_ID = 0x0ca11
        private const val ACTION_STOP = "fish.nexa.voice.STOP"
        private const val EXTRA_CAMERA = "camera"
        private const val EXTRA_SCREEN = "screen"

        @Volatile private var running = false
        @Volatile private var ready = CompletableDeferred<Boolean>()

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
                CallNotifications.cancelOngoing()
                return
            }
            val s = Engine.current()
            val intent = Intent(context, CallService::class.java)
                .putExtra(EXTRA_CAMERA, camera ?: (s?.camera != null))
                .putExtra(EXTRA_SCREEN, screen ?: (s?.screen != null))
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
