package fish.nexa

import fish.nexa.net.Message
import fish.nexa.net.wireJson
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A reply's original as the server sends it along (`referenced_message`):
 * absent when the server said nothing, null once the original is deleted,
 * the message itself otherwise. The three must stay apart, or a reply to a
 * message nobody sent along would read as deleted.
 */
class ReferencedMessageTest {
    private fun decode(json: String) = wireJson.decodeFromString(Message.serializer(), json)

    @Test
    fun absentIsNotSaid() {
        val m = decode("""{"id":"2","channel_id":"1","reply_to_id":"1"}""")
        assertEquals(Message.NOT_SAID, m.referenced)
    }

    @Test
    fun nullIsDeleted() {
        val m = decode("""{"id":"2","channel_id":"1","reply_to_id":"1","referenced_message":null}""")
        assertNull(m.referenced)
    }

    @Test
    fun objectIsTheOriginal() {
        val m = decode("""{"id":"2","channel_id":"1","reply_to_id":"3","referenced_message":{"id":"3","channel_id":"1","author_id":"9"}}""")
        val ref = m.referenced
        assertTrue(ref is JsonObject)
        val orig = wireJson.decodeFromJsonElement(Message.serializer(), ref!!)
        assertEquals("3", orig.id)
        assertEquals("9", orig.authorId)
        // the original itself said nothing about one of its own
        assertEquals(Message.NOT_SAID, orig.referenced)
    }
}
