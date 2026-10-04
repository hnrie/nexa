package fish.nexa.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Wire types for the chatd REST API and gateway (web/src/api/types.ts).
 * Every id is a decimal string, every timestamp Unix milliseconds, every
 * binary field standard base64. Go marshals nil slices as null, so every list
 * has a default and `coerceInputValues` turns a null into it.
 */
typealias Snowflake = String

val wireJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
    encodeDefaults = true
}

@Serializable
data class WornTag(
    @SerialName("server_id") val serverId: Snowflake = "",
    val text: String = "",
    val badge: String = "",
    val color: Long? = null,
)

@Serializable
data class PublicUser(
    val id: Snowflake,
    val username: String = "",
    @SerialName("display_name") val displayName: String = "",
    @SerialName("avatar_id") val avatarId: Snowflake? = null,
    @SerialName("banner_id") val bannerId: Snowflake? = null,
    @SerialName("about_me") val aboutMe: String = "",
    val pronouns: String = "",
    @SerialName("accent_color") val accentColor: Long? = null,
    @SerialName("accent_color_2") val accentColor2: Long? = null,
    @SerialName("status_text") val statusText: String = "",
    @SerialName("status_emoji") val statusEmoji: String = "",
    @SerialName("status_expires_at") val statusExpiresAt: Long? = null,
    @SerialName("public_key") val publicKey: String = "",
    val flags: Long = 0,
    @SerialName("group_link_only") val groupLinkOnly: Boolean = false,
    @SerialName("created_at") val createdAt: Long = 0,
    @SerialName("typing_style") val typingStyle: JsonElement? = null,
    @SerialName("server_tag") val serverTag: WornTag? = null,
) {
    val isAdmin get() = flags and 1L != 0L
    val isSystem get() = flags and 16L != 0L
    val isWebhook get() = flags and 32L != 0L
    val isGuest get() = flags and 8L != 0L
    val name get() = displayName.ifBlank { username }
}

@Serializable
data class NexaRestriction(
    val until: Long? = null,
    val reason: String = "",
    @SerialName("case_id") val caseId: Snowflake? = null,
)

/** The account's moderation standing (api/moderation.ts NexaState); kept loose, as it grows. */
@Serializable
data class NexaState(
    val mute: JsonElement? = null,
    val ban: JsonElement? = null,
    val unread: Int = 0,
)

@Serializable
data class MeUser(
    val id: Snowflake,
    val username: String = "",
    @SerialName("display_name") val displayName: String = "",
    @SerialName("avatar_id") val avatarId: Snowflake? = null,
    @SerialName("banner_id") val bannerId: Snowflake? = null,
    @SerialName("about_me") val aboutMe: String = "",
    val pronouns: String = "",
    @SerialName("accent_color") val accentColor: Long? = null,
    @SerialName("accent_color_2") val accentColor2: Long? = null,
    @SerialName("status_text") val statusText: String = "",
    @SerialName("status_emoji") val statusEmoji: String = "",
    @SerialName("status_expires_at") val statusExpiresAt: Long? = null,
    @SerialName("public_key") val publicKey: String = "",
    val flags: Long = 0,
    @SerialName("group_link_only") val groupLinkOnly: Boolean = false,
    @SerialName("created_at") val createdAt: Long = 0,
    @SerialName("typing_style") val typingStyle: JsonElement? = null,
    @SerialName("server_tag") val serverTag: WornTag? = null,
    @SerialName("presence_pref") val presencePref: String = "online",
    @SerialName("dm_privacy") val dmPrivacy: String = "friends_servers",
    @SerialName("has_recovery") val hasRecovery: Boolean = false,
    @SerialName("mfa_enabled") val mfaEnabled: Boolean = false,
    @SerialName("backup_codes_left") val backupCodesLeft: Int = 0,
    val nexa: JsonElement? = null,
) {
    fun asPublic() = PublicUser(
        id, username, displayName, avatarId, bannerId, aboutMe, pronouns, accentColor, accentColor2, statusText, statusEmoji,
        statusExpiresAt, publicKey, flags and (1L or 16L or 32L), groupLinkOnly, createdAt, typingStyle, serverTag,
    )
    val isAdmin get() = flags and 1L != 0L
    val name get() = displayName.ifBlank { username }
}

@Serializable
data class Session(
    val id: Snowflake,
    @SerialName("user_agent") val userAgent: String = "",
    val ip: String = "",
    @SerialName("created_at") val createdAt: Long = 0,
    @SerialName("last_seen_at") val lastSeenAt: Long = 0,
    val current: Boolean = false,
)

