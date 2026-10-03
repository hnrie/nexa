package fish.nexa.search

import java.time.LocalDate
import java.time.ZoneId

/**
 * The search query: what someone types, read as words and filters
 * (web/src/lib/search.ts).
 *
 * Messages are end-to-end encrypted, so the server cannot search them; this
 * device does, over what it has decrypted. The syntax: plain words (every one
 * must appear, each found by its beginning), "a quoted phrase", -word to
 * leave one out, and filters:
 *
 *   from:bob           written by someone (from:me for yourself)
 *   in:general         in a channel or conversation, by its name
 *   mentions:bob       mentioning someone (mentions:everyone too)
 *   has:image          link, image, video, audio, file, embed or sticker
 *   before:2026-01-31  sent before a day, a month (2026-01) or a year
 *   after:2026-01-31   sent after one
 *   during:2026-01     sent within one
 *   pinned:yes         pinned (or pinned:no)
 *
 * A filter's value can be quoted when it has spaces: in:"weekend plans".
 */
object SearchQueries {
    val HAS_KINDS = listOf("link", "image", "video", "audio", "file", "embed", "sticker")
    val FILTER_KEYS = listOf("from", "in", "mentions", "has", "before", "after", "during", "pinned")

    /** One piece of a query and where it sits in the text: a word, a phrase, a left-out word or a filter. */
    data class Token(
        val kind: String,
        /** The filter's name, for a filter. */
        val key: String? = null,
        /** The word, the phrase or the filter's value, as typed (without quotes). */
        val value: String,
        val start: Int,
        val end: Int,
        /** A filter whose value could not be read (a date that is not one, has:unicorn). */
        val invalid: Boolean = false,
    )

    data class Query(
        /** Words, lowercased, as typed. */
        val terms: List<String> = emptyList(),
        val phrases: List<String> = emptyList(),
        val exclude: List<String> = emptyList(),
        val from: List<String> = emptyList(),
        val inside: List<String> = emptyList(),
        val mentions: List<String> = emptyList(),
        val has: List<String> = emptyList(),
        /** Sent at or after this (ms), from after: and during:. */
        val since: Long? = null,
        /** Sent before this (ms), from before: and during:. */
        val until: Long? = null,
        val pinned: Boolean? = null,
        /** Every piece of the query in order, for the chips that read it back and for suggestions. */
        val tokens: List<Token> = emptyList(),
    )

    /** A day, a month or a year, as the local time it starts and the one after it ends. */
    data class Range(val start: Long, val end: Long)

    fun dateRange(v: String, zone: ZoneId = ZoneId.systemDefault()): Range? {
        val m = DATE.matchEntire(Js.trim(v)) ?: return null
        val year = m.groupValues[1].toInt()
        val month = m.groups[2]?.value?.toInt()
        val day = m.groups[3]?.value?.toInt()
        if (month != null && (month < 1 || month > 12)) return null
        // JavaScript's Date reads years below 100 as 19xx, which the web then
        // refuses as not coming back as itself; and an impossible day is no date
        if (year < 100) return null
        val start = try {
            LocalDate.of(year, month ?: 1, day ?: 1)
        } catch (_: Exception) {
            return null
        }
        val end = when {
            day != null -> start.plusDays(1)
            month != null -> start.plusMonths(1)
            else -> start.plusYears(1)
        }
        return Range(start.atStartOfDay(zone).toInstant().toEpochMilli(), end.atStartOfDay(zone).toInstant().toEpochMilli())
    }

    private val DATE = Regex("^([0-9]{4})(?:-([0-9]{1,2})(?:-([0-9]{1,2}))?)?$")

    private fun yesNo(v: String): Boolean? = when (v.lowercase()) {
        "yes", "true", "y", "1" -> true
        "no", "false", "n", "0" -> false
        else -> null
    }

    private fun isWordChar(c: Char) = c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '_'

    /** The key typed at `i` followed by `:"`, compared as JavaScript's case-insensitive mode compares ASCII. */
    private fun quotedKeyAt(raw: String, i: Int): String? {
        if (i > 0 && isWordChar(raw[i - 1])) return null
        for (key in FILTER_KEYS) {
            val n = key.length
            if (i + n + 1 >= raw.length) continue
            var ok = true
            for (k in 0 until n) {
                val c = raw[i + k]
                val lower = if (c in 'A'..'Z') c + 32 else c
                if (lower != key[k]) { ok = false; break }
            }
            if (ok && raw[i + n] == ':' && raw[i + n + 1] == '"') return raw.substring(i, i + n)
        }
        return null
    }

    /** The pieces the web's PIECE expression finds, in order: a quoted filter, a quoted phrase, or a run of non-space. */
    private class Piece(val start: Int, val end: Int, val key: String?, val quotedValue: String?, val phrase: String?, val word: String?)

