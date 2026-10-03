package fish.nexa.search

import java.text.Normalizer
import java.util.Locale

/**
 * How search reads text (web/src/search/text.ts).
 *
 * Text is folded before it is compared, so that what someone types finds what
 * was written however either was spelled: case does not matter, nor do the
 * accents of Latin, Greek and Cyrillic letters ("cafe" finds "café"), nor the
 * vowel marks of Arabic, nor full-width or ligature forms. Marks that are part
 * of a letter elsewhere stay: a Devanagari vowel sign or a Japanese voicing
 * mark changes the word, so dropping it would match the wrong one.
 *
 * Folded text is then cut into the words the index is keyed by. Chinese and
 * Japanese are written without spaces, so their runs are cut into characters
 * and pairs of characters instead of words.
 *
 * Positions are UTF-16 units throughout, as JavaScript counts them, so a
 * match found here lands where the web's would.
 */
object SearchText {
    private fun isPlainAscii(s: String): Boolean {
        for (ch in s) if (ch.code > 0x7f) return false
        return true
    }

    fun isMark(cp: Int): Boolean = when (Character.getType(cp)) {
        Character.NON_SPACING_MARK.toInt(), Character.COMBINING_SPACING_MARK.toInt(), Character.ENCLOSING_MARK.toInt() -> true
        else -> false
    }

    private fun isNumber(cp: Int): Boolean = when (Character.getType(cp)) {
        Character.DECIMAL_DIGIT_NUMBER.toInt(), Character.LETTER_NUMBER.toInt(), Character.OTHER_NUMBER.toInt() -> true
        else -> false
    }

    /** `[\p{L}\p{N}\p{M}]`: what words are made of. */
    private fun isWordPart(cp: Int): Boolean = Character.isLetter(cp) || isNumber(cp) || isMark(cp)

    private fun script(cp: Int): Character.UnicodeScript = try {
        Character.UnicodeScript.of(cp)
    } catch (_: IllegalArgumentException) {
        Character.UnicodeScript.UNKNOWN
    }

    /** Scripts whose combining accents are decoration a search should see through. */
    private fun accentedScript(cp: Int): Boolean = when (script(cp)) {
        Character.UnicodeScript.LATIN, Character.UnicodeScript.GREEK, Character.UnicodeScript.CYRILLIC -> true
        else -> false
    }

    /** Chinese characters and Japanese kana, which are written without spaces. */
    private fun isCjk(cp: Int): Boolean = when (script(cp)) {
        Character.UnicodeScript.HAN, Character.UnicodeScript.HIRAGANA, Character.UnicodeScript.KATAKANA -> true
        else -> false
    }

    /** Arabic vowel marks, the superscript alef and the tatweel stretch. */
    private fun isArabicMark(cp: Int): Boolean = cp in 0x064B..0x065F || cp == 0x0670 || cp == 0x0640