@Serializable
data class Overwrite(
    @SerialName("channel_id") val channelId: Snowflake = "",
    @SerialName("target_id") val targetId: Snowflake,
    @SerialName("target_type") val targetType: String,
    val allow: String = "0",
    val deny: String = "0",
)

@Serializable
data class Channel(
    val id: Snowflake,
    @SerialName("server_id") val serverId: Snowflake? = null,
    val type: String = "text",
    val name: String = "",
    val topic: String = "",
    val position: Int = 0,
    @SerialName("parent_id") val parentId: Snowflake? = null,
    val nsfw: Boolean = false,
    @SerialName("slowmode_seconds") val slowmodeSeconds: Int = 0,
    @SerialName("user_limit") val userLimit: Int = 0,
    @SerialName("owner_id") val ownerId: Snowflake? = null,
    @SerialName("icon_id") val iconId: Snowflake? = null,
    @SerialName("last_message_id") val lastMessageId: Snowflake? = null,
    @SerialName("created_at") val createdAt: Long = 0,
    @SerialName("recipient_ids") val recipientIds: List<Snowflake> = emptyList(),
    @SerialName("key_conv_id") val keyConvId: Snowflake = "",
    val overwrites: List<Overwrite>? = null,
    val locked: Boolean = false,
    val glyph: String? = null,
) {
    val isDmLike get() = type == "dm" || type == "group_dm" || type == "subchat"
    val isText get() = type == "text"
    val isVoice get() = type == "voice"
    val isCategory get() = type == "category"
}

@Serializable
data class ServerTag(
    val text: String = "",
    val badge: String = "",
    val color: Long? = null,
    val limited: Boolean = false,
    val roles: List<Snowflake> = emptyList(),
    val join: Boolean = false,
)

@Serializable
data class Server(
    val id: Snowflake,
    val name: String = "",
    @SerialName("icon_id") val iconId: Snowflake? = null,
    @SerialName("banner_id") val bannerId: Snowflake? = null,
    @SerialName("owner_id") val ownerId: Snowflake = "",
    val description: String = "",
    @SerialName("system_channel_id") val systemChannelId: Snowflake? = null,
    @SerialName("default_notifications") val defaultNotifications: Int = 0,
    val flags: Long = 0,
    @SerialName("created_at") val createdAt: Long = 0,
    val tag: ServerTag? = null,
)

@Serializable
data class Member(
    @SerialName("server_id") val serverId: Snowflake = "",
    @SerialName("user_id") val userId: Snowflake,
    val nickname: String = "",
    @SerialName("avatar_id") val avatarId: Snowflake? = null,
    @SerialName("joined_at") val joinedAt: Long = 0,
    @SerialName("timeout_until") val timeoutUntil: Long? = null,
    val flags: Long = 0,
    @SerialName("role_ids") val roleIds: List<Snowflake> = emptyList(),
)

@Serializable
data class Role(
    val id: Snowflake,
    @SerialName("server_id") val serverId: Snowflake = "",
    val name: String = "",
    val color: Long = 0,
    val hoist: Boolean = false,
    val mentionable: Boolean = false,
    val position: Int = 0,
    val permissions: String = "0",
    @SerialName("icon_id") val iconId: Snowflake? = null,
    @SerialName("created_at") val createdAt: Long = 0,
)

@Serializable
data class ServerView(
    val id: Snowflake,
    val name: String = "",
    @SerialName("icon_id") val iconId: Snowflake? = null,
    @SerialName("banner_id") val bannerId: Snowflake? = null,
    @SerialName("owner_id") val ownerId: Snowflake = "",
    val description: String = "",
    @SerialName("system_channel_id") val systemChannelId: Snowflake? = null,
    @SerialName("default_notifications") val defaultNotifications: Int = 0,
    val flags: Long = 0,
    @SerialName("created_at") val createdAt: Long = 0,
    val tag: ServerTag? = null,
    val channels: List<Channel> = emptyList(),
    val roles: List<Role> = emptyList(),
    val members: List<Member> = emptyList(),
    @SerialName("member_count") val memberCount: Int = 0,
    val me: Member? = null,
    @SerialName("my_permissions") val myPermissions: String = "0",
) {
    fun server() = Server(id, name, iconId, bannerId, ownerId, description, systemChannelId, defaultNotifications, flags, createdAt, tag)
}

