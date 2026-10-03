package fish.nexa.data

import fish.nexa.net.Member
import fish.nexa.net.Overwrite
import fish.nexa.net.Role

/** Permission bits and their resolution, exactly as web/src/lib/perms.ts (and the server) work them out. */
object P {
    const val CREATE_INSTANT_INVITE = 1L shl 0
    const val KICK_MEMBERS = 1L shl 1
    const val BAN_MEMBERS = 1L shl 2
    const val ADMINISTRATOR = 1L shl 3
    const val MANAGE_CHANNELS = 1L shl 4
    const val MANAGE_SERVER = 1L shl 5
    const val ADD_REACTIONS = 1L shl 6
    const val VIEW_AUDIT_LOG = 1L shl 7
    const val PRIORITY_SPEAKER = 1L shl 8
    const val STREAM = 1L shl 9
    const val VIEW_CHANNEL = 1L shl 10
    const val SEND_MESSAGES = 1L shl 11
    const val MANAGE_MESSAGES = 1L shl 13
    const val EMBED_LINKS = 1L shl 14
    const val ATTACH_FILES = 1L shl 15
    const val READ_MESSAGE_HISTORY = 1L shl 16
    const val MENTION_EVERYONE = 1L shl 17
    const val CONNECT = 1L shl 20
    const val SPEAK = 1L shl 21
    const val MUTE_MEMBERS = 1L shl 22
    const val DEAFEN_MEMBERS = 1L shl 23
    const val MOVE_MEMBERS = 1L shl 24
    const val USE_VAD = 1L shl 25
    const val CHANGE_NICKNAME = 1L shl 26
    const val MANAGE_NICKNAMES = 1L shl 27
    const val MANAGE_ROLES = 1L shl 28
    const val MANAGE_WEBHOOKS = 1L shl 29
    const val MANAGE_EMOJIS = 1L shl 30
    const val MODERATE_MEMBERS = 1L shl 40
    const val USE_SOUNDBOARD = 1L shl 42
    const val CREATE_POLLS = 1L shl 49

    val ALL = listOf(
        CREATE_INSTANT_INVITE, KICK_MEMBERS, BAN_MEMBERS, ADMINISTRATOR, MANAGE_CHANNELS, MANAGE_SERVER, ADD_REACTIONS,
        VIEW_AUDIT_LOG, PRIORITY_SPEAKER, STREAM, VIEW_CHANNEL, SEND_MESSAGES, MANAGE_MESSAGES, EMBED_LINKS, ATTACH_FILES,
        READ_MESSAGE_HISTORY, MENTION_EVERYONE, CONNECT, SPEAK, MUTE_MEMBERS, DEAFEN_MEMBERS, MOVE_MEMBERS, USE_VAD,
        CHANGE_NICKNAME, MANAGE_NICKNAMES, MANAGE_ROLES, MANAGE_WEBHOOKS, MANAGE_EMOJIS, MODERATE_MEMBERS, USE_SOUNDBOARD, CREATE_POLLS,
    ).fold(0L) { a, b -> a or b }

    val DEFAULT_EVERYONE = CREATE_INSTANT_INVITE or ADD_REACTIONS or STREAM or VIEW_CHANNEL or SEND_MESSAGES or EMBED_LINKS or
        ATTACH_FILES or READ_MESSAGE_HISTORY or CONNECT or SPEAK or USE_VAD or CHANGE_NICKNAME or USE_SOUNDBOARD or CREATE_POLLS

    /** What a timed-out member keeps. */
    const val TIMED_OUT_KEEP = VIEW_CHANNEL or READ_MESSAGE_HISTORY

    fun parse(s: String?): Long = s?.toULongOrNull()?.toLong() ?: s?.toLongOrNull() ?: 0L

    fun has(p: Long, need: Long) = p and need == need
}

data class PermRole(val id: String, val position: Int, val permissions: Long)
data class PermMember(val userId: String, val roleIds: List<String>, val timedOut: Boolean)

