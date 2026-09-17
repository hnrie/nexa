package xyz.evilion.chat.data

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import xyz.evilion.chat.crypto.Bytes
import xyz.evilion.chat.crypto.Identity
import xyz.evilion.chat.crypto.Kdf
import xyz.evilion.chat.crypto.Keys
import xyz.evilion.chat.i18n.t
import xyz.evilion.chat.net.*
import xyz.evilion.chat.voice.VoiceSession

enum class AuthStatus {
    /** Still working out whether this device is signed in. */
    LOADING,

    /** No session: the sign-in screen. */
    ANONYMOUS,

    /** A session, but the server cannot be reached to confirm it. */
    OFFLINE,

    /** Signed in, but this device has no identity key: the password unlocks it. */
    LOCKED,

    READY,
}

/** What a password got us: in, or a request for the second factor. */
data class LoginOutcome(val mfaRequired: Boolean, val backupCodesLeft: Int = 0)

/**
 * The signed-in session: who this is, the socket, and everything that arrives
 * through it.
 *
 * The password never leaves the device. Argon2id stretches it into a master
 * key, HKDF splits that into the key the server checks and the key that
 * unwraps this account's identity, and every conversation key is opened here
 * with that identity.
 */
object Session {
    private const val TAG = "Session"

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val _status = MutableStateFlow(AuthStatus.LOADING)
    val status: StateFlow<AuthStatus> = _status.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /** Short notices the UI shows as toasts. */
    val toasts = MutableSharedFlow<String>(extraBufferCapacity = 8)

    val gateway = Gateway(scope, { Api.token })
    val connection: StateFlow<GatewayStatus> get() = gateway.status

    /** Set while a sign-in is waiting for a code from an authenticator app. */
    private var pendingMfa: Triple<String, ByteArray, String>? = null

    /** Someone rang while the app was open; the UI puts up the incoming-call screen. */
    val ringing = MutableStateFlow<Pair<String, String>?>(null)

    /**
     * A recovery key that has just been made and not yet been written down.
     * It is shown once, over whatever is on screen, because signing in lands
     * on the app itself and the screen that made it is gone by then.
     */
    val pendingRecoveryKey = MutableStateFlow<String?>(null)

    @Volatile
    var sessionId: String = ""
        private set

    fun start() {
        Api.onUnauthorized = { scope.launch { signOutLocally() } }
        scope.launch {
            gateway.events.collect { event ->
                runCatching { dispatch(event) }
                    .onFailure { Log.w(TAG, "event ${event.type} failed", it) }
            }
        }
    }

    // --- sign in -----------------------------------------------------------

    suspend fun loadInstance(): InstanceInfo? =
        runCatching { MiscApi.instance() }.getOrNull()?.also { AppState.instance.value = it }

    /** Picks up a session left on this device. */
    suspend fun bootstrap() {
        SecureStore.serverUrl()?.let { Api.baseUrl = it }
        scope.launch { loadInstance() }
        val token = SecureStore.token()
        if (token.isNullOrEmpty()) {
            _status.value = AuthStatus.ANONYMOUS
            return
        }
        Api.token = token
        if (_status.value != AuthStatus.OFFLINE) _status.value = AuthStatus.LOADING
        try {
            val me = UsersApi.me()
            AppState.me.value = me
            val identity = SecureStore.identity(me.id)
            if (identity == null) {
                _status.value = AuthStatus.LOCKED
                return
            }
            goLive(me, identity)
        } catch (e: Throwable) {
            if (e !is ApiException) {
                // A response the app cannot parse, a keystore that will not
                // open: whatever it is, starting up must not end the process.
                _error.value = e.readable("bootstrap")
                _status.value = AuthStatus.OFFLINE
                return
            }
            when {
                e.isAuth -> signOutLocally()
                e.isTransient -> {
                    // Only the server turning us down means signed out. A dropped
                    // connection or a restart keeps the session and waits.
                    _error.value = t("offline.couldNotReachTheServer")
                    _status.value = AuthStatus.OFFLINE
                }
                else -> {
                    _error.value = e.message
                    _status.value = AuthStatus.ANONYMOUS
                }
            }
        }
    }