@Serializable
data class Invite(
    val code: String,
    @SerialName("server_id") val serverId: Snowflake? = null,
    @SerialName("channel_id") val channelId: Snowflake? = null,
    @SerialName("inviter_id") val inviterId: Snowflake = "",
    @SerialName("max_uses") val maxUses: Int = 0,
    val uses: Int = 0,
    @SerialName("expires_at") val expiresAt: Long? = null,
    @SerialName("created_at") val createdAt: Long = 0,
)

@Serializable
data class InviteServer(
    val id: Snowflake,
    val name: String = "",
    @SerialName("icon_id") val iconId: Snowflake? = null,
    @SerialName("banner_id") val bannerId: Snowflake? = null,
    val description: String = "",
    @SerialName("member_count") val memberCount: Int = 0,
    @SerialName("online_count") val onlineCount: Int = 0,
)

@Serializable
data class InviteGroup(
    val id: Snowflake,
    val name: String = "",
    @SerialName("icon_id") val iconId: Snowflake? = null,
    @SerialName("member_count") val memberCount: Int = 0,
)

@Serializable
data class InviteChannel(val id: Snowflake, val name: String = "", val type: String = "text")

@Serializable
data class InvitePreview(
    val code: String,
    val server: InviteServer? = null,
    val group: InviteGroup? = null,
    val channel: InviteChannel? = null,
    val inviter: PublicUser? = null,
    @SerialName("expires_at") val expiresAt: Long? = null,
)

@Serializable
data class Ban(
    @SerialName("server_id") val serverId: Snowflake = "",
    @SerialName("user_id") val userId: Snowflake,
    val reason: String = "",
    @SerialName("banned_by") val bannedBy: Snowflake = "",
    @SerialName("created_at") val createdAt: Long = 0,
)

@Serializable
data class AuditEntry(
    val id: Snowflake,
    @SerialName("server_id") val serverId: Snowflake = "",
    @SerialName("actor_id") val actorId: Snowflake = "",
    val action: String = "",
    @SerialName("target_type") val targetType: String = "",
    @SerialName("target_id") val targetId: Snowflake? = null,
    val changes: JsonElement? = null,
    val reason: String = "",
    @SerialName("created_at") val createdAt: Long = 0,
)

@Serializable
data class Emoji(
    val id: Snowflake,
    @SerialName("server_id") val serverId: Snowflake = "",
    val name: String = "",
    @SerialName("blob_id") val blobId: Snowflake = "",
    val animated: Boolean = false,
    @SerialName("creator_id") val creatorId: Snowflake = "",
    @SerialName("created_at") val createdAt: Long = 0,
)

@Serializable
data class Sticker(
    val id: Snowflake,
    @SerialName("pack_id") val packId: Snowflake = "",
    val name: String = "",
    val tags: String = "",
    @SerialName("blob_id") val blobId: Snowflake = "",
    val format: String = "png",
    val position: Int = 0,
    @SerialName("creator_id") val creatorId: Snowflake = "",
    @SerialName("created_at") val createdAt: Long = 0,
    val width: Int? = null,
    val height: Int? = null,
    val animated: Boolean = false,
)

@Serializable
data class StickerPack(
    val id: Snowflake,
    val kind: String = "sticker",
    @SerialName("owner_user_id") val ownerUserId: Snowflake? = null,
    @SerialName("server_id") val serverId: Snowflake? = null,
    val name: String = "",
    val description: String = "",
    @SerialName("cover_sticker_id") val coverStickerId: Snowflake? = null,
    val public: Boolean = false,
    @SerialName("created_at") val createdAt: Long = 0,
    @SerialName("updated_at") val updatedAt: Long = 0,
    val stickers: List<Sticker> = emptyList(),
    val installed: Boolean = false,
)

@Serializable
data class StickerInfo(val sticker: Sticker, val pack: StickerPack, val users: List<PublicUser> = emptyList())

@Serializable
data class GifResult(val id: String, val url: String, val preview: String = "", val w: Int = 0, val h: Int = 0, val title: String = "")

@Serializable
data class GifPage(val results: List<GifResult> = emptyList(), val next: String = "")

@Serializable
data class CallUser(
    val id: Snowflake,
    @SerialName("display_name") val displayName: String = "",
    @SerialName("avatar_id") val avatarId: Snowflake? = null,
    val flags: Long = 0,
)

@Serializable
data class GuestEpoch(val epoch: Int = 0)

