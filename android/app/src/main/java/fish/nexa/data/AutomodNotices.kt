package fish.nexa.data

import androidx.compose.runtime.mutableStateMapOf

/**
 * stores/automodNotices.ts: what AutoMod said about a message this account
 * tried to send, shown above the box of the conversation it was meant for
 * until it is dismissed or the next message goes.
 */
object AutomodNotices {
    data class Notice(
        /** The rule's own words, or empty for the usual ones. */
        val message: String,
        val rule: String,
        /** The kind of rule, which says what it looks for. */
        val kind: String,
        /** The word, link or sign it caught, when there is one to show. */
        val matched: String? = null,
        /** What was typed, to put back in the box when it was emptied for the send. */
        val text: String? = null,
        val at: Long = System.currentTimeMillis(),
    )

    val byChannel = mutableStateMapOf<String, Notice>()

    fun show(channelId: String, n: Notice) {
        byChannel[channelId] = n
    }

    fun stopped(channelId: String, c: Automod.Catch, text: String?) =
        show(channelId, Notice(c.message, c.rule.name, c.rule.kind, c.matched, text))

    /** The words were put back in the box. */
    fun restored(channelId: String) {
        val n = byChannel[channelId] ?: return
        if (n.text != null) byChannel[channelId] = n.copy(text = null)
    }

    fun dismiss(channelId: String) {
        byChannel.remove(channelId)
    }

    fun clear() = byChannel.clear()
}
