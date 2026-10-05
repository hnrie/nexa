package fish.nexa.automod

import fish.nexa.data.AutomodMatch
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * AutoMod's matching against the cases the server and the web app answer
 * (internal/automod/testdata/vectors.json, read from the repository itself so
 * the three can never drift apart).
 */
class AutomodMatchTest {
    private fun vectors(): JSONArray {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val f = File(dir, "internal/automod/testdata/vectors.json")
            if (f.exists()) return JSONArray(f.readText())
            dir = dir.parentFile
        }
        error("internal/automod/testdata/vectors.json not found above ${File("").absolutePath}")
    }

    private fun strings(a: JSONArray) = List(a.length()) { a.getString(it) }

    @Test
    fun sharedVectors() {
        val cases = vectors()
        for (i in 0 until cases.length()) {
            val v = cases.getJSONObject(i)
            val m = AutomodMatch.Matcher(strings(v.getJSONArray("words")), strings(v.getJSONArray("regex")), strings(v.getJSONArray("allow")), v.getBoolean("evasion"))
            val want = if (v.isNull("match")) null else v.getString("match")
            assertEquals(v.getString("name"), want, m.match(v.getString("text")))
        }
    }

    @Test
    fun foldsDisguisesAway() {
        assertEquals("hello world", AutomodMatch.fold("Ｈéllo Wörld"))
        assertEquals("fuck this", AutomodMatch.fold("f.u.c.k this"))
    }
}
