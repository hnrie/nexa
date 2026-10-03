package fish.nexa.search

import fish.nexa.net.Channel
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Everything's name as search says it (components/search/scope.ts Names):
 * worked out once for the chips, the suggestions and the result rows, so
 * they all say the same thing.
 */
class SearchNames(
    /** Everyone this device knows, in the order they were met. */
    val users: Map<String, SearchQueries.Person>,
    val meId: String?,
    /** A person's name as this reader knows them: a friend nickname, else their display name. */
    val person: (String) -> String,
    /** A channel as a result or a chip names it: "#general", a DM's person, a group's name. */
    val channel: (Channel) -> String,
    /** The server a channel is in, if any. */
    val serverName: (String?) -> String?,
    /** What the query resolves names against. */
    val ctx: SearchQueries.Ctx,
)

/**
 * What to offer while someone types a search (components/search/suggest.ts).
 *
 * It looks at the piece of the query the caret is in. In a filter being
 * typed it offers what that filter takes: people for from: and mentions:,
 * conversations for in:, kinds of thing for has:, days and months for the
 * dates, yes or no for pinned:. In a plain word it offers the filters that
 * word begins and, once it could be a name, the person or the conversation
 * it names. In an empty box it offers the last few searches and the filters.
 */
object Suggest {
    data class DateHint(val start: Long, val unit: String, val relative: String? = null)

    data class Suggestion(
        val id: String,
        val kind: String,
        /** The query once this is chosen. */
        val text: String,
        /** Where the caret goes in it. */
        val caret: Int,
        val key: String? = null,
        val value: String? = null,
        val userId: String? = null,
        val channel: Channel? = null,
        val has: String? = null,
        val date: DateHint? = null,
        val recent: String? = null,
    )

    data class Group(val kind: String, val items: List<Suggestion>)

    class Input(
        val raw: String,
        val caret: Int,
        val names: SearchNames,
        /** Conversations for in:, the scope's own first. */
        val channels: List<Channel>,
        /** People to offer first: those in the conversation being searched. */
        val nearby: List<String>,
        val recent: List<String>,
        val now: Long,
        val zone: ZoneId = ZoneId.systemDefault(),
        /** How names sort when they rank the same: the reader's language's order (ICU's, as localeCompare's). */
        val collator: Comparator<String>,
    )

    /** The piece of the query the caret is in: a filter's value, or a word. */
    data class Partial(val key: String?, val value: String, val start: Int, val end: Int)

    fun partialAt(raw: String, caret: Int): Partial? {
        for (tok in SearchQueries.parse(raw).tokens) {
            if (caret < tok.start || caret > tok.end) continue
            if (tok.kind == "filter") return Partial(tok.key, tok.value, tok.start, tok.end)
            if (tok.kind == "term") return Partial(null, tok.value, tok.start, tok.end)
            return null
        }
        return null
    }

    data class Placed(val text: String, val caret: Int)

    /** Puts `insert` where the piece was; a finished filter gets a space after it, ready for the next word. */
    fun replacePiece(raw: String, start: Int, end: Int, insert: String, finished: Boolean): Placed {
        val before = raw.substring(0, start)
        val after = raw.substring(end)
        if (!finished) return Placed(before + insert + after, before.length + insert.length)
        val rest = Js.trimStart(after)
        return Placed("$before$insert $rest", before.length + insert.length + 1)
    }

    private const val LIMIT = 8

    private fun parts(s: String): List<String> {
        val out = ArrayList<String>()
        val cur = StringBuilder()
        for (c in s) {
            if (Js.isSpace(c) || c == '.' || c == '_' || c == '-') {
                out += cur.toString()
                cur.setLength(0)
            } else cur.append(c)
        }
        out += cur.toString()
        return out
    }

    /** Matches a name by its beginning first, then any word of it, then anywhere; -1 for no match. */
    fun rank(name: String, wanted: String): Int {
        val n = SearchText.fold(name)
        if (wanted.isEmpty()) return 1
        if (n.startsWith(wanted)) return 3
        if (parts(n).any { it.startsWith(wanted) }) return 2
        return if (n.contains(wanted)) 1 else -1
    }