    suspend fun login(username: String, password: String): LoginOutcome {
        val kdf = AuthApi.kdf(username)
        val salt = Bytes.unb64(kdf.salt)
        val params = Kdf.Params(kdf.params.m, kdf.params.t, kdf.params.p)
        val master = withContext(Dispatchers.Default) { Kdf.deriveMaster(password, salt, params) }
        val authKey = Kdf.authKey(master)
        val encKey = Kdf.encKey(master)
        Bytes.wipe(master)
        val res = guarded("login") { captcha -> AuthApi.login(username, Bytes.b64(authKey), captcha) }
        if (res.mfaRequired) {
            pendingMfa = Triple(username, encKey, res.ticket)
            return LoginOutcome(true, res.backupCodesLeft)
        }
        finishLogin(res, encKey)
        return LoginOutcome(false)
    }

    suspend fun completeMfa(code: String?, backupCode: String?) {
        val pending = pendingMfa ?: throw IllegalStateException(t("auth.startAgainFromYourPassword"))
        val res = AuthApi.loginMfa(pending.third, code?.replace(" ", ""), backupCode)
        finishLogin(res, pending.second)
        pendingMfa = null
    }

    fun cancelMfa() {
        pendingMfa = null
    }

    private suspend fun finishLogin(res: LoginResponse, encKey: ByteArray) {
        val me = res.user ?: throw ApiException(0, "bad_response", t("attachments.theServerSAnswerCouldNot"))
        val priv = Keys.unwrapPrivateKey(Bytes.unb64(res.encPrivateKey), encKey)
        val identity = Identity(Bytes.unb64(res.publicKey), priv)
        SecureStore.saveToken(res.token, me.id)
        SecureStore.saveIdentity(me.id, identity)
        SecureStore.saveServerUrl(Api.baseUrl)
        Api.token = res.token
        AppState.me.value = me
        goLive(me, identity)
    }

    /** Signing in on a device that has the session but not the keys. */
    suspend fun unlock(password: String) {
        val me = AppState.me.value ?: throw IllegalStateException(t("session.signInAgain"))
        val kdf = AuthApi.kdf(me.username)
        val master = withContext(Dispatchers.Default) {
            Kdf.deriveMaster(password, Bytes.unb64(kdf.salt), Kdf.Params(kdf.params.m, kdf.params.t, kdf.params.p))
        }
        val encKey = Kdf.encKey(master)
        Bytes.wipe(master)
        val mine = UsersApi.me()
        val keys = Api.request<JsonObject>("GET", "/users/@me/keys")
        val encPrivate = keys["enc_private_key"]?.jsonPrimitive?.content ?: throw DecryptFailed()
        val publicKey = keys["public_key"]?.jsonPrimitive?.content ?: mine.publicKey
        val priv = try {
            Keys.unwrapPrivateKey(Bytes.unb64(encPrivate), encKey)
        } catch (_: Exception) {
            throw DecryptFailed()
        }
        val identity = Identity(Bytes.unb64(publicKey), priv)
        SecureStore.saveIdentity(mine.id, identity)
        AppState.me.value = mine
        goLive(mine, identity)
    }

    class DecryptFailed : Exception(t("session.thatPasswordDoesNotOpenThe"))

    suspend fun register(
        username: String,
        displayName: String,
        password: String,
        inviteCode: String? = null,
        registrationKey: String? = null,
    ): String {
        val salt = Bytes.random(16)
        val params = Kdf.DEFAULT
        val master = withContext(Dispatchers.Default) { Kdf.deriveMaster(password, salt, params) }
        val authKey = Kdf.authKey(master)
        val encKey = Kdf.encKey(master)
        Bytes.wipe(master)
        val identity = Keys.generateIdentity()
        val (recoveryBytes, recoveryDisplay) = Kdf.newRecoveryKey()
        val (recoveryAuth, recoveryEnc) = Kdf.recoveryKeys(recoveryBytes)
        val body = RegisterRequest(
            username = username,
            displayName = displayName,
            authKey = Bytes.b64(authKey),
            kdfSalt = Bytes.b64(salt),
            kdfParams = KdfParamsJson(params.m, params.t, params.p),
            publicKey = Bytes.b64(identity.publicKey),
            encPrivateKey = Bytes.b64(Keys.wrapPrivateKey(identity.privateKey, encKey)),
            encPrivateKeyRecovery = Bytes.b64(Keys.wrapPrivateKey(identity.privateKey, recoveryEnc)),
            recoveryAuthKey = Bytes.b64(recoveryAuth),
            inviteCode = inviteCode,
            registrationKey = registrationKey,
        )
        val res = guarded("register") { captcha -> AuthApi.register(body, captcha) }
        pendingRecoveryKey.value = recoveryDisplay
        SecureStore.saveToken(res.token, res.user.id)
        SecureStore.saveIdentity(res.user.id, identity)
        SecureStore.saveServerUrl(Api.baseUrl)
        Api.token = res.token
        AppState.me.value = res.user
        goLive(res.user, identity)
        return recoveryDisplay
    }

