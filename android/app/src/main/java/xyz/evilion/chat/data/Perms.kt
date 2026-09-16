package xyz.evilion.chat.data

import xyz.evilion.chat.net.Member
import xyz.evilion.chat.net.Overwrite
import xyz.evilion.chat.net.Role

/**
 * Discord-compatible permission bitsets, mirroring internal/perms on the
 * server and web/src/lib/perms.ts in the browser. Bits reach 2^49, so they are
 * unsigned 64-bit; the wire form is a decimal string.
 */
object P {
    val CREATE_INSTANT_INVITE = 1UL shl 0
    val KICK_MEMBERS = 1UL shl 1
    val BAN_MEMBERS = 1UL shl 2
    val ADMINISTRATOR = 1UL shl 3
    val MANAGE_CHANNELS = 1UL shl 4
    val MANAGE_SERVER = 1UL shl 5
    val ADD_REACTIONS = 1UL shl 6
    val VIEW_AUDIT_LOG = 1UL shl 7
    val PRIORITY_SPEAKER = 1UL shl 8
    val STREAM = 1UL shl 9
    val VIEW_CHANNEL = 1UL shl 10
    val SEND_MESSAGES = 1UL shl 11
    val MANAGE_MESSAGES = 1UL shl 13
    val EMBED_LINKS = 1UL shl 14
    val ATTACH_FILES = 1UL shl 15
    val READ_MESSAGE_HISTORY = 1UL shl 16
    val MENTION_EVERYONE = 1UL shl 17
    val CONNECT = 1UL shl 20
    val SPEAK = 1UL shl 21
    val MUTE_MEMBERS = 1UL shl 22
    val DEAFEN_MEMBERS = 1UL shl 23
    val MOVE_MEMBERS = 1UL shl 24
    val USE_VAD = 1UL shl 25
    val CHANGE_NICKNAME = 1UL shl 26
    val MANAGE_NICKNAMES = 1UL shl 27
    val MANAGE_ROLES = 1UL shl 28
    val MANAGE_EMOJIS = 1UL shl 30
    val MODERATE_MEMBERS = 1UL shl 40
    val USE_SOUNDBOARD = 1UL shl 42
    val CREATE_POLLS = 1UL shl 49

    val ALL = CREATE_INSTANT_INVITE or KICK_MEMBERS or BAN_MEMBERS or ADMINISTRATOR or MANAGE_CHANNELS or MANAGE_SERVER or
        ADD_REACTIONS or VIEW_AUDIT_LOG or PRIORITY_SPEAKER or STREAM or VIEW_CHANNEL or SEND_MESSAGES or MANAGE_MESSAGES or
        EMBED_LINKS or ATTACH_FILES or READ_MESSAGE_HISTORY or MENTION_EVERYONE or CONNECT or SPEAK or MUTE_MEMBERS or
        DEAFEN_MEMBERS or MOVE_MEMBERS or USE_VAD or CHANGE_NICKNAME or MANAGE_NICKNAMES or MANAGE_ROLES or MANAGE_EMOJIS or
        MODERATE_MEMBERS or USE_SOUNDBOARD or CREATE_POLLS

    val TIMED_OUT_KEEP = VIEW_CHANNEL or READ_MESSAGE_HISTORY

    /** The names, labels and help the role and channel editors show. */
    data class Item(val bit: ULong, val label: String, val description: String, val channels: Set<String> = emptySet())

    val GROUPS: List<Pair<String, List<Item>>> = listOf(
        "General Server Permissions" to listOf(
            Item(VIEW_CHANNEL, "View Channels", "Allows members to view channels by default (excluding private channels).", setOf("text", "voice")),
            Item(MANAGE_CHANNELS, "Manage Channels", "Allows members to create, edit, or delete channels.", setOf("text", "voice")),
            Item(MANAGE_ROLES, "Manage Roles", "Allows members to create roles and edit ones below their highest, and to edit channel permissions.", setOf("text", "voice")),
            Item(MANAGE_EMOJIS, "Manage Expressions", "Allows members to add or remove custom emoji and stickers in this server."),
            Item(VIEW_AUDIT_LOG, "View Audit Log", "Allows members to see a record of who made which changes in this server."),
            Item(MANAGE_SERVER, "Manage Server", "Allows members to change this server's name, icon, description and invites."),
        ),
        "Membership Permissions" to listOf(
            Item(CREATE_INSTANT_INVITE, "Create Invite", "Allows members to invite new people to this server.", setOf("text", "voice")),
            Item(CHANGE_NICKNAME, "Change Nickname", "Allows members to change their own nickname."),
            Item(MANAGE_NICKNAMES, "Manage Nicknames", "Allows members to change the nicknames of other members."),
            Item(KICK_MEMBERS, "Kick Members", "Allows members to remove others from this server. They can rejoin with an invite."),
            Item(BAN_MEMBERS, "Ban Members", "Allows members to permanently ban other members."),
            Item(MODERATE_MEMBERS, "Time out Members", "Allows members to time others out: no messages, reactions or speaking until it ends."),
        ),
        "Text Channel Permissions" to listOf(
            Item(SEND_MESSAGES, "Send Messages", "Allows members to send messages in text channels.", setOf("text")),
            Item(EMBED_LINKS, "Embed Links", "Allows links that members share to show embedded content.", setOf("text")),
            Item(ATTACH_FILES, "Attach Files", "Allows members to upload files or media.", setOf("text")),
            Item(ADD_REACTIONS, "Add Reactions", "Allows members to add new emoji reactions to a message.", setOf("text")),
            Item(MENTION_EVERYONE, "Mention @everyone and All Roles", "Allows members to use @everyone and any role mention.", setOf("text")),
            Item(MANAGE_MESSAGES, "Manage Messages", "Allows members to delete other people's messages or pin any message.", setOf("text")),
            Item(READ_MESSAGE_HISTORY, "Read Message History", "Allows members to read messages sent before they arrived.", setOf("text")),
            Item(CREATE_POLLS, "Create Polls", "Allows members to create polls.", setOf("text")),
        ),
        "Voice Channel Permissions" to listOf(
            Item(CONNECT, "Connect", "Allows members to join voice channels and hear others.", setOf("voice")),
            Item(SPEAK, "Speak", "Allows members to talk in voice channels.", setOf("voice")),
            Item(STREAM, "Video", "Allows members to share their camera or screen.", setOf("voice")),
            Item(USE_SOUNDBOARD, "Use Soundboard", "Allows members to send sounds from the soundboard.", setOf("voice")),
            Item(USE_VAD, "Use Voice Activity", "Allows talking without push-to-talk.", setOf("voice")),
            Item(PRIORITY_SPEAKER, "Priority Speaker", "Lowers other people's volume while they speak.", setOf("voice")),
            Item(MUTE_MEMBERS, "Mute Members", "Allows muting other members for everyone.", setOf("voice")),
            Item(DEAFEN_MEMBERS, "Deafen Members", "Allows deafening other members.", setOf("voice")),
            Item(MOVE_MEMBERS, "Move Members", "Allows moving members between voice channels.", setOf("voice")),
        ),
        "Advanced Permissions" to listOf(
            Item(ADMINISTRATOR, "Administrator", "Every permission, and channel permissions are bypassed. Grant with care."),
        ),
    )
}

