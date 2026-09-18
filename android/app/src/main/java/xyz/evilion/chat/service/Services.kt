package xyz.evilion.chat.service

import android.app.Notification
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
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import xyz.evilion.chat.MainActivity
import xyz.evilion.chat.R
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.notify.Notifications
import xyz.evilion.chat.voice.VoiceSession
import java.util.concurrent.atomic.AtomicReference

/**
 * Keeps the socket open while the app is in the background, so a message
 * arrives without a push service in the middle of it.
 */
class GatewayService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Notifications.ensureChannels(this)
        val notification = NotificationCompat.Builder(this, Notifications.CHANNEL_SERVICE)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Nexa")
            .setContentText(t("services.connected"))
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setContentIntent(
                PendingIntent.getActivity(
                    this, 0, Intent(this, MainActivity::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()
        if (!startForegroundCompat(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)) {
            // The socket does not need this service; it only keeps it open while
            // the app is away. Failing to put the notification up is not worth
            // taking the app down for.
            Session.gateway.connect()
            stopSelf()
            return START_NOT_STICKY
        }
        Session.gateway.connect()
        return START_STICKY
    }

    companion object {
        fun start(context: Context) {
            runCatching { context.startForegroundService(Intent(context, GatewayService::class.java)) }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, GatewayService::class.java)) }
        }
    }
}

/** Keeps a call running while the app is not on screen. */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Notifications.ensureChannels(this)
        val call = VoiceSession.state.value
        val channelId = intent?.getStringExtra("channel_id") ?: call.channelId
        // START_NOT_STICKY below means Android does not bring this back after
        // a kill, but a stale intent can still arrive: a notification saying
        // "In a call · Call" that leads to an empty app is worse than none.
        if (channelId == null) {
            reached(false)
            stopSelf()
            return START_NOT_STICKY
        }
        val name = AppState.channels.value[channelId]?.let { AppState.channelName(it) } ?: t("services.call")
        val notification: Notification = NotificationCompat.Builder(this, Notifications.CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(t("services.inACall"))
            .setContentText(name)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setContentIntent(
                PendingIntent.getActivity(
                    this, 1,
                    Intent(this, MainActivity::class.java).apply { putExtra("call_channel_id", channelId) },
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()
        // Android 14 refuses a microphone service to an app that has not been
        // given the microphone, and the refusal is an exception that would take
        // the whole app down. Someone who said no to the microphone can still
        // be in the call and listen, so the service runs as a plain one.
        //
        // The rest of the types come from the call itself rather than from
        // whatever the caller passed: the call screen re-announced "not
        // sharing" every time it was reopened, which took mediaProjection off
        // a running service and killed the share a second later. Android also
        // cuts a backgrounded app off from the camera without the camera type,
        // which froze everyone else's view of your video on its last frame.
        val mic = ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        var type = if (mic) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        if (call.video) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        if (call.screen || VoiceSession.wantsScreen) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        if (!startForegroundCompat(2, notification, type)) {
            // the call itself carries on; only the notification that would keep
            // it alive in the background could not be put up
            reached(false)
            stopSelf()
            return START_NOT_STICKY
        }
        reached(true)
        return START_NOT_STICKY
    }

    companion object {
        /**
         * Whoever is waiting for this service to be in the foreground.
         *
         * A media projection may not be touched until a foreground service of
         * type `mediaProjection` is actually running, and
         * `startForegroundService` only schedules one — so the screen share
         * used to start the capture on the next breath and be refused with a
         * `SecurityException` the moment the user confirmed the system dialog.
         */
        private val waiting = AtomicReference<CompletableDeferred<Boolean>?>(null)

        private fun reached(ok: Boolean) {
            waiting.getAndSet(null)?.complete(ok)
        }

        fun start(context: Context, channelId: String) {
            runCatching {
                context.startForegroundService(
                    Intent(context, CallService::class.java).apply {
                        putExtra("channel_id", channelId)
                    },
                )
            }.onFailure {
                Log.w("Services", "could not start the call service", it)
                reached(false)
            }
        }

        /** Starts the service and waits until it really is in the foreground. */
        suspend fun awaitForeground(context: Context, channelId: String, timeoutMs: Long = 6_000): Boolean {
            val waiter = CompletableDeferred<Boolean>()
            waiting.set(waiter)
            start(context, channelId)
            val ok = withTimeoutOrNull(timeoutMs) { waiter.await() }
            waiting.compareAndSet(waiter, null)
            return ok == true
        }

        fun stop(context: Context) {
            reached(false)
            runCatching { context.stopService(Intent(context, CallService::class.java)) }
        }
    }
}

/**
 * Puts the service in the foreground, and says whether that worked.
 *
 * Every way this can fail throws, and none of them is worth a crash: the
 * system refuses a service of a type whose permission is missing, refuses one
 * started while the app is away, and refuses one whose notification it will
 * not show. What is lost is the service, not the call or the socket.
 */
private fun Service.startForegroundCompat(id: Int, notification: Notification, type: Int): Boolean =
    try {
        if (Build.VERSION.SDK_INT >= 29) startForeground(id, notification, type) else startForeground(id, notification)
        true
    } catch (e: Throwable) {
        Log.w("Services", "could not go to the foreground", e)
        false
    }
