package fish.nexa.voice

import android.util.Log
import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.Envelope
import fish.nexa.net.ApiError
import fish.nexa.net.Message
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.max
import kotlin.math.roundToLong

/**
 * Follows a DM or group call this device started until it is over, then seals
 * how it went onto the call's line (web/src/voice/callRecord.ts and
 * callSummary.ts): whether anyone picked up, who said no, whether the ringing
 * ran out, and how long people talked. Only the caller writes it, once, and
 * only as ciphertext. Runs on the voice thread.
 */
internal object CallRecord {
    private const val TAG = "CallRecord"
    /** How long after a reconnect a call nobody is in still counts as over. */
    private const val SETTLE_MS = 15_000L
    /** A call that got no line of its own is let go after this long. */
    private const val NO_LINE_MS = 30_000L

    private class Outgoing(val channelId: String, var count: Int) {
        var messageId: String? = null
        var answeredAt = 0L
        var talkEnd = 0L
        val joined = ArrayList<String>()
        val declined = LinkedHashSet<String>()
        var timedOut = false
        var over = false
    }

    private val calls = HashMap<String, Outgoing>()

    private fun me() = Nexa.users.meId

    /** The accounts in a call right now; a guest picks up nobody's call. */
    private fun accountsIn(channelId: String): List<String> = Voice.participants(channelId).filter { !Voice.isGuest(it) }.map { it.userId }

    private fun observe(c: Outgoing) {
        if (c.over) return
        val now = System.currentTimeMillis()
        val inCall = accountsIn(c.channelId)
        val count = inCall.size
        // picking up means being in the call with someone else, not waiting alone in one
        if (count >= 2) for (id in inCall) if (id != me() && id !in c.joined) c.joined += id
        if (count >= 2 && c.answeredAt == 0L) c.answeredAt = now
        if (count < 2 && c.count >= 2) c.talkEnd = now
        c.count = count
    }

    /** This device has just called a conversation nobody else is in. */
    fun started(channelId: String) {
        calls[channelId] = Outgoing(channelId, accountsIn(channelId).size)
    }

    /** A message arrived: the server's line for a call this device started is where its summary goes. */
    fun line(m: Message) {
        if (m.type != "system_call" || m.authorId != me()) return
        val c = calls[m.channelId] ?: return
        if (c.messageId != null) return
        c.messageId = m.id
        if (c.over) write(c)
    }

    fun declined(channelId: String, userId: String) {
        calls[channelId]?.declined?.add(userId)
    }

    private fun everyoneSaidNo(c: Outgoing): Boolean {
        val others = Nexa.channels.get(c.channelId)?.recipientIds.orEmpty().filter { it != me() }
        return others.isNotEmpty() && others.all { it in c.declined }
    }

    fun allDeclined(channelId: String): Boolean = calls[channelId]?.let { everyoneSaidNo(it) } ?: false

    fun timedOut(channelId: String) {
        val c = calls[channelId] ?: return
        if (c.answeredAt == 0L) c.timedOut = true
    }

    /** The server says the call is over: nobody is left in it. */
    fun ended(channelId: String) {
        val c = calls[channelId] ?: return
        if (c.over) return
        observe(c)
        c.over = true
        if (c.messageId != null) {
            write(c)
            return
        }
        Calls.scope.launch {
            delay(NO_LINE_MS)
            if (calls[channelId] === c && c.messageId == null) calls.remove(channelId)
        }
    }

    /** The gateway came back: a call that ended while it was away never said so. */
    fun afterReady(inCall: (String) -> Boolean) {
        for (c in calls.values.toList()) {
            if (c.over || inCall(c.channelId) || accountsIn(c.channelId).isNotEmpty()) continue
            Calls.scope.launch {
                delay(SETTLE_MS)
                if (calls[c.channelId] === c && !inCall(c.channelId) && accountsIn(c.channelId).isEmpty()) ended(c.channelId)
            }
        }
    }

    /** Keeps every call being followed up to date as people come and go. */
    fun observeAll() {
        for (c in calls.values) observe(c)
    }

    private fun write(c: Outgoing) {
        val outcome = when {
            c.answeredAt != 0L -> "answered"
            everyoneSaidNo(c) -> "declined"
            c.timedOut -> "unanswered"
            else -> "cancelled"
        }
        val duration = if (outcome == "answered") max(0L, (((if (c.talkEnd != 0L) c.talkEnd else System.currentTimeMillis()) - c.answeredAt) / 1000.0).roundToLong()) else 0L
        val joined = if (outcome == "answered") c.joined.toList() else emptyList()
        val declined = c.declined.toList()
        if (calls[c.channelId] === c) calls.remove(c.channelId)
        val myId = me() ?: return
        val messageId = c.messageId ?: return
        Calls.scope.launch {
            try {
                val conv = Nexa.channels.convFor(c.channelId)
                val latest = Nexa.keys.ring.latest(conv) ?: Nexa.keys.ensureConvKey(conv) ?: return@launch
                val key = Nexa.keys.channelKey(conv, latest.first, c.channelId) ?: return@launch
                val summary = buildJsonObject {
                    put("outcome", outcome)
                    put("duration", duration)
                    put("joined", buildJsonArray { for (id in joined) add(kotlinx.serialization.json.JsonPrimitive(id)) })
                    put("declined", buildJsonArray { for (id in declined) add(kotlinx.serialization.json.JsonPrimitive(id)) })
                }
                val iv = Bytes.random(Bytes.IV_LEN)
                val aad = Bytes.utf8("call|$conv|${latest.first}|${c.channelId}|$myId|$messageId")
                val ct = Bytes.gcmEncrypt(key, iv, Bytes.utf8(summary.toString()), aad)
                val env = Envelope(1, conv, latest.first, Bytes.b64(iv), Bytes.b64(ct))
                VoiceApi.callSummary(c.channelId, messageId, env.toJson(), conv, latest.first)
            } catch (e: ApiError) {
                // another device of this account wrote it: that is fine
                if (e.code != "already_summarized") Log.w(TAG, "the call's summary was not written", e)
            } catch (e: Exception) {
                Log.w(TAG, "the call's summary was not written", e)
            }
        }
    }

    fun clear() = calls.clear()
}
