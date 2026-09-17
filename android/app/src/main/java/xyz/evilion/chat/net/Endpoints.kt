package xyz.evilion.chat.net

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add

/**
 * Every route chatd serves, grouped the way web/src/api is.
 *
 * A captcha token, when the instance asks for one, rides in the X-Captcha-Token
 * header of the request it was made for.
 */

private fun captcha(token: String?): Map<String, String> =
    if (token.isNullOrEmpty()) emptyMap() else mapOf("X-Captcha-Token" to token)

object AuthApi {
    suspend fun register(body: RegisterRequest, captchaToken: String? = null): AuthResponse =
        Api.request("POST", "/auth/register", Api.body(body), headers = captcha(captchaToken))

    suspend fun kdf(username: String): KdfInfo =
        Api.request("GET", "/auth/kdf", query = mapOf("username" to username))

    suspend fun login(username: String, authKey: String, captchaToken: String? = null): LoginResponse =
        Api.request("POST", "/auth/login", Api.body(buildJsonObject {
            put("username", username); put("auth_key", authKey)
        }), headers = captcha(captchaToken))

    suspend fun loginMfa(ticket: String, code: String?, backupCode: String?): LoginResponse =
        Api.request("POST", "/auth/login/mfa", Api.body(buildJsonObject {
            put("ticket", ticket)
            code?.let { put("code", it) }
            backupCode?.let { put("backup_code", it) }
        }))

    suspend fun logout() = Api.request<Unit>("POST", "/auth/logout")

    suspend fun sessions(): List<Session> = Api.request("GET", "/auth/sessions")

    suspend fun deleteSession(id: String) = Api.request<Unit>("DELETE", "/auth/sessions/$id")

    suspend fun mfaStatus(): MfaStatus = Api.request("GET", "/auth/mfa")

    suspend fun totpSetup(authKey: String): TotpSetup =
        Api.request("POST", "/auth/mfa/totp/setup", Api.body(buildJsonObject { put("auth_key", authKey) }))

    suspend fun totpEnable(ticket: String, code: String): BackupCodes =
        Api.request("POST", "/auth/mfa/totp/enable", Api.body(buildJsonObject { put("ticket", ticket); put("code", code) }))

    suspend fun mfaDisable(authKey: String): MfaStatus =
        Api.request("POST", "/auth/mfa/disable", Api.body(buildJsonObject { put("auth_key", authKey) }))

    suspend fun newBackupCodes(authKey: String): BackupCodes =
        Api.request("POST", "/auth/mfa/backup", Api.body(buildJsonObject { put("auth_key", authKey) }))

    suspend fun recoverBegin(username: String, recoveryAuthKey: String, captchaToken: String? = null): RecoverBegin =
        Api.request("POST", "/auth/recover/begin", Api.body(buildJsonObject {
            put("username", username); put("recovery_auth_key", recoveryAuthKey)
        }), headers = captcha(captchaToken))

    suspend fun recoverFinish(body: JsonObject): LoginResponse =
        Api.request("POST", "/auth/recover/finish", body.toString())

    suspend fun changePassword(body: JsonObject) = Api.request<Unit>("POST", "/auth/password", body.toString())

    suspend fun replaceRecovery(body: JsonObject) = Api.request<Unit>("POST", "/auth/recovery", body.toString())
}

object UsersApi {
    suspend fun me(): MeUser = Api.request("GET", "/users/@me")

    suspend fun patchMe(patch: JsonObject): MeUser = Api.request("PATCH", "/users/@me", patch.toString())

    suspend fun deleteMe(authKey: String) =
        Api.request<Unit>("POST", "/users/@me/delete", Api.body(buildJsonObject { put("auth_key", authKey) }))

    suspend fun settings(): SettingsBlob? = Api.request("GET", "/users/@me/settings")

    suspend fun putSettings(blob: String, version: Int): SettingsBlob =
        Api.request("PUT", "/users/@me/settings", Api.body(buildJsonObject { put("blob", blob); put("version", version) }))

    suspend fun search(q: String): List<PublicUser> = Api.request("GET", "/users/search", query = mapOf("q" to q))

    suspend fun user(id: String): PublicUser = Api.request("GET", "/users/$id")

    suspend fun profile(id: String): JsonObject = Api.request("GET", "/users/$id/profile")

    suspend fun publicKey(id: String): String =
        (Api.request<JsonObject>("GET", "/users/$id/public-key")["public_key"] as? JsonPrimitive)?.content.orEmpty()

