package xyz.evilion.chat.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import xyz.evilion.chat.crypto.Envelope

/**
 * The chatd wire types (web/src/api/types.ts).
 *
 * Every id is a decimal string, every timestamp is Unix milliseconds, and
 * every binary field is standard base64. Property names are camelCase here and
 * travel as snake_case; [Api.json] does the conversion.
 */

@Serializable
data class PublicUser(
    val id: String,
    val username: String = "",
    val displayName: String = "",
    val avatarId: String? = null,
    val bannerId: String? = null,
    val aboutMe: String = "",
    val pronouns: String = "",
    val accentColor: Int? = null,
    val accentColor2: Int? = null,
    val statusText: String = "",
    val statusEmoji: String = "",
    val statusExpiresAt: Long? = null,
    val publicKey: String = "",
    val flags: Int = 0,
    val createdAt: Long = 0,
) {
    val name: String get() = displayName.ifEmpty { username }
}

@Serializable
data class MeUser(
    val id: String,
    val username: String = "",
    val displayName: String = "",
    val avatarId: String? = null,
    val bannerId: String? = null,
    val aboutMe: String = "",
    val pronouns: String = "",
    val accentColor: Int? = null,
    val accentColor2: Int? = null,
    val statusText: String = "",
    val statusEmoji: String = "",
    val statusExpiresAt: Long? = null,
    val publicKey: String = "",
    val flags: Int = 0,
    val createdAt: Long = 0,
    val presencePref: String = "online",
    val dmPrivacy: String = "everyone",
    val hasRecovery: Boolean = false,
    val mfaEnabled: Boolean = false,
    val backupCodesLeft: Int = 0,
) {
    val name: String get() = displayName.ifEmpty { username }

    fun toPublic() = PublicUser(
        id, username, displayName, avatarId, bannerId, aboutMe, pronouns, accentColor, accentColor2,
        statusText, statusEmoji, statusExpiresAt, publicKey, flags, createdAt,
    )
}

@Serializable
data class Session(
    val id: String,
    val userAgent: String = "",
    val ip: String = "",
    val createdAt: Long = 0,
    val lastSeenAt: Long = 0,
    val current: Boolean = false,
)

@Serializable
data class Overwrite(
    val channelId: String = "",
    val targetId: String,
    val targetType: String,
    val allow: String = "0",
    val deny: String = "0",
)

@Serializable
data class Channel(
    val id: String,
    val serverId: String? = null,
    val type: String = "text",
    val name: String = "",
    val topic: String = "",
    val position: Int = 0,
    val parentId: String? = null,
    val nsfw: Boolean = false,
    val slowmodeSeconds: Int = 0,
    val userLimit: Int = 0,
    val ownerId: String? = null,
    val iconId: String? = null,
    val lastMessageId: String? = null,
    val createdAt: Long = 0,
    val recipientIds: List<String> = emptyList(),
    /** The conversation whose keys encrypt this channel. */
    val keyConvId: String = "0",
    val overwrites: List<Overwrite>? = null,
) {
    val isDm: Boolean get() = type == "dm" || type == "group_dm"
    val isVoice: Boolean get() = type == "voice"
    val isCategory: Boolean get() = type == "category"
    val isText: Boolean get() = type == "text" || type == "subchat" || isDm
}

@Serializable
data class Server(
    val id: String,
    val name: String = "",
    val iconId: String? = null,
    val bannerId: String? = null,
    val ownerId: String = "",
    val description: String = "",
    val systemChannelId: String? = null,
    val defaultNotifications: Int = 0,
    val flags: Int = 0,
    val createdAt: Long = 0,
)

@Serializable
data class Member(
    val serverId: String = "",
    val userId: String,
    val nickname: String = "",
    val avatarId: String? = null,
    val joinedAt: Long = 0,
    val timeoutUntil: Long? = null,
    val flags: Int = 0,
    val roleIds: List<String> = emptyList(),
)

