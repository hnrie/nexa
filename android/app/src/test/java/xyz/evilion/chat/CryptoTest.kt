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
import xyz.evilion.chat.crypto.Fingerprint
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

    /**
     * The safety number two people read out to each other. It has to be the
     * same thirty digits on a phone and in a browser, or a real pair comparing
     * across platforms would be told they are talking to an impostor. The same
     * expectation is pinned in web/src/crypto/fingerprint.test.ts for this same
     * key; change one and the other fails.
     */
    @Test
    fun `prints the same safety number as the web client`() {
        assertEquals("84234 17400 39277 85751 92324 02841", Fingerprint.of(identityPub))
        // A second vector with no structure to it, in case the first is ever
        // regenerated: the bytes 0..31.
        assertEquals(
            "61271 82505 00669 17367 22914 44410",
            Fingerprint.of(ByteArray(32) { it.toByte() }),
        )
        // The shape the API carries a key in, and the answers for one that is
        // missing or is not a key at all.
        assertEquals("84234 17400 39277 85751 92324 02841", Fingerprint.ofB64(Bytes.b64(identityPub)))
        assertNull(Fingerprint.ofB64(null))
        assertNull(Fingerprint.ofB64(""))
        assertNull(Fingerprint.ofB64(Bytes.b64(ByteArray(16))))
    }

    /**
     * The floor has to be the server's own rule for what a client may register
     * with (validKDF, internal/api/auth_handlers.go), or an account the server
     * accepted could not sign in on a client that refuses its parameters.
     */
    @Test
    fun `refuses argon2id parameters that would give the password away`() {
        assertTrue(Kdf.acceptable(Kdf.DEFAULT))
        assertTrue(Kdf.acceptable(Kdf.FLOOR))
        assertTrue(Kdf.acceptable(Kdf.Params(m = 1 shl 20, t = 20, p = 4)))
        assertEquals(Kdf.Params(m = 32768, t = 2, p = 1), Kdf.FLOOR)
        // Free to compute, so a server that asked for these would get the
        // plaintext password back out of the proof it is handed.
        assertTrue(!Kdf.acceptable(Kdf.Params(m = 8, t = 1, p = 1)))
        assertTrue(!Kdf.acceptable(Kdf.Params(m = 32767, t = 2, p = 1)))
        assertTrue(!Kdf.acceptable(Kdf.Params(m = 65536, t = 1, p = 1)))
        // Heavy enough to wedge a phone, which is the other half of the range.
        assertTrue(!Kdf.acceptable(Kdf.Params(m = 1 shl 22, t = 3, p = 1)))
        assertTrue(!Kdf.acceptable(Kdf.Params(m = 65536, t = 100, p = 1)))
        assertTrue(!Kdf.acceptable(Kdf.Params(m = 65536, t = 3, p = 64)))
        // A params version this build does not know is not guessed at.
        assertTrue(!Kdf.acceptable(Kdf.Params(m = 65536, t = 3, p = 1, v = 2)))
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
    fun `a file that arrives a few bytes at a time still decrypts`() {
        // what a slow download looks like to the decryptor: short reads, which
        // the reading has to loop over rather than take as the end
        val plain = ByteArray(70_000) { (it % 253).toByte() }
        val (key, sealed) = FileCrypto.encryptBytes(plain)
        val trickle = object : java.io.InputStream() {
            var at = 0
            override fun read(): Int = if (at < sealed.size) sealed[at++].toInt() and 0xff else -1
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (at >= sealed.size) return -1
                val n = minOf(len, 3, sealed.size - at)
                sealed.copyInto(b, off, at, at + n)
                at += n
                return n
            }
        }
        val out = ByteArrayOutputStream()
        FileCrypto.decryptStream(trickle, key, out)
        assertArrayEquals(plain, out.toByteArray())
    }

    @Test
    fun `reading up to n bytes stops only at the end`() {
        val data = ByteArrayInputStream(byteArrayOf(1, 2, 3, 4, 5))
        assertArrayEquals(byteArrayOf(1, 2, 3), Bytes.readUpTo(data, 3))
        assertArrayEquals(byteArrayOf(4, 5), Bytes.readUpTo(data, 3))
        assertEquals(0, Bytes.readUpTo(data, 3).size)
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

    /**
     * The renderer draws a code run in monospace on a panel, so a run that
     * quietly swallowed three lines because a stray fence found a later one
     * looked like a torn code block in the middle of a sentence.
     */
    @Test
    fun `an inline code run cannot cross a line`() {
        val blocks = Markdown.parse("a ```js and then\nconst x = 1;\n``` and more")
        val code = blocks.flatMap { (it as? Node.Styled)?.children.orEmpty() }.filterIsInstance<Node.Code>()
        assertTrue("an unclosed run on its own line is literal text", code.isEmpty())
    }

    @Test
    fun `a fence that is never closed still runs to the end`() {
        val code = Markdown.parse("```go\nfmt.Println(1)\nfmt.Println(2)").filterIsInstance<Node.CodeBlock>().single()
        assertEquals("go", code.lang)
        assertEquals("fmt.Println(1)\nfmt.Println(2)", code.text)
    }

    @Test
    fun `a one-line fence is content, not a language`() {
        val code = Markdown.parse("```not a lang```").filterIsInstance<Node.CodeBlock>().single()
        assertEquals(null, code.lang)
        assertEquals("not a lang", code.text)
    }

    @Test
    fun `what follows a closing fence is read as blocks again`() {
        val blocks = Markdown.parse("```\nx\n```\n# after")
        assertEquals("x", blocks.filterIsInstance<Node.CodeBlock>().single().text)
        assertEquals(1, blocks.filterIsInstance<Node.Heading>().single().level)
    }

    /** The chip's padding is drawn; it used to be spaces inside the text. */
    @Test
    fun `inline code keeps what is between the backticks`() {
        val code = Markdown.parseInline("say `  x  ` now").filterIsInstance<Node.Code>().single()
        assertEquals("  x  ", code.text)
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
