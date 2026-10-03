package fish.nexa.data

import androidx.compose.runtime.mutableStateMapOf
import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.net.ApiError
import fish.nexa.net.Channel
import fish.nexa.net.InvitePreview
import fish.nexa.net.PublicUser
import fish.nexa.net.ServerView
import fish.nexa.net.wireJson
import fish.nexa.ui.nav.Route
import fish.nexa.ui.profile.ProfileLinks
import fish.nexa.ui.t
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * lib/inviteLink.ts and lib/joinInvite.ts: invite links, which for a server
 * (and a group) may carry the current key in the part after `#` that never
 * reaches the server, and joining through one.
 */
object Invites {
    data class Key(val epoch: Int, val root: ByteArray)

    private fun toUrl(b: String) = b.replace('+', '-').replace('/', '_').trimEnd('=')

    fun encodeKey(k: Key) = "k=${k.epoch}.${toUrl(Bytes.b64(k.root))}"

    fun parseFragment(hash: String): Key? {
        val m = Regex("(?:^|[#&])k=(\\d+)\\.([A-Za-z0-9_-]{40,50})(?:&|$)").find(hash) ?: return null
        return try {
            val s = m.groupValues[2].replace('-', '+').replace('_', '/')
            val root = Bytes.unb64(s + "=".repeat((4 - s.length % 4) % 4))
            if (root.size != 32) null else Key(m.groupValues[1].toInt(), root)
        } catch (_: Exception) {
            null
        }
    }

    fun url(code: String, key: Key?): String {
        val base = "${ProfileLinks.origin()}/invite/$code"
        return if (key != null) "$base#${encodeKey(key)}" else base
    }

    /** The current key of a conversation (a server or a group), for a link to carry. */
    fun keyOf(conv: String): Key? = Nexa.keys.ring.latest(conv)?.let { Key(it.first, it.second) }

    /** CreateServerModal's join field: a link or just the code, the key part kept. */
    fun parseCode(text: String): Pair<String, String>? {
        val trimmed = text.trim()
        val m = Regex("(?:invite/)?([A-Za-z0-9_-]{4,32})(?:[#?].*)?$").find(trimmed) ?: return null
        val code = m.groupValues[1]
        val hash = trimmed.substringAfter('#', "")
        return code to (if (hash.isNotEmpty()) "#$hash" else "")
    }

    data class Preview(
        val code: String,
        /** The server it leads to, or the group (see [group]). */
        val id: String?,
        val name: String,
        val iconId: String?,
        val bannerId: String?,
        val description: String,
        val members: Int?,
        val online: Int?,
        val inviter: PublicUser?,
        val group: Boolean,
        val channelName: String?,
    )

