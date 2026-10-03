package fish.nexa.markdown

import fish.nexa.net.PublicUser
import fish.nexa.ui.markdown.Commands
import fish.nexa.ui.markdown.Mentions
import fish.nexa.ui.markdown.MessageLimit
import fish.nexa.ui.markdown.People
import fish.nexa.ui.markdown.ShortcodeTyping
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.BeforeClass
import org.junit.Test
import java.util.Locale

/** The composer's helpers (web/src/components/composer), against the web. */
class ComposeVectorsTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun assets() = Vectors.useAssets()
    }

    private fun JsonObject.s(k: String): String? = this[k]?.takeIf { it !is JsonNull }?.jsonPrimitive?.contentOrNull

    private val users = linkedMapOf(
        "1" to PublicUser("1", username = "alice", displayName = "Alice A"),
        "2" to PublicUser("2", username = "bob.smith", displayName = "Bob"),
        "3" to PublicUser("3", username = "carol_", displayName = "Carol"),
        "4" to PublicUser("4", username = "dave", displayName = "Ann"),
    )

    private val scope = Mentions.Scope(
        members = listOf(
            Mentions.Member("1", listOf("alice", "Alice A", "Al")),
            Mentions.Member("2", listOf("bob.smith", "Bob", "Robert")),
            Mentions.Member("4", listOf("dave", "Ann")),
            Mentions.Member("5", listOf("Ann")),
            Mentions.Member("6", listOf("Zoë Q")),
        ),
        roles = listOf(Mentions.Named("10", "Mods"), Mentions.Named("11", "Mod Team"), Mentions.Named("12", "alice")),
        channels = listOf(Mentions.Named("20", "general"), Mentions.Named("21", "dev"), Mentions.Named("22", "dev-chat")),
        emoji = listOf(
            Mentions.EmojiToken("blob", "<:blob:30>"),
            Mentions.EmojiToken("Blob", "<:Blob:31>"),
            Mentions.EmojiToken("smile", "<:smile:32>"),
            Mentions.EmojiToken("party", "<a:party:33>", fallback = true),
            Mentions.EmojiToken("fire", "<:fire:34>", fallback = true),
        ),
        isShortcode = { it.lowercase() in setOf("smile", "fire", "heart", "+1") },
    )

    private fun same(got: Mentions.Extracted, want: JsonObject): Boolean =
        got.text == want.s("text") &&
            got.mentions == want["mentions"]!!.jsonArray.map { it.jsonPrimitive.content } &&
            got.roles == want["roles"]!!.jsonArray.map { it.jsonPrimitive.content } &&
            got.everyone == want["everyone"]!!.jsonPrimitive.boolean

    @Test
    fun extractMentions() {
        val cases = Vectors["mentions"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("extractMentions", cases) { c ->
            val text = c.s("text")!!
            val got = Mentions.extract(text, users, scope)
            val bare = Mentions.extract(text, users)
            if (same(got, c["out"]!!.jsonObject) && same(bare, c["bare"]!!.jsonObject)) null
            else "text ${Vectors.show(text)}\nweb    ${c["out"]} / ${c["bare"]}\nkotlin $got / $bare"
        }
    }

    @Test
    fun humanizeMentions() {
        val names = Mentions.HumanNames(roles = mapOf("10" to "Mods"), channels = mapOf("20" to "general"), emoji = { token, _ -> token.contains("blob") })
        val cases = Vectors["human"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("humanizeMentions", cases) { c ->
            val text = c.s("text")!!
            val got = Mentions.humanize(text, users, names)
            val bare = Mentions.humanize(text, users)
            if (got == c.s("out") && bare == c.s("bare")) null else "text ${Vectors.show(text)}: web ${c.s("out")} / ${c.s("bare")} kotlin $got / $bare"
        }
    }

    @Test
    fun limits() {
        val inputs = listOf("", "a".repeat(3799), "a".repeat(3800), "a".repeat(4000), "a".repeat(4001), "  " + "a".repeat(4000) + "  ", "😀".repeat(2001))
        val cases = Vectors["limits"].jsonArray.map { it.jsonObject }
        assertEquals(inputs.size, cases.size)
        Vectors.expectAll("charsLeft / counterShown / tooLong / pasteOverflows", inputs.indices.toList()) { k ->
            val text = inputs[k]
            val c = cases[k]
            val ok = text.length == c["len"]!!.jsonPrimitive.int &&
                MessageLimit.charsLeft(text) == c["left"]!!.jsonPrimitive.int &&
                MessageLimit.counterShown(text) == c["shown"]!!.jsonPrimitive.boolean &&
                MessageLimit.tooLong(text) == c["tooLong"]!!.jsonPrimitive.boolean &&
                MessageLimit.pasteOverflows(text, 0, 0, "abc") == c["paste"]!!.jsonPrimitive.boolean
            if (ok) null else "input $k: web $c"
        }
    }

    @Test
    fun inCode() {
        val cases = Vectors["codes"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("inCode", cases) { c ->
            val got = ShortcodeTyping.inCode(c.s("before")!!)
            if (got == c["value"]!!.jsonPrimitive.boolean) null else "before ${Vectors.show(c.s("before")!!)}: web ${c["value"]} kotlin $got"
        }
    }

    @Test
    fun commands() {
        val cases = Vectors["commands"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("runCommand", cases) { c ->
            val r = Commands.run(c.s("text")!!)
            val (kind, out) = when (r) {
                is Commands.Result.Text -> "text" to null
                is Commands.Result.Command -> "command" to r.text
                is Commands.Result.Unknown -> "unknown" to r.name
                is Commands.Result.Empty -> "empty" to r.name
            }
            if (kind == c.s("kind") && out == c.s("out")) null else "text ${Vectors.show(c.s("text")!!)}: web $c kotlin $kind $out"
        }
    }

    @Test
    fun rankPeople() {
        val people = listOf(
            People.Person("1", "alice", "Alice"),
            People.Person("2", "michal", "Michał"),
            People.Person("3", "al_bundy", ""),
            People.Person("4", "xal", "Sal"),
            People.Person("5", "bob", "Bob Al"),
            People.Person("6", "Ålex", ""),
        )
        val recent = People.recentSpeakers(listOf("5", "5", "1", "9", "3"), "9")
        val want = Vectors["recent"].jsonArray.map { it.jsonArray[0].jsonPrimitive.content to it.jsonArray[1].jsonPrimitive.int }
        assertEquals(want, recent.entries.map { it.key to it.value })
        val cases = Vectors["ranks"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("rankPeople", cases) { c ->
            val got = People.rank(c.s("q")!!, people, { it }, { if (it == "4") "Big Al" else "" }, recent, Locale.ENGLISH).map { it.id }
            val ids = c["ids"]!!.jsonArray.map { it.jsonPrimitive.content }
            if (got == ids) null else "q ${c.s("q")}: web $ids kotlin $got"
        }
    }
}
