package fish.nexa.data

import java.text.Normalizer
import java.util.regex.Pattern

/**
 * AutoMod's matching (web/src/lib/automod/match.ts), as the server's
 * internal/automod does it: text read past the usual disguises, and a rule's
 * words (with * wildcards), patterns and allowed words matched against it.
 * internal/automod/testdata/vectors.json holds the cases all three agree on.
 */
object AutomodMatch {
    /** Letters from other scripts and symbols that pass for Latin ones. */
    private val CONFUSABLES = mapOf(
        "а" to "a", "в" to "b", "е" to "e", "ё" to "e", "к" to "k", "м" to "m", "н" to "h", "о" to "o", "р" to "p", "с" to "c", "т" to "t", "у" to "y", "х" to "x",
        "і" to "i", "ї" to "i", "ј" to "j", "ѕ" to "s", "ԁ" to "d", "ԛ" to "q", "ԝ" to "w", "ү" to "y", "һ" to "h", "ɡ" to "g",
        "α" to "a", "β" to "b", "ε" to "e", "ι" to "i", "κ" to "k", "ν" to "v", "ο" to "o", "ρ" to "p", "τ" to "t", "υ" to "u", "χ" to "x", "ω" to "w",
        "ł" to "l", "ø" to "o", "đ" to "d", "ß" to "s", "æ" to "a", "œ" to "o", "ı" to "i", "ƒ" to "f", "€" to "e", "¢" to "c", "£" to "l", "¥" to "y",
    )

    /** Digits and symbols swapped for letters. */
    private val LEET = mapOf("0" to "o", "1" to "i", "3" to "e", "4" to "a", "5" to "s", "7" to "t", "8" to "b", "9" to "g", "@" to "a", "$" to "s", "!" to "i", "|" to "l", "+" to "t")

    private val INVISIBLE = Regex("[​‌‍⁠﻿­᠎]|\\p{Cf}")
    private val MARK = Regex("\\p{M}")
    private val LETTER_OR_DIGIT = Regex("[\\p{L}\\p{N}]")
    private const val SPELL_SEP = " .-_*,~/\\"
    private val WORD_CHAR = Regex("[\\p{L}\\p{N}_']")

    class Folded(val text: String, val runs: List<String>)

