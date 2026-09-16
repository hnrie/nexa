package xyz.evilion.chat.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import xyz.evilion.chat.MainActivity
import xyz.evilion.chat.R
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.notify.Notifications

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
            .setContentTitle("Evilion Chat")
            .setContentText("Connected")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setContentIntent(
                PendingIntent.getActivity(
                    this, 0, Intent(this, MainActivity::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()
        startForegroundCompat(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
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
        val channelId = intent?.getStringExtra("channel_id")
        val sharing = intent?.getBooleanExtra("sharing", false) == true
        val name = channelId?.let { id ->
            AppState.channels.value[id]?.let { AppState.channelName(it) }
        } ?: "Call"
        val notification: Notification = NotificationCompat.Builder(this, Notifications.CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("In a call")
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
        val type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
            (if (sharing) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0)
        startForegroundCompat(2, notification, type)
        return START_STICKY
    }

    companion object {
        fun start(context: Context, channelId: String, sharing: Boolean) {
            runCatching {
                context.startForegroundService(
                    Intent(context, CallService::class.java).apply {
                        putExtra("channel_id", channelId)
                        putExtra("sharing", sharing)
                    },
                )
            }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, CallService::class.java)) }
        }
    }
}

private fun Service.startForegroundCompat(id: Int, notification: Notification, type: Int) {
    if (Build.VERSION.SDK_INT >= 29) {
        startForeground(id, notification, type)
    } else {
        startForeground(id, notification)
    }
}