    /** Takes an account back with its recovery key and sets a new password. */
    suspend fun recover(username: String, recoveryKey: String, newPassword: String): String {
        val recoveryBytes = Kdf.recoveryKeyToBytes(recoveryKey)
        val (recoveryAuth, recoveryEnc) = Kdf.recoveryKeys(recoveryBytes)
        val begin = guarded("recover") { captcha ->
            AuthApi.recoverBegin(username, Bytes.b64(recoveryAuth), captcha)
        }
        val priv = Keys.unwrapPrivateKey(Bytes.unb64(begin.encPrivateKeyRecovery), recoveryEnc)
        val identity = Identity(Bytes.unb64(begin.publicKey), priv)

        val salt = Bytes.random(16)
        val params = Kdf.DEFAULT
        val master = withContext(Dispatchers.Default) { Kdf.deriveMaster(newPassword, salt, params) }
        val authKey = Kdf.authKey(master)
        val encKey = Kdf.encKey(master)
        Bytes.wipe(master)
        val (nextRecoveryBytes, nextRecoveryDisplay) = Kdf.newRecoveryKey()
        val (nextAuth, nextEnc) = Kdf.recoveryKeys(nextRecoveryBytes)
        val res = AuthApi.recoverFinish(buildJsonObject {
            put("username", username)
            put("recovery_auth_key", Bytes.b64(recoveryAuth))
            put("new_auth_key", Bytes.b64(authKey))
            put("new_kdf_salt", Bytes.b64(salt))
            put("new_kdf_params", Api.json.encodeToJsonElement(KdfParamsJson.serializer(), KdfParamsJson(params.m, params.t, params.p)))
            put("new_enc_private_key", Bytes.b64(Keys.wrapPrivateKey(identity.privateKey, encKey)))
            put("new_recovery_auth_key", Bytes.b64(nextAuth))
            put("new_enc_private_key_recovery", Bytes.b64(Keys.wrapPrivateKey(identity.privateKey, nextEnc)))
            put("ticket", begin.ticket)
        })
        finishLogin(res, encKey)
        pendingRecoveryKey.value = nextRecoveryDisplay
        return nextRecoveryDisplay
    }

    /** The key the server checks, derived from a password with this account's parameters. */
    private suspend fun authKeyFor(password: String): Pair<ByteArray, ByteArray> {
        val me = AppState.me.value ?: throw IllegalStateException(t("session.signInAgain"))
        val kdf = AuthApi.kdf(me.username)
        val master = withContext(Dispatchers.Default) {
            Kdf.deriveMaster(password, Bytes.unb64(kdf.salt), Kdf.Params(kdf.params.m, kdf.params.t, kdf.params.p))
        }
        val keys = Kdf.authKey(master) to Kdf.encKey(master)
        Bytes.wipe(master)
        return keys
    }

