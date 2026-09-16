package xyz.evilion.chat.media

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import xyz.evilion.chat.net.Api

/**
 * Twemoji file names, the same rule the web client follows
 * (web/src/lib/twemoji.ts): the code points in lower-case hex joined by
 * dashes, with the variation selector dropped unless the sequence is joined
 * with a zero-width joiner.
 *
 * Every emoji in the app is drawn with the same artwork the browser draws, so
 * a message looks the same wherever it is read, and a phone whose own emoji
 * font is older than the message still shows the right picture rather than a
 * box. The pictures come from this instance, which is where everything else
 * comes from, and Coil keeps them on disk after the first look.
 */
object Twemoji {
    private const val ZWJ = '‍'
    private const val VARIATION = '️'

    /** What the set actually holds, once the list has arrived. Null means not yet. */
    @Volatile
    private var available: Set<String>? = null

    @Volatile
    private var tried = false

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** The code point sequence Twemoji names a file after, or null. */
    fun code(text: String): String? {
        if (text.isEmpty()) return null
        val zwj = text.indexOf(ZWJ) >= 0
        val parts = ArrayList<String>(4)
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            i += Character.charCount(cp)
            if (!zwj && cp == VARIATION.code) continue
            parts.add(cp.toString(16))
        }
        return if (parts.isEmpty()) null else parts.joinToString("-")
    }

    /**
     * Where the picture for this emoji is, or null when the set has none.
     *
     * Until the list of what exists has arrived, a picture is asked for anyway:
     * a missing one simply fails and the glyph takes over, which is better than
     * showing no emoji at all while the list is on its way.
     */
    fun url(text: String): String? {
        val code = code(text) ?: return null
        val have = available
        if (have != null && code !in have) {
            // Twemoji has no sequence for it; the shortest run of it may still exist
            val base = code.substringBefore('-')
            if (base !in have) return null
            return Api.url("/twemoji/$base.svg").toString()
        }
        return Api.url("/twemoji/$code.svg").toString()
    }

    /**
     * Fetches the list of artwork this instance ships. Twemoji trails Unicode,
     * so without it the app asks for pictures that were never drawn.
     */
    fun ensureIndex() {
        if (tried) return
        tried = true
        scope.launch {
            val names = runCatching {
                val raw = Api.requestRaw("GET", "/twemoji/available.json")
                Api.json.decodeFromString(ListSerializer(String.serializer()), raw)
            }.getOrNull() ?: return@launch
            available = names.toHashSet()
        }
    }

    /** Forgets the list, for when the app is pointed at another instance. */
    fun reset() {
        available = null
        tried = false
    }
}