@Serializable
data class Role(
    val id: String,
    val serverId: String = "",
    val name: String = "",
    val color: Int = 0,
    val hoist: Boolean = false,
    val mentionable: Boolean = false,
    val position: Int = 0,
    val permissions: String = "0",
    val iconId: String? = null,
    val createdAt: Long = 0,
)

@Serializable
data class ServerView(
    val id: String,
    val name: String = "",
    val iconId: String? = null,
    val bannerId: String? = null,
    val ownerId: String = "",
    val description: String = "",
    val systemChannelId: String? = null,
    val defaultNotifications: Int = 0,
    val flags: Int = 0,
    val createdAt: Long = 0,
    val channels: List<Channel> = emptyList(),
    val roles: List<Role> = emptyList(),
    val members: List<Member> = emptyList(),
    val memberCount: Int = 0,
    val me: Member? = null,
    val myPermissions: String = "0",
) {
    fun toServer() = Server(id, name, iconId, bannerId, ownerId, description, systemChannelId, defaultNotifications, flags, createdAt)
}

/** What joining an invite gives back: the server, and the people in it. */
@Serializable
data class JoinResult(val server: ServerView, val users: List<PublicUser> = emptyList())

@Serializable
data class Invite(
    val code: String,
    val serverId: String? = null,
    val channelId: String? = null,
    val inviterId: String = "",
    val maxUses: Int = 0,
    val uses: Int = 0,
    val expiresAt: Long? = null,
    val createdAt: Long = 0,
)

@Serializable
data class InvitePreviewServer(
    val id: String,
    val name: String = "",
    val iconId: String? = null,
    val bannerId: String? = null,
    val description: String = "",
    val memberCount: Int = 0,
    val onlineCount: Int = 0,
)

@Serializable
data class InvitePreviewGroup(val id: String, val name: String = "", val iconId: String? = null, val memberCount: Int = 0)

@Serializable
data class InvitePreviewChannel(val id: String, val name: String = "", val type: String = "text")

@Serializable
data class InvitePreview(
    val code: String,
    val server: InvitePreviewServer? = null,
    val group: InvitePreviewGroup? = null,
    val channel: InvitePreviewChannel? = null,
    val inviter: PublicUser? = null,
    val expiresAt: Long? = null,
)

@Serializable
data class Ban(val serverId: String = "", val userId: String, val reason: String = "", val bannedBy: String = "", val createdAt: Long = 0)

@Serializable
data class AuditEntry(
    val id: String,
    val serverId: String = "",
    val actorId: String = "",
    val action: String = "",
    val targetType: String = "",
    val targetId: String? = null,
    val changes: JsonElement? = null,
    val reason: String = "",
    val createdAt: Long = 0,
)

@Serializable
data class Emoji(
    val id: String,
    val serverId: String = "",
    val name: String = "",
    val blobId: String = "",
    val animated: Boolean = false,
    val creatorId: String = "",
    val createdAt: Long = 0,
)

@Serializable
data class Sticker(
    val id: String,
    val packId: String = "",
    val name: String = "",
    val tags: String = "",
    val blobId: String = "",
    val format: String = "png",
    val position: Int = 0,
    val creatorId: String = "",
    val createdAt: Long = 0,
    val width: Int? = null,
    val height: Int? = null,
    val animated: Boolean = false,
)

@Serializable
data class StickerPack(
    val id: String,
    val kind: String = "sticker",
    val ownerUserId: String? = null,
    val serverId: String? = null,
    val name: String = "",
    val description: String = "",
    val coverStickerId: String? = null,
    @SerialName("public") val isPublic: Boolean = false,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
    val stickers: List<Sticker> = emptyList(),
    val installed: Boolean = false,
)

@Serializable
data class StickerInfo(val sticker: Sticker, val pack: StickerPack, val users: List<PublicUser> = emptyList())