    /**
     * A new password. The identity key is unwrapped with the old one and
     * wrapped again with the new, so every message written before it stays
     * readable.
     */
    suspend fun changePassword(current: String, next: String) {
        val identity = KeyService.identity ?: throw IllegalStateException(t("session.thisDeviceDoesNotHoldYour"))
        val (authKey, _) = authKeyFor(current)
        val salt = Bytes.random(16)
        val params = Kdf.DEFAULT
        val master = withContext(Dispatchers.Default) { Kdf.deriveMaster(next, salt, params) }
        val newAuth = Kdf.authKey(master)
        val newEnc = Kdf.encKey(master)
        Bytes.wipe(master)
        AuthApi.changePassword(buildJsonObject {
            put("auth_key", Bytes.b64(authKey))
            put("new_auth_key", Bytes.b64(newAuth))
            put("new_kdf_salt", Bytes.b64(salt))
            put("new_kdf_params", Api.json.encodeToJsonElement(KdfParamsJson.serializer(), KdfParamsJson(params.m, params.t, params.p)))
            put("new_enc_private_key", Bytes.b64(Keys.wrapPrivateKey(identity.privateKey, newEnc)))
        })
    }

    /** Replaces the recovery key, and hands back the new one to write down. */
    suspend fun newRecoveryKey(password: String): String {
        val identity = KeyService.identity ?: throw IllegalStateException(t("session.thisDeviceDoesNotHoldYour"))
        val (authKey, _) = authKeyFor(password)
        val (bytes, display) = Kdf.newRecoveryKey()
        val (recoveryAuth, recoveryEnc) = Kdf.recoveryKeys(bytes)
        AuthApi.replaceRecovery(buildJsonObject {
            put("auth_key", Bytes.b64(authKey))
            put("recovery_auth_key", Bytes.b64(recoveryAuth))
            put("enc_private_key_recovery", Bytes.b64(Keys.wrapPrivateKey(identity.privateKey, recoveryEnc)))
        })
        AppState.me.update { it?.copy(hasRecovery = true) }
        pendingRecoveryKey.value = display
        return display
    }

    suspend fun totpSetup(password: String): TotpSetup = AuthApi.totpSetup(Bytes.b64(authKeyFor(password).first))

    suspend fun mfaDisable(password: String): MfaStatus = AuthApi.mfaDisable(Bytes.b64(authKeyFor(password).first))

    suspend fun newBackupCodes(password: String): List<String> =
        AuthApi.newBackupCodes(Bytes.b64(authKeyFor(password).first)).backupCodes

    private fun goLive(me: MeUser, identity: Identity) {
        KeyService.start(me.id, identity)
        _error.value = null
        _status.value = AuthStatus.READY
        gateway.connect()
    }

    suspend fun logout() {
        runCatching { AuthApi.logout() }
        signOutLocally()
    }

    private fun signOutLocally() {
        gateway.disconnect()
        VoiceSession.leaveQuietly()
        Api.token = null
        SecureStore.clear()
        KeyService.reset()
        AppState.reset()
        pendingMfa = null
        _status.value = AuthStatus.ANONYMOUS
    }

    /** Runs a request that a captcha may guard, fetching a token only if one is wanted. */
    suspend fun <T> guarded(action: String, block: suspend (String?) -> T): T {
        val siteKey = AppState.instance.value?.captcha?.siteKey
        return try {
            block(if (!siteKey.isNullOrEmpty()) Captcha.token(action, siteKey) else null)
        } catch (e: ApiException) {
            if (e.code != "captcha_required") throw e
            val key = loadInstance()?.captcha?.siteKey ?: throw e
            block(Captcha.token(action, key))
        }
    }

    // --- events ------------------------------------------------------------

    private inline fun <reified T> JsonElement?.into(): T? =
        this?.let { runCatching { Api.json.decodeFromJsonElement<T>(it) }.getOrNull() }

