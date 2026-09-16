package xyz.evilion.chat.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import xyz.evilion.chat.crypto.MessagePayload
import xyz.evilion.chat.net.Channel
import xyz.evilion.chat.net.Emoji
import xyz.evilion.chat.net.GuestInfo
import xyz.evilion.chat.net.InstanceInfo
import xyz.evilion.chat.net.Member
import xyz.evilion.chat.net.MeUser
import xyz.evilion.chat.net.Message
import xyz.evilion.chat.net.Presence
import xyz.evilion.chat.net.PublicUser
import xyz.evilion.chat.net.ReadState
import xyz.evilion.chat.net.Relationship
import xyz.evilion.chat.net.Role
import xyz.evilion.chat.net.Server
import xyz.evilion.chat.net.ServerView
import xyz.evilion.chat.net.StickerPack
import xyz.evilion.chat.net.VoiceState
import java.util.concurrent.ConcurrentHashMap

/** A server with everything this client knows about it. */
data class ServerState(
    val server: Server,
    val roles: Map<String, Role> = emptyMap(),
    val members: Map<String, Member> = emptyMap(),
    val memberCount: Int = 0,
    val me: Member? = null,
    val myPermissions: ULong = 0UL,
) {
    val id: String get() = server.id
}

/** A message as the UI needs it: the wire form, plus what this device could read of it. */
data class UiMessage(
    val raw: Message,
    val payload: MessagePayload? = null,
    /** null when it decrypted, "no_key" while the key is missing, "failed" when it never will. */
    val decryptError: String? = null,
    val pending: Boolean = false,
    val failed: Boolean = false,
    val tmpId: String? = null,
) {
    val id: String get() = tmpId ?: raw.id
    val text: String get() = payload?.text.orEmpty()
}

/**
 * Everything the app is showing, in memory.
 *
 * The browser keeps its state the same way: history is fetched and decrypted
 * as it is read rather than kept in a local database, so signing out leaves
 * nothing behind and a key that never arrives cannot leak plaintext to disk.
 */
object AppState {
    val me = MutableStateFlow<MeUser?>(null)
    val users = MutableStateFlow<Map<String, PublicUser>>(emptyMap())
    val servers = MutableStateFlow<Map<String, ServerState>>(emptyMap())
    val channels = MutableStateFlow<Map<String, Channel>>(emptyMap())
    val relationships = MutableStateFlow<Map<String, Relationship>>(emptyMap())
    val presences = MutableStateFlow<Map<String, Presence>>(emptyMap())
    val readStates = MutableStateFlow<Map<String, ReadState>>(emptyMap())
    val voiceStates = MutableStateFlow<Map<String, VoiceState>>(emptyMap())
    val typing = MutableStateFlow<Map<String, Map<String, Long>>>(emptyMap())
    val emojis = MutableStateFlow<Map<String, List<Emoji>>>(emptyMap())
    val stickerPacks = MutableStateFlow<List<StickerPack>>(emptyList())
    val instance = MutableStateFlow<InstanceInfo?>(null)
    val guest = MutableStateFlow<GuestInfo?>(null)
    /** Conversations whose key this device is still waiting for. */
    val waitingForKeys = MutableStateFlow<Set<String>>(emptySet())

    private val messageFlows = ConcurrentHashMap<String, MutableStateFlow<List<UiMessage>>>()
    /** Channels whose history has been fetched at least once, and whether the top has been reached. */
    val loadedChannels = MutableStateFlow<Map<String, Boolean>>(emptyMap())

    fun messages(channelId: String): MutableStateFlow<List<UiMessage>> =
        messageFlows.getOrPut(channelId) { MutableStateFlow(emptyList()) }

    fun messagesOrNull(channelId: String): StateFlow<List<UiMessage>>? = messageFlows[channelId]

    fun reset() {
        me.value = null
        users.value = emptyMap()
        servers.value = emptyMap()
        channels.value = emptyMap()
        relationships.value = emptyMap()
        presences.value = emptyMap()
        readStates.value = emptyMap()
        voiceStates.value = emptyMap()
        typing.value = emptyMap()
        emojis.value = emptyMap()
        stickerPacks.value = emptyList()
        guest.value = null
        waitingForKeys.value = emptySet()
        messageFlows.clear()
        loadedChannels.value = emptyMap()
    }

    // --- writers -----------------------------------------------------------

    fun putUsers(list: Collection<PublicUser>) {
        if (list.isEmpty()) return
        users.update { current -> current + list.associateBy { it.id } }
    }

    fun putUser(user: PublicUser) = putUsers(listOf(user))

    fun putChannels(list: Collection<Channel>) {
        if (list.isEmpty()) return
        channels.update { current -> current + list.associateBy { it.id } }
    }

    fun putChannel(channel: Channel) = putChannels(listOf(channel))

    fun removeChannel(id: String) {
        channels.update { it - id }
        messageFlows.remove(id)
    }