object Perms {
    fun roles(roles: Collection<Role>) = roles.map { PermRole(it.id, it.position, P.parse(it.permissions)) }

    fun member(m: Member?, userId: String, now: Long = System.currentTimeMillis()) =
        PermMember(userId, m?.roleIds ?: emptyList(), (m?.timeoutUntil ?: 0L) > now)

    fun base(everyoneId: String, roles: List<PermRole>, m: PermMember, isOwner: Boolean): Long {
        if (isOwner) return P.ALL
        val mine = HashSet<String>(m.roleIds.size + 1).apply { add(everyoneId); addAll(m.roleIds) }
        var p = 0L
        for (r in roles) if (r.id in mine) p = p or r.permissions
        if (P.has(p, P.ADMINISTRATOR)) return P.ALL
        if (m.timedOut) p = p and P.TIMED_OUT_KEEP
        return p
    }

    fun compute(everyoneId: String, roles: List<PermRole>, m: PermMember, isOwner: Boolean, overwrites: List<Overwrite>?): Long {
        val b = base(everyoneId, roles, m, isOwner)
        if (isOwner || P.has(b, P.ADMINISTRATOR)) return P.ALL
        var p = b
        val mine = m.roleIds.toHashSet()
        var everyoneOw: Overwrite? = null
        var roleAllow = 0L
        var roleDeny = 0L
        var memberOw: Overwrite? = null
        for (ow in overwrites ?: emptyList()) {
            if (ow.targetType == "role" && ow.targetId == everyoneId) everyoneOw = ow
            else if (ow.targetType == "role" && ow.targetId in mine) {
                roleAllow = roleAllow or P.parse(ow.allow)
                roleDeny = roleDeny or P.parse(ow.deny)
            } else if (ow.targetType == "member" && ow.targetId == m.userId) memberOw = ow
        }
        everyoneOw?.let { p = (p and P.parse(it.deny).inv()) or P.parse(it.allow) }
        p = (p and roleDeny.inv()) or roleAllow
        memberOw?.let { p = (p and P.parse(it.deny).inv()) or P.parse(it.allow) }
        if (m.timedOut) p = p and P.TIMED_OUT_KEEP
        if (!P.has(p, P.VIEW_CHANNEL)) return 0L
        return p
    }

    fun highestPosition(roles: List<PermRole>, m: PermMember): Int {
        var best = 0
        for (id in m.roleIds) for (r in roles) if (r.id == id && r.position > best) best = r.position
        return best
    }

    fun canManageRole(actorHighest: Int, actorIsOwner: Boolean, rolePosition: Int) = actorIsOwner || actorHighest > rolePosition

    fun canActOn(actorHighest: Int, targetHighest: Int, actorIsOwner: Boolean, targetIsOwner: Boolean): Boolean {
        if (targetIsOwner) return false
        return actorIsOwner || actorHighest > targetHighest
    }

    fun isPrivateChannel(everyoneId: String, overwrites: List<Overwrite>?): Boolean {
        val ow = overwrites?.firstOrNull { it.targetType == "role" && it.targetId == everyoneId } ?: return false
        return P.has(P.parse(ow.deny), P.VIEW_CHANNEL)
    }
}

/** Snowflake order: numeric, never lexicographic. */
object Ids {
    const val EPOCH_MS = 1767225600000L

    fun compare(a: String, b: String): Int {
        if (a.length != b.length) return a.length.compareTo(b.length)
        return a.compareTo(b)
    }

    fun createdAt(id: String): Long = (id.toLongOrNull() ?: 0L).let { (it shr 22) + EPOCH_MS }

    fun max(a: String?, b: String?): String? = when {
        a == null -> b
        b == null -> a
        compare(a, b) >= 0 -> a
        else -> b
    }

    /** An id just after this one, for "before" queries that should include it. */
    fun next(id: String): String = ((id.toLongOrNull() ?: 0L) + 1).toString()
}