    suspend fun uploadAvatar(kind: String, bytes: ByteArray, contentType: String): JsonObject {
        val text = Api.upload("PUT", "/users/@me/$kind", bytes, mapOf("Content-Type" to contentType))
        return Api.json.parseToJsonElement(text).jsonObject
    }

    suspend fun deleteAvatar(kind: String) = Api.request<Unit>("DELETE", "/users/@me/$kind")
}

object ChannelsApi {
    suspend fun dms(): List<Channel> = Api.request("GET", "/users/@me/channels")

    suspend fun createDm(recipientIds: List<String>, name: String? = null): Channel =
        Api.request("POST", "/users/@me/channels", Api.body(buildJsonObject {
            putJsonArray("recipient_ids") { for (id in recipientIds) add(id) }
            name?.let { put("name", it) }
        }))

    suspend fun channel(id: String): Channel = Api.request("GET", "/channels/$id")

    suspend fun patch(id: String, patch: JsonObject): Channel = Api.request("PATCH", "/channels/$id", patch.toString())

    suspend fun delete(id: String) = Api.request<Unit>("DELETE", "/channels/$id")

    suspend fun addRecipient(id: String, userId: String) = Api.request<Unit>("POST", "/channels/$id/recipients/$userId")

    suspend fun removeRecipient(id: String, userId: String) = Api.request<Unit>("DELETE", "/channels/$id/recipients/$userId")

    suspend fun typing(id: String) = Api.request<Unit>("POST", "/channels/$id/typing")

    suspend fun pins(id: String): List<Message> = Api.request("GET", "/channels/$id/pins")

    suspend fun pin(id: String, messageId: String) = Api.request<Unit>("PUT", "/channels/$id/pins/$messageId")

    suspend fun unpin(id: String, messageId: String) = Api.request<Unit>("DELETE", "/channels/$id/pins/$messageId")

    suspend fun putOverwrite(channelId: String, targetId: String, body: JsonObject) =
        Api.request<Unit>("PUT", "/channels/$channelId/permissions/$targetId", body.toString())

    suspend fun deleteOverwrite(channelId: String, targetId: String) =
        Api.request<Unit>("DELETE", "/channels/$channelId/permissions/$targetId")

    suspend fun subchats(id: String): List<Channel> = Api.request("GET", "/channels/$id/subchats")

    suspend fun createSubchat(id: String, name: String): Channel =
        Api.request("POST", "/channels/$id/subchats", Api.body(buildJsonObject { put("name", name) }))

    suspend fun groupInvites(id: String): List<Invite> = Api.request("GET", "/channels/$id/invites")
}

object MessagesApi {
    suspend fun list(channelId: String, before: String? = null, after: String? = null, around: String? = null, limit: Int = 50): List<Message> =
        Api.request("GET", "/channels/$channelId/messages", query = mapOf(
            "before" to before, "after" to after, "around" to around, "limit" to limit.toString(),
        ))

    suspend fun send(channelId: String, body: SendMessageRequest): Message =
        Api.request("POST", "/channels/$channelId/messages", Api.body(body))

    suspend fun get(channelId: String, id: String): Message = Api.request("GET", "/channels/$channelId/messages/$id")

    suspend fun edit(channelId: String, id: String, body: JsonObject): Message =
        Api.request("PATCH", "/channels/$channelId/messages/$id", body.toString())

    suspend fun delete(channelId: String, id: String) = Api.request<Unit>("DELETE", "/channels/$channelId/messages/$id")

    suspend fun bulkDelete(channelId: String, ids: List<String>) =
        Api.request<Unit>("POST", "/channels/$channelId/messages/bulk-delete", Api.body(buildJsonObject {
            putJsonArray("ids") { for (id in ids) add(id) }
        }))

    /**
     * Marks a channel read up to a message.
     *
     * An ordinary ack never moves backwards, so marking something *unread*
     * has to say it means it. Without the flag the request is accepted and
     * quietly changes nothing.
     */
    suspend fun ack(channelId: String, messageId: String, manual: Boolean = false) =
        Api.request<Unit>(
            "POST", "/channels/$channelId/messages/$messageId/ack",
            if (manual) Api.body(buildJsonObject { put("manual", true) }) else null,
        )

    suspend fun addReaction(channelId: String, messageId: String, emoji: String) =
        Api.request<Unit>("PUT", "/channels/$channelId/messages/$messageId/reactions/${encode(emoji)}/@me")

    suspend fun removeReaction(channelId: String, messageId: String, emoji: String) =
        Api.request<Unit>("DELETE", "/channels/$channelId/messages/$messageId/reactions/${encode(emoji)}/@me")

