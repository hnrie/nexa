package xyz.evilion.chat

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import xyz.evilion.chat.crypto.Aad
import xyz.evilion.chat.crypto.Bytes
import xyz.evilion.chat.crypto.Conv
import xyz.evilion.chat.crypto.Envelope
import xyz.evilion.chat.crypto.FileCrypto
import xyz.evilion.chat.crypto.Kdf
import xyz.evilion.chat.crypto.Keys
import xyz.evilion.chat.crypto.MessageCrypto
import xyz.evilion.chat.crypto.MessagePayload
import xyz.evilion.chat.data.InviteLink
import xyz.evilion.chat.data.Mentions
import xyz.evilion.chat.net.PublicUser
import xyz.evilion.chat.ui.markdown.Markdown
import xyz.evilion.chat.ui.markdown.Node
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/**
 * The values in here came out of the web client (web/src/crypto), so these
 * tests say the two speak the same encryption, not just that this one is
 * consistent with itself. A message written in a browser has to open here.
 */
class CryptoTest {
    private val master = Bytes.unb64("AQgPFh0kKzI5QEdOVVxjanF4f4aNlJuiqbC3vsXM09o=")
    private val root = Bytes.unb64("BQwTGiEoLzY9REtSWWBnbnV8g4qRmJ+mrbS7wsnQ194=")
    private val identityPriv = Bytes.unb64("CRAXHiUsMzpBSE9WXWRrcnmAh46VnKOqsbi/xs3U2+I=")
    private val identityPub = Bytes.unb64("cy7fq5I66k0o8YehEg1rHNCyrLM3Y+RQ1915E+EiYE0=")

    @Test
    fun `derives the same keys as the web client`() {
        assertEquals("xGjfFDfDO+c/ap4FLdWIBP5peEzu54TcIXAEdKHH11U=", Bytes.b64(Kdf.authKey(master)))
        assertEquals("pwWNf4CLwC2J3yPNihC4SVjS/VcTRwZOXV0ikfc+qm4=", Bytes.b64(Kdf.encKey(master)))
        assertEquals("7nhhlY8bXZRZriYfhVvfMP8hcC30fC9kbQswTHFI7Aw=", Bytes.b64(Kdf.settingsKey(identityPriv)))
    }

    @Test
    fun `derives the same conversation keys`() {
        assertEquals("ZTrTcbgCEIXoTOE21UVZT48/PGrhth1Hlwx5y8fjxlU=", Bytes.b64(Conv.channelKey(root, "12345")))
        assertEquals("6tq9QfaRgas30EYbQFcLyh5ghl1rALSsj3a+LoggtnM=", Bytes.b64(Conv.voiceFrameKey(root, "12345")))
    }

    @Test
    fun `x25519 public keys match, and a sealed box from the web opens`() {
        assertArrayEquals(identityPub, Keys.publicKeyOf(identityPriv))
        val sealed = Bytes.unb64(
            "7AREsLeZ28maOB44DMRGmL4FqjWF7Stb5tcYnFeGykPGeTMovQ2wRFoXhzlR3C1D/hG2Jz7cZEcqNPf4HrR27XcxStmMRtXvdfPPEt1TGVfNLjUWlRYrwd4Ga/M=",
        )
        assertArrayEquals(root, Keys.open(identityPriv, identityPub, sealed))
    }

    @Test
    fun `a message written in the browser decrypts here`() {
        val envelope = Envelope(v = 1, conv = "99", epoch = 3, iv = "sfQ4rdKCb12exSg0", ct = "ElnO9SOx+iT0xF8WIMobik4QOSBPLUAtp61Ny+O52bfTFqEkldnD")
        val payload = MessageCrypto.decrypt(
            Conv.channelKey(root, "12345"), envelope, Aad("99", 3, "12345", "777"),
        )
        assertEquals("hello **world**", payload.text)
    }

    @Test
    fun `a message sealed here opens with the same key`() {
        val key = Conv.channelKey(root, "12345")
        val aad = Aad("99", 4, "12345", "777")
        val envelope = MessageCrypto.encrypt(key, aad, MessagePayload(text = "round trip"))
        assertEquals("round trip", MessageCrypto.decrypt(key, envelope, aad).text)
        // the channel and author are bound in: another channel's key must not open it
        var failed = false
        try {
            MessageCrypto.decrypt(key, envelope, Aad("99", 4, "99999", "777"))
        } catch (_: Exception) {
            failed = true
        }
        assertTrue("a message must not open under another channel", failed)
    }

