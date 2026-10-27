package fish.nexa.data

import fish.nexa.Nexa
import fish.nexa.net.Channel

/**
 * Forwarding a message (the web's lib/forward.ts): its words, files, sticker
 * and link previews go as they were, marked forwarded. The files are the
 * original's own (the same uploads, opened by the same keys, sealed into the
 * new message), so nothing is uploaded again and nobody's monthly allowance
 * is spent. A forward pings nobody.
 */
object Forward {
    /** Whether a message can be passed on: one of a person's, decrypted here, with something to carry. A poll stays where it is. */
    fun can(msg: ChatMessage): Boolean {
        val p = msg.payload ?: return false
        if (msg.local || msg.hook != null || msg.error != null || p.poll != null) return false
        if (msg.m.type != "default" && msg.m.type != "reply") return false
        return !p.t.isNullOrEmpty() || !p.att.isNullOrEmpty() || p.sticker != null || !p.embeds.isNullOrEmpty()
    }

    /** Where a message can go: conversations, newest first, then server channels this account may write in (and send files in, for one with files). */
    fun targets(withFiles: Boolean): List<Channel> {
        val all = Nexa.channels.byId.value.values
        val dms = all.filter { it.type == "dm" || it.type == "group_dm" }.sortedWith { a, b -> Ids.compare(b.lastMessageId ?: b.id, a.lastMessageId ?: a.id) }
        val inServers = Nexa.servers.byId.value.values.flatMap { st ->
            all.filter { it.serverId == st.server.id && (it.type == "text" || it.type == "announcement") }
                .filter { Nexa.servers.canI(st, P.VIEW_CHANNEL or P.SEND_MESSAGES, it.id) && (!withFiles || Nexa.servers.canI(st, P.ATTACH_FILES, it.id)) }
                .sortedBy { it.position }
        }
        return dms + inServers
    }

    /** Passes a message on to one conversation or channel; one at a time, so forwarding passes something on rather than spreading it (the server limits how often, too). */
    fun send(msg: ChatMessage, to: String, comment: String = "") {
        val p = msg.payload ?: return
        val attachments = p.att.orEmpty().map { Uploaded(it, it.blobId, it.size) }
        val forward = Forwarding(msg.channelId, msg.id, p.fwdAt ?: Ids.createdAt(msg.id), comment.trim().takeIf { it.isNotEmpty() })
        Send.sendMessage(
            to, p.t ?: "",
            SendOptions(ping = false, attachments = attachments.takeIf { it.isNotEmpty() }, sticker = p.sticker, embeds = p.embeds, forward = forward),
        )
    }
}