    suspend fun reactors(channelId: String, messageId: String, emoji: String): List<PublicUser> =
        Api.request("GET", "/channels/$channelId/messages/$messageId/reactions/${encode(emoji)}")

    private fun encode(emoji: String): String = java.net.URLEncoder.encode(emoji, "UTF-8").replace("+", "%20")
}

object ServersApi {
    suspend fun create(name: String, captchaToken: String? = null): ServerView =
        Api.request("POST", "/servers", Api.body(buildJsonObject { put("name", name) }), headers = captcha(captchaToken))

    suspend fun get(id: String): ServerView = Api.request("GET", "/servers/$id")

    suspend fun patch(id: String, patch: JsonObject): Server = Api.request("PATCH", "/servers/$id", patch.toString())

    suspend fun delete(id: String) = Api.request<Unit>("DELETE", "/servers/$id")

    suspend fun leave(id: String) = Api.request<Unit>("POST", "/servers/$id/leave")

    suspend fun transfer(id: String, userId: String) =
        Api.request<Unit>("POST", "/servers/$id/transfer", Api.body(buildJsonObject { put("user_id", userId) }))

    suspend fun channels(id: String): List<Channel> = Api.request("GET", "/servers/$id/channels")

    suspend fun createChannel(id: String, body: JsonObject): Channel = Api.request("POST", "/servers/$id/channels", body.toString())

    suspend fun channelPositions(id: String, body: String) = Api.request<Unit>("PATCH", "/servers/$id/channels", body)

    suspend fun roles(id: String): List<Role> = Api.request("GET", "/servers/$id/roles")

    suspend fun createRole(id: String, body: JsonObject): Role = Api.request("POST", "/servers/$id/roles", body.toString())

    suspend fun patchRole(id: String, roleId: String, body: JsonObject): Role =
        Api.request("PATCH", "/servers/$id/roles/$roleId", body.toString())

    suspend fun deleteRole(id: String, roleId: String) = Api.request<Unit>("DELETE", "/servers/$id/roles/$roleId")

    suspend fun rolePositions(id: String, body: String) = Api.request<Unit>("PATCH", "/servers/$id/roles", body)

    suspend fun members(id: String, limit: Int = 200, after: String? = null): List<Member> =
        Api.request("GET", "/servers/$id/members", query = mapOf("limit" to limit.toString(), "after" to after))

    suspend fun member(id: String, userId: String): Member = Api.request("GET", "/servers/$id/members/$userId")

    suspend fun patchMember(id: String, userId: String, body: JsonObject): Member =
        Api.request("PATCH", "/servers/$id/members/$userId", body.toString())

    suspend fun kick(id: String, userId: String, reason: String = "") =
        Api.request<Unit>("DELETE", "/servers/$id/members/$userId", query = mapOf("reason" to reason.ifEmpty { null }))

    suspend fun addRole(id: String, userId: String, roleId: String) =
        Api.request<Unit>("PUT", "/servers/$id/members/$userId/roles/$roleId")

    suspend fun removeRole(id: String, userId: String, roleId: String) =
        Api.request<Unit>("DELETE", "/servers/$id/members/$userId/roles/$roleId")

    suspend fun bans(id: String): List<Ban> = Api.request("GET", "/servers/$id/bans")

    suspend fun ban(id: String, userId: String, reason: String) =
        Api.request<Unit>("PUT", "/servers/$id/bans/$userId", Api.body(buildJsonObject { put("reason", reason) }))

    suspend fun unban(id: String, userId: String) = Api.request<Unit>("DELETE", "/servers/$id/bans/$userId")

    suspend fun invites(id: String): List<Invite> = Api.request("GET", "/servers/$id/invites")

    suspend fun createInvite(channelId: String, maxUses: Int, expiresIn: Long?): Invite =
        Api.request("POST", "/channels/$channelId/invites", Api.body(buildJsonObject {
            put("max_uses", maxUses)
            expiresIn?.let { put("expires_in", it) }
        }))

    suspend fun invitePreview(code: String): InvitePreview = Api.request("GET", "/invites/$code")

    suspend fun joinInvite(code: String, captchaToken: String? = null): JoinResult =
        Api.request("POST", "/invites/$code", headers = captcha(captchaToken))

    suspend fun deleteInvite(code: String) = Api.request<Unit>("DELETE", "/invites/$code")

    suspend fun auditLog(id: String, limit: Int = 50, before: String? = null): List<AuditEntry> =
        Api.request("GET", "/servers/$id/audit-log", query = mapOf("limit" to limit.toString(), "before" to before))