    private fun pieces(raw: String): List<Piece> {
        val out = ArrayList<Piece>()
        var i = 0
        while (i < raw.length) {
            val c = raw[i]
            if (Js.isSpace(c)) { i++; continue }
            val key = if (c.isLetter()) quotedKeyAt(raw, i) else null
            if (key != null) {
                val from = i + key.length + 2
                val close = raw.indexOf('"', from)
                val valueEnd = if (close < 0) raw.length else close
                val end = if (close < 0) raw.length else close + 1
                out += Piece(i, end, key, raw.substring(from, valueEnd), null, null)
                i = end
                continue
            }
            if (c == '"') {
                val close = raw.indexOf('"', i + 1)
                val valueEnd = if (close < 0) raw.length else close
                val end = if (close < 0) raw.length else close + 1
                out += Piece(i, end, null, null, raw.substring(i + 1, valueEnd), null)
                i = end
                continue
            }
            var j = i
            while (j < raw.length && !Js.isSpace(raw[j])) j++
            out += Piece(i, j, null, null, null, raw.substring(i, j))
            i = j
        }
        return out
    }

    fun parse(raw: String): Query {
        val terms = ArrayList<String>()
        val phrases = ArrayList<String>()
        val exclude = ArrayList<String>()
        val from = ArrayList<String>()
        val inside = ArrayList<String>()
        val mentions = ArrayList<String>()
        val has = ArrayList<String>()
        val tokens = ArrayList<Token>()
        var since: Long? = null
        var until: Long? = null
        var pinned: Boolean? = null
        fun narrow(r: Range, which: String) {
            if (which != "until") since = since?.let { maxOf(it, r.start) } ?: r.start
            if (which != "since") until = until?.let { minOf(it, r.end) } ?: r.end
        }
        fun filter(keyTyped: String, value: String, start: Int, end: Int): Boolean {
            val k = keyTyped.lowercase()
            if (k !in FILTER_KEYS) return false
            // a filter still being typed ("from:") narrows nothing yet
            if (value.isEmpty()) {
                tokens += Token("filter", k, value, start, end)
                return true
            }
            val v = value.lowercase()
            var invalid = false
            when (k) {
                "from" -> from += v.removePrefix("@")
                "in" -> inside += if (v.startsWith("#") || v.startsWith("@")) v.substring(1) else v
                "mentions" -> mentions += v.removePrefix("@")
                "has" -> if (v in HAS_KINDS) { if (v !in has) has += v } else invalid = true
                "pinned" -> yesNo(v).let { if (it == null) invalid = true else pinned = it }
                else -> {
                    val range = dateRange(v)
                    if (range == null) invalid = true
                    // before a day is before it starts; after a day is once it is over
                    else when (k) {
                        "before" -> narrow(Range(range.start, range.start), "until")
                        "after" -> narrow(Range(range.end, range.end), "since")
                        else -> narrow(range, "both")
                    }
                }
            }
            tokens += Token("filter", k, value, start, end, invalid)
            return true
        }
        for (p in pieces(raw)) {
            if (p.key != null) {
                filter(p.key, p.quotedValue ?: "", p.start, p.end)
                continue
            }
            if (p.phrase != null) {
                val phrase = Js.trim(p.phrase).lowercase()
                if (phrase.isNotEmpty()) {
                    phrases += phrase
                    tokens += Token("phrase", value = phrase, start = p.start, end = p.end)
                }
                continue
            }
            val word = p.word!!
            val colon = word.indexOf(':')
            if (colon > 0 && filter(word.substring(0, colon), word.substring(colon + 1), p.start, p.end)) continue
            if (word.startsWith("-") && word.length > 1) {
                exclude += word.substring(1).lowercase()
                tokens += Token("exclude", value = word.substring(1), start = p.start, end = p.end)
            } else {
                terms += word.lowercase()
                tokens += Token("term", value = word, start = p.start, end = p.end)
            }
        }
        return Query(terms, phrases, exclude, from, inside, mentions, has, since, until, pinned, tokens)
    }

    /** True when the query asks for nothing yet: no words and no filter with a value. */
    fun isEmpty(q: Query): Boolean = q.terms.isEmpty() && q.phrases.isEmpty() && q.exclude.isEmpty() && q.from.isEmpty() && q.inside.isEmpty() &&
        q.mentions.isEmpty() && q.has.isEmpty() && q.since == null && q.until == null && q.pinned == null

    /** Removes one piece from the raw query, tidying the space it leaves. */
    fun withoutToken(raw: String, start: Int, end: Int): String {
        val before = Js.trimEnd(raw.substring(0, start))
        val after = Js.trimStart(raw.substring(end))
        return if (before.isNotEmpty() && after.isNotEmpty()) "$before $after" else before.ifEmpty { after }
    }

    /** A filter value as it goes into a query: quoted when it has a space. */
    fun filterValue(v: String): String = if (Js.hasSpace(v)) "\"" + v.replace("\"", "") + "\"" else v

