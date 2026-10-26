package fish.nexa.ui.shell

import android.icu.text.ListFormatter
import fish.nexa.Nexa
import fish.nexa.data.Ids
import fish.nexa.data.ReadMark
import fish.nexa.net.Channel
import fish.nexa.net.PublicUser
import fish.nexa.ui.I18n
import fish.nexa.ui.t
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.coroutines.launch

/** lib/names.ts. */
object Names {
    fun display(u: PublicUser?, fallback: String = t("names.unknownUser")): String = u?.displayName?.ifBlank { null } ?: u?.username?.ifBlank { null } ?: fallback

    /** Your friend nickname for them, else their display name. */
    fun shown(userId: String?): String {
        if (userId == null) return t("names.unknownUser")
        Nexa.relationships.nickname(userId)?.let { return it }
        if (userId == Nexa.users.meId) Nexa.users.me.value?.let { return it.name }
        return display(Nexa.users.get(userId))
    }

    /** In a server: the member's nickname, else the shown name. */
    fun member(serverId: String?, userId: String): String {
        val nick = serverId?.let { Nexa.servers.get(it)?.members?.get(userId)?.nickname }?.takeIf { it.isNotBlank() }
        return nick ?: shown(userId)
    }

    fun list(names: List<String>): String = try {
        ListFormatter.getInstance(I18n.locale).format(names)
    } catch (_: Exception) {
        names.joinToString(", ")
    }

    /** The name shown for a DM or group (channelDisplayName). */
    fun channel(ch: Channel): String {
        val me = Nexa.users.meId
        return when (ch.type) {
            "dm" -> shown(ch.recipientIds.firstOrNull { it != me } ?: ch.recipientIds.firstOrNull())
            "group_dm" -> ch.name.ifBlank {
                val others = ch.recipientIds.filter { it != me }.map { shown(it) }
                if (others.isEmpty()) t("names.unnamedGroup") else list(others)
            }
            else -> ch.name
        }
    }

    fun otherOf(ch: Channel): String? = ch.recipientIds.firstOrNull { it != Nexa.users.meId } ?: ch.recipientIds.firstOrNull()
}

/** lib/unread.ts and the notification settings that bear on it. */
object Unread {
    private fun notifications(): JsonObject = Nexa.settings.notifications

    fun mutedIds(): Set<String> = (notifications()["muted"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }?.toSet() ?: emptySet()

    private fun level(id: String): String? = ((notifications()["perChannel"] as? JsonObject)?.get(id) as? JsonPrimitive)?.contentOrNull

    /** The channel or its server is muted, or set to Nothing. */
    fun isMuted(channelId: String, serverId: String?): Boolean {
        val muted = mutedIds()
        if (channelId in muted || (serverId != null && serverId in muted)) return true
        return (level(channelId) ?: serverId?.let { level(it) }) == "none"
    }

    fun isUnread(read: ReadMark?, lastMessageId: String?): Boolean {
        if (lastMessageId == null) return false
        val mark = read?.lastReadId ?: return true
        return Ids.compare(lastMessageId, mark) > 0
    }

    /** A DM's or group's count: mentions when muted, else the larger of unread and mentions. */
    fun conversationCount(ch: Channel): Int {
        val read = Nexa.readStates.get(ch.id) ?: return 0
        if (!isUnread(read, ch.lastMessageId)) return 0
        return if (isMuted(ch.id, null)) read.mentions else maxOf(read.unread, read.mentions)
    }

    data class ServerUnread(val unread: Boolean, val mentions: Int)

    fun server(serverId: String): ServerUnread {
        val muted = mutedIds()
        var unread = false
        var mentions = 0
        for (ch in Nexa.channels.byId.value.values) {
            // a thread counts once this account is in it
            if (ch.serverId != serverId || !ch.hasChat || (ch.isThread && !Nexa.threads.isJoined(ch.id))) continue
            val read = Nexa.readStates.get(ch.id)
            mentions += read?.mentions ?: 0
            if (!unread && serverId !in muted && ch.id !in muted && isUnread(read, ch.lastMessageId)) unread = true
        }
        return ServerUnread(unread, mentions)
    }

    fun setMuted(id: String, mute: Boolean) {
        val now = mutedIds().toMutableList()
        if (mute) { if (id !in now) now += id } else now.remove(id)
        Nexa.settings.patch(buildJsonObject { put("notifications", buildJsonObject { put("muted", JsonArray(now.map { JsonPrimitive(it) })) }) })
    }

    /** Marks every unread text channel of a server read. */
    fun markServerRead(serverId: String) {
        for (ch in Nexa.channels.byId.value.values) {
            if (ch.serverId != serverId || !ch.hasChat) continue
            val last = ch.lastMessageId ?: continue
            val read = Nexa.readStates.get(ch.id)
            if (isUnread(read, last) || (read?.mentions ?: 0) > 0) Nexa.scope.launch { Nexa.session.ack(ch.id, last) }
        }
    }

    fun markRead(channelId: String) {
        val last = Nexa.channels.get(channelId)?.lastMessageId ?: return
        Nexa.scope.launch { Nexa.session.ack(channelId, last) }
    }
}

/** A server's channels as the sidebar lists them (stores/channels.ts channelTree). */
object ChannelTree {
    data class Category(val channel: Channel, val children: List<Channel>)
    data class Tree(val loose: List<Channel>, val categories: List<Category>)