@Serializable
data class GifResult(val id: String, val url: String, val preview: String, val w: Int = 0, val h: Int = 0, val title: String = "")

@Serializable
data class GifPage(val results: List<GifResult> = emptyList(), val next: String = "")

@Serializable
data class GuestMark(val epoch: Int)

@Serializable
data class CallUser(val id: String, val displayName: String = "", val avatarId: String? = null, val flags: Int = 0)

@Serializable
data class VoiceState(
    val userId: String,
    val channelId: String? = null,
    val oldChannelId: String? = null,
    val sessionId: String = "",
    val selfMute: Boolean = false,
    val selfDeaf: Boolean = false,
    val video: Boolean = false,
    val streaming: Boolean = false,
    val serverMute: Boolean = false,
    val serverDeaf: Boolean = false,
    val joinedAt: Long = 0,
    /** What this participant publishes: kind (audio, video, screen, screen_audio) to a tag. */
    val media: Map<String, String>? = null,
    val user: CallUser? = null,
    val guest: GuestMark? = null,
)

@Serializable
data class GuestLink(
    val code: String,
    val channelId: String = "",
    val creatorId: String = "",
    val epoch: Int = 0,
    val createdAt: Long = 0,
    val expiresAt: Long = 0,
    val guests: Int = 0,
)

@Serializable
data class GuestInfo(
    val id: String,
    val displayName: String = "",
    val channelId: String = "",
    val epoch: Int = 0,
    val expiresAt: Long = 0,
    val sfu: Boolean = false,
)

@Serializable
data class IceServer(
    val urls: JsonElement? = null,
    val username: String? = null,
    val credential: String? = null,
)

@Serializable
data class IceConfig(val iceServers: List<IceServer> = emptyList(), val sfu: Boolean = false, val guests: Boolean = true)

@Serializable
data class Attachment(val id: String, val blobId: String, val size: Long = 0)

@Serializable
data class ReactionSummary(val emoji: String, val count: Int = 0, val me: Boolean = false)

@Serializable
data class Message(
    val id: String,
    val channelId: String,
    val authorId: String,
    val type: String = "default",
    val ciphertext: Envelope? = null,
    val keyConvId: String? = null,
    val keyEpoch: Int? = null,
    val replyToId: String? = null,
    val mentions: List<String> = emptyList(),
    val mentionRoles: List<String> = emptyList(),
    val mentionEveryone: Boolean = false,
    val attachments: List<Attachment> = emptyList(),
    val reactions: List<ReactionSummary> = emptyList(),
    val flags: Int = 0,
    val nonce: String? = null,
    val editedAt: Long? = null,
    val createdAt: Long = 0,
)

@Serializable
data class Relationship(val user: PublicUser, val type: String, val nickname: String = "", val createdAt: Long = 0)

@Serializable
data class ReadState(
    val channelId: String,
    val lastReadMessageId: String? = null,
    val lastAckAt: Long = 0,
    val mentionCount: Int = 0,
    val unreadCount: Int = 0,
)

@Serializable
data class KeyGrant(
    val convId: String,
    val epoch: Int,
    val userId: String = "",
    val wrappedKey: String = "",
    val wrappedBy: String = "",
    val createdAt: Long = 0,
)

@Serializable
data class KeyNeed(val convId: String, val epoch: Int, val userIds: List<String> = emptyList(), val rotate: Boolean = false)

@Serializable
data class KeyEpoch(val convId: String, val epoch: Int, val createdBy: String = "", val createdAt: Long = 0, val reason: String = "")

@Serializable
data class KeyFlags(val convId: String, val needsRotation: Boolean = false, val needsOwnKey: Boolean = false)

@Serializable
data class EpochList(val epochs: List<KeyEpoch> = emptyList(), val flags: KeyFlags? = null, val entitled: List<String> = emptyList())

@Serializable
data class EpochCreated(val convId: String, val epoch: Int, val userIds: List<String> = emptyList())

