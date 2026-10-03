package fish.nexa.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import fish.nexa.Nexa
import fish.nexa.data.Send
import kotlinx.coroutines.launch

/**
 * The buttons on a message notification: Reply sends what was typed into it
 * (as the composer would, encrypted, in order), Mark as Read moves the read
 * marker to the newest message and takes the notification away.
 */
class NotifyActions : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val channelId = intent.getStringExtra(Notifier.EXTRA_CHANNEL) ?: return
        when (intent.action) {
            REPLY -> {
                val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notifier.KEY_REPLY)?.toString()?.trim()
                if (text.isNullOrEmpty()) return
                Send.sendMessage(channelId, text)
                Notifier.addOwnReply(channelId, text)
            }
            READ -> {
                val pending = goAsync()
                Nexa.scope.launch {
                    try {
                        Nexa.channels.get(channelId)?.lastMessageId?.let { Nexa.session.ack(channelId, it) }
                        Notifier.clearConversation(channelId)
                    } finally {
                        pending.finish()
                    }
                }
            }
        }
    }

    companion object {
        const val REPLY = "fish.nexa.notify.REPLY"
        const val READ = "fish.nexa.notify.READ"
    }
}