    /** `(\p{Script=Latin|Greek|Cyrillic})\p{M}+` → the letter alone. */
    private fun dropAccents(s: String): String {
        val out = StringBuilder(s.length)
        var afterAccented = false
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            if (isMark(cp)) {
                if (!afterAccented) out.appendCodePoint(cp)
            } else {
                out.appendCodePoint(cp)
                afterAccented = accentedScript(cp)
            }
            i += Character.charCount(cp)
        }
        return out.toString()
    }

    private fun dropArabicMarks(s: String): String {
        var any = false
        for (ch in s) if (isArabicMark(ch.code)) { any = true; break }
        if (!any) return s
        val out = StringBuilder(s.length)
        for (ch in s) if (!isArabicMark(ch.code)) out.append(ch)
        return out.toString()
    }

    /** Folds text for comparison: `fold(a).contains(fold(b))` is how search asks whether a contains b. */
    fun fold(text: String): String {
        if (isPlainAscii(text)) return text.lowercase(Locale.ROOT)
        var s = Normalizer.normalize(text, Normalizer.Form.NFC).lowercase(Locale.ROOT)
        s = Normalizer.normalize(s, Normalizer.Form.NFKD)
        s = dropArabicMarks(dropAccents(s))
        s = Normalizer.normalize(s, Normalizer.Form.NFC)
        return s.replace('ς', 'σ').replace("ß", "ss")
    }

    /**
     * Text as it will be shown (NFC), folded, and for each UTF-16 unit of the
     * folded text where the character it came from starts in the shown text
     * (one extra entry holds the shown text's length).
     */
    class Folded(val shown: String, val folded: String, val map: IntArray)

    /** Folds text and remembers where every folded character came from, so a match is marked where it was written. */
    fun foldWithMap(text: String): Folded {
        val shown = Normalizer.normalize(text, Normalizer.Form.NFC)
        if (isPlainAscii(shown)) return Folded(shown, shown.lowercase(Locale.ROOT), IntArray(shown.length + 1) { it })
        val folded = StringBuilder()
        val map = IntList()
        // `\P{M}\p{M}*|\p{M}+`: one character as a reader sees it
        var i = 0
        while (i < shown.length) {
            val start = i
            val first = shown.codePointAt(i)
            i += Character.charCount(first)
            while (i < shown.length) {
                val cp = shown.codePointAt(i)
                if (!isMark(cp)) break
                i += Character.charCount(cp)
            }
            val piece = fold(shown.substring(start, i))
            repeat(piece.length) { map.add(start) }
            folded.append(piece)
        }
        map.add(shown.length)
        return Folded(shown, folded.toString(), map.toArray())
    }

    /** A word the index is keyed by, and whether it may be matched by its beginning (false for CJK characters and pairs). */
    data class Token(val text: String, val prefix: Boolean)

    private class Run(val text: String, val cjk: Boolean)

    /** Splits a word into its runs of CJK and of everything else. */
    private fun runs(word: String): List<Run> {
        val out = ArrayList<Run>(2)
        var start = 0
        var cjk: Boolean? = null
        var i = 0
        while (i < word.length) {
            val cp = word.codePointAt(i)
            val isC = isCjk(cp)
            if (cjk != null && isC != cjk) {
                out += Run(word.substring(start, i), cjk)
                start = i
            }
            cjk = isC
            i += Character.charCount(cp)
        }
        if (cjk != null && start < word.length) out += Run(word.substring(start), cjk)
        return out
    }

    /** `[\p{L}\p{N}\p{M}]+`, in order. */
    private fun words(s: String): List<String> {
        val out = ArrayList<String>()
        var i = 0
        var start = -1
        while (i < s.length) {
            val cp = s.codePointAt(i)
            if (isWordPart(cp)) {
                if (start < 0) start = i
            } else if (start >= 0) {
                out += s.substring(start, i)
                start = -1
            }
            i += Character.charCount(cp)
        }
        if (start >= 0) out += s.substring(start)
        return out
    }

    private fun codePoints(s: String): List<String> {
        val out = ArrayList<String>(s.length)
        var i = 0
        while (i < s.length) {
            val n = Character.charCount(s.codePointAt(i))
            out += s.substring(i, i + n)
            i += n
        }
        return out
    }

    /** `^ال(?=\p{Script=Arabic}{2,})`: the Arabic definite article, written joined to its word. */
    private fun withoutArabicThe(word: String): String {
        if (!word.startsWith("ال")) return word
        var n = 0
        var i = 2
        while (i < word.length && n < 2) {
            val cp = word.codePointAt(i)
            if (script(cp) != Character.UnicodeScript.ARABIC) break
            n++
            i += Character.charCount(cp)
        }
        return if (n >= 2) word.substring(2) else word
    }

    /** The tokens of folded text, in order, repeats included (a word said twice counts twice). */
    fun tokenize(folded: String): List<Token> {
        val out = ArrayList<Token>()
        for (w in words(folded)) {
            for (run in runs(w)) {
                if (!run.cjk) {
                    out += Token(run.text, true)
                    // "الكتاب" (the book) is found by "كتاب" (book), as a reader expects
                    val bare = withoutArabicThe(run.text)
                    if (bare != run.text) out += Token(bare, true)
                    continue
                }
                val chars = codePoints(run.text)
                if (chars.size == 1) {
                    out += Token(chars[0], false)
                    continue
                }
                for (i in chars.indices) {
                    out += Token(chars[i], false)
                    if (i + 1 < chars.size) out += Token(chars[i] + chars[i + 1], false)
                }
            }
        }
        return out
    }

    /**
     * What a search term needs from the index: a word asks for any token that
     * starts with it; a CJK run of two or more characters asks for each of its
     * pairs, and one character for itself.
     */
    fun termTokens(folded: String): List<Token> {
        val out = ArrayList<Token>()
        for (w in words(folded)) {
            for (run in runs(w)) {
                if (!run.cjk) {
                    out += Token(run.text, true)
                    continue
                }
                val chars = codePoints(run.text)
                if (chars.size == 1) out += Token(chars[0], false)
                for (i in 0 until chars.size - 1) out += Token(chars[i] + chars[i + 1], false)
            }
        }
        return out
    }

    /**
     * A long message cut down to the part around its first match, so the match
     * is on screen in a result that shows a few lines. Short text, or text
     * whose match is near its start, comes back whole.
     */
    fun excerptAround(text: String, needles: List<String>, max: Int = 280): String {
        if (text.length <= max) return text
        val f = foldWithMap(text)
        val shown = f.shown
        var first = -1
        for (n in needles) {
            if (n.isEmpty()) continue
            val at = f.folded.indexOf(n)
            if (at >= 0 && (first < 0 || at < first)) first = at
        }
        val hit = if (first < 0) 0 else f.map[first]
        // a little of what comes before, starting at a word
        var start = maxOf(0, hit - max / 4)
        if (start > 0) {
            val space = shown.lastIndexOf(" ", start + 12)
            if (space > start - 24 && space < hit) start = space + 1
        }
        val end = minOf(shown.length, start + max)
        return (if (start > 0) "…" else "") + Js.trim(shown.substring(start, end)) + (if (end < shown.length) "…" else "")
    }

    /** A run of text, and whether it is part of a match. */
    data class Piece(val text: String, val hit: Boolean)

    /**
     * Splits text into highlighted and plain runs for every place a needle
     * occurs. Matching is on the folded text and marking on the text as
     * written, so an accent or a capital never stops a match from showing.
     */
    fun highlightRuns(text: String, needles: List<String>): List<Piece> {
        val wanted = LinkedHashSet(needles.filter { it.isNotEmpty() }).toList()
        val f = foldWithMap(text)
        val shown = f.shown
        if (wanted.isEmpty() || shown.isEmpty()) return if (shown.isNotEmpty()) listOf(Piece(shown, false)) else emptyList()
        val spans = ArrayList<IntArray>()
        for (n in wanted) {
            var at = f.folded.indexOf(n)
            while (at >= 0) {
                spans += intArrayOf(at, at + n.length)
                at = f.folded.indexOf(n, at + maxOf(1, n.length))
            }
        }
        if (spans.isEmpty()) return listOf(Piece(shown, false))
        spans.sortWith { a, b -> if (a[0] != b[0]) a[0] - b[0] else b[1] - a[1] }
        // overlapping and touching matches ("need" and "needle") read as one
        val merged = ArrayList<IntArray>()
        for (s in spans) {
            val last = merged.lastOrNull()
            if (last != null && s[0] <= last[1]) last[1] = maxOf(last[1], s[1]) else merged += intArrayOf(s[0], s[1])
        }
        val map = f.map
        val out = ArrayList<Piece>()
        var pos = 0
        for (m in merged) {
            val from = m[0]
            val to = m[1]
            val start = map[from]
            // a match ends where the next written character starts, so one that
            // ends halfway through a character's folding still marks all of it
            val last = map[to - 1]
            var k = to
            while (k < map.size - 1 && map[k] <= last) k++
            val end = map[k]
            if (start < pos) continue
            if (start > pos) out += Piece(shown.substring(pos, start), false)
            if (end > start) out += Piece(shown.substring(start, end), true)
            pos = maxOf(pos, end)
        }
        if (pos < shown.length) out += Piece(shown.substring(pos), false)
        return out
    }
}

