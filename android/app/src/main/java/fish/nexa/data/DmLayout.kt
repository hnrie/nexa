package fish.nexa.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import java.math.BigInteger
import kotlin.random.Random

/**
 * lib/dmLayout.ts: how you arranged your direct messages (pins, your own
 * groups, rows moved by hand), synced in the account's settings as `dmList`.
 * Every function returns the same layout object when nothing changes, so a
 * caller can tell a no-op, and the shape stays the web's byte for byte.
 */
object DmLayout {
    data class Group(val id: String, val name: String, val ids: List<String>, val collapsed: Boolean = false)
    data class Moved(val at: String, val since: String)
    data class Layout(val pins: List<String> = emptyList(), val groups: List<Group> = emptyList(), val moved: Map<String, Moved>? = null)

    sealed interface Row {
        data class Conversation(val id: String) : Row
        data class GroupRow(val group: Group, val ids: List<String>) : Row
    }

    data class View(val pinned: List<Row>, val rest: List<Row>, val keys: Map<String, String>, val now: Map<String, String>)

    const val NEXA_ID = "nexa"
    const val GROUP_NAME_MAX = 40
    private const val MOVED_MAX = 200
    private val CONVERSATION_ID = Regex("^(\\d{1,20}|nexa)$")
    private val GROUP_ID = Regex("^g[a-z0-9]{1,16}$")
    private val KEY = Regex("^\\d{1,20}$")
    val EMPTY = Layout()

    fun isGroupId(id: String) = GROUP_ID.matches(id)

    fun rowId(row: Row): String = when (row) {
        is Row.GroupRow -> row.group.id
        is Row.Conversation -> row.id
    }

