package fish.nexa.notes

import fish.nexa.net.PublicUser

/**
 * Mentioning people in a note (web lib/notes/mentions.ts). A mention is
 * written as it is in a message, `<@id>`, and only the people who have the
 * note are offered: anyone else could not open it to see they were mentioned.
 */
object NoteMentions {
    /** How many people the list offers at once. */
    const val MAX = 8

    private val NAME_WORDS = Regex("""[\s._-]+""")
    private val USER_WORDS = Regex("[._]+")
    private val MENTION = Regex("""<@!?(\d{1,20})>""")

    /**
     * The people whose name or username fits what was typed after the @, best
     * first: a name or username that starts with it, then one with a word that
     * starts with it, then one that has it anywhere; alphabetical within each.
     * Nothing typed yet offers everyone.
     */
    fun matches(people: Collection<PublicUser>, query: String, max: Int = MAX): List<PublicUser> {
        val q = query.lowercase()
        val scored = ArrayList<Triple<PublicUser, Int, String>>()
        for (u in people) {
            val name = u.displayName.ifEmpty { u.username }.lowercase()
            val user = u.username.lowercase()
            val rank = when {
                q.isEmpty() || name.startsWith(q) || user.startsWith(q) -> 0
                name.split(NAME_WORDS).any { it.startsWith(q) } || user.split(USER_WORDS).any { it.startsWith(q) } -> 1
                name.contains(q) || user.contains(q) -> 2
                else -> continue
            }
            scored += Triple(u, rank, name)
        }
        val collator = java.text.Collator.getInstance(java.util.Locale.getDefault())
        return scored
            .sortedWith(compareBy<Triple<PublicUser, Int, String>> { it.second }.thenComparator { a, b -> collator.compare(a.third, b.third) }.thenBy { it.first.id })
            .take(max)
            .map { it.first }
    }

    /** The people a note's text mentions, each once, in the order they first appear. */
    fun mentionedIds(md: String): List<String> = MENTION.findAll(md).map { it.groupValues[1] }.distinct().toList()
}