@Serializable
data class VoiceState(
    @SerialName("user_id") val userId: Snowflake,
    @SerialName("channel_id") val channelId: Snowflake? = null,
    @SerialName("old_channel_id") val oldChannelId: Snowflake? = null,
    @SerialName("session_id") val sessionId: Snowflake = "",
    @SerialName("self_mute") val selfMute: Boolean = false,
    @SerialName("self_deaf") val selfDeaf: Boolean = false,
    val video: Boolean = false,
    val streaming: Boolean = false,
    @SerialName("server_mute") val serverMute: Boolean = false,
    @SerialName("server_deaf") val serverDeaf: Boolean = false,
    @SerialName("joined_at") val joinedAt: Long = 0,
    val media: Map<String, String>? = null,
    /** The video codecs besides VP8 the participant's device can watch: "h264" for a phone's screen share. */
    val codecs: List<String>? = null,
    val user: CallUser? = null,
    val guest: GuestEpoch? = null,
    val reason: String? = null,
)

@Serializable
data class GuestInfo(
    val id: Snowflake,
    @SerialName("display_name") val displayName: String = "",
    @SerialName("channel_id") val channelId: Snowflake = "",
    val epoch: Int = 0,
    @SerialName("expires_at") val expiresAt: Long = 0,
    val sfu: Boolean = false,
)

@Serializable
data class IceServer(val urls: JsonElement, val username: String? = null, val credential: String? = null)

@Serializable
data class InstanceInfo(
    val name: String = "Nexa",
    val version: String = "",
    val registration: String = "open",
    @SerialName("needs_key") val needsKey: Boolean = false,
    @SerialName("max_upload_bytes") val maxUploadBytes: Long = 104857600,
    @SerialName("gif_search") val gifSearch: Boolean = false,
    @SerialName("public_url") val publicUrl: String = "",
    @SerialName("turn_configured") val turnConfigured: Boolean = false,
    val captcha: CaptchaInfo? = null,
    @SerialName("upload_single_bytes") val uploadSingleBytes: Long = 33554432,
    @SerialName("upload_chunk_bytes") val uploadChunkBytes: Long = 33554432,
    @SerialName("max_sticker_bytes") val maxStickerBytes: Long = 5242880,
)

@Serializable
data class CaptchaInfo(val provider: String = "", @SerialName("site_key") val siteKey: String = "")

@Serializable
data class Attachment(val id: Snowflake = "", @SerialName("blob_id") val blobId: Snowflake = "", val size: Long = 0)

@Serializable
data class ReactionSummary(val emoji: String, val count: Int = 0, val me: Boolean = false)

@Serializable
data class PollAnswerCount(val id: Int, val count: Int = 0, @SerialName("me_voted") val meVoted: Boolean = false)

@Serializable
data class PollTally(
    @SerialName("answer_counts") val answerCounts: List<PollAnswerCount> = emptyList(),
    @SerialName("total_voters") val totalVoters: Int = 0,
    @SerialName("expires_at") val expiresAt: Long? = null,
    @SerialName("is_finalized") val isFinalized: Boolean = false,
)

@Serializable
data class PollOutcome(
    @SerialName("answer_counts") val answerCounts: List<PollAnswerCount> = emptyList(),
    @SerialName("total_votes") val totalVotes: Int = 0,
    @SerialName("total_voters") val totalVoters: Int = 0,
    @SerialName("victor_answer_id") val victorAnswerId: Int = 0,
    @SerialName("victor_answer_votes") val victorAnswerVotes: Int = 0,
)

@Serializable
data class Message(
    val id: Snowflake,
    @SerialName("channel_id") val channelId: Snowflake,
    @SerialName("author_id") val authorId: Snowflake = "",
    val type: String = "default",
    val ciphertext: JsonElement? = null,
    @SerialName("key_conv_id") val keyConvId: Snowflake? = null,
    @SerialName("key_epoch") val keyEpoch: Int? = null,
    @SerialName("reply_to_id") val replyToId: Snowflake? = null,
    val mentions: List<Snowflake> = emptyList(),
    @SerialName("mention_roles") val mentionRoles: List<Snowflake> = emptyList(),
    @SerialName("mention_everyone") val mentionEveryone: Boolean = false,
    val attachments: List<Attachment> = emptyList(),
    val reactions: List<ReactionSummary> = emptyList(),
    val flags: Long = 0,
    val nonce: String? = null,
    @SerialName("edited_at") val editedAt: Long? = null,
    @SerialName("created_at") val createdAt: Long = 0,
    @SerialName("webhook_id") val webhookId: Snowflake? = null,
    val webhook: JsonElement? = null,
    @SerialName("poll_results") val pollResults: PollTally? = null,
    @SerialName("poll_result") val pollResult: PollOutcome? = null,
) {
    val pinned get() = flags and MSG_FLAG_PINNED != 0L
    val suppressEmbeds get() = flags and MSG_FLAG_SUPPRESS_EMBEDS != 0L
    val silent get() = flags and MSG_FLAG_SUPPRESS_NOTIFICATIONS != 0L

    companion object {
        const val MSG_FLAG_PINNED = 1L
        const val MSG_FLAG_SUPPRESS_EMBEDS = 4L
        const val MSG_FLAG_SUPPRESS_NOTIFICATIONS = 1L shl 12
        const val MSG_FLAG_COMPONENTS_V2 = 1L shl 15
    }
}