@Serializable
data class GrantUpload(val convId: String, val epoch: Int, val userId: String, val wrappedKey: String)

@Serializable
data class ActivityTimestamps(val start: Long? = null, val end: Long? = null)

@Serializable
data class ActivityAssets(
    val largeImage: String? = null,
    val largeText: String? = null,
    val smallImage: String? = null,
    val smallText: String? = null,
)

@Serializable
data class Activity(
    val name: String = "",
    val type: Int = 0,
    val statusDisplayType: Int? = null,
    val details: String? = null,
    val state: String? = null,
    val timestamps: ActivityTimestamps? = null,
    val assets: ActivityAssets? = null,
    val iconUrl: String? = null,
    val createdAt: Long = 0,
)

@Serializable
data class Presence(
    val userId: String,
    val status: String = "offline",
    val statusText: String = "",
    val statusEmoji: String = "",
    val statusExpiresAt: Long? = null,
    val activities: List<Activity> = emptyList(),
)

@Serializable
data class SettingsBlob(val blob: String = "", val version: Int = 0, val updatedAt: Long = 0)

@Serializable
data class ReadyPayload(
    val sessionId: String = "",
    val user: MeUser? = null,
    val users: List<PublicUser> = emptyList(),
    val channels: List<Channel> = emptyList(),
    val relationships: List<Relationship> = emptyList(),
    val readStates: List<ReadState> = emptyList(),
    val presences: List<Presence> = emptyList(),
    val keyGrants: List<KeyGrant> = emptyList(),
    val settings: SettingsBlob? = null,
    val servers: List<ServerView> = emptyList(),
    val emojis: List<Emoji> = emptyList(),
    val stickerPacks: List<StickerPack> = emptyList(),
    val voiceStates: List<VoiceState> = emptyList(),
    val guest: GuestInfo? = null,
)

@Serializable
data class UnfurlResult(
    val url: String,
    val type: String = "link",
    val title: String? = null,
    val description: String? = null,
    val siteName: String? = null,
    val image: String? = null,
    val imageW: Int? = null,
    val imageH: Int? = null,
    val videoId: String? = null,
    val mime: String? = null,
    val color: String? = null,
    val inviteCode: String? = null,
    val memberCount: Int? = null,
    val onlineCount: Int? = null,
)

@Serializable
data class KdfParamsJson(val m: Int, val t: Int, val p: Int, val v: Int = 1)

@Serializable
data class KdfInfo(val salt: String, val params: KdfParamsJson)

@Serializable
data class RegisterRequest(
    val username: String,
    val displayName: String,
    val authKey: String,
    val kdfSalt: String,
    val kdfParams: KdfParamsJson,
    val publicKey: String,
    val encPrivateKey: String,
    val encPrivateKeyRecovery: String? = null,
    val recoveryAuthKey: String? = null,
    val inviteCode: String? = null,
    val registrationKey: String? = null,
)

@Serializable
data class AuthResponse(val user: MeUser, val token: String)

@Serializable
data class LoginResponse(
    val user: MeUser? = null,
    val token: String = "",
    val encPrivateKey: String = "",
    val publicKey: String = "",
    val kdfSalt: String = "",
    val kdfParams: KdfParamsJson? = null,
    /** Set instead of the rest when the account also wants a code. */
    val mfaRequired: Boolean = false,
    val ticket: String = "",
    val backupCodesLeft: Int = 0,
)

@Serializable
data class MfaStatus(val enabled: Boolean = false, val backupCodesLeft: Int = 0, val enabledAt: Long? = null)

@Serializable
data class TotpSetup(val secret: String, val formatted: String = "", val uri: String = "", val ticket: String = "")

@Serializable
data class BackupCodes(val backupCodes: List<String> = emptyList(), val enabled: Boolean = false)

@Serializable
data class RecoverBegin(val publicKey: String, val encPrivateKeyRecovery: String, val ticket: String)

