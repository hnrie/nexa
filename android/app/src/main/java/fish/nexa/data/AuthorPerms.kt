package fish.nexa.data

import fish.nexa.Nexa

/**
 * What the author of a message may do in its channel, as a reader's app works
 * it out (web lib/authorPerms.ts). Emoji and stickers from outside the server
 * are sealed inside a message, where the server cannot look, so every app
 * holds Use External Emoji and Use External Stickers when it draws someone
 * else's message.
 */
object AuthorPerms {
    /** Whether a message's author holds a permission in its channel: null when this device cannot tell (their roles not loaded, not a server channel, an app's message), which readers take as yes. */
    fun has(st: ServerState?, cm: ChatMessage, need: Long): Boolean? {
        if (st == null || cm.hook != null) return null
        val author = cm.m.authorId
        if (Nexa.channels.get(cm.channelId)?.serverId != st.server.id) return null
        if (st.server.ownerId != author && st.members[author] == null) return null
        return P.has(Nexa.servers.channelPerms(st, cm.channelId, author), need)
    }
}