    /** Reads whatever the settings hold, keeping only what makes sense (sanitizeDMList). */
    fun read(x: JsonElement?): Layout {
        val raw = x as? JsonObject ?: return Layout()
        val groups = ArrayList<Group>()
        val groupIds = HashSet<String>()
        val seen = HashSet<String>()
        val rawPins = (raw["pins"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content } ?: emptyList()
        for (id in rawPins) if (CONVERSATION_ID.matches(id)) seen += id
        for (g in (raw["groups"] as? JsonArray) ?: JsonArray(emptyList())) {
            val r = g as? JsonObject ?: continue
            val gid = (r["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: continue
            if (!GROUP_ID.matches(gid) || gid in groupIds) continue
            groupIds += gid
            val ids = ArrayList<String>()
            for (el in (r["ids"] as? JsonArray) ?: JsonArray(emptyList())) {
                val id = (el as? JsonPrimitive)?.takeIf { it.isString }?.content ?: continue
                if (!CONVERSATION_ID.matches(id) || id in seen) continue
                seen += id
                ids += id
            }
            val name = (r["name"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { it.take(GROUP_NAME_MAX) } ?: ""
            groups += Group(gid, name, ids, (r["collapsed"] as? JsonPrimitive)?.booleanOrNull == true)
        }
        val pins = ArrayList<String>()
        for (id in rawPins) if ((CONVERSATION_ID.matches(id) || id in groupIds) && id !in pins) pins += id
        var moved: Map<String, Moved>? = null
        (raw["moved"] as? JsonObject)?.let { rm ->
            val out = LinkedHashMap<String, Moved>()
            for ((id, m) in rm) {
                if (!(CONVERSATION_ID.matches(id) || id in groupIds)) continue
                val o = m as? JsonObject ?: continue
                val at = (o["at"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                val since = (o["since"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                if (at != null && since != null && KEY.matches(at) && KEY.matches(since)) out[id] = Moved(at, since)
            }
            if (out.isNotEmpty()) moved = out
        }
        return Layout(pins, groups, moved)
    }

    fun toJson(l: Layout): JsonObject = buildJsonObject {
        putJsonArray("pins") { l.pins.forEach { add(JsonPrimitive(it)) } }
        putJsonArray("groups") {
            for (g in l.groups) add(buildJsonObject {
                put("id", g.id)
                put("name", g.name)
                putJsonArray("ids") { g.ids.forEach { add(JsonPrimitive(it)) } }
                if (g.collapsed) put("collapsed", true)
            })
        }
        l.moved?.let { m ->
            putJsonObject("moved") { for ((id, v) in m) putJsonObject(id) { put("at", v.at); put("since", v.since) } }
        }
    }

    fun groupOf(l: Layout, id: String): Group? = l.groups.firstOrNull { id in it.ids }

    fun isPinned(l: Layout, id: String) = id in l.pins

    /**
     * dmListView: the pinned rows in the order they were pinned, then the rest
     * newest activity first, except rows moved by hand, which keep their place
     * until something new happens in them.
     */
    fun view(l: Layout, conversations: List<String>, known: (String) -> Boolean, activity: (String) -> String, compare: (String, String) -> Int): View {
        val placed = LinkedHashSet<String>()
        val newest = Comparator<String> { a, b -> compare(activity(b), activity(a)) }
        val groups = l.groups.associateBy { it.id }
        val pinnedIds = l.pins.toSet()
        val pinned = ArrayList<Row>()
        for (id in l.pins) {
            if (isGroupId(id)) continue
            if (known(id)) placed += id
        }
        fun groupRow(g: Group): Row.GroupRow {
            val ids = g.ids.filter { known(it) && it !in placed && it !in pinnedIds }.sortedWith(newest)
            placed += ids
            return Row.GroupRow(g, ids)
        }
        val groupRows = LinkedHashMap<String, Row.GroupRow>()
        for (g in l.groups) groupRows[g.id] = groupRow(g)
        for (id in l.pins) {
            if (isGroupId(id)) {
                val row = if (groups.containsKey(id)) groupRows[id] else null
                if (row != null) pinned += row
            } else if (known(id)) pinned += Row.Conversation(id)
        }
        data class Placed(val row: Row, val at: String, val now: String)
        val rest = ArrayList<Placed>()
        fun placeOf(id: String, now: String): String {
            val m = l.moved?.get(id)
            return if (m != null && compare(now, m.since) <= 0) m.at else now
        }
        for (g in l.groups) {
            if (g.id in pinnedIds) continue
            val row = groupRows[g.id]!!
            val now = row.ids.firstOrNull()?.let(activity) ?: "0"
            rest += Placed(row, placeOf(g.id, now), now)
        }
        for (id in conversations) {
            if (id in placed || !known(id)) continue
            placed += id
            val now = activity(id)
            rest += Placed(Row.Conversation(id), placeOf(id, now), now)
        }
        // stable, as Array.prototype.sort is
        val sorted = rest.sortedWith { a, b -> compare(b.at, a.at) }
        val keys = LinkedHashMap<String, String>()
        val now = LinkedHashMap<String, String>()
        for (id in placed) now[id] = activity(id)
        for ((gid, row) in groupRows) now[gid] = row.ids.firstOrNull()?.let(activity) ?: "0"
        for (r in sorted) {
            keys[rowId(r.row)] = r.at
            now[rowId(r.row)] = r.now
        }
        return View(pinned, sorted.map { it.row }, keys, now)
    }

    private fun big(k: String?): BigInteger = if (k != null && KEY.matches(k)) BigInteger(k) else BigInteger.ZERO

    /** Puts a row of the main list beside another, remembering the place until it has news. */
    fun moveInMain(l: Layout, id: String, at: String, where: String, rest: List<String>, keys: Map<String, String> = emptyMap(), now: Map<String, String> = emptyMap()): Layout {
        if (id == at) return l
        val pins = l.pins.filter { it != id }
        val groups = if (!isGroupId(id)) l.groups.map { g -> g.copy(ids = g.ids.filter { it != id }) } else l.groups
        val order = rest.filter { it != id }
        val target = order.indexOf(at)
        val i = if (target < 0) 0 else if (where == "after") target + 1 else target
        val above = order.getOrNull(i - 1)
        val below = order.getOrNull(i)
        val place = when {
            above != null && below != null -> (big(keys[above]) + big(keys[below])).divide(BigInteger.TWO)
            below != null -> big(keys[below]) + BigInteger.ONE
            above != null -> if (big(keys[above]) > BigInteger.ZERO) big(keys[above]) - BigInteger.ONE else BigInteger.ZERO
            else -> return l.copy(pins = pins, groups = groups)
        }
        val moved = LinkedHashMap<String, Moved>()
        for ((k, m) in l.moved ?: emptyMap()) {
            if (k == id) continue
            if (now.containsKey(k) && big(now[k]) > big(m.since)) continue
            moved[k] = m
        }
        moved[id] = Moved(place.toString(), now[id] ?: keys[id] ?: "0")
        val kept = moved.entries.toList().takeLast(MOVED_MAX).associate { it.key to it.value }
        return Layout(pins, groups, kept)
    }

    private fun unplace(l: Layout, id: String): Layout = l.copy(pins = l.pins.filter { it != id }, groups = l.groups.map { g -> g.copy(ids = g.ids.filter { it != id }) })

    fun newGroupId(l: Layout, random: Random = Random.Default): String {
        val used = l.groups.map { it.id }.toSet()
        while (true) {
            val n = random.nextLong(0, 2176782336L) // 36^6
            val id = "g" + n.toString(36).padStart(6, '0')
            if (id !in used) return id
        }
    }

    fun pin(l: Layout, id: String, index: Int? = null): Layout {
        if (isGroupId(id) && l.groups.none { it.id == id }) return l
        val was = l.pins.indexOf(id)
        var next = if (isGroupId(id)) l.copy(pins = l.pins.filter { it != id }) else unplace(l, id)
        val pins = next.pins.toMutableList()
        val at = if (index == null) pins.size else maxOf(0, minOf(if (was >= 0 && was < index) index - 1 else index, pins.size))
        pins.add(at, id)
        next = next.copy(pins = pins)
        return next
    }

    fun unpin(l: Layout, id: String): Layout = if (id !in l.pins) l else l.copy(pins = l.pins.filter { it != id })

    fun movePinned(l: Layout, id: String, delta: Int): Layout {
        val at = l.pins.indexOf(id)
        val to = at + delta
        if (at < 0 || to < 0 || to >= l.pins.size) return l
        val pins = l.pins.toMutableList()
        pins.removeAt(at)
        pins.add(to, id)
        return l.copy(pins = pins)
    }

    fun addToGroup(l: Layout, id: String, groupId: String): Layout {
        val g = l.groups.firstOrNull { it.id == groupId } ?: return l
        if (id in g.ids || isGroupId(id)) return l
        val next = unplace(l, id)
        return next.copy(groups = next.groups.map { if (it.id == groupId) it.copy(ids = it.ids + id) else it })
    }

    fun removeFromGroup(l: Layout, id: String): Layout = if (groupOf(l, id) == null) l else l.copy(groups = l.groups.map { g -> g.copy(ids = g.ids.filter { it != id }) })

    fun createGroup(l: Layout, name: String, ids: List<String> = emptyList()): Pair<Layout, String> {
        val id = newGroupId(l)
        var next = l
        for (c in ids) next = unplace(next, c)
        val members = ids.filterIndexed { i, c -> !isGroupId(c) && ids.indexOf(c) == i }
        return next.copy(groups = next.groups + Group(id, name.trim().take(GROUP_NAME_MAX), members)) to id
    }

    fun rename(l: Layout, groupId: String, name: String): Layout {
        if (l.groups.none { it.id == groupId }) return l
        return l.copy(groups = l.groups.map { if (it.id == groupId) it.copy(name = name.trim().take(GROUP_NAME_MAX)) else it })
    }

    fun setCollapsed(l: Layout, groupId: String, collapsed: Boolean): Layout {
        if (l.groups.none { it.id == groupId }) return l
        return l.copy(groups = l.groups.map { if (it.id == groupId) it.copy(collapsed = collapsed) else it })
    }

    private fun unmove(l: Layout, id: String): Layout {
        val m = l.moved ?: return l
        if (!m.containsKey(id)) return l
        val rest = m - id
        return l.copy(moved = rest.ifEmpty { null })
    }

    fun deleteGroup(l: Layout, groupId: String): Layout {
        if (l.groups.none { it.id == groupId }) return l
        return unmove(l.copy(groups = l.groups.filter { it.id != groupId }, pins = l.pins.filter { it != groupId }), groupId)
    }

    /** A conversation closed or left: its place goes too. */
    fun forget(l: Layout, id: String): Layout {
        if (id !in l.pins && groupOf(l, id) == null && l.moved?.containsKey(id) != true) return l
        return unmove(unplace(l, id), id)
    }

    /** Drops conversations that are gone from pins, groups and moved places. */
    fun prune(l: Layout, known: (String) -> Boolean): Layout {
        val groupIds = l.groups.map { it.id }.toSet()
        val gone = { id: String -> if (isGroupId(id)) id !in groupIds else !known(id) }
        val movedGone = l.moved?.keys?.filter(gone) ?: emptyList()
        if (l.pins.none(gone) && l.groups.none { g -> g.ids.any(gone) } && movedGone.isEmpty()) return l
        var next = l.copy(pins = l.pins.filterNot(gone), groups = l.groups.map { g -> g.copy(ids = g.ids.filterNot(gone)) })
        for (id in movedGone) next = unmove(next, id)
        return next
    }
}