    suspend fun voiceModerate(id: String, userId: String, body: JsonObject) =
        Api.request<Unit>("PATCH", "/servers/$id/members/$userId/voice", body.toString())
}

object KeysApi {
    suspend fun grants(): List<KeyGrant> = Api.request("GET", "/keys/grants")

    suspend fun needs(): List<KeyNeed> = Api.request("GET", "/keys/needs")

    suspend fun putGrants(list: List<GrantUpload>) = Api.request<Unit>("POST", "/keys/grants", Api.body(list))

    suspend fun createEpoch(convId: String, reason: String = ""): EpochCreated =
        Api.request("POST", "/keys/epochs", Api.body(buildJsonObject { put("conv_id", convId); put("reason", reason) }))

    suspend fun epochs(convId: String): EpochList =
        Api.request("GET", "/keys/epochs", query = mapOf("conv_id" to convId))
}

object RelationshipsApi {
    suspend fun list(): List<Relationship> = Api.request("GET", "/users/@me/relationships")

    suspend fun request(username: String, captchaToken: String? = null): Relationship =
        Api.request("POST", "/users/@me/relationships", Api.body(buildJsonObject { put("username", username) }), headers = captcha(captchaToken))

    suspend fun accept(userId: String): Relationship = Api.request("PUT", "/users/@me/relationships/$userId")

    suspend fun remove(userId: String) = Api.request<Unit>("DELETE", "/users/@me/relationships/$userId")

    suspend fun nickname(userId: String, nickname: String) =
        Api.request<Unit>("PATCH", "/users/@me/relationships/$userId", Api.body(buildJsonObject { put("nickname", nickname) }))

    suspend fun block(userId: String) = Api.request<Unit>("PUT", "/users/@me/blocks/$userId")

    suspend fun unblock(userId: String) = Api.request<Unit>("DELETE", "/users/@me/blocks/$userId")
}

object ExpressionsApi {
    suspend fun emojis(serverId: String): List<Emoji> = Api.request("GET", "/servers/$serverId/emojis")

    suspend fun createEmoji(serverId: String, name: String, bytes: ByteArray, contentType: String): Emoji {
        val text = Api.upload("POST", "/servers/$serverId/emojis", bytes, mapOf("Content-Type" to contentType), mapOf("name" to name))
        return Api.json.decodeFromString(text)
    }

    suspend fun deleteEmoji(serverId: String, id: String) = Api.request<Unit>("DELETE", "/servers/$serverId/emojis/$id")

    suspend fun packs(): List<StickerPack> = Api.request("GET", "/stickers/packs")

    suspend fun publicPacks(): List<StickerPack> = Api.request("GET", "/stickers/packs/public")

    suspend fun pack(id: String): StickerPack = Api.request("GET", "/stickers/packs/$id")

    suspend fun createPack(body: JsonObject): StickerPack = Api.request("POST", "/stickers/packs", body.toString())

    suspend fun patchPack(id: String, body: JsonObject): StickerPack = Api.request("PATCH", "/stickers/packs/$id", body.toString())

    suspend fun deletePack(id: String) = Api.request<Unit>("DELETE", "/stickers/packs/$id")

    suspend fun install(id: String, install: Boolean) =
        Api.request<Unit>(if (install) "PUT" else "DELETE", "/stickers/packs/$id/install")

    suspend fun sticker(id: String): StickerInfo = Api.request("GET", "/stickers/$id")

    suspend fun createSticker(packId: String, name: String, tags: String, bytes: ByteArray, contentType: String): Sticker {
        val text = Api.upload("POST", "/stickers/packs/$packId/stickers", bytes, mapOf("Content-Type" to contentType),
            mapOf("name" to name, "tags" to tags))
        return Api.json.decodeFromString(text)
    }

    suspend fun deleteSticker(packId: String, id: String) = Api.request<Unit>("DELETE", "/stickers/packs/$packId/stickers/$id")

    suspend fun gifStatus(): JsonObject = Api.request("GET", "/gif/status")

    suspend fun gifSearch(q: String, pos: String? = null): GifPage =
        Api.request("GET", "/gif/search", query = mapOf("q" to q, "pos" to pos))

    suspend fun gifTrending(pos: String? = null): GifPage =
        Api.request("GET", "/gif/trending", query = mapOf("pos" to pos))
}

object VoiceApi {
    suspend fun ice(): IceConfig = Api.request("GET", "/voice/ice")

    suspend fun participants(channelId: String): List<VoiceState> = Api.request("GET", "/channels/$channelId/voice")

