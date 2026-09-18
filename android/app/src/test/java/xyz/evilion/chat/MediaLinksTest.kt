package xyz.evilion.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import xyz.evilion.chat.media.MediaLinks

/**
 * The rules for what the image loader may fetch: this server's paths and
 * addresses, proxy links read for their deadline, and nobody else's address.
 */
class MediaLinksTest {
    private val base = "https://chat.example.org"
    private val target = "aHR0cHM6Ly9leGFtcGxlLmNvbS9hLnBuZw"

    @Test
    fun `this server's paths and addresses are its own, another site's are not`() {
        assertEquals("/media/emoji/1?size=64", MediaLinks.serverPath("/media/emoji/1?size=64", base))
        assertEquals("/media/avatar/2", MediaLinks.serverPath("https://chat.example.org/media/avatar/2", base))
        assertNull(MediaLinks.serverPath("https://tracker.example/pixel.gif", base))
        assertNull(MediaLinks.serverPath("//tracker.example/pixel.gif", base))
        // same name, another port, is another server
        assertNull(MediaLinks.serverPath("https://chat.example.org:8443/media/avatar/2", base))
    }

    @Test
    fun `a proxy link's deadline is read, and one from before deadlines has none`() {
        assertEquals(1_789_999_999_000L, MediaLinks.deadline("/media/proxy/1789999999-abcdefghijklmnopqrstuv/$target"))
        assertNull(MediaLinks.deadline("/media/proxy/Zm9vYmFyLWJhei1xdXV4MTIz/$target"))
        assertNull(MediaLinks.deadline("/media/emoji/1"))
    }

    @Test
    fun `every signing of one address has the same key`() {
        val a = "/media/proxy/1789999999-abcdefghijklmnopqrstuv/$target"
        val b = "/media/proxy/1790000999-zyxwvutsrqponmlkjihgfe/$target"
        val legacy = "/media/proxy/Zm9vYmFyLWJhei1xdXV4MTIz/$target"
        assertEquals(MediaLinks.key(a), MediaLinks.key(b))
        assertEquals(MediaLinks.key(a), MediaLinks.key(legacy))
        assertEquals(target, MediaLinks.key(a))
    }
}