    private suspend fun dispatch(event: GatewayEvent) {
        val meId = AppState.me.value?.id
        val d = event.data
        when (event.type) {
            "ready" -> onReady(d.into<ReadyPayload>() ?: return)

            "message_create" -> {
                val m = d.into<Message>() ?: return
                val decrypted = MessageService.decrypt(m)
                MessageService.insert(m.channelId, listOf(decrypted))
                AppState.channels.value[m.channelId]?.let { AppState.putChannel(it.copy(lastMessageId = m.id)) }
                AppState.setTyping(m.channelId, m.authorId, null)
                if (decrypted.decryptError == "no_key" && m.keyConvId != null) {
                    AppState.waitingForKeys.update { it + m.keyConvId }
                }
                // Fetching a stranger's name, or telling the server this was
                // read, must not hold up the next event: the whole stream is
                // one coroutine, and a slow connection would put typing,
                // presence and call signalling behind message traffic.
                scope.launch { ensureUser(m.authorId) }
                scope.launch { ensureChannel(m.channelId) }
                val mine = meId == m.authorId
                if (mine || (Focus.activeChannel == m.channelId && Focus.foreground)) {
                    scope.launch { MessageService.ack(m.channelId, m.id) }
                } else {
                    bumpUnread(m, meId)
                }
                for (hook in messageHooks) hook(m, decrypted, mine)
            }

            "message_update" -> {
                val m = d.into<Message>() ?: return
                MessageService.update(m.channelId, MessageService.decrypt(m))
            }

            "message_delete" -> {
                val o = d?.jsonObject ?: return
                MessageService.remove(o.str("channel_id"), o.str("id"))
            }

            "message_delete_bulk" -> {
                val o = d?.jsonObject ?: return
                val ids = (o["ids"] as? kotlinx.serialization.json.JsonArray)?.map { it.jsonPrimitive.content } ?: return
                MessageService.removeMany(o.str("channel_id"), ids)
            }

            "reaction_add", "reaction_remove" -> {
                val o = d?.jsonObject ?: return
                MessageService.setReaction(
                    o.str("channel_id"), o.str("message_id"), o.str("emoji"),
                    event.type == "reaction_add", o.str("user_id") == meId,
                )
            }

            "typing" -> {
                val o = d?.jsonObject ?: return
                val user = o.str("user_id")
                if (user == meId) return
                val stop = (o["stop"]?.jsonPrimitive?.content == "true")
                AppState.setTyping(o.str("channel_id"), user, if (stop) null else System.currentTimeMillis() + 9_000)
            }

            "channel_create", "channel_update" -> {
                val c = d.into<Channel>() ?: return
                AppState.putChannel(c)
                for (id in c.recipientIds) ensureUser(id)
            }

            "channel_delete" -> AppState.removeChannel((d?.jsonObject ?: return).str("id"))

            "channel_positions" -> {
                val o = d?.jsonObject ?: return
                val list = (o["channels"] as? kotlinx.serialization.json.JsonArray) ?: return
                val current = AppState.channels.value.toMutableMap()
                for (entry in list) {
                    val e = entry.jsonObject
                    val id = e.str("id")
                    val ch = current[id] ?: continue
                    current[id] = ch.copy(
                        position = e["position"]?.jsonPrimitive?.content?.toIntOrNull() ?: ch.position,
                        parentId = e["parent_id"]?.jsonPrimitive?.contentOrNull(),
                    )
                }
                AppState.channels.value = current
            }

            "server_create" -> {
                val view = d.into<ServerView>() ?: return
                AppState.putServerView(view, meId)
                AppState.emojis.update { it }
            }

            "server_update" -> {
                val s = d.into<Server>() ?: return
                AppState.updateServer(s.id) { it.copy(server = s) }
            }

            "server_delete" -> AppState.removeServer((d?.jsonObject ?: return).str("id"))

            "emoji_update" -> {
                val o = d?.jsonObject ?: return
                val list = o["emojis"].into<List<Emoji>>() ?: emptyList()
                AppState.emojis.update { it + (o.str("server_id") to list) }
            }

            "sticker_update" -> {
                val o = d?.jsonObject ?: return
                val packId = o.str("pack_id")
                val pack = o["pack"].into<StickerPack>()
                AppState.stickerPacks.update { packs ->
                    if (pack == null) packs.filterNot { it.id == packId }
                    else packs.filterNot { it.id == packId } + pack
                }
            }

            "member_add" -> {
                val o = d?.jsonObject ?: return
                o["user"].into<PublicUser>()?.let { AppState.putUser(it) }
                val member = o["member"].into<Member>() ?: return
                AppState.updateServer(o.str("server_id")) {
                    it.copy(members = it.members + (member.userId to member), memberCount = it.memberCount + 1)
                }
            }

            "member_update" -> {
                val m = d.into<Member>() ?: return
                AppState.updateServer(m.serverId) { state ->
                    val me = if (m.userId == meId) m else state.me
                    state.copy(members = state.members + (m.userId to m), me = me)
                }
            }

            "member_remove" -> {
                val o = d?.jsonObject ?: return
                val serverId = o.str("server_id")
                val userId = o.str("user_id")
                if (userId == meId) {
                    AppState.removeServer(serverId)
                } else {
                    AppState.updateServer(serverId) {
                        it.copy(members = it.members - userId, memberCount = maxOf(0, it.memberCount - 1))
                    }
                }
            }

            "role_create", "role_update" -> {
                val r = d.into<Role>() ?: return
                AppState.updateServer(r.serverId) { it.copy(roles = it.roles + (r.id to r)) }
            }

            "role_delete" -> {
                val o = d?.jsonObject ?: return
                AppState.updateServer(o.str("server_id")) { it.copy(roles = it.roles - o.str("id")) }
            }

            "presence" -> AppState.putPresence(d.into<Presence>() ?: return)

            "user_update" -> {
                val u = d.into<PublicUser>() ?: return
                AppState.putUser(u)
                if (u.id == meId) {
                    AppState.me.update { me ->
                        me?.copy(
                            username = u.username, displayName = u.displayName, avatarId = u.avatarId,
                            bannerId = u.bannerId, aboutMe = u.aboutMe, pronouns = u.pronouns,
                            accentColor = u.accentColor, accentColor2 = u.accentColor2,
                            statusText = u.statusText, statusEmoji = u.statusEmoji, statusExpiresAt = u.statusExpiresAt,
                        )
                    }
                }
            }

            "relationship_add" -> {
                val r = d.into<Relationship>() ?: return
                val before = AppState.relationships.value[r.user.id]?.type
                AppState.relationships.update { it + (r.user.id to r) }
                AppState.putUser(r.user)
                if (r.type == "incoming" && before != "incoming") {
                    for (hook in friendRequestHooks) hook(r)
                }
            }

            "relationship_remove" -> {
                val id = (d?.jsonObject ?: return).str("user_id")
                AppState.relationships.update { it - id }
            }

            "read_state" -> AppState.putReadState(d.into<ReadState>() ?: return)

            "key_grant" -> {
                val grant = d.into<KeyGrant>() ?: return
                val changed = KeyService.ingestGrants(listOf(grant))
                if (changed.isNotEmpty()) MessageService.redecrypt(changed.toSet())
            }

            "keys_needed" -> {
                val need = d.into<KeyNeed>() ?: return
                if (KeyService.ring.get(need.convId, need.epoch) != null) {
                    // Key upkeep can mean many requests; it runs beside the event
                    // queue so messages and calls never wait behind it.
                    scope.launch { runCatching { KeyService.grantTo(need.convId, need.epoch, need.userIds) } }
                }
            }

            "key_rotation_needed" -> {
                val conv = (d?.jsonObject ?: return).str("conv_id")
                if (KeyService.ring.latest(conv) != null) {
                    scope.launch { runCatching { KeyService.rotate(conv, "membership change") } }
                }
            }

            "pin_update" -> {
                val o = d?.jsonObject ?: return
                val channelId = o.str("channel_id")
                val messageId = o.str("message_id")
                val pinned = o["pinned"]?.jsonPrimitive?.content == "true"
                val current = AppState.messagesOrNull(channelId)?.value?.firstOrNull { it.raw.id == messageId } ?: return
                MessageService.setFlags(channelId, messageId, if (pinned) current.raw.flags or 1 else current.raw.flags and 1.inv())
            }

            "settings_update" -> {
                val version = (d?.jsonObject ?: return)["version"]?.jsonPrimitive?.content?.toIntOrNull() ?: return
                if (version > SettingsStore.version) scope.launch { runCatching { SettingsStore.reload() } }
            }

            "session_expired" -> signOutLocally()

            "voice_state" -> {
                val v = d.into<VoiceState>() ?: return
                AppState.putVoiceState(v)
                VoiceSession.onVoiceState(v)
            }

            "voice_signal", "voice_error", "voice_resumed" -> VoiceSession.onGatewayEvent(event)

            "call_ring" -> {
                val o = d?.jsonObject ?: return
                val channelId = o.str("channel_id")
                val from = o.str("from")
                ringing.value = channelId to from
                ensureChannel(channelId)
                ensureUser(from)
                for (hook in ringHooks) hook(channelId, from)
            }

            "call_end" -> {
                val o = d?.jsonObject ?: return
                if (ringing.value?.first == o.str("channel_id")) ringing.value = null
                for (hook in callEndHooks) hook(o.str("channel_id"))
                VoiceSession.onGatewayEvent(event)
            }

            "guest_ended" -> VoiceSession.onGatewayEvent(event)

            "heartbeat_ack" -> Unit
            else -> Unit
        }
    }