/** JavaScript's own reading of whitespace and trimming, which search's syntax is defined by. */
object Js {
    /** `\s` in a JavaScript regular expression. */
    fun isSpace(c: Char): Boolean = when (c) {
        '\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
        else -> c in ' '..' '
    }

    fun trim(s: String): String {
        var a = 0
        var b = s.length
        while (a < b && isSpace(s[a])) a++
        while (b > a && isSpace(s[b - 1])) b--
        return s.substring(a, b)
    }

    fun trimEnd(s: String): String {
        var b = s.length
        while (b > 0 && isSpace(s[b - 1])) b--
        return s.substring(0, b)
    }

    fun trimStart(s: String): String {
        var a = 0
        while (a < s.length && isSpace(s[a])) a++
        return s.substring(a)
    }

    fun hasSpace(s: String): Boolean = s.any { isSpace(it) }
}

/** A growable list of ints without boxing, for postings and positions. */
class IntList(capacity: Int = 4) {
    private var a = IntArray(capacity)
    var size = 0
        private set

    fun add(v: Int) {
        if (size == a.size) a = a.copyOf(maxOf(4, a.size * 2))
        a[size++] = v
    }

    operator fun get(i: Int): Int = a[i]

    fun last(): Int = a[size - 1]

    fun toArray(): IntArray = a.copyOf(size)

    inline fun forEach(fn: (Int) -> Unit) {
        for (i in 0 until size) fn(this[i])
    }
}
