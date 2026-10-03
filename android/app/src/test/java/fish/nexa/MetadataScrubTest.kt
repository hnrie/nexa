package fish.nexa

import fish.nexa.data.MetadataScrub
import org.json.JSONArray
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Base64

/**
 * The scrubber against the server's test files (internal/media/testdata/scrub:
 * each file and, where something comes out, its .clean copy) and against what
 * the web's own scrubber makes of damaged copies of them.
 */
class MetadataScrubTest {
    private fun resource(name: String): ByteArray = javaClass.classLoader!!.getResourceAsStream(name)!!.readBytes()

    private val files = listOf(
        "apng-text.png", "gif-comment.gif", "heic-exif.heic", "jpeg-exif-be.jpg", "jpeg-exif-le.jpg", "jpeg-plain.jpg",
        "jpeg-upright.jpg", "mov-meta.mov", "mp4-meta.mp4", "png-text.png", "webp-anim.webp", "webp-still.webp",
    )

    @Test
    fun serverTestFiles() {
        for (name in files) {
            val input = resource("scrub/$name")
            val dot = name.lastIndexOf('.')
            val cleanName = name.substring(0, dot) + ".clean" + name.substring(dot)
            val expected = javaClass.classLoader!!.getResourceAsStream("scrub/$cleanName")?.readBytes()
            val out = MetadataScrub.scrubBytes(input)
            if (expected == null) assertNull("$name should be left as it is", out)
            else assertArrayEquals("$name cleaned as the server cleans it", expected, out ?: input)
        }
    }

    @Test
    fun webVectors() {
        val cases = JSONArray(String(resource("web-scrub-vectors.json")))
        val dec = Base64.getDecoder()
        var changed = 0
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val input = dec.decode(c.getString("input"))
            val want = if (c.isNull("output")) null else dec.decode(c.getString("output"))
            val got = MetadataScrub.scrubBytes(input)
            if (want == null) assertNull(c.getString("name"), got)
            else {
                changed++
                assertArrayEquals(c.getString("name"), want, got)
            }
        }
        assertEquals(224, changed)
    }
}
