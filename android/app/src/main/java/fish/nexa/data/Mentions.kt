package fish.nexa.data

import fish.nexa.Nexa
import fish.nexa.net.PublicUser
import fish.nexa.ui.markdown.EmojiData
import fish.nexa.ui.markdown.Markdown
import fish.nexa.ui.markdown.Mentions as Md

/**
 * The app's side of turning names into mentions (components/composer/send.ts
 * mentionScope, editNames; messageMenu.ts knownNames): who and what can be
 * named in a conversation, handed to the ported parser in ui/markdown.
 */
object Mentions {
    /** Everyone this device knows, you included, by id. */
    private fun users(): Map<String, PublicUser> {
        val all = HashMap(Nexa.users.byId.value)
        Nexa.users.me.value?.let { me -> all[me.id] = PublicUser(me.id, me.username, me.displayName, me.avatarId) }
        return all
    }

    /** A subchat's conversation is its parent's. */
    private fun conversation(channelId: String) = Nexa.channels.get(channelId)?.let { ch ->
        if (ch.type == "subchat" && ch.parentId != null) Nexa.channels.get(ch.parentId) ?: ch else ch
    }

    fun scope(channelId: String): Md.Scope {
        val ch = conversation(channelId)
        val users = Nexa.users.byId.value
        val me = Nexa.users.me.value
        fun nameOf(id: String) = (if (id == me?.id) me.displayName else users[id]?.displayName) ?: ""
        val serverId = ch?.serverId
        val st = serverId?.let { Nexa.servers.get(it) }
        var members = emptyList<Md.Member>()
        var roles = emptyList<Md.Named>()
        var channels = emptyList<Md.Named>()
        if (st != null) {
            members = st.members.values.map { m -> Md.Member(m.userId, listOfNotNull(nameOf(m.userId), m.nickname.takeIf { it.isNotEmpty() })) }
            val everyRole = Nexa.servers.canI(st, P.MENTION_EVERYONE, channelId)
            roles = st.roles.values.filter { it.id != st.server.id && (it.mentionable || everyRole) }.map { Md.Named(it.id, it.name) }
            channels = Nexa.channels.byId.value.values.filter { it.serverId == serverId && (it.isText || it.isAnnouncement || it.isForum) && Nexa.servers.canI(st, P.VIEW_CHANNEL, it.id) }
                .map { Md.Named(it.id, it.name) }
        } else if (ch != null) {
            val ids = (ch.recipientIds + listOfNotNull(me?.id)).toSet()
            members = ids.map { Md.Member(it, listOf(nameOf(it))) }
        }
        val ex = Nexa.expressions
        val emoji = ArrayList<Md.EmojiToken>()
        if (serverId != null) for (e in ex.emojis.value[serverId] ?: emptyList()) emoji += Md.EmojiToken(e.name, token(e.name, e.blobId, e.animated))
        for ((sid, list) in ex.emojis.value) if (sid != serverId) for (e in list) emoji += Md.EmojiToken(e.name, token(e.name, e.blobId, e.animated), fallback = true)
        for (pack in ex.packs.value.values.filter { it.kind == "emoji" && it.stickers.isNotEmpty() }.sortedByDescending { it.updatedAt }) {
            for (s in pack.stickers) emoji += Md.EmojiToken(s.name, token(s.name, s.blobId, s.animated), fallback = true)
        }
        return Md.Scope(members, roles, channels, emoji) { name -> !EmojiData.loaded() || EmojiData.byShortcode(name) != null }
    }

    private fun token(name: String, blobId: String, animated: Boolean) = "<" + (if (animated) "a" else "") + ":" + name + ":" + blobId + ">"

    fun extract(raw: String, channelId: String): Md.Extracted = Md.extract(raw, users(), scope(channelId))

    /**
     * A custom emoji as it reads in the message box (Composer.tsx emojiText):
     * its :name:, when sending that name brings back this very emoji, and its
     * raw token otherwise, which is never wrong.
     */
    fun emojiText(token: String, name: String, channelId: String): String {
        val short = ":$name:"
        return if (extract(short, channelId).text == token) short else token
    }

    fun urls(text: String): List<String> = Markdown.extractUrls(text)

    /** For copying a message: every role and channel name this device knows, so it reads as the message does. */
    fun humanize(text: String): String {
        val roles = HashMap<String, String>()
        for (st in Nexa.servers.byId.value.values) for (r in st.roles.values) roles[r.id] = r.name
        val channels = Nexa.channels.byId.value.values.filter { it.serverId != null && it.name.isNotEmpty() }.associate { it.id to it.name }
        return Md.humanize(text, users(), Md.HumanNames(roles, channels) { _, _ -> true })
    }

    /** For editing: only names that turn back into the same mention when saved (send.ts editNames). */
    fun humanizeForEdit(text: String, channelId: String): String {
        val sc = scope(channelId)
        fun once(list: List<Md.Named>): Map<String, String> {
            val count = list.groupingBy { it.name.lowercase() }.eachCount()
            return list.filter { count[it.name.lowercase()] == 1 }.associate { it.id to it.name }
        }
        return Md.humanize(text, users(), Md.HumanNames(once(sc.roles), once(sc.channels)) { token, name -> Md.extract(":$name:", emptyMap(), sc).text == token })
    }
}

/** Emoji you use, for the picker's suggestions (lib/emojiSuggest.ts noteEmojiUse). */
object EmojiUse {
    fun note(keys: List<String>) {
        if (!Nexa.settings.loaded.value || !Nexa.settings.smartEmoji || keys.isEmpty()) return
        fish.nexa.ui.markdown.EmojiUsage.noteUsePatch(Nexa.settings.doc.value, keys, System.currentTimeMillis().toDouble())?.let { Nexa.settings.patch(it) }
    }

    /** The emoji you reach for most, newest habits first. */
    fun frequent(n: Int): List<String> {
        val usage = fish.nexa.ui.markdown.EmojiUsage.sanitize(Nexa.settings.doc.value["emojiUsage"], System.currentTimeMillis().toDouble())
        val ranked = fish.nexa.ui.markdown.EmojiUsage.rankedKeys(usage, System.currentTimeMillis().toDouble())
            .filter { !it.startsWith("c:") }
        return (ranked + Nexa.settings.recentEmoji).distinct().take(n)
    }
}