@Serializable
data class PollRequest(
    @SerialName("answer_count") val answerCount: Int,
    val duration: Int,
    @SerialName("allow_multiselect") val allowMultiselect: Boolean,
)

@Serializable
data class Webhook(
    val id: Snowflake,
    val type: Int = 1,
    @SerialName("server_id") val serverId: Snowflake = "",
    @SerialName("channel_id") val channelId: Snowflake = "",
    val name: String = "",
    val avatar: Snowflake? = null,
    val token: String? = null,
    val url: String? = null,
    @SerialName("created_at") val createdAt: Long = 0,
)

@Serializable
data class Relationship(
    val user: PublicUser,
    val type: String,
    val nickname: String = "",
    val note: String? = null,
    @SerialName("created_at") val createdAt: Long = 0,
)

@Serializable
data class ReadState(
    @SerialName("channel_id") val channelId: Snowflake,
    @SerialName("last_read_message_id") val lastReadMessageId: Snowflake? = null,
    @SerialName("last_ack_at") val lastAckAt: Long = 0,
    @SerialName("mention_count") val mentionCount: Int = 0,
    @SerialName("unread_count") val unreadCount: Int = 0,
    val manual: Boolean = false,
)

@Serializable
data class KeyGrant(
    @SerialName("conv_id") val convId: Snowflake,
    val epoch: Int,
    @SerialName("user_id") val userId: Snowflake = "",
    @SerialName("wrapped_key") val wrappedKey: String,
    @SerialName("wrapped_by") val wrappedBy: Snowflake = "",
    @SerialName("created_at") val createdAt: Long = 0,
)

@Serializable
data class KeyNeed(
    @SerialName("conv_id") val convId: Snowflake,
    val epoch: Int,
    @SerialName("user_ids") val userIds: List<Snowflake> = emptyList(),
    val rotate: Boolean = false,
)

@Serializable
data class KeyEpoch(
    @SerialName("conv_id") val convId: Snowflake,
    val epoch: Int,
    @SerialName("created_by") val createdBy: Snowflake = "",
    @SerialName("created_at") val createdAt: Long = 0,
    val reason: String = "",
)

@Serializable
data class KeyFlags(
    @SerialName("conv_id") val convId: Snowflake,
    @SerialName("needs_rotation") val needsRotation: Boolean = false,
    @SerialName("needs_own_key") val needsOwnKey: Boolean = false,
)

@Serializable
data class ActivityTimestamps(val start: Long? = null, val end: Long? = null)

@Serializable
data class ActivityAssets(
    @SerialName("large_image") val largeImage: String? = null,
    @SerialName("large_text") val largeText: String? = null,
    @SerialName("large_url") val largeUrl: String? = null,
    @SerialName("small_image") val smallImage: String? = null,
    @SerialName("small_text") val smallText: String? = null,
    @SerialName("small_url") val smallUrl: String? = null,
)

@Serializable
data class ActivityButton(val label: String, val url: String)

@Serializable
data class ActivityParty(val id: String? = null, val size: List<Long>? = null)

@Serializable
data class Activity(
    @SerialName("application_id") val applicationId: String? = null,
    val name: String = "",
    val type: Int = 0,
    @SerialName("status_display_type") val statusDisplayType: Int? = null,
    val details: String? = null,
    @SerialName("details_url") val detailsUrl: String? = null,
    val state: String? = null,
    @SerialName("state_url") val stateUrl: String? = null,
    val timestamps: ActivityTimestamps? = null,
    val assets: ActivityAssets? = null,
    val party: ActivityParty? = null,
    val buttons: List<ActivityButton>? = null,
    val instance: Boolean = false,
    @SerialName("icon_url") val iconUrl: String? = null,
    val source: String? = null,
    @SerialName("created_at") val createdAt: Long = 0,
)