fun String?.toPerm(): ULong = this?.toULongOrNull() ?: 0UL

fun ULong.has(need: ULong): Boolean = (this and need) == need

object Permissions {
    /** Server-level: @everyone OR the member's roles; Administrator and ownership grant everything. */
    fun base(serverId: String, roles: Collection<Role>, member: Member?, isOwner: Boolean): ULong {
        if (isOwner) return P.ALL
        val mine = buildSet {
            add(serverId)
            member?.roleIds?.let { addAll(it) }
        }
        var p = 0UL
        for (r in roles) if (r.id in mine) p = p or r.permissions.toPerm()
        return if (p.has(P.ADMINISTRATOR)) P.ALL else p
    }

    /**
     * A member's permissions in a channel: base, then the @everyone overwrite,
     * then role overwrites, then the member overwrite, then a timeout; no view
     * means nothing at all.
     */
    fun compute(
        serverId: String,
        roles: Collection<Role>,
        member: Member?,
        userId: String,
        isOwner: Boolean,
        overwrites: List<Overwrite>?,
        now: Long = System.currentTimeMillis(),
    ): ULong {
        val b = base(serverId, roles, member, isOwner)
        if (isOwner || b.has(P.ADMINISTRATOR)) return P.ALL
        var p = b
        val mine = member?.roleIds?.toSet() ?: emptySet()
        var everyone: Overwrite? = null
        var roleAllow = 0UL
        var roleDeny = 0UL
        var memberOw: Overwrite? = null
        for (ow in overwrites ?: emptyList()) {
            when {
                ow.targetType == "role" && ow.targetId == serverId -> everyone = ow
                ow.targetType == "role" && ow.targetId in mine -> {
                    roleAllow = roleAllow or ow.allow.toPerm()
                    roleDeny = roleDeny or ow.deny.toPerm()
                }
                ow.targetType == "member" && ow.targetId == userId -> memberOw = ow
            }
        }
        everyone?.let { p = (p and it.deny.toPerm().inv()) or it.allow.toPerm() }
        p = (p and roleDeny.inv()) or roleAllow
        memberOw?.let { p = (p and it.deny.toPerm().inv()) or it.allow.toPerm() }
        val timedOut = (member?.timeoutUntil ?: 0) > now
        if (timedOut) p = p and P.TIMED_OUT_KEEP
        if (!p.has(P.VIEW_CHANNEL)) return 0UL
        return p
    }

    /** Position of the member's highest role (0 = only @everyone). */
    fun highestPosition(roles: Collection<Role>, member: Member?): Int {
        var best = 0
        for (id in member?.roleIds ?: emptyList()) {
            for (r in roles) if (r.id == id && r.position > best) best = r.position
        }
        return best
    }

    fun canManageRole(actorHighest: Int, actorIsOwner: Boolean, rolePosition: Int): Boolean =
        actorIsOwner || actorHighest > rolePosition

    fun canActOn(actorHighest: Int, targetHighest: Int, actorIsOwner: Boolean, targetIsOwner: Boolean): Boolean =
        if (targetIsOwner) false else actorIsOwner || actorHighest > targetHighest

    /** True when @everyone cannot view the channel: the lock icon, and the own-key rule. */
    fun isPrivateChannel(serverId: String, overwrites: List<Overwrite>?): Boolean {
        val ow = overwrites?.firstOrNull { it.targetType == "role" && it.targetId == serverId } ?: return false
        return ow.deny.toPerm().has(P.VIEW_CHANNEL)
    }
}