    suspend fun preview(code: String): Preview {
        val res = Nexa.api.get("/invites/$code") as JsonObject
        val inviter = res["inviter"]?.let { runCatching { wireJson.decodeFromJsonElement(PublicUser.serializer(), it) }.getOrNull() }
        fun JsonObject.s(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun JsonObject.n(k: String) = (this[k] as? JsonPrimitive)?.content?.toIntOrNull()
        val server = res["server"] as? JsonObject
        if (server != null) {
            return Preview(
                code, server.s("id"), server.s("name") ?: "", server.s("icon_id"), server.s("banner_id"), server.s("description") ?: "",
                server.n("member_count"), server.n("online_count"), inviter, group = false,
                channelName = (res["channel"] as? JsonObject)?.s("name"),
            )
        }
        val group = res["group"] as? JsonObject ?: throw IllegalStateException("invite")
        return Preview(code, group.s("id"), group.s("name") ?: "", group.s("icon_id"), null, "", group.n("member_count"), null, inviter, group = true, channelName = null)
    }

    /** acceptInvite: joins, keeps the link's key and grants it to this account, and says where to go. */
    suspend fun accept(code: String, fragment: String): Route {
        val res = Nexa.auth.guarded("join") { captcha -> Nexa.api.request("POST", "/invites/$code", captcha = captcha) } as JsonObject
        val users = (res["users"] as? JsonArray)?.let { runCatching { wireJson.decodeFromJsonElement(ListSerializer(PublicUser.serializer()), it) }.getOrNull() } ?: emptyList()
        Nexa.users.upsert(users)
        res["channel"]?.let { el ->
            val ch = wireJson.decodeFromJsonElement(Channel.serializer(), el)
            Nexa.channels.upsert(listOf(ch))
            parseFragment(fragment)?.let { Nexa.keys.adopt(ch.id, it.epoch, it.root) }
            return Route.Dm(ch.id)
        }
        val view = res["server"]?.let { wireJson.decodeFromJsonElement(ServerView.serializer(), it) } ?: throw IllegalStateException(t("invite.couldNotAcceptTheInvite"))
        Nexa.channels.upsert(view.channels)
        Nexa.servers.put(view)
        parseFragment(fragment)?.let { Nexa.keys.adopt(view.id, it.epoch, it.root) }
        val first = view.channels.filter { it.type == "text" }.minByOrNull { it.position }
        return Route.Server(view.id, first?.id)
    }

    /** An invite just made: its code, when it runs out (null for never) and how many times it may be used (0 for no limit). */
    data class Made(val code: String, val expiresAt: Long?, val maxUses: Int)

    /** A new link for a server channel or a group; max age in seconds (0 never), max uses (0 unlimited). */
    suspend fun create(channelId: String, maxAge: Int, maxUses: Int): Made {
        val res = Nexa.api.request("POST", "/channels/$channelId/invites", buildJsonObject {
            put("max_age", maxAge)
            put("max_uses", maxUses)
        }) as JsonObject
        return Made(
            (res["code"] as JsonPrimitive).content,
            (res["expires_at"] as? JsonPrimitive)?.content?.toLongOrNull(),
            (res["max_uses"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0,
        )
    }

    // -----------------------------------------------------------------------
    // lib/invitePreviews.ts: what an invite in a message leads to, kept a few
    // minutes, and asked again a little after a failure

    sealed interface Entry {
        data object Loading : Entry
        data class Ready(val preview: InvitePreview, val at: Long) : Entry
        data class Invalid(val at: Long) : Entry
        data class Failed(val at: Long) : Entry
    }

    private const val FRESH_MS = 5 * 60_000L
    private const val RETRY_MS = 30_000L

    val byCode = mutableStateMapOf<String, Entry>()
    private val inflight = HashSet<String>()

    private fun due(e: Entry?, now: Long): Boolean = when (e) {
        null -> true
        Entry.Loading -> false
        is Entry.Ready -> now - e.at > FRESH_MS
        is Entry.Invalid -> now - e.at > FRESH_MS
        is Entry.Failed -> now - e.at > RETRY_MS
    }

    fun load(code: String, force: Boolean = false) {
        synchronized(inflight) { if (code in inflight) return }
        val cur = byCode[code]
        if (!force && !due(cur, System.currentTimeMillis())) return
        if (cur !is Entry.Ready) byCode[code] = Entry.Loading
        synchronized(inflight) { inflight += code }
        Nexa.scope.launch {
            try {
                val p = Nexa.api.request("GET", "/invites/${java.net.URLEncoder.encode(code, "UTF-8")}", InvitePreview.serializer())
                byCode[code] = Entry.Ready(p, System.currentTimeMillis())
            } catch (e: Exception) {
                byCode[code] = when {
                    e is ApiError && e.status == 404 -> Entry.Invalid(System.currentTimeMillis())
                    cur is Entry.Ready -> cur.copy(at = System.currentTimeMillis())
                    else -> Entry.Failed(System.currentTimeMillis())
                }
            } finally {
                synchronized(inflight) { inflight -= code }
            }
        }
    }
}
