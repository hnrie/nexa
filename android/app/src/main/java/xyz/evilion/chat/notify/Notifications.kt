package xyz.evilion.chat.notify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.launch
import xyz.evilion.chat.MainActivity
import xyz.evilion.chat.R
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.data.SettingsStore
import xyz.evilion.chat.data.UiMessage
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.net.Message

/**
 * Notifications, from the socket this app keeps open rather than from a push
 * service: the server has no third party to hand a message to, and could not
 * tell it anything readable if it had.
 */
object Notifications {
    const val CHANNEL_MESSAGES = "messages"
    const val CHANNEL_CALLS = "calls"
    const val CHANNEL_SERVICE = "service"

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_MESSAGES, t("modals.quickSwitcher.messages"), NotificationManager.IMPORTANCE_HIGH).apply {
                description = t("notifications.newMessagesAndMentions")
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_CALLS, t("notifications.calls"), NotificationManager.IMPORTANCE_HIGH).apply {
                description = t("notifications.incomingAndOngoingCalls")
                setSound(null, null)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_SERVICE, t("notifications.stayingConnected"), NotificationManager.IMPORTANCE_MIN).apply {
                description = t("notifications.keepsMessagesArrivingWhileTheApp")
            },
        )
    }

    private fun openIntent(context: Context, channelId: String?): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            channelId?.let { putExtra("channel_id", it) }
        }
        return PendingIntent.getActivity(
            context, channelId?.hashCode() ?: 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** A message that arrived while this device was not looking at it. */
    fun message(context: Context, raw: Message, decrypted: UiMessage) {
        if (!SettingsStore.deviceBool("notifications", true)) return
        val me = AppState.me.value?.id
        val channel = AppState.channels.value[raw.channelId]
        val serverId = channel?.serverId
        if (SettingsStore.isMuted(raw.channelId, serverId)) return
        val mentionsMe = raw.mentionEveryone || (me != null && me in raw.mentions)
        val wanted = when (SettingsStore.notificationLevel(raw.channelId, serverId)) {
            "none" -> false
            "mentions" -> mentionsMe
            else -> true
        }
        if (!wanted) return

        val title = channel?.let { AppState.channelName(it, me) } ?: t("profile.profileCard.message")
        val author = AppState.nameFor(raw.authorId, channel?.serverId)
        val body = when {
            decrypted.decryptError != null -> t("notifications.sentYouAMessage")
            !decrypted.payload?.text.isNullOrEmpty() -> decrypted.payload?.text.orEmpty()
            decrypted.payload?.attachments?.isNotEmpty() == true -> t("notifications.sentAnAttachment")
            decrypted.payload?.sticker != null -> t("notify.sentASticker")
            else -> t("notifications.sentAMessage")
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (channel?.isDm == true) author else "$author · $title")
            .setContentText(body.take(200))
            .setStyle(NotificationCompat.BigTextStyle().bigText(body.take(500)))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(if (mentionsMe) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openIntent(context, raw.channelId))
            .setGroup(raw.channelId)
            .build()
        post(context, raw.channelId.hashCode(), notification)
    }

    /** Someone is calling. */
    fun ringing(context: Context, channelId: String, fromUserId: String) {
        val name = AppState.nameFor(fromUserId)
        val answer = PendingIntent.getActivity(
            context, channelId.hashCode() + 1,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("call_channel_id", channelId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val decline = PendingIntent.getBroadcast(
            context, channelId.hashCode() + 2,
            Intent(context, NotificationActions::class.java).apply {
                action = NotificationActions.ACTION_DECLINE
                putExtra("channel_id", channelId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("$name is calling")
            .setContentText(t("settings.notifications.incomingCall"))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOngoing(true)
            .setFullScreenIntent(answer, true)
            .addAction(0, t("notifications.answer"), answer)
            .addAction(0, t("voice.incomingCall.decline"), decline)
            .build()
        post(context, callId(channelId), notification)
    }

    fun clearRing(context: Context, channelId: String) {
        NotificationManagerCompat.from(context).cancel(callId(channelId))
    }

    private fun callId(channelId: String) = channelId.hashCode() + 7777

    private fun post(context: Context, id: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) return
        NotificationManagerCompat.from(context).notify(id, notification)
    }
}

/** The buttons on a call notification. */
class NotificationActions : BroadcastReceiver() {
    companion object {
        const val ACTION_DECLINE = "xyz.evilion.chat.DECLINE"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val channelId = intent.getStringExtra("channel_id") ?: return
        when (intent.action) {
            ACTION_DECLINE -> {
                Notifications.clearRing(context, channelId)
                Session.scope.launch {
                    runCatching { xyz.evilion.chat.net.VoiceApi.decline(channelId) }
                }
            }
        }
    }
}