    suspend fun decline(channelId: String) = Api.request<Unit>("POST", "/channels/$channelId/call/decline")

    suspend fun sfuSession(): SfuSession = Api.request("POST", "/voice/sfu/session")

    suspend fun sfuPublish(body: SfuPublishRequest): SfuPublishReply =
        Api.request("POST", "/voice/sfu/publish", Api.body(body))

    suspend fun sfuSubscribe(body: SfuSubscribeRequest): SfuSubscribeReply =
        Api.request("POST", "/voice/sfu/subscribe", Api.body(body))

    suspend fun sfuRenegotiate(body: SfuRenegotiateRequest): SfuRenegotiateReply =
        Api.request("PUT", "/voice/sfu/renegotiate", Api.body(body))

    suspend fun sfuRestart(body: SfuRestartRequest): SfuRestartReply =
        Api.request("PUT", "/voice/sfu/restart", Api.body(body))

    suspend fun sfuClose(body: SfuCloseRequest): SfuCloseReply =
        Api.request("PUT", "/voice/sfu/close", Api.body(body))
}

object UploadsApi {
    suspend fun create(size: Long): UploadSession =
        Api.request("POST", "/uploads", Api.body(buildJsonObject { put("size", size) }))

    suspend fun status(id: String): UploadSession = Api.request("GET", "/uploads/$id")

    suspend fun chunk(id: String, offset: Long, bytes: ByteArray, onProgress: ((Long, Long) -> Unit)? = null): UploadSession {
        val text = Api.upload("PATCH", "/uploads/$id", bytes, mapOf("Upload-Offset" to offset.toString()), onProgress = onProgress)
        return Api.json.decodeFromString(text)
    }

    suspend fun finish(id: String): BlobResult = Api.request("POST", "/uploads/$id/finish")

    suspend fun cancel(id: String) = Api.request<Unit>("DELETE", "/uploads/$id")

    /** A whole small attachment in one request. */
    suspend fun attachment(channelId: String, bytes: ByteArray, onProgress: ((Long, Long) -> Unit)? = null): BlobResult {
        val text = Api.upload("POST", "/channels/$channelId/attachments", bytes, onProgress = onProgress)
        return Api.json.decodeFromString(text)
    }
}

object MiscApi {
    suspend fun instance(): InstanceInfo = Api.request("GET", "/instance")

    suspend fun unfurl(url: String): UnfurlResult = Api.request("GET", "/unfurl", query = mapOf("url" to url))

    suspend fun reportError(body: JsonObject) = runCatching { Api.request<Unit>("POST", "/client-errors", body.toString()) }
}

object AdminApi {
    suspend fun stats(): AdminStats = Api.request("GET", "/admin/stats")

    suspend fun users(q: String? = null): List<AdminUser> = Api.request("GET", "/admin/users", query = mapOf("q" to q))

    suspend fun patchUser(id: String, body: JsonObject): AdminUser = Api.request("PATCH", "/admin/users/$id", body.toString())

    suspend fun deleteUser(id: String) = Api.request<Unit>("DELETE", "/admin/users/$id")

    suspend fun settings(): AdminSettings = Api.request("GET", "/admin/settings")

    suspend fun patchSettings(body: JsonObject): AdminSettings = Api.request("PATCH", "/admin/settings", body.toString())
}

object GuestsApi {
    suspend fun links(channelId: String): List<GuestLink> = Api.request("GET", "/channels/$channelId/guest-links")

    suspend fun createLink(channelId: String, expiresIn: Long? = null): GuestLink =
        Api.request("POST", "/channels/$channelId/guest-links", Api.body(buildJsonObject {
            expiresIn?.let { put("expires_in", it) }
        }))

    suspend fun revokeLink(channelId: String, code: String) = Api.request<Unit>("DELETE", "/channels/$channelId/guest-links/$code")

    suspend fun revokeAll(channelId: String) = Api.request<Unit>("DELETE", "/channels/$channelId/guest-links")

    suspend fun removeGuest(channelId: String, guestId: String) = Api.request<Unit>("DELETE", "/channels/$channelId/guests/$guestId")

    suspend fun check(code: String): JsonObject = Api.request("GET", "/guest/links/$code")

    suspend fun join(code: String, displayName: String, captchaToken: String? = null): GuestJoinResponse =
        Api.request("POST", "/guest/join", Api.body(buildJsonObject {
            put("code", code); put("display_name", displayName)
        }), headers = captcha(captchaToken))

    suspend fun leave() = Api.request<Unit>("DELETE", "/guest/me")
}