    private suspend fun onReady(ready: ReadyPayload) {
        val me = ready.user ?: return
        sessionId = ready.sessionId
        AppState.me.value = me
        AppState.putUsers(ready.users + me.toPublic())
        val channels = ready.channels + ready.servers.flatMap { it.channels }
        AppState.channels.value = channels.associateBy { it.id }
        AppState.relationships.value = ready.relationships.associateBy { it.user.id }
        AppState.putUsers(ready.relationships.map { it.user })
        AppState.readStates.value = ready.readStates.associateBy { it.channelId }
        AppState.presences.value = ready.presences.associateBy { it.userId }
        AppState.servers.value = emptyMap()
        for (view in ready.servers) AppState.putServerView(view, me.id)
        AppState.emojis.value = ready.emojis.groupBy { it.serverId }
        AppState.stickerPacks.value = ready.stickerPacks
        AppState.voiceStates.value = ready.voiceStates.filter { it.channelId != null }.associateBy { it.userId }
        AppState.guest.value = ready.guest
        SettingsStore.load(ready.settings?.blob, ready.settings?.version ?: 0)
        val changed = KeyService.ingestGrants(ready.keyGrants)
        if (changed.isNotEmpty()) MessageService.redecrypt(changed.toSet())
        VoiceSession.onReady(ready.voiceStates, ready.sessionId)
        scope.launch { runCatching { KeyService.reconcile() } }
        for (hook in readyHooks) hook()
    }

