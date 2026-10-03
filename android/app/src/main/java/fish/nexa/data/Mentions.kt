// TEMPORARY: replaced by the port of web/src/components/composer/mentions.ts (extractMentions)
// and markdown extractUrls, landing from the markdown work.
package fish.nexa.data

object Mentions {
    data class Extracted(val text: String, val mentions: List<String>, val roles: List<String>, val everyone: Boolean)

    private val user = Regex("<@!?(\\d{1,20})>")
    private val role = Regex("<@&(\\d{1,20})>")
    private val everyone = Regex("(^|\\s)@(everyone|here)\\b")
    private val url = Regex("https?://[^\\s<>]+")

    fun extract(raw: String, channelId: String): Extracted {
        val text = raw.trim()
        return Extracted(
            text,
            user.findAll(text).map { it.groupValues[1] }.distinct().take(50).toList(),
            role.findAll(text).map { it.groupValues[1] }.distinct().take(50).toList(),
            everyone.containsMatchIn(text),
        )
    }

    fun urls(text: String): List<String> = url.findAll(text).map { it.value }.toList()

    /** <@id> back to @username, for copying and editing. */
    fun humanize(text: String): String = user.replace(text) { m -> fish.nexa.Nexa.users.get(m.groupValues[1])?.let { "@${it.username}" } ?: m.value }
}

/** Emoji you use, for the picker's suggestions (lib/emojiSuggest.ts noteEmojiUse). */
object EmojiUse {
    fun note(keys: List<String>) = Unit
    fun frequent(n: Int): List<String> = fish.nexa.Nexa.settings.recentEmoji.take(n)
}
