package fish.nexa.data

import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.Keys
import fish.nexa.crypto.MessagePayload
import fish.nexa.net.PublicUser

/**
 * Copies of a message for the apps it is addressed to (web lib/botCopies.ts).
 *
 * An app reads only what is meant for it: a message in a conversation with
 * its bot, one that mentions its bot, or a reply to its bot. Nothing else is
 * ever readable to it unless its app reads every message (the Message Content
 * intent, marked wherever it applies). So the sender's app seals the message
 * a second time, to each such bot's key, and the server hands that copy to the
 * app. The server keeps only copies for bots that are addressed and can see
 * the channel, and drops any other.
 */
object BotCopies {
    /** As many apps as one message carries copies for (store.MaxBotCopies). */
    const val MAX = 10

    /**
     * The bots a message is addressed to: the other side of a conversation
     * with one, the ones it mentions, and the one it replies to. In that
     * order, at most [MAX], never the sender.
     */
    fun addressed(channelId: String, mentions: List<String>, replyAuthorId: String?, meId: String): List<PublicUser> {
        val ch = Nexa.channels.get(channelId)
        val ids = ArrayList<String>()
        if (ch?.type == "dm") ids += ch.recipientIds
        ids += mentions
        if (replyAuthorId != null) ids += replyAuthorId
        val out = ArrayList<PublicUser>()
        val seen = hashSetOf(meId)
        for (id in ids) {
            if (!seen.add(id)) continue
            val u = Nexa.users.get(id) ?: continue
            if (!u.isBot || u.publicKey.isEmpty()) continue
            out += u
            if (out.size >= MAX) break
        }
        return out
    }

    /** Seals a message's content to each bot's key: base64 copies by bot id, for `bot_copies`. */
    fun seal(bots: List<PublicUser>, payload: MessagePayload): Map<String, String> {
        if (bots.isEmpty()) return emptyMap()
        val data = Bytes.utf8(payload.toJson().toString())
        val out = LinkedHashMap<String, String>()
        for (bot in bots) {
            // a bot whose key cannot be read goes without; the message still goes
            runCatching { out[bot.id] = Bytes.b64(Keys.seal(Bytes.unb64(bot.publicKey), data)) }
        }
        return out
    }
}