    fun putServerView(view: ServerView, myUserId: String?) {
        val state = ServerState(
            server = view.toServer(),
            roles = view.roles.associateBy { it.id },
            members = view.members.associateBy { it.userId },
            memberCount = view.memberCount,
            me = view.me,
            myPermissions = view.myPermissions.toPerm(),
        )
        servers.update { it + (view.id to state) }
        putChannels(view.channels)
    }

    fun updateServer(id: String, block: (ServerState) -> ServerState) {
        servers.update { all -> all[id]?.let { all + (id to block(it)) } ?: all }
    }

    fun removeServer(id: String) {
        val channelIds = channels.value.values.filter { it.serverId == id }.map { it.id }
        channels.update { it - channelIds.toSet() }
        for (c in channelIds) messageFlows.remove(c)
        servers.update { it - id }
        emojis.update { it - id }
    }

    fun putPresence(p: Presence) = presences.update { it + (p.userId to p) }

    fun putReadState(rs: ReadState) = readStates.update { it + (rs.channelId to rs) }

    fun putVoiceState(v: VoiceState) {
        voiceStates.update { current ->
            if (v.channelId == null) current - v.userId else current + (v.userId to v)
        }
    }

    fun setTyping(channelId: String, userId: String, until: Long?) {
        typing.update { all ->
            val forChannel = all[channelId] ?: emptyMap()
            val next = if (until == null) forChannel - userId else forChannel + (userId to until)
            if (next.isEmpty()) all - channelId else all + (channelId to next)
        }
    }

    // --- readers -----------------------------------------------------------

    /** A server's channels, categories first in position order, as the sidebar shows them. */
    fun channelsOf(serverId: String): List<Channel> =
        channels.value.values.filter { it.serverId == serverId }.sortedWith(
            compareBy({ if (it.isCategory) 0 else 1 }, { it.position }, { it.id }),
        )

    fun dmChannels(): List<Channel> =
        channels.value.values.filter { it.isDm }.sortedByDescending { it.lastMessageId?.toLongOrNull() ?: it.createdAt }

    fun user(id: String): PublicUser? = users.value[id] ?: me.value?.takeIf { it.id == id }?.toPublic()

    /** What to call someone here: server nickname, then friend nickname, then display name. */
    fun nameFor(userId: String, serverId: String? = null): String {
        val member = serverId?.let { servers.value[it]?.members?.get(userId) }
        member?.nickname?.takeIf { it.isNotEmpty() }?.let { return it }
        relationships.value[userId]?.nickname?.takeIf { it.isNotEmpty() }?.let { return it }
        return user(userId)?.name ?: "Unknown"
    }

    fun channelName(channel: Channel, myId: String? = me.value?.id): String = when {
        channel.type == "dm" -> channel.recipientIds.firstOrNull { it != myId }?.let { nameFor(it) } ?: "Direct message"
        channel.type == "group_dm" -> channel.name.ifEmpty {
            channel.recipientIds.filter { it != myId }.joinToString(", ") { nameFor(it) }.ifEmpty { "Group" }
        }
        else -> channel.name
    }

    fun isOwner(serverId: String, userId: String?): Boolean =
        userId != null && servers.value[serverId]?.server?.ownerId == userId

    /** This account's permissions in a channel, overwrites and timeouts included. */
    fun permissionsIn(channelId: String): ULong {
        val channel = channels.value[channelId] ?: return 0UL
        val myId = me.value?.id ?: return 0UL
        val serverId = channel.serverId ?: return P.ALL // DMs have no permission model
        val state = servers.value[serverId] ?: return 0UL
        return Permissions.compute(
            serverId, state.roles.values, state.members[myId] ?: state.me, myId,
            state.server.ownerId == myId, channel.overwrites,
        )
    }

    fun can(channelId: String, need: ULong): Boolean = permissionsIn(channelId).has(need)

    /** The conversation whose keys encrypt a channel. */
    fun convFor(channelId: String): String {
        val channel = channels.value[channelId] ?: return channelId
        if (channel.keyConvId.isNotEmpty() && channel.keyConvId != "0") return channel.keyConvId
        if (channel.serverId != null && !channel.isDm) return channel.serverId
        return channelId
    }

    fun unreadOf(channelId: String): Pair<Boolean, Int> {
        val channel = channels.value[channelId] ?: return false to 0
        val rs = readStates.value[channelId]
        val last = channel.lastMessageId?.toLongOrNull() ?: return false to 0
        val read = rs?.lastReadMessageId?.toLongOrNull() ?: 0L
        return (last > read) to (rs?.mentionCount ?: 0)
    }

    fun serverUnread(serverId: String): Pair<Boolean, Int> {
        var unread = false
        var mentions = 0
        for (c in channels.value.values) {
            if (c.serverId != serverId || !c.isText) continue
            if (!permissionsIn(c.id).has(P.VIEW_CHANNEL)) continue
            val (u, m) = unreadOf(c.id)
            if (u) unread = true
            mentions += m
        }
        return unread to mentions
    }

    fun voiceIn(channelId: String): List<VoiceState> =
        voiceStates.value.values.filter { it.channelId == channelId }.sortedBy { it.joinedAt }
}
