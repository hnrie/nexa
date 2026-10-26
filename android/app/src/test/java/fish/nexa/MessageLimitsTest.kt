package fish.nexa

import fish.nexa.crypto.MessageCrypto
import fish.nexa.data.Uploads
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** What a message may hold: the same cases as the web's crypto/message.test.ts, "what a message may hold". */
class MessageLimitsTest {
    private fun broken(json: String): String? = MessageCrypto.brokenLimit(Json.parseToJsonElement(json) as JsonObject)
    private fun file(name: String = "a.png") = """{"blob_id":"9","name":"$name","type":"image/png","size":10,"key":"${"k".repeat(44)}"}"""
    private fun card(extra: String = "") = """{"url":"https://example.com/","title":"t"$extra}"""

    @Test fun textUpToTheComposersLengthWithMentionsCountedAsTyped() {
        assertNull(broken("""{"t":"${"x".repeat(4000)}"}"""))
        assertEquals("text", broken("""{"t":"${"x".repeat(4001)}"}"""))
        assertNull(broken("""{"t":"${"<@123456789012345678>".repeat(1000)}${"x".repeat(1000)}"}"""))
        assertEquals(8, MessageCrypto.typedLength("hi <:wave:123456789012345678> <@&42>"))
        assertEquals("text", broken("""{"t":42}"""))
    }

    @Test fun filesAndTheirNames() {
        assertNull(broken("""{"att":[${List(10) { file() }.joinToString(",")}]}"""))
        assertEquals("files", broken("""{"att":[${List(11) { file() }.joinToString(",")}]}"""))
        assertEquals("file", broken("""{"att":[${file()},{"blob_id":5}]}"""))
        assertEquals("file", broken("""{"att":[${file("n".repeat(256))}]}"""))
    }

    @Test fun previewsStickersAndPolls() {
        assertNull(broken("""{"embeds":[${List(5) { card() }.joinToString(",")}]}"""))
        assertEquals("embeds", broken("""{"embeds":[${List(6) { card() }.joinToString(",")}]}"""))
        assertEquals("embed", broken("""{"embeds":[${card(""","description":"${"d".repeat(2049)}"""")}]}"""))
        assertEquals("embed", broken("""{"embeds":[{"url":"javascript:alert(1)"}]}"""))
        assertEquals("sticker", broken("""{"sticker":{"id":"1","name":"${"s".repeat(31)}"}}"""))
        assertEquals("poll", broken("""{"poll":{"question":"${"q".repeat(301)}","answers":[{"text":"a"},{"text":"b"}]}}"""))
    }

    @Test fun aLongNameKeepsItsExtension() {
        val fitted = Uploads.fitName("é".repeat(300) + ".png")
        assertEquals(255, fitted.codePointCount(0, fitted.length))
        assertEquals(true, fitted.endsWith(".png"))
        assertEquals("short.txt", Uploads.fitName("short.txt"))
    }
}