    @Test
    fun `a file encrypted by the browser decrypts here`() {
        val key = Bytes.unb64("ZGe/hRVH3fNzJPJjEfVpFE4XHOKVuzqJqDf/lbBJMn4=")
        val bytes = Bytes.unb64("RUNGMbLXhQFy0jIPAAAAFZ4PZdyMT6dGaypU9CwDcETMTOHfww==")
        val out = ByteArrayOutputStream()
        FileCrypto.decryptStream(ByteArrayInputStream(bytes), key, out)
        assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5), out.toByteArray())
    }

    @Test
    fun `files round-trip through the chunked format`() {
        val plain = ByteArray(9_000) { (it % 251).toByte() }
        val (key, sealed) = FileCrypto.encryptBytes(plain)
        assertEquals(FileCrypto.encryptedSize(plain.size.toLong()), sealed.size.toLong())
        val out = ByteArrayOutputStream()
        FileCrypto.decryptStream(ByteArrayInputStream(sealed), key, out)
        assertArrayEquals(plain, out.toByteArray())
    }

    @Test
    fun `the recovery key survives being written down`() {
        val (bytes, display) = Kdf.newRecoveryKey()
        assertEquals(8, display.split("-").size)
        assertArrayEquals(bytes, Kdf.recoveryKeyToBytes(display.lowercase().replace("-", " ")))
    }
}

class MarkdownTest {
    @Test
    fun `reads Discord's emphasis`() {
        val nodes = Markdown.parseInline("**bold** *italic* __under__ ~~strike~~ ||secret||")
        val styles = nodes.filterIsInstance<Node.Styled>().map { it.style }
        assertEquals(
            listOf(
                xyz.evilion.chat.ui.markdown.Style.STRONG,
                xyz.evilion.chat.ui.markdown.Style.EM,
                xyz.evilion.chat.ui.markdown.Style.UNDERLINE,
                xyz.evilion.chat.ui.markdown.Style.STRIKE,
                xyz.evilion.chat.ui.markdown.Style.SPOILER,
            ),
            styles,
        )
    }

    @Test
    fun `reads mentions, custom emoji and timestamps`() {
        val nodes = Markdown.parseInline("hi <@123> in <#456> <:wave:789> <t:1700000000:R>")
        assertTrue(nodes.any { it is Node.Mention && it.kind == xyz.evilion.chat.ui.markdown.MentionKind.USER && it.id == "123" })
        assertTrue(nodes.any { it is Node.Mention && it.kind == xyz.evilion.chat.ui.markdown.MentionKind.CHANNEL && it.id == "456" })
        assertTrue(nodes.any { it is Node.CustomEmoji && it.id == "789" && it.name == "wave" })
        assertTrue(nodes.any { it is Node.Timestamp && it.unix == 1_700_000_000L })
    }

    @Test
    fun `keeps code fences whole`() {
        val blocks = Markdown.parse("before\n```kotlin\nval x = **not bold**\n```\nafter")
        val code = blocks.filterIsInstance<Node.CodeBlock>().single()
        assertEquals("kotlin", code.lang)
        assertEquals("val x = **not bold**", code.text)
    }

    @Test
    fun `counts a message that is only emoji`() {
        assertEquals(2, Markdown.onlyEmoji(Markdown.parse("😀 <:wave:789>")))
        assertEquals(0, Markdown.onlyEmoji(Markdown.parse("hi 😀")))
    }
}

class LinksAndMentionsTest {
    @Test
    fun `an invite link carries its key`() {
        val key = xyz.evilion.chat.data.InviteKey(3, ByteArray(32) { (it * 3).toByte() })
        val url = InviteLink.url("https://chat.evilion.xyz", "AbCd1234", key)
        val (code, parsed) = InviteLink.parse(url)
        assertEquals("AbCd1234", code)
        assertNotNull(parsed)
        assertEquals(3, parsed!!.epoch)
        assertArrayEquals(key.root, parsed.root)
    }

    @Test
    fun `a bare code is an invite too`() {
        val (code, key) = InviteLink.parse("  AbCd1234 ")
        assertEquals("AbCd1234", code)
        assertNull(key)
    }

    @Test
    fun `usernames become mentions, except in code and links`() {
        val users = listOf(
            PublicUser(id = "1", username = "alice", displayName = "Alice"),
            PublicUser(id = "2", username = "bob", displayName = "Bob"),
        )
        val result = Mentions.extract("hey @alice and `@bob` see https://youtube.com/@bob", users)
        assertEquals("hey <@1> and `@bob` see https://youtube.com/@bob", result.text)
        assertEquals(listOf("1"), result.mentions)
        assertTrue(!result.everyone)
    }

    @Test
    fun `everyone is noticed but not turned into an id`() {
        val result = Mentions.extract("@everyone look", emptyList())
        assertEquals("@everyone look", result.text)
        assertTrue(result.everyone)
    }
}