@Serializable
data class Presence(
    @SerialName("user_id") val userId: Snowflake,
    val status: String = "offline",
    @SerialName("status_text") val statusText: String = "",
    @SerialName("status_emoji") val statusEmoji: String = "",
    @SerialName("status_expires_at") val statusExpiresAt: Long? = null,
    val activities: List<Activity>? = null,
)

@Serializable
data class SettingsBlob(val blob: String = "", val version: Long = 0, @SerialName("updated_at") val updatedAt: Long? = null)

@Serializable
data class GroupAddNotice(
    @SerialName("channel_id") val channelId: Snowflake,
    @SerialName("added_by") val addedBy: Snowflake,
    @SerialName("added_at") val addedAt: Long = 0,
)

@Serializable
data class ReadyPayload(
    @SerialName("session_id") val sessionId: Snowflake = "",
    val user: MeUser,
    val users: List<PublicUser> = emptyList(),
    val channels: List<Channel> = emptyList(),
    val relationships: List<Relationship> = emptyList(),
    @SerialName("read_states") val readStates: List<ReadState> = emptyList(),
    val presences: List<Presence> = emptyList(),
    @SerialName("key_grants") val keyGrants: List<KeyGrant> = emptyList(),
    val settings: SettingsBlob? = null,
    val servers: List<ServerView> = emptyList(),
    val emojis: List<Emoji> = emptyList(),
    @SerialName("sticker_packs") val stickerPacks: List<StickerPack> = emptyList(),
    @SerialName("voice_states") val voiceStates: List<VoiceState> = emptyList(),
    @SerialName("group_add_notices") val groupAddNotices: List<GroupAddNotice> = emptyList(),
    val guest: GuestInfo? = null,
    val nexa: JsonElement? = null,
)

@Serializable
data class KdfParamsJson(val m: Int, val t: Int, val p: Int, val v: Int = 1)

@Serializable
data class KdfInfo(val salt: String, val params: KdfParamsJson)

@Serializable
data class RegisterRequest(
    val username: String,
    @SerialName("display_name") val displayName: String,
    @SerialName("auth_key") val authKey: String,
    @SerialName("kdf_salt") val kdfSalt: String,
    @SerialName("kdf_params") val kdfParams: KdfParamsJson,
    @SerialName("public_key") val publicKey: String,
    @SerialName("enc_private_key") val encPrivateKey: String,
    @SerialName("enc_private_key_recovery") val encPrivateKeyRecovery: String? = null,
    @SerialName("recovery_auth_key") val recoveryAuthKey: String? = null,
    @SerialName("invite_code") val inviteCode: String? = null,
    @SerialName("registration_key") val registrationKey: String? = null,
)

/** A login answer: either a session (user, token and the key bundle) or a request for a second factor. */
@Serializable
data class LoginResult(
    val user: MeUser? = null,
    val token: String? = null,
    @SerialName("public_key") val publicKey: String? = null,
    @SerialName("enc_private_key") val encPrivateKey: String? = null,
    @SerialName("kdf_salt") val kdfSalt: String? = null,
    @SerialName("kdf_params") val kdfParams: KdfParamsJson? = null,
    @SerialName("mfa_required") val mfaRequired: Boolean = false,
    val ticket: String? = null,
    @SerialName("backup_codes_left") val backupCodesLeft: Int = 0,
)

@Serializable
data class KeyBundle(
    @SerialName("public_key") val publicKey: String,
    @SerialName("enc_private_key") val encPrivateKey: String,
    @SerialName("kdf_salt") val kdfSalt: String,
    @SerialName("kdf_params") val kdfParams: KdfParamsJson,
)

@Serializable
data class RecoverBegin(
    @SerialName("public_key") val publicKey: String,
    @SerialName("enc_private_key_recovery") val encPrivateKeyRecovery: String,
    val ticket: String,
)

@Serializable
data class MfaStatus(val enabled: Boolean = false, @SerialName("backup_codes_left") val backupCodesLeft: Int = 0, @SerialName("enabled_at") val enabledAt: Long? = null)

@Serializable
data class TotpSetup(val secret: String, val formatted: String = "", val uri: String = "", val ticket: String)

@Serializable
data class UnfurlResult(
    val url: String,
    val type: String = "link",
    val raw: JsonObject? = null,
)
