package fish.nexa.ui.markdown

/**
 * The web's RE_UNICODE_EMOJI, matched by hand at one index of a line:
 *
 * ```
 * \p{RI}\p{RI} | [0-9#*]\u{FE0F}?\u{20E3}
 * | ( (?=\p{Extended_Pictographic})\p{Emoji_Presentation}(\u{FE0F}|\p{Emoji_Modifier})?
 *   | \p{Extended_Pictographic}(\u{FE0F}\p{Emoji_Modifier}?|\p{Emoji_Modifier}|(?=\u{200D}\p{Extended_Pictographic})) )
 *   (\u{200D}\p{Extended_Pictographic}(\u{FE0F}|\p{Emoji_Modifier})?)*
 * ```
 *
 * A symbol that is text by default (©, ™, ↔) is only an emoji when it asks to
 * be one, with U+FE0F or a skin tone, or when a joiner makes it part of a
 * sequence, so "Nexa™" keeps its trademark sign.
 */
internal object EmojiMatch {
    private const val FE0F = 0xFE0F
    private const val ZWJ = 0x200D
    private const val KEYCAP = 0x20E3

    fun isRegionalIndicator(cp: Int) = UnicodeTables.has(UnicodeTables.REGIONAL_INDICATOR, cp)
    fun isPictographic(cp: Int) = UnicodeTables.has(UnicodeTables.EXTENDED_PICTOGRAPHIC, cp)
    fun isPresentation(cp: Int) = UnicodeTables.has(UnicodeTables.EMOJI_PRESENTATION, cp)
    fun isModifier(cp: Int) = UnicodeTables.has(UnicodeTables.EMOJI_MODIFIER, cp)

    private fun cp(s: String, i: Int): Int = if (i < s.length) s.codePointAt(i) else -1

    private fun width(cp: Int) = Character.charCount(cp)

    /** How many UTF-16 units the emoji starting at `i` takes, 0 when none does. */
    fun at(s: String, i: Int): Int {
        if (i >= s.length) return 0
        val first = s.codePointAt(i)
        val j = i + width(first)
        // a flag: two regional indicators
        if (isRegionalIndicator(first)) {
            val second = cp(s, j)
            if (second >= 0 && isRegionalIndicator(second)) return j + width(second) - i
        }
        // a keycap
        if (first in '0'.code..'9'.code || first == '#'.code || first == '*'.code) {
            if (cp(s, j) == FE0F && cp(s, j + 1) == KEYCAP) return j + 2 - i
            if (cp(s, j) == KEYCAP) return j + 1 - i
        }
        if (!isPictographic(first)) return 0
        var end: Int
        if (isPresentation(first)) {
            end = j
            val next = cp(s, end)
            if (next == FE0F || (next >= 0 && isModifier(next))) end += width(next)
        } else {
            val next = cp(s, j)
            if (next == FE0F) {
                end = j + 1
                val tone = cp(s, end)
                if (tone >= 0 && isModifier(tone)) end += width(tone)
            } else if (next >= 0 && isModifier(next)) {
                end = j + width(next)
            } else if (next == ZWJ && cp(s, j + 1).let { it >= 0 && isPictographic(it) }) {
                end = j
            } else {
                return 0
            }
        }
        // joined parts
        while (cp(s, end) == ZWJ) {
            val part = cp(s, end + 1)
            if (part < 0 || !isPictographic(part)) break
            end += 1 + width(part)
            val after = cp(s, end)
            if (after == FE0F || (after >= 0 && isModifier(after))) end += width(after)
        }
        return end - i
    }
}

/**
 * Twemoji's file names for an emoji (lib/twemoji.ts): the code points in
 * lower-case hex joined by dashes, the variation selector dropped unless the
 * sequence is joined, and for a joined sequence two more spellings to try (no
 * selectors at all, and a selector after every part that is text by default),
 * since Twemoji is not consistent about them and senders leave them out.
 */
object TwemojiFiles {
    private const val ZWJ = "‍"
    private const val VS16 = "️"

    /** The code point sequence Twemoji names a file after, or null if there is none. */
    fun code(text: String): String? {
        if (text.isEmpty()) return null
        val source = if (text.contains(ZWJ)) text else text.replace(VS16, "")
        val parts = ArrayList<String>()
        var i = 0
        while (i < source.length) {
            val cp = source.codePointAt(i)
            parts += Integer.toHexString(cp)
            i += Character.charCount(cp)
        }
        return if (parts.isEmpty()) null else parts.joinToString("-")
    }

    /** A joined sequence with U+FE0F after each part that is text by default and has none. */
    private fun spelledOut(text: String): String {
        val chars = ArrayList<Int>()
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            chars += cp
            i += Character.charCount(cp)
        }
        val out = StringBuilder()
        for ((k, cp) in chars.withIndex()) {
            out.appendCodePoint(cp)
            val textByDefault = EmojiMatch.isPictographic(cp) && !EmojiMatch.isPresentation(cp)
            val next = chars.getOrNull(k + 1)
            val asks = next != null && (next == 0xFE0F || EmojiMatch.isModifier(next))
            if (textByDefault && !asks) out.append(VS16)
        }
        return out.toString()
    }

    /** The artwork files an emoji may be drawn from (names without the extension), best first; only `known` ones when given. */
    fun files(text: String, known: Set<String>? = null): List<String> {
        val codes = ArrayList<String>()
        code(text)?.let { codes += it }
        if (text.contains(ZWJ)) {
            for (spelling in listOf(text.replace(VS16, ""), spelledOut(text))) {
                val c = code(spelling)
                if (c != null && c !in codes) codes += c
            }
        }
        return if (known != null) codes.filter { it in known } else codes
    }
}
