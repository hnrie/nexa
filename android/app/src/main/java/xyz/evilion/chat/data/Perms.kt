package xyz.evilion.chat.data

import xyz.evilion.chat.i18n.t
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
        t("perms.generalServerPermissions") to listOf(
            Item(VIEW_CHANNEL, t("perms.viewChannels"), t("perms.allowsMembersToViewChannelsBy"), setOf("text", "voice")),
            Item(MANAGE_CHANNELS, t("perms.manageChannels"), t("perms.allowsMembersToCreateEditOr"), setOf("text", "voice")),
            Item(MANAGE_ROLES, t("perms.manageRoles"), t("perms.allowsMembersToCreateRolesAnd"), setOf("text", "voice")),
            Item(MANAGE_EMOJIS, t("perms.manageExpressions"), t("perms.allowsMembersToAddOrRemove2")),
            Item(VIEW_AUDIT_LOG, t("perms.viewAuditLog"), t("perms.allowsMembersToSeeARecord")),
            Item(MANAGE_SERVER, t("perms.manageServer"), t("perms.allowsMembersToChangeThisServer")),
        ),
        t("perms.membershipPermissions") to listOf(
            Item(CREATE_INSTANT_INVITE, t("server.invites.createInvite"), t("perms.allowsMembersToInviteNewPeople"), setOf("text", "voice")),
            Item(CHANGE_NICKNAME, t("modals.serverProfile.changeNickname"), t("perms.allowsMembersToChangeTheirOwn")),
            Item(MANAGE_NICKNAMES, t("perms.manageNicknames"), t("perms.allowsMembersToChangeTheNicknames")),
            Item(KICK_MEMBERS, t("perms.kickMembers"), t("perms.allowsMembersToRemoveOthersFrom")),
            Item(BAN_MEMBERS, t("perms.banMembers"), t("perms.allowsMembersToPermanentlyBanOther2")),
            Item(MODERATE_MEMBERS, t("perms.timeOutMembers"), t("perms.allowsMembersToTimeOthersOut")),
        ),
        t("perms.textChannelPermissions") to listOf(
            Item(SEND_MESSAGES, t("perms.sendMessages"), t("perms.allowsMembersToSendMessagesIn"), setOf("text")),
            Item(EMBED_LINKS, t("perms.embedLinks"), t("perms.allowsLinksThatMembersShareTo"), setOf("text")),
            Item(ATTACH_FILES, t("perms.attachFiles"), t("perms.allowsMembersToUploadFilesOr"), setOf("text")),
            Item(ADD_REACTIONS, t("perms.addReactions"), t("perms.allowsMembersToAddNewEmoji"), setOf("text")),
            Item(MENTION_EVERYONE, t("perms.mentionEveryoneAndAllRoles"), t("perms.allowsMembersToUseEveryoneAnd2"), setOf("text")),
            Item(MANAGE_MESSAGES, t("perms.manageMessages"), t("perms.allowsMembersToDeleteOtherPeople"), setOf("text")),
            Item(READ_MESSAGE_HISTORY, t("perms.readMessageHistory"), t("perms.allowsMembersToReadMessagesSent"), setOf("text")),
            Item(CREATE_POLLS, t("perms.createPolls"), t("perms.allowsMembersToCreatePolls"), setOf("text")),
        ),
        t("perms.voiceChannelPermissions") to listOf(
            Item(CONNECT, t("perms.connect"), t("perms.allowsMembersToJoinVoiceChannels"), setOf("voice")),
            Item(SPEAK, t("perms.speak"), t("perms.allowsMembersToTalkInVoice"), setOf("voice")),
            Item(STREAM, t("perms.video"), t("perms.allowsMembersToShareTheirCamera"), setOf("voice")),
            Item(USE_SOUNDBOARD, t("perms.useSoundboard"), t("perms.allowsMembersToSendSoundsFrom"), setOf("voice")),
            Item(USE_VAD, t("perms.useVoiceActivity"), t("perms.allowsTalkingWithoutPushToTalk"), setOf("voice")),
            Item(PRIORITY_SPEAKER, t("perms.prioritySpeaker"), t("perms.lowersOtherPeopleSVolumeWhile"), setOf("voice")),
            Item(MUTE_MEMBERS, t("perms.muteMembers"), t("perms.allowsMutingOtherMembersForEveryone"), setOf("voice")),
            Item(DEAFEN_MEMBERS, t("perms.deafenMembers"), t("perms.allowsDeafeningOtherMembers"), setOf("voice")),
            Item(MOVE_MEMBERS, t("perms.moveMembers"), t("perms.allowsMovingMembersBetweenVoiceChannels"), setOf("voice")),
        ),
        t("perms.advancedPermissions") to listOf(
            Item(ADMINISTRATOR, t("perms.administrator"), t("perms.everyPermissionAndChannelPermissionsAre")),
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
