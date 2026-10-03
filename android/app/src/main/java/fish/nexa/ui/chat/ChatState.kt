package fish.nexa.ui.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import fish.nexa.data.Staged

/**
 * What the open conversations remember while the app runs (stores/ui.ts,
 * stores/selection.ts, the composer's per-conversation state): a reply being
 * written, an edit parked while you look elsewhere, files waiting in the tray,
 * picked messages, and a request to jump to a message.
 */
object ChatUi {
    data class Reply(val messageId: String, val ping: Boolean = true)
    data class Edit(val messageId: String, val text: String)
    data class Jump(val channelId: String, val messageId: String, val seq: Int)

    val reply = mutableStateMapOf<String, Reply>()
    val editing = mutableStateMapOf<String, Edit>()
    val trays = mutableStateMapOf<String, List<Staged>>()

    /** The conversation whose messages are being picked (selection mode), and the picks. */
    var selecting by mutableStateOf<String?>(null)
    val picked = mutableStateListOf<String>()

    var jump by mutableStateOf<Jump?>(null)
    private var jumpSeq by mutableIntStateOf(0)

    /** The side panel open over the chat on a phone: "pins", "search" or "subchats". */
    var panel by mutableStateOf<String?>(null)

    /** A message whose long-press menu is open (its row is tinted). */
    var menuFor by mutableStateOf<String?>(null)

    /** Bumped to snap a conversation to its newest message (after sending). */
    val toBottom = mutableStateMapOf<String, Int>()

    /** Text for a conversation's composer to put at its caret ("Mention" in a member menu: `ec:insert-text`). */
    val inserts = mutableStateMapOf<String, String>()

    fun jumpTo(channelId: String, messageId: String) {
        jumpSeq += 1
        jump = Jump(channelId, messageId, jumpSeq)
    }

    fun snapToBottom(channelId: String) {
        toBottom[channelId] = (toBottom[channelId] ?: 0) + 1
    }

    fun startSelecting(channelId: String, first: String?) {
        selecting = channelId
        picked.clear()
        if (first != null) picked += first
        editing.remove(channelId)
    }

    fun stopSelecting() {
        selecting = null
        picked.clear()
    }

    fun togglePick(id: String) {
        if (id in picked) picked.remove(id) else picked += id
    }

    /** Opening another conversation closes the panels and ends picking; replies stay with their conversation. */
    fun leftConversation(channelId: String) {
        if (selecting == channelId) stopSelecting()
        panel = null
        reply.remove(channelId)
    }

    fun clear() {
        reply.clear(); editing.clear(); trays.clear(); stopSelecting(); jump = null; panel = null; menuFor = null
    }
}

/**
 * Who owns a sideways swipe that starts on a message: the row (swipe left to
 * reply) or the page (swipe right for the drawer, left for members elsewhere).
 * The row marks the finger as its own when it goes down; the page's recogniser
 * leaves leftward swipes from such a finger alone.
 */
object TouchClaims {
    @Volatile var onMessageRow: Boolean = false
}
