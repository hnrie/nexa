package fish.nexa.ui.markdown

import java.net.IDN

/**
 * An http or https address read the way a browser's `new URL()` reads it (the
 * WHATWG URL standard), for the parts a chat client asks about: the host a
 * link really goes to, its path and fragment, and the address without its
 * fragment. Other schemes, and anything a browser would refuse, give null.
 *
 * A host with letters outside ASCII goes through UTS 46 as browsers do it
 * ([idna]: the phone's ICU in the app, ICU4J in tests).
 */
class WebUrl private constructor(
    /** "http" or "https". */
    val scheme: String,
    val username: String,
    val password: String,
    /** The host as a browser serialises it: lower-case, punycode, an IPv4 address in dotted form, IPv6 in brackets. */
    val hostname: String,
    /** The port when it is not the scheme's own, else null. */
    val port: Int?,
    private val segments: List<String>,
    /** The query without its "?", or null when there is none. */
    val query: String?,
    /** The fragment without its "#", or null when there is none. */
    val fragment: String?,
) {
    val protocol: String get() = "$scheme:"
    val host: String get() = if (port != null) "$hostname:$port" else hostname
    val origin: String get() = "$scheme://$host"
    val pathname: String get() = "/" + segments.joinToString("/")
    val search: String get() = if (query.isNullOrEmpty()) "" else "?$query"
    val hash: String get() = if (fragment.isNullOrEmpty()) "" else "#$fragment"

    /** The whole address as a browser writes it. */
    val href: String
        get() = buildString {
            append(scheme).append("://")
            if (username.isNotEmpty() || password.isNotEmpty()) {
                append(username)
                if (password.isNotEmpty()) append(':').append(password)
                append('@')
            }
            append(host)
            append(pathname)
            if (query != null) append('?').append(query)
            if (fragment != null) append('#').append(fragment)
        }

    /** The same address without its fragment (`u.hash = ""`). */
    fun withoutFragment(): WebUrl = WebUrl(scheme, username, password, hostname, port, segments, query, null)

    override fun toString() = href

    companion object {
        private const val C0_CONTROL_SET = ""
        private const val FRAGMENT_SET = " \"<>`"
        private const val QUERY_SET = " \"#<>"
        private const val SPECIAL_QUERY_SET = " \"#<>'"
        private const val PATH_SET = " \"#<>?^`{}"
        private const val USERINFO_SET = " \"#<>?`{}/:;=@[\\]^|"

        /** Reads an absolute http(s) address, or null. */
        fun parse(input: String): WebUrl? = try {
            Reader(input).read()
        } catch (_: Invalid) {
            null
        }

        private class Invalid : Exception() {
            override fun fillInStackTrace(): Throwable = this
        }

        private fun encode(cp: Int, extra: String, out: StringBuilder) {
            if (cp < 0x20 || cp > 0x7E || (cp < 128 && extra.indexOf(cp.toChar()) >= 0)) {
                val bytes = String(Character.toChars(cp)).toByteArray(Charsets.UTF_8)
                for (b in bytes) out.append('%').append("0123456789ABCDEF"[(b.toInt() shr 4) and 15]).append("0123456789ABCDEF"[b.toInt() and 15])
            } else out.appendCodePoint(cp)
        }

        private class Reader(raw: String) {
            // a JavaScript string becomes a USVString: lone surrogates turn into U+FFFD
            private val s: String = clean(raw)

            private fun clean(raw: String): String {
                val sb = StringBuilder(raw.length)
                var i = 0
                while (i < raw.length) {
                    val c = raw[i]
                    if (Character.isHighSurrogate(c) && i + 1 < raw.length && Character.isLowSurrogate(raw[i + 1])) {
                        sb.append(c).append(raw[i + 1])
                        i += 2
                        continue
                    }
                    sb.append(if (Character.isSurrogate(c)) '�' else c)
                    i++
                }
                // leading and trailing C0 controls and spaces go; tabs and newlines go from anywhere
                var a = 0
                var b = sb.length
                while (a < b && sb[a] <= ' ') a++
                while (b > a && sb[b - 1] <= ' ') b--
                val out = StringBuilder(b - a)
                for (k in a until b) {
                    val c = sb[k]
                    if (c != '\t' && c != '\n' && c != '\r') out.append(c)
                }
                return out.toString()
            }

            fun read(): WebUrl {
                // scheme
                val colon = s.indexOf(':')
                if (colon <= 0) throw Invalid()
                for (k in 0 until colon) {
                    val c = s[k]
                    val ok = if (k == 0) c.isAsciiLetter() else c.isAsciiLetter() || c in '0'..'9' || c == '+' || c == '-' || c == '.'
                    if (!ok) throw Invalid()
                }
                val scheme = s.substring(0, colon).lowercase()
                if (scheme != "http" && scheme != "https") throw Invalid()
                var p = colon + 1
                // special authority slashes: any number of / or \ are skipped
                while (p < s.length && (s[p] == '/' || s[p] == '\\')) p++
                // authority: up to / \ ? # or the end
                var end = p
                while (end < s.length && s[end] != '/' && s[end] != '\\' && s[end] != '?' && s[end] != '#') end++
                val authority = s.substring(p, end)
                var username = ""
                var password = ""
                var hostPort = authority
                val at = authority.lastIndexOf('@')
                if (at >= 0) {
                    val info = authority.substring(0, at)
                    hostPort = authority.substring(at + 1)
                    if (hostPort.isEmpty()) throw Invalid()
                    // every @ before the last is part of the credentials, written as %40
                    val ci = info.indexOf(':')
                    val user = if (ci >= 0) info.substring(0, ci) else info
                    val pass = if (ci >= 0) info.substring(ci + 1) else ""
                    username = encodeAll(user, USERINFO_SET)
                    password = encodeAll(pass, USERINFO_SET)
                }
                // host and port: a colon outside [ ] starts the port
                var hostEnd = hostPort.length
                var inBrackets = false
                for (k in hostPort.indices) {
                    val c = hostPort[k]
                    if (c == '[') inBrackets = true
                    if (c == ']') inBrackets = false
                    if (c == ':' && !inBrackets) {
                        hostEnd = k
                        break
                    }
                }
                val hostText = hostPort.substring(0, hostEnd)
                if (hostText.isEmpty()) throw Invalid()
                val hostname = parseHost(hostText)
                var port: Int? = null
                if (hostEnd < hostPort.length) {
                    val digits = hostPort.substring(hostEnd + 1)
                    if (!digits.all { it in '0'..'9' }) throw Invalid()
                    if (digits.isNotEmpty()) {
                        val n = digits.trimStart('0').ifEmpty { "0" }
                        if (n.length > 5 || n.toInt() > 65535) throw Invalid()
                        val v = n.toInt()
                        port = if ((scheme == "http" && v == 80) || (scheme == "https" && v == 443)) null else v
                    }
                }
                // path
                p = end
                val segments = ArrayList<String>()
                var query: String? = null
                var fragment: String? = null
                val buffer = StringBuilder()
                // path start: a first / or \ is the path's own
                if (p < s.length && (s[p] == '/' || s[p] == '\\')) p++
                while (true) {
                    val c = if (p < s.length) s[p] else null
                    if (c == null || c == '/' || c == '\\' || c == '?' || c == '#') {
                        val seg = buffer.toString()
                        val slash = c == '/' || c == '\\'
                        if (isDoubleDot(seg)) {
                            if (segments.isNotEmpty()) segments.removeAt(segments.size - 1)
                            if (!slash) segments += ""
                        } else if (isSingleDot(seg) && !slash) {
                            segments += ""
                        } else if (!isSingleDot(seg)) {
                            segments += seg
                        }
                        buffer.setLength(0)
                        if (c == null) break
                        if (c == '?') {
                            p++
                            val qs = StringBuilder()
                            while (p < s.length && s[p] != '#') {
                                val cp = s.codePointAt(p)
                                encode(cp, SPECIAL_QUERY_SET, qs)
                                p += Character.charCount(cp)
                            }
                            query = qs.toString()
                            if (p < s.length) {
                                fragment = encodeAll(s.substring(p + 1), FRAGMENT_SET)
                            }
                            break
                        }
                        if (c == '#') {
                            fragment = encodeAll(s.substring(p + 1), FRAGMENT_SET)
                            break
                        }
                        p++
                        continue
                    }
                    val cp = s.codePointAt(p)
                    encode(cp, PATH_SET, buffer)
                    p += Character.charCount(cp)
                }
                return WebUrl(scheme, username, password, hostname, port, segments, query, fragment)
            }

            private fun encodeAll(text: String, set: String): String {
                val out = StringBuilder()
                var i = 0
                while (i < text.length) {
                    val cp = text.codePointAt(i)
                    encode(cp, set, out)
                    i += Character.charCount(cp)
                }
                return out.toString()
            }

            private fun isSingleDot(seg: String) = seg == "." || seg.equals("%2e", ignoreCase = true)

            private fun isDoubleDot(seg: String): Boolean {
                val t = seg.lowercase()
                return t == ".." || t == ".%2e" || t == "%2e." || t == "%2e%2e"
            }
        }

        private fun Char.isAsciiLetter() = this in 'a'..'z' || this in 'A'..'Z'

        /** The host parser for a special scheme: IPv6, then a domain (to ASCII), then IPv4 when it ends in a number. */
        private fun parseHost(input: String): String {
            if (input.startsWith("[")) {
                if (!input.endsWith("]")) throw Invalid()
                return "[" + ipv6(input.substring(1, input.length - 1)) + "]"
            }
            val domain = percentDecode(input)
            val ascii = toAscii(domain)
            // a name that maps to nothing (a lone variation selector) is no host
            if (ascii.isEmpty()) throw Invalid()
            for (c in ascii) {
                if (c.code <= 0x20 || c.code == 0x7F || c in "#%/:<>?@[\\]^|") throw Invalid()
            }
            if (endsInNumber(ascii)) return ipv4(ascii)
            return ascii
        }

        private fun percentDecode(input: String): String {
            if (input.indexOf('%') < 0) return input
            val bytes = java.io.ByteArrayOutputStream()
            val raw = input.toByteArray(Charsets.UTF_8)
            var i = 0
            while (i < raw.size) {
                val b = raw[i]
                if (b == '%'.code.toByte() && i + 2 < raw.size && hex(raw[i + 1]) >= 0 && hex(raw[i + 2]) >= 0) {
                    bytes.write(hex(raw[i + 1]) * 16 + hex(raw[i + 2]))
                    i += 3
                } else {
                    bytes.write(b.toInt())
                    i++
                }
            }
            return String(bytes.toByteArray(), Charsets.UTF_8)
        }

        private fun hex(b: Byte): Int = when (val c = b.toInt().toChar()) {
            in '0'..'9' -> c - '0'
            in 'a'..'f' -> c - 'a' + 10
            in 'A'..'F' -> c - 'A' + 10
            else -> -1
        }

        /**
         * UTS 46 ToASCII as the URL standard asks for it (not transitional,
         * joiners and bidi checked, hyphens and lengths not), or null when it
         * refuses the domain. The app's is the phone's ICU; tests set ICU4J's.
         */
        @Volatile var idna: (String) -> String? = ::platformIdna

        private fun platformIdna(domain: String): String? = try {
            val uts46 = android.icu.text.IDNA.getUTS46Instance(
                android.icu.text.IDNA.NONTRANSITIONAL_TO_ASCII or android.icu.text.IDNA.NONTRANSITIONAL_TO_UNICODE or
                    android.icu.text.IDNA.CHECK_BIDI or android.icu.text.IDNA.CHECK_CONTEXTJ,
            )
            val info = android.icu.text.IDNA.Info()
            val out = StringBuilder()
            uts46.nameToASCII(domain, out, info)
            val ignored = setOf(
                android.icu.text.IDNA.Error.EMPTY_LABEL, android.icu.text.IDNA.Error.LABEL_TOO_LONG, android.icu.text.IDNA.Error.DOMAIN_NAME_TOO_LONG,
                android.icu.text.IDNA.Error.LEADING_HYPHEN, android.icu.text.IDNA.Error.TRAILING_HYPHEN, android.icu.text.IDNA.Error.HYPHEN_3_4,
            )
            if (info.errors.all { it in ignored }) out.toString() else null
        } catch (_: Throwable) {
            // no ICU to ask: the platform's older rules, which agree for nearly every name
            try {
                IDN.toASCII(domain, IDN.ALLOW_UNASSIGNED).lowercase()
            } catch (_: Exception) {
                null
            }
        }

        private fun toAscii(domain: String): String {
            val ascii = domain.all { it.code < 128 }
            if (ascii && domain.split('.').none { it.startsWith("xn--", ignoreCase = true) }) return domain.lowercase()
            return idna(domain) ?: throw Invalid()
        }

        private fun endsInNumber(host: String): Boolean {
            val parts = host.split('.').toMutableList()
            if (parts.last().isEmpty()) {
                if (parts.size == 1) return false
                parts.removeAt(parts.size - 1)
            }
            val last = parts.last()
            if (last.isNotEmpty() && last.all { it in '0'..'9' }) return true
            return ipv4Number(last) != null
        }

        /** The IPv4 number parser: decimal, 0x hex or 0-led octal; null for failure. */
        private fun ipv4Number(input: String): Long? {
            if (input.isEmpty()) return null
            var s = input
            var radix = 10
            if (s.length >= 2 && (s.startsWith("0x") || s.startsWith("0X"))) {
                radix = 16
                s = s.substring(2)
            } else if (s.length >= 2 && s.startsWith("0")) {
                radix = 8
                s = s.substring(1)
            }
            if (s.isEmpty()) return 0
            var v = java.math.BigInteger.ZERO
            for (c in s) {
                val d = Character.digit(c, radix)
                if (d < 0 || c.code > 127) return null
                v = v.multiply(java.math.BigInteger.valueOf(radix.toLong())).add(java.math.BigInteger.valueOf(d.toLong()))
            }
            return if (v.bitLength() > 62) Long.MAX_VALUE else v.toLong()
        }

        private fun ipv4(host: String): String {
            val parts = host.split('.').toMutableList()
            if (parts.last().isEmpty() && parts.size > 1) parts.removeAt(parts.size - 1)
            if (parts.size > 4) throw Invalid()
            val numbers = parts.map { ipv4Number(it) ?: throw Invalid() }
            for (k in 0 until numbers.size - 1) if (numbers[k] > 255) throw Invalid()
            val limit = Math.pow(256.0, (5 - numbers.size).toDouble())
            if (numbers.last() >= limit) throw Invalid()
            var ip = numbers.last()
            for (k in 0 until numbers.size - 1) ip += numbers[k] * Math.pow(256.0, (3 - k).toDouble()).toLong()
            return listOf(ip shr 24 and 255, ip shr 16 and 255, ip shr 8 and 255, ip and 255).joinToString(".")
        }

        /** The IPv6 parser and serialiser (compressing the longest run of zeros). */
        private fun ipv6(input: String): String {
            val address = IntArray(8)
            var pieceIndex = 0
            var compress = -1
            var p = 0
            fun c(at: Int): Char? = if (at < input.length) input[at] else null
            if (c(p) == ':') {
                if (c(p + 1) != ':') throw Invalid()
                p += 2
                pieceIndex++
                compress = pieceIndex
            }
            while (c(p) != null) {
                if (pieceIndex == 8) throw Invalid()
                if (c(p) == ':') {
                    if (compress != -1) throw Invalid()
                    p++
                    pieceIndex++
                    compress = pieceIndex
                    continue
                }
                var value = 0
                var length = 0
                while (length < 4 && c(p) != null && Character.digit(c(p)!!, 16) >= 0 && c(p)!!.code < 128) {
                    value = value * 16 + Character.digit(c(p)!!, 16)
                    p++
                    length++
                }
                if (c(p) == '.') {
                    if (length == 0) throw Invalid()
                    p -= length
                    if (pieceIndex > 6) throw Invalid()
                    var numbersSeen = 0
                    while (c(p) != null) {
                        var ipv4Piece = -1
                        if (numbersSeen > 0) {
                            if (c(p) == '.' && numbersSeen < 4) p++ else throw Invalid()
                        }
                        if (c(p) == null || c(p)!! !in '0'..'9') throw Invalid()
                        while (c(p) != null && c(p)!! in '0'..'9') {
                            val number = c(p)!! - '0'
                            if (ipv4Piece == -1) ipv4Piece = number
                            else if (ipv4Piece == 0) throw Invalid()
                            else ipv4Piece = ipv4Piece * 10 + number
                            if (ipv4Piece > 255) throw Invalid()
                            p++
                        }
                        address[pieceIndex] = address[pieceIndex] * 0x100 + ipv4Piece
                        numbersSeen++
                        if (numbersSeen == 2 || numbersSeen == 4) pieceIndex++
                    }
                    if (numbersSeen != 4) throw Invalid()
                    break
                } else if (c(p) == ':') {
                    p++
                    if (c(p) == null) throw Invalid()
                } else if (c(p) != null) throw Invalid()
                address[pieceIndex] = value
                pieceIndex++
            }
            if (compress != -1) {
                var swaps = pieceIndex - compress
                pieceIndex = 7
                while (pieceIndex != 0 && swaps > 0) {
                    val t = address[pieceIndex]
                    address[pieceIndex] = address[compress + swaps - 1]
                    address[compress + swaps - 1] = t
                    pieceIndex--
                    swaps--
                }
            } else if (pieceIndex != 8) throw Invalid()
            // serialise: the first longest run of two or more zero pieces becomes ::
            var bestStart = -1
            var bestLen = 1
            var k = 0
            while (k < 8) {
                if (address[k] == 0) {
                    var e = k
                    while (e < 8 && address[e] == 0) e++
                    if (e - k > bestLen) {
                        bestStart = k
                        bestLen = e - k
                    }
                    k = e
                } else k++
            }
            val out = StringBuilder()
            var ignore0 = false
            for (i in 0 until 8) {
                if (ignore0 && address[i] == 0) continue
                ignore0 = false
                if (bestStart == i) {
                    out.append(if (i == 0) "::" else ":")
                    ignore0 = true
                    continue
                }
                out.append(Integer.toHexString(address[i]))
                if (i != 7) out.append(':')
            }
            return out.toString()
        }
    }
}