    private fun bumpUnread(m: Message, meId: String?) {
        val mentions = m.mentionEveryone || (meId != null && meId in m.mentions)
        val rs = AppState.readStates.value[m.channelId] ?: ReadState(m.channelId)
        val channel = AppState.channels.value[m.channelId]
        AppState.putReadState(
            rs.copy(
                mentionCount = rs.mentionCount + if (mentions) 1 else 0,
                unreadCount = if (channel == null || channel.isDm) minOf(100, rs.unreadCount + 1) else rs.unreadCount,
            ),
        )
    }

    private val fetching = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    private suspend fun ensureChannel(id: String) {
        if (AppState.channels.value.containsKey(id) || !fetching.add("c$id")) return
        runCatching { AppState.putChannel(ChannelsApi.channel(id)) }
        fetching.remove("c$id")
    }

    private suspend fun ensureUser(id: String) {
        if (AppState.users.value.containsKey(id) || !fetching.add("u$id")) return
        runCatching { AppState.putUser(UsersApi.user(id)) }
        fetching.remove("u$id")
    }

    // --- hooks other layers register ---------------------------------------

    val messageHooks = mutableListOf<(Message, UiMessage, Boolean) -> Unit>()
    val friendRequestHooks = mutableListOf<(Relationship) -> Unit>()
    val ringHooks = mutableListOf<(String, String) -> Unit>()
    val callEndHooks = mutableListOf<(String) -> Unit>()
    val readyHooks = mutableListOf<() -> Unit>()

    /** What the app is showing, so a message in view is marked read rather than counted. */
    object Focus {
        @Volatile var activeChannel: String? = null
        @Volatile var foreground: Boolean = true
    }

    private fun JsonObject.str(key: String): String =
        this[key]?.jsonPrimitive?.contentOrNull() ?: ""
}

private fun kotlinx.serialization.json.JsonPrimitive.contentOrNull(): String? =
    if (this is kotlinx.serialization.json.JsonNull) null else content
