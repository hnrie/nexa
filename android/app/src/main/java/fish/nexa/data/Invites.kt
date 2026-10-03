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
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/**
 * Invites (lib/invitePreviews.ts, lib/joinInvite.ts, lib/inviteLink.ts):
 * what an invite leads to, kept a few minutes and asked again after a
 * failure, and joining through one, with the key a link may carry after its #.
 */
object Invites {
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

    /** The key in an invite link's fragment ("k=<epoch>.<root>"), or null. */
    fun keyOf(fragment: String): Pair<Int, ByteArray>? {
        val m = Regex("(?:^|[#&])k=(\\d+)\\.([A-Za-z0-9_-]{40,50})(?:&|$)").find(fragment) ?: return null
        return runCatching {
            val root = Bytes.unb64url(m.groupValues[2])
            if (root.size != 32) null else m.groupValues[1].toInt() to root
        }.getOrNull()
    }

    /** Where joining went: a group conversation, or a server and the channel to open in it. */
    sealed interface Joined {
        data class Group(val channelId: String) : Joined
        data class Server(val serverId: String, val channelId: String?) : Joined
    }

    /** acceptInvite: joins, takes in what came back, keeps the link's key, and says where to go. */
    suspend fun accept(code: String, fragment: String): Joined {
        val res = Nexa.auth.withCaptcha("join") { captcha ->
            Nexa.api.request("POST", "/invites/${java.net.URLEncoder.encode(code, "UTF-8")}", captcha = captcha)
        } as? JsonObject ?: throw ApiError(0, "bad_response", fish.nexa.ui.t("invite.couldNotAcceptTheInvite"))
        (res["users"] as? JsonArray)?.let { Nexa.users.upsert(wireJson.decodeFromJsonElement(ListSerializer(PublicUser.serializer()), it)) }
        res["channel"]?.let { ch ->
            val channel = wireJson.decodeFromJsonElement(Channel.serializer(), ch)
            Nexa.channels.upsert(listOf(channel))
            return Joined.Group(channel.id)
        }
        val server = res["server"]?.let { wireJson.decodeFromJsonElement(ServerView.serializer(), it) }
            ?: throw ApiError(0, "bad_response", fish.nexa.ui.t("invite.couldNotAcceptTheInvite"))
        Nexa.channels.upsert(server.channels)
        Nexa.servers.put(server)
        keyOf(fragment)?.let { (epoch, root) -> runCatching { Nexa.keys.adopt(server.id, epoch, root) } }
        val first = server.channels.firstOrNull { it.type == "text" }
        return Joined.Server(server.id, first?.id)
    }
}