    private fun people(input: Input, wanted: String): List<String> {
        val near = input.nearby.toHashSet()
        val scored = ArrayList<Pair<String, Int>>()
        for (u in input.names.users.values) {
            val nicks = input.names.ctx.nicknames[u.id] ?: emptyList()
            var score = maxOf(rank(u.username, wanted), rank(u.displayName, wanted))
            for (n in nicks) score = maxOf(score, rank(n, wanted))
            if (score < 0) continue
            // the people of the conversation being searched come first
            scored += u.id to score + (if (u.id in near) 10 else 0)
        }
        scored.sortWith { a, b -> if (a.second != b.second) b.second - a.second else input.collator.compare(input.names.person(a.first), input.names.person(b.first)) }
        return scored.map { it.first }
    }

    private fun stripMark(s: String, marks: String) = if (s.isNotEmpty() && s[0] in marks) s.substring(1) else s

    private fun conversations(input: Input, wanted: String): List<Channel> {
        val out = ArrayList<Triple<Channel, Int, Int>>()
        input.channels.forEachIndexed { order, ch ->
            val label = stripMark(input.names.channel(ch), "#@")
            var score = rank(label, wanted)
            for (n in input.names.ctx.channelNames[ch.id] ?: emptyList()) score = maxOf(score, rank(n, wanted))
            if (score >= 0) out += Triple(ch, score, order)
        }
        out.sortWith { a, b -> if (a.second != b.second) b.second - a.second else a.third - b.third }
        return out.map { it.first }
    }

    /** The value in: puts in for a conversation: a DM by its person's username, anything else by its name. */
    fun channelValue(ch: Channel, names: SearchNames): String {
        if (ch.type == "dm") {
            val other = ch.recipientIds.firstOrNull { it != names.meId }
            other?.let { names.users[it] }?.let { return it.username }
        }
        val label = stripMark(names.channel(ch), "#")
        return SearchQueries.filterValue(label.ifEmpty { ch.id })
    }

    private fun pad(n: Int) = n.toString().padStart(2, '0')

    private class DateOption(val value: String, val date: DateHint)

    private fun dates(now: Long, zone: ZoneId): List<DateOption> {
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val yesterday = today.minusDays(1)
        val month = today.withDayOfMonth(1)
        val lastMonth = month.minusMonths(1)
        val year = LocalDate.of(today.year, 1, 1)
        fun ms(d: LocalDate) = d.atStartOfDay(zone).toInstant().toEpochMilli()
        fun day(d: LocalDate) = "${d.year}-${pad(d.monthValue)}-${pad(d.dayOfMonth)}"
        fun mon(d: LocalDate) = "${d.year}-${pad(d.monthValue)}"
        return listOf(
            DateOption(day(today), DateHint(ms(today), "day", "today")),
            DateOption(day(yesterday), DateHint(ms(yesterday), "day", "yesterday")),
            DateOption(mon(month), DateHint(ms(month), "month", "thisMonth")),
            DateOption(mon(lastMonth), DateHint(ms(lastMonth), "month", "lastMonth")),
            DateOption(today.year.toString(), DateHint(ms(year), "year", "thisYear")),
        )
    }

