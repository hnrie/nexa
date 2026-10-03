package fish.nexa.ui.markdown

import java.math.BigDecimal

/**
 * The few places where JavaScript's string rules differ from Kotlin's, done
 * JavaScript's way, so text is read here exactly as the web reads it: what
 * counts as white space (`\s`, `trim()`), what counts as a letter for a
 * single UTF-16 unit, and how a number prints.
 */
internal object Js {
    /** `\s` and what `trim()` removes: WhiteSpace and LineTerminator in ECMAScript. */
    fun isSpace(c: Char): Boolean = when (c) {
        '\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
        else -> c in ' '..' '
    }

    /** What JavaScript's `.` will not match: the line terminators. */
    fun isLineTerminator(c: Char): Boolean = c == '\n' || c == '\r' || c == ' ' || c == ' '

    fun noLineTerminator(s: String): Boolean = s.none { isLineTerminator(it) }

    fun trim(s: String): String {
        var a = 0
        var b = s.length
        while (a < b && isSpace(s[a])) a++
        while (b > a && isSpace(s[b - 1])) b--
        return if (a == 0 && b == s.length) s else s.substring(a, b)
    }

    fun trimStart(s: String): String {
        var a = 0
        while (a < s.length && isSpace(s[a])) a++
        return if (a == 0) s else s.substring(a)
    }

    fun trimEnd(s: String): String {
        var b = s.length
        while (b > 0 && isSpace(s[b - 1])) b--
        return if (b == s.length) s else s.substring(0, b)
    }

    /** `/[\p{L}\p{N}_]/u.test(c)` for one UTF-16 unit, as the web asks of `charAt`: a lone surrogate is no letter. */
    fun isWordUnit(c: Char): Boolean = UnicodeTables.has(UnicodeTables.WORD, c.code)

    /** `[\p{L}\p{N}_]` for a whole code point. */
    fun isWordCodePoint(cp: Int): Boolean = UnicodeTables.has(UnicodeTables.WORD, cp)

    fun isLetterCodePoint(cp: Int): Boolean = UnicodeTables.has(UnicodeTables.LETTER, cp)

    /** ASCII-only case folding, which is what a JavaScript `/i` expression without `/u` does for these patterns. */
    fun asciiLower(c: Char): Char = if (c in 'A'..'Z') c + 32 else c

    fun regionMatchesAsciiIgnoreCase(s: String, at: Int, word: String): Boolean {
        if (at < 0 || at + word.length > s.length) return false
        for (k in word.indices) if (asciiLower(s[at + k]) != asciiLower(word[k])) return false
        return true
    }

    /** `String.prototype.toLowerCase()`: Unicode's default lowering, the same in every language. */
    fun lower(s: String): String = s.lowercase()

    /** The code unit at `i`, or null past either end (the web's `charAt` returning ""). */
    fun at(s: String, i: Int): Char? = if (i >= 0 && i < s.length) s[i] else null

    /**
     * `String(n)` for a whole number: the shortest digits that read back as
     * the same double, written out without an exponent below 1e21.
     */
    fun numberToString(d: Double): String {
        if (d.isNaN()) return "NaN"
        if (d.isInfinite()) return if (d > 0) "Infinity" else "-Infinity"
        if (d == 0.0) return "0"
        val abs = kotlin.math.abs(d)
        if (abs >= 1e21 || abs < 1e-6) {
            // exponent form, as JavaScript writes it
            val bd = BigDecimal(d.toString())
            val digits = bd.unscaledValue().abs().toString().trimEnd('0').ifEmpty { "0" }
            val exp = bd.precision() - bd.scale() - 1
            val mantissa = if (digits.length == 1) digits else digits[0] + "." + digits.substring(1)
            return (if (d < 0) "-" else "") + mantissa + "e" + (if (exp >= 0) "+" else "") + exp
        }
        return BigDecimal(d.toString()).stripTrailingZeros().toPlainString()
    }
}