    private val order = compareBy<Channel>({ it.position }, { it.id.length }, { it.id })

    fun of(serverId: String, all: Collection<Channel>): Tree {
        // threads sit under their channel, not in the list of channels
        val mine = all.filter { it.serverId == serverId && !it.isThread }
        val cats = mine.filter { it.isCategory }.sortedWith(order)
        val catIds = cats.map { it.id }.toSet()
        val loose = mine.filter { !it.isCategory && (it.parentId == null || it.parentId !in catIds) }.sortedWith(order)
        return Tree(loose, cats.map { cat -> Category(cat, mine.filter { !it.isCategory && it.parentId == cat.id }.sortedWith(order)) })
    }
}

/** lib/railLayout.ts: the rail's pinned and unpinned entries, servers and folders, shared with every device. */
object RailLayout {
    data class Folder(val id: String, val name: String, val color: String?, val servers: List<String>, val open: Boolean)
    sealed interface Entry {
        data class ServerEntry(val id: String) : Entry
        data class FolderEntry(val folder: Folder) : Entry
    }
    data class Layout(val pinned: List<Entry>, val rest: List<Entry>)

    private val SERVER_ID = Regex("^\\d{1,20}$")
    private val FOLDER_ID = Regex("^f[a-z0-9]{1,16}$")

    private fun readEntries(arr: JsonElement?, seen: MutableSet<String>, folders: MutableSet<String>): List<Entry> {
        val out = ArrayList<Entry>()
        for (e in (arr as? JsonArray) ?: return out) {
            if (e is JsonPrimitive && e.isString) {
                val id = e.content
                if (SERVER_ID.matches(id) && seen.add(id)) out += Entry.ServerEntry(id)
            } else if (e is JsonObject) {
                val id = (e["id"] as? JsonPrimitive)?.contentOrNull ?: continue
                if (!FOLDER_ID.matches(id) || !folders.add(id)) continue
                val servers = (e["servers"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }?.filter { SERVER_ID.matches(it) && seen.add(it) } ?: emptyList()
                out += Entry.FolderEntry(
                    Folder(
                        id,
                        ((e["name"] as? JsonPrimitive)?.contentOrNull ?: "").take(40),
                        (e["color"] as? JsonPrimitive)?.contentOrNull?.takeIf { Regex("^#[0-9a-fA-F]{6}$").matches(it) },
                        servers,
                        (e["open"] as? JsonPrimitive)?.contentOrNull == "true",
                    ),
                )
            }
        }
        return out
    }

    /** The layout as shown: left servers dropped, new ones at the top of the unpinned list (newest first). */
    fun resolve(rail: JsonElement?, joinOrder: List<String>, legacy: List<String>): Layout {
        val joined = joinOrder.toSet()
        if (rail == null || rail is JsonNull || rail !is JsonObject) {
            val order = (legacy.filter { it in joined } + joinOrder.filter { it !in legacy }).distinct()
            return Layout(emptyList(), order.map { Entry.ServerEntry(it) })
        }
        val seen = HashSet<String>()
        val folders = HashSet<String>()
        fun keep(list: List<Entry>) = list.mapNotNull { e ->
            when (e) {
                is Entry.ServerEntry -> e.takeIf { it.id in joined }
                is Entry.FolderEntry -> e.folder.servers.filter { it in joined }.takeIf { it.isNotEmpty() }?.let { Entry.FolderEntry(e.folder.copy(servers = it)) }
            }
        }
        val pinned = keep(readEntries(rail["pinned"], seen, folders))
        val rest = keep(readEntries(rail["rest"], seen, folders))
        val fresh = joinOrder.filter { it !in seen }.reversed().map { Entry.ServerEntry(it) }
        return Layout(pinned, fresh + rest)
    }

    fun toJson(l: Layout): JsonObject {
        fun enc(list: List<Entry>) = JsonArray(list.map { e ->
            when (e) {
                is Entry.ServerEntry -> JsonPrimitive(e.id)
                is Entry.FolderEntry -> buildJsonObject {
                    put("id", e.folder.id)
                    put("name", e.folder.name)
                    put("color", e.folder.color?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("servers", JsonArray(e.folder.servers.map { JsonPrimitive(it) }))
                    if (e.folder.open) put("open", true)
                }
            }
        })
        return buildJsonObject {
            put("pinned", enc(l.pinned))
            put("rest", enc(l.rest))
        }
    }
}