    /** A person as search knows them. */
    data class Person(val id: String, val username: String, val displayName: String)

    /** What names mean: filters are resolved to ids before the index sees them. */
    data class Ctx(
        /** Everyone this device knows, in the order they were met. */
        val users: Map<String, Person>,
        /** Other names a person goes by, lowercased: nicknames in servers, a friend nickname. */
        val nicknames: Map<String, List<String>> = emptyMap(),
        /** The names a channel answers to, lowercased. */
        val channelNames: Map<String, List<String>> = emptyMap(),
        /** Who is signed in, so `from:me` and `mentions:me` mean them. */
        val meId: String? = null,
    )

    /** A query with its names turned into ids and its words folded: what the index is asked. */
    data class Resolved(
        val terms: List<String> = emptyList(),
        val phrases: List<String> = emptyList(),
        val exclude: List<String> = emptyList(),
        /** Any of these authors; null for no filter. An empty list matches nothing. */
        val from: List<String>? = null,
        /** Any of these channels, from in:; null for no filter. */
        val channels: List<String>? = null,
        /** Mentioning any of these people; null for no filter. */
        val mentions: List<String>? = null,
        /** mentions:everyone (or here) was asked for. */
        val everyone: Boolean = false,
        val has: List<String> = emptyList(),
        val since: Long? = null,
        val until: Long? = null,
        val pinned: Boolean? = null,
    )

    private fun isDigits(s: String) = s.isNotEmpty() && s.all { it in '0'..'9' }

    private fun usersNamed(wanted: String, ctx: Ctx): List<String> {
        if (wanted == "me") return listOfNotNull(ctx.meId)
        val out = ArrayList<String>()
        for (u in ctx.users.values) {
            if (u.id == wanted || u.username.lowercase() == wanted || u.displayName.lowercase() == wanted || wanted in (ctx.nicknames[u.id] ?: emptyList())) out += u.id
        }
        // an id nobody has loaded is still an id
        if (out.isEmpty() && isDigits(wanted)) out += wanted
        return out
    }

    private fun channelsNamed(wanted: String, ctx: Ctx): List<String> =
        ctx.channelNames.filter { (id, names) -> id == wanted || wanted in names }.keys.toList()

    private fun unique(xs: List<String>) = LinkedHashSet(xs).toList()

    fun resolve(q: Query, ctx: Ctx): Resolved {
        val mentionNames = q.mentions.filter { it != "everyone" && it != "here" }
        return Resolved(
            terms = unique(q.terms.map { SearchText.fold(it) }.filter { it.isNotEmpty() }),
            phrases = unique(q.phrases.map { SearchText.fold(it) }.filter { it.isNotEmpty() }),
            exclude = unique(q.exclude.map { SearchText.fold(it) }.filter { it.isNotEmpty() }),
            from = if (q.from.isNotEmpty()) unique(q.from.flatMap { usersNamed(it, ctx) }) else null,
            channels = if (q.inside.isNotEmpty()) unique(q.inside.flatMap { channelsNamed(it, ctx) }) else null,
            mentions = if (mentionNames.isNotEmpty()) unique(mentionNames.flatMap { usersNamed(it, ctx) }) else null,
            everyone = q.mentions.size > mentionNames.size,
            has = q.has.toList(),
            since = q.since,
            until = q.until,
            pinned = q.pinned,
        )
    }

    /** The filters alone: everything but the words. Cheap, so it goes first. */
    fun matchFilters(d: SearchDoc, r: Resolved): Boolean {
        if (r.since != null && d.ts < r.since) return false
        if (r.until != null && d.ts >= r.until) return false
        if (r.from != null && d.a !in r.from) return false
        if (r.channels != null && d.c !in r.channels) return false
        if (r.pinned != null && (d.fl and 1L != 0L) != r.pinned) return false
        if (r.mentions != null || r.everyone) {
            val byName = r.mentions?.let { want -> d.mn?.any { it in want } } ?: false
            if (!byName && !(r.everyone && d.ev)) return false
        }
        if (r.has.isNotEmpty()) {
            val kinds = SearchDocs.hasKinds(d)
            for (h in r.has) if (h !in kinds) return false
        }
        return true
    }

    /** The words, against a message's folded searchable text. */
    fun matchText(folded: String, r: Resolved): Boolean {
        for (w in r.exclude) if (folded.contains(w)) return false
        for (p in r.phrases) if (!folded.contains(p)) return false
        for (t in r.terms) if (!folded.contains(t)) return false
        return true
    }

    fun matches(d: SearchDoc, r: Resolved): Boolean = matchFilters(d, r) && matchText(SearchText.fold(SearchDocs.searchableText(d)), r)

    /** What to mark in a result: the words and phrases searched for, folded. */
    fun needlesOf(q: Query): List<String> = (q.terms + q.phrases).map { SearchText.fold(it) }.filter { it.isNotEmpty() }
}
