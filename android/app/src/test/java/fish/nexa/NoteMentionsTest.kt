package fish.nexa

import fish.nexa.net.PublicUser
import fish.nexa.notes.NoteMentions
import org.junit.Assert.assertEquals
import org.junit.Test

/** The same cases as web/src/lib/notes/mentions.test.ts. */
class NoteMentionsTest {
    private fun user(id: String, username: String, display: String) = PublicUser(id, username, display)

    private val people = listOf(user("1", "alice", "Alice Lind"), user("2", "bob", "Bob"), user("3", "mika_k", "Mika"), user("4", "zoe", "Zoë Calice"))

    private fun ids(q: String, max: Int = NoteMentions.MAX) = NoteMentions.matches(people, q, max).map { it.id }

    @Test fun everyoneAlphabeticallyBeforeAnythingIsTyped() = assertEquals(listOf("1", "2", "3", "4"), ids(""))

    @Test fun startsThenWordsThenContains() {
        assertEquals(listOf("1", "4"), ids("li"))
        assertEquals(listOf("1"), ids("lin"))
        assertEquals(listOf("4"), ids("cal"))
        assertEquals(listOf("3"), ids("k"))
    }

    @Test fun usernamesAndCase() {
        assertEquals(listOf("3"), ids("MIKA_"))
        assertEquals(listOf("2"), ids("BO"))
    }

    @Test fun nobodyAndMax() {
        assertEquals(emptyList<String>(), ids("xyz"))
        assertEquals(2, ids("", 2).size)
    }

    @Test fun mentionedOnceEach() =
        assertEquals(listOf("12", "34"), NoteMentions.mentionedIds("hi <@12> and <@!34>, also <@12> but not <@&56> or <#78>"))
}