@Serializable
data class SendMessageRequest(
    val ciphertext: Envelope,
    val keyConvId: String,
    val keyEpoch: Int,
    val replyToId: String? = null,
    val mentions: List<String> = emptyList(),
    val mentionRoles: List<String>? = null,
    val mentionEveryone: Boolean? = null,
    val attachments: List<AttachmentRef>? = null,
    val nonce: String,
    val flags: Int? = null,
)

@Serializable
data class AttachmentRef(val blobId: String, val size: Long)

@Serializable
data class UploadSession(val id: String, val size: Long, val received: Long, val chunkSize: Long)

@Serializable
data class BlobResult(val blobId: String, val size: Long = 0)

@Serializable
data class CaptchaInfo(val provider: String = "", val siteKey: String = "")

@Serializable
data class InstanceInfo(
    val name: String = "",
    val version: String = "",
    val registration: String = "open",
    val needsKey: Boolean = false,
    val maxUploadBytes: Long = 0,
    val gifSearch: Boolean = false,
    val publicUrl: String = "",
    val turnConfigured: Boolean = false,
    val captcha: CaptchaInfo? = null,
    val uploadSingleBytes: Long = 0,
    val uploadChunkBytes: Long = 0,
    val maxStickerBytes: Long = 0,
)

@Serializable
data class AdminStats(
    val users: Int = 0,
    val servers: Int = 0,
    val messages: Int = 0,
    val blobs: Int = 0,
    val blobBytes: Long = 0,
    val online: Int = 0,
    val version: String = "",
)

@Serializable
data class AdminUser(
    val id: String,
    val username: String = "",
    val displayName: String = "",
    val flags: Int = 0,
    val createdAt: Long = 0,
    val admin: Boolean = false,
    val disabled: Boolean = false,
)

@Serializable
data class AdminSettings(
    val registration: String = "open",
    val registrationKeySet: Boolean = false,
    val maxUploadBytes: Long = 0,
    val gifSearch: Boolean = false,
    val turn: Boolean = false,
)

@Serializable
data class SfuDescription(val type: String, val sdp: String)

@Serializable
data class SfuSession(val sessionId: String)

@Serializable
data class SfuTrackRequest(val mid: String, val kind: String, val bitrate: Int? = null)

@Serializable
data class SfuPublishRequest(val sessionId: String, val offer: SfuDescription, val tracks: List<SfuTrackRequest>)

@Serializable
data class SfuPublishReply(val answer: SfuDescription? = null, val failed: Int = 0)

@Serializable
data class SfuSubscribeTrack(val userId: String, val kind: String)

@Serializable
data class SfuSubscribeRequest(val sessionId: String, val tracks: List<SfuSubscribeTrack>)

@Serializable
data class SfuPulled(val mid: String? = null, val userId: String = "", val kind: String = "", val tag: String? = null, val error: String? = null)

@Serializable
data class SfuSubscribeReply(val offer: SfuDescription? = null, val renegotiate: Boolean = false, val tracks: List<SfuPulled> = emptyList())

@Serializable
data class SfuRenegotiateRequest(val sessionId: String, val description: SfuDescription)

@Serializable
data class SfuRenegotiateReply(val description: SfuDescription? = null)

@Serializable
data class SfuRestartRequest(val sessionId: String, val offer: SfuDescription, val mid: String, val kind: String)

@Serializable
data class SfuRestartReply(val answer: SfuDescription? = null)

@Serializable
data class SfuCloseRequest(val sessionId: String, val mids: List<String>, val offer: SfuDescription? = null)

@Serializable
data class SfuCloseReply(val answer: SfuDescription? = null, val renegotiate: Boolean = false)

@Serializable
data class GuestJoinRequest(val code: String, val displayName: String)

@Serializable
data class GuestJoinResponse(val token: String, val guest: GuestInfo, val channel: Channel? = null, val key: String? = null)