    /** Each code point of a string, as a string of its own. */
    private fun codePoints(s: String): List<String> {
        val out = ArrayList<String>(s.length)
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            val n = Character.charCount(cp)
            out += s.substring(i, i + n)
            i += n
        }
        return out
    }

    /** Folded text, and the spelled-out runs put back together within it. */
    fun foldWithRuns(s: String): Folded {
        val runes = ArrayList<String>()
        for (ch in codePoints(Normalizer.normalize(s, Normalizer.Form.NFKD))) {
            if (MARK.containsMatchIn(ch) || INVISIBLE.containsMatchIn(ch)) continue
            var c = ch.lowercase()
            c = CONFUSABLES[c] ?: c
            c = LEET[c] ?: c
            runes += c
        }
        return joinSpelled(runes)
    }

    /**
     * Reads text the way a rule should see it: lower case, without accents or
     * the marks stacked on letters, look-alike letters and number swaps read as
     * the letters they stand for, invisible characters gone, and letters spelled
     * out one at a time with the same thing between each put back together.
     */
    fun fold(s: String): String = foldWithRuns(s).text

    private fun isLetterOrDigit(c: String?) = c != null && LETTER_OR_DIGIT.containsMatchIn(c)

    private fun single(r: List<String>, i: Int): Boolean =
        isLetterOrDigit(r.getOrNull(i)) && (i == 0 || !isLetterOrDigit(r[i - 1])) && (i + 1 >= r.size || !isLetterOrDigit(r[i + 1]))

    private fun joinSpelled(r: List<String>): Folded {
        val out = StringBuilder()
        val runs = ArrayList<String>()
        var i = 0
        while (i < r.size) {
            if (single(r, i) && i + 2 < r.size && SPELL_SEP.contains(r[i + 1]) && single(r, i + 2)) {
                val sep = r[i + 1]
                val letters = arrayListOf(r[i])
                var j = i
                while (j + 2 < r.size && r[j + 1] == sep && single(r, j + 2)) {
                    letters += r[j + 2]
                    j += 2
                }
                if (letters.size >= 3) {
                    letters.forEach { out.append(it) }
                    runs += letters.joinToString("")
                    i = j + 1
                    continue
                }
            }
            out.append(r[i])
            i++
        }
        return Folded(out.toString(), runs)
    }

    /** A word of a rule: a * after starts a word, a * before ends one. */
    private class Term(val text: String, val prefix: Boolean, val suffix: Boolean)

    private fun parseTerm(w: String): Term? {
        val trimmed = w.trim()
        val text = trimmed.trim('*').lowercase()
        if (text.isEmpty()) return null
        return Term(text, trimmed.endsWith("*"), trimmed.startsWith("*"))
    }

    private fun lastCodePointBefore(s: String, at: Int): String? {
        if (at <= 0) return null
        val cp = s.codePointBefore(at)
        return String(Character.toChars(cp))
    }

    private fun codePointAtOrNull(s: String, at: Int): String? {
        if (at >= s.length) return null
        return String(Character.toChars(s.codePointAt(at)))
    }

    /** Where a term occurs in text as a whole word or phrase, unless a * lets it be part of one. */
    private fun findTerm(t: Term, text: String): IntRange? {
        var from = 0
        while (true) {
            val start = text.indexOf(t.text, from)
            if (start < 0) return null
            val end = start + t.text.length
            val before = lastCodePointBefore(text, start)
            val after = codePointAtOrNull(text, end)
            val startOk = t.suffix || start == 0 || before == null || !WORD_CHAR.containsMatchIn(before)
            val endOk = t.prefix || end == text.length || after == null || !WORD_CHAR.containsMatchIn(after)
            if (startOk && endOk) return start until end
            from = start + 1
        }
    }

    private fun escape(c: String): String = c.replace(Regex("[.*+?^\${}()|\\[\\]\\\\/-]")) { "\\" + it.value }

    /** A term as a pattern over folded text, letters free to be stretched; bare leaves out the word edges. */
    private fun fuzzyPattern(t: Term, bare: Boolean): String {
        val p = StringBuilder()
        if (!t.suffix && !bare) p.append("(?:^|[^\\p{L}\\p{N}_'])")
        p.append("(")
        for (c in codePoints(t.text)) {
            when {
                c.isNotEmpty() && Character.isWhitespace(c.codePointAt(0)) -> p.append("[\\s\\p{P}]+")
                c.isNotEmpty() && Character.isLetter(c.codePointAt(0)) -> p.append(escape(c)).append("+")
                else -> p.append(escape(c))
            }
        }
        p.append(")")
        if (!t.prefix && !bare) p.append("(?:$|[^\\p{L}\\p{N}_'])")
        return p.toString()
    }

    private fun wildcardForm(t: Term) = (if (t.suffix) "*" else "") + t.text + (if (t.prefix) "*" else "")

    private fun compile(p: String, flags: Int = 0): Pattern? = try {
        Pattern.compile(p, flags)
    } catch (_: Exception) {
        null
    }

    /** A rule's words, patterns and allowed words, ready to match. */
    class Matcher(words: List<String>, patterns: List<String>, allow: List<String>, evasion: Boolean) {
        private val terms = ArrayList<Term>()
        private val allowed = ArrayList<Term>()
        private var fuzzy: Pattern? = null
        private val fuzzyEach = ArrayList<Pattern?>()
        private val bareEach = ArrayList<Pattern?>()
        private val regexes = ArrayList<Pattern>()

        init {
            val alts = ArrayList<String>()
            for (w in words) {
                val t = parseTerm(w) ?: continue
                terms += t
                if (evasion) {
                    val ft = Term(fold(t.text), t.prefix, t.suffix)
                    val p = fuzzyPattern(ft, false)
                    val each = compile(p)
                    fuzzyEach += each
                    if (each != null) alts += p
                    bareEach += compile(fuzzyPattern(ft, true))
                }
            }
            if (alts.isNotEmpty()) fuzzy = compile(alts.joinToString("|"))
            for (w in allow) parseTerm(w)?.let { allowed += it }
            // written for the server's matcher: left out where this one cannot read it
            for (p in patterns) compile(p, Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE)?.let { regexes += it }
        }

        private fun withoutAllowed(input: String): String {
            var text = input
            for (a in allowed) {
                while (true) {
                    val at = findTerm(a, text) ?: break
                    text = text.substring(0, at.first) + " ".repeat(at.last + 1 - at.first) + text.substring(at.last + 1)
                }
            }
            return text
        }

        /** The first of the rule's words or patterns in text, as the rule wrote it (or what a pattern matched); null for none. */
        fun match(text: String): String? {
            if (text.isBlank()) return null
            val low = withoutAllowed(text.lowercase())
            for (t in terms) if (findTerm(t, low) != null) return wildcardForm(t)
            val fz = fuzzy
            if (fz != null) {
                val f = foldWithRuns(text)
                val folded = withoutAllowed(f.text)
                if (fz.matcher(folded).find()) {
                    for ((i, p) in fuzzyEach.withIndex()) if (p != null && p.matcher(folded).find()) return wildcardForm(terms[i])
                }
                for (run in f.runs) {
                    if (withoutAllowed(run).isBlank()) continue
                    for ((i, p) in bareEach.withIndex()) if (p != null && p.matcher(run).find()) return wildcardForm(terms[i])
                }
            }
            for (re in regexes) {
                val m = re.matcher(text)
                if (m.find() && m.group().isNotEmpty()) return m.group()
            }
            return null
        }
    }
}