    fun suggest(input: Input): List<Group> {
        val raw = input.raw
        val caret = input.caret
        val groups = ArrayList<Group>()
        if (Js.trim(raw).isEmpty()) {
            val recent = input.recent.take(5).mapIndexed { i, r -> Suggestion("recent-$i", "recent", r, r.length, recent = r) }
            if (recent.isNotEmpty()) groups += Group("recent", recent)
            val lead = Js.trimEnd(raw)
            val spacer = if (Js.trim(raw).isNotEmpty()) " " else ""
            groups += Group("keys", SearchQueries.FILTER_KEYS.map { key ->
                Suggestion("key-$key", "key", "$lead$spacer$key:", lead.length + spacer.length + key.length + 1, key = key)
            })
            return groups
        }
        val p = partialAt(raw, caret) ?: return groups
        val wanted = SearchText.fold(stripMark(p.value, "@#"))
        fun fill(key: String, value: String) = replacePiece(raw, p.start, p.end, "$key:$value", true)
        fun sug(id: String, kind: String, placed: Placed, key: String? = null, value: String? = null, userId: String? = null, channel: Channel? = null, has: String? = null, date: DateHint? = null) =
            Suggestion(id, kind, placed.text, placed.caret, key, value, userId, channel, has, date)

        when (p.key) {
            "from", "mentions" -> {
                val items = ArrayList<Suggestion>()
                val me = input.names.meId
                // "me" is always a way to say yourself
                if (me != null && (wanted.isEmpty() || "me".startsWith(wanted))) items += sug("${p.key}-me", "person", fill(p.key, "me"), p.key, "me", me)
                if (p.key == "mentions" && (wanted.isEmpty() || "everyone".startsWith(wanted))) items += sug("mentions-everyone", "everyone", fill("mentions", "everyone"), "mentions", "everyone")
                for (id in people(input, wanted)) {
                    if (items.size >= LIMIT) break
                    if (id == me && items.any { it.value == "me" }) continue
                    val u = input.names.users[id]!!
                    items += sug("${p.key}-$id", "person", fill(p.key, u.username), p.key, u.username, id)
                }
                if (items.isNotEmpty()) groups += Group("people", items)
                return groups
            }
            "in" -> {
                val items = conversations(input, wanted).take(LIMIT).map { ch ->
                    val value = channelValue(ch, input.names)
                    sug("in-${ch.id}", "channel", fill("in", value), "in", value, channel = ch)
                }
                if (items.isNotEmpty()) groups += Group("conversations", items)
                return groups
            }
            "has" -> {
                val items = SearchQueries.HAS_KINDS.filter { it.startsWith(wanted) }.map { h -> sug("has-$h", "has", fill("has", h), "has", h, has = h) }
                if (items.isNotEmpty()) groups += Group("kinds", items)
                return groups
            }
            "pinned" -> {
                val items = listOf("yes", "no").filter { it.startsWith(wanted) }.map { v -> sug("pinned-$v", "pinned", fill("pinned", v), "pinned", v) }
                if (items.isNotEmpty()) groups += Group("pinned", items)
                return groups
            }
            "before", "after", "during" -> {
                val key = p.key
                val items = ArrayList<Suggestion>()
                for (d in dates(input.now, input.zone)) if (wanted.isEmpty() || d.value.startsWith(wanted)) items += sug("$key-${d.value}", "date", fill(key, d.value), key, d.value, date = d.date)
                // and a calendar, for any other day
                items += Suggestion("$key-pick", "pickDate", raw, caret, key = key)
                groups += Group("dates", items)
                return groups
            }
        }
        // A plain word: the filters it could be the start of, and once it could
        // be a name, the person or conversation it names.
        val keys = SearchQueries.FILTER_KEYS.filter { wanted.isNotEmpty() && it.startsWith(wanted) && it != wanted }.map { key ->
            sug("key-$key", "key", replacePiece(raw, p.start, p.end, "$key:", false), key)
        }
        if (keys.isNotEmpty()) groups += Group("keys", keys)
        if (wanted.length >= 2) {
            val items = ArrayList<Suggestion>()
            for (id in people(input, wanted).take(3)) {
                val u = input.names.users[id]!!
                items += sug("from-$id", "person", replacePiece(raw, p.start, p.end, "from:${u.username}", true), "from", u.username, id)
            }
            for (ch in conversations(input, wanted).take(2)) {
                val value = channelValue(ch, input.names)
                items += sug("in-${ch.id}", "channel", replacePiece(raw, p.start, p.end, "in:$value", true), "in", value, channel = ch)
            }
            if (items.isNotEmpty()) groups += Group("filters", items)
        }
        return groups
    }
}
