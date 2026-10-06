package fish.nexa.data

import fish.nexa.Nexa
import fish.nexa.net.Message
import fish.nexa.ui.markdown.Markdown
import fish.nexa.ui.t
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/**
 * The newest thing said in each thread this app has seen, for the card under
 * the message a thread hangs from: who said it, a line of it, and when
 * (web/src/stores/threadLast.ts). It comes with the message's page (sealed,
 * opened here) and follows the thread as messages arrive in it.
 */
object ThreadLast {
    data class Last(val id: String, val authorId: String, val text: String, val createdAt: Long)

    private val _byThread = MutableStateFlow<Map<String, Last>>(emptyMap())
    val byThread: StateFlow<Map<String, Last>> = _byThread

    /** Keeps the newer of what is here and [last]. */
    fun note(threadId: String, last: Last) = _byThread.update { m ->
        val cur = m[threadId]
        if (cur != null && Ids.compare(cur.id, last.id) > 0) m else m + (threadId to last)
    }

    /** A thread's newest message deleted: its card stops quoting it. */
    fun forget(threadId: String, messageId: String? = null) = _byThread.update { m ->
        val cur = m[threadId] ?: return@update m
        if (messageId != null && cur.id != messageId) m else m - threadId
    }

    fun clear() {
        _byThread.value = emptyMap()
    }

    /** One line of a message, as the card under a thread's message shows it. */
    fun lineOf(d: ChatMessage): String {
        val p = d.payload ?: return if (d.error != null) t("chat.messageItem.encryptedMessage") else ""
        p.t?.takeIf { it.isNotEmpty() }?.let { return Markdown.plainText(Markdown.parse(it), fish.nexa.ui.chat.AppNames).replace(Regex("\\s+"), " ").trim().take(140) }
        p.poll?.let { poll -> return (listOf(poll.question) + poll.answers.map { it.text }).filter { it.isNotBlank() }.joinToString("\n").take(140) }
        p.att?.takeIf { it.isNotEmpty() }?.let { return if (it.size == 1) t("notify.sentFile", "name" to it[0].name) else t("notify.sentFiles", "count" to it.size) }
        if (p.sticker != null) return t("notify.sentASticker")
        return ""
    }

    /** Keeps a message said in a thread as the thread's newest, once opened. */
    fun noteMessage(threadId: String, d: ChatMessage) {
        if (d.m.type != "default" && d.m.type != "reply") return
        note(threadId, Last(d.id, d.authorId, lineOf(d), d.m.createdAt))
    }

    /** Opens the newest message a thread's summary came with, sealed, and keeps it. */
    fun openSummaryLast(threadId: String, m: Message) {
        if (_byThread.value[threadId]?.id == m.id) return
        noteMessage(threadId, Nexa.messages.decrypt(m))
    }
}
