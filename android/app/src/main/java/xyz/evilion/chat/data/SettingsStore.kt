package xyz.evilion.chat.data

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import xyz.evilion.chat.crypto.Aes
import xyz.evilion.chat.crypto.Bytes
import xyz.evilion.chat.crypto.Kdf
import xyz.evilion.chat.net.ApiException
import xyz.evilion.chat.net.Api
import xyz.evilion.chat.net.UsersApi

/**
 * The account's settings, shared with every other device.
 *
 * The document is encrypted with a key derived from the identity key, so the
 * server keeps it without being able to read it, and a password change does
 * not lose it. Fields this app does not know are carried through untouched, so
 * saving here never drops something the web client set.
 */
object SettingsStore {
    private val AAD = "settings/v1".toByteArray()

    private val _doc = MutableStateFlow(JsonObject(emptyMap()))
    val doc: StateFlow<JsonObject> = _doc

    @Volatile
    var version: Int = 0
        private set

    private var saveJob: Job? = null
    private lateinit var prefs: SharedPreferences

    /**
     * What has been changed here and not yet confirmed saved.
     *
     * A save used to be `runCatching { … }.getOrDefault(false)` against a
     * version that only moved on success. One conflict — another device saving
     * in the same moment — left the local version behind the server's forever,
     * so every save after it failed the same way and nothing was ever stored
     * again: not the theme, not the language, not a muted channel, not a
     * draft. And a `settings_update` from another device replaced the whole
     * document, taking any unsaved change with it.
     *
     * Keeping the changed fields apart from the document means a failure can
     * put them back, a conflict can take the server's copy and lay them on top
     * again, and a push from elsewhere cannot quietly drop them.
     */
    private val pending = mutableMapOf<String, JsonElement>()
    private var sending: Map<String, JsonElement>? = null
    private var failures = 0
    private val saveLock = Mutex()

    fun init(context: Context) {
        prefs = context.getSharedPreferences("device", Context.MODE_PRIVATE)
    }

    private fun key(): ByteArray? = KeyService.identity?.let { Kdf.settingsKey(it.privateKey) }

    fun load(blob: String?, version: Int) {
        // a save of ours may have landed while this copy was on its way
        if (this.version > 0 && version < this.version) return
        this.version = version
        val k = key()
        val base = if (blob.isNullOrEmpty() || k == null) JsonObject(emptyMap()) else decrypt(k, blob) ?: JsonObject(emptyMap())
        val unsaved = synchronized(pending) { (sending.orEmpty() + pending).toMap() }
        _doc.value = if (unsaved.isEmpty()) base else JsonObject(base.toMutableMap().apply { putAll(unsaved) })
        if (unsaved.isNotEmpty()) scheduleSave()
    }

    suspend fun reload() {
        val stored = UsersApi.settings() ?: return
        load(stored.blob, stored.version)
    }

    private fun decrypt(key: ByteArray, blob: String): JsonObject? = runCatching {
        val raw = Bytes.unb64(blob)
        if (raw.size < 13) return null
        val plain = Aes.decrypt(key, raw.copyOf(12), raw, 12, raw.size - 12, AAD)
        Api.json.parseToJsonElement(plain.decodeToString()) as? JsonObject
    }.getOrNull()

    private fun encrypt(key: ByteArray, doc: JsonObject): String {
        val iv = Bytes.random(12)
        return Bytes.b64(Bytes.concat(iv, Aes.encrypt(key, iv, doc.toString().toByteArray(), AAD)))
    }

    /** Changes one field and saves shortly after, so a burst of edits is one request. */
    fun put(name: String, value: JsonElement) {
        _doc.value = JsonObject(_doc.value.toMutableMap().apply { this[name] = value })
        synchronized(pending) { pending[name] = value }
        scheduleSave()
    }

    fun put(name: String, value: String) = put(name, JsonPrimitive(value))
    fun put(name: String, value: Boolean) = put(name, JsonPrimitive(value))
    fun put(name: String, value: Int) = put(name, JsonPrimitive(value))

    /** Changes a field of a nested object, keeping everything else in it. */
    fun putIn(parent: String, name: String, value: JsonElement) {
        val current = _doc.value[parent] as? JsonObject ?: JsonObject(emptyMap())
        put(parent, JsonObject(current.toMutableMap().apply { this[name] = value }))
    }

    private fun scheduleSave(after: Long = 600) {
        saveJob?.cancel()
        saveJob = Session.scope.launch {
            delay(after)
            flush()
        }
    }

    /**
     * One save of everything changed so far.
     *
     * A conflict means another device got there first: take its copy, lay the
     * unsaved changes back on top and try again, a few times. Anything else
     * transient backs off and retries. Either way the changes stay pending
     * until the server has actually taken them.
     */
    suspend fun flush(): Boolean = saveLock.withLock {
        val k = key() ?: return@withLock false
        val mine = synchronized(pending) {
            if (pending.isEmpty() && sending == null) return@withLock true
            val take = pending.toMap()
            pending.clear()
            sending = (sending.orEmpty() + take)
            sending!!
        }
        try {
            // The version sent is the one being replaced, not the one being
            // written: the server answers with the number it wrote. Sending
            // version + 1 meant the very first save claimed to replace a
            // version that did not exist, so it was refused as a conflict —
            // and so was every save after it. Nothing this app changed had
            // ever reached the account.
            val saved = UsersApi.putSettings(encrypt(k, _doc.value), version)
            version = saved.version
            synchronized(pending) { sending = null }
            failures = 0
            true
        } catch (e: Throwable) {
            synchronized(pending) {
                // put them back, but never over a newer local edit
                for ((name, value) in mine) pending.putIfAbsent(name, value)
                sending = null
            }
            val status = (e as? ApiException)?.status ?: 0
            if (status == 409 && failures < 3) {
                failures++
                // someone else saved first: take theirs, put ours back on top
                runCatching { reload() }.onFailure { scheduleSave(backoff()) }
                return@withLock false
            }
            if (status == 409 || (e as? ApiException)?.isTransient != false) {
                failures++
                scheduleSave(backoff())
            } else {
                Log.w(LOG_TAG, "settings did not save", e)
            }
            false
        }
    }

    /** 2s, 4s, 8s … up to a minute. */
    private fun backoff(): Long = (2000L shl (failures - 1).coerceIn(0, 5)).coerceAtMost(60_000)

    // --- typed views over the document ------------------------------------

    fun string(name: String, fallback: String): String =
        (_doc.value[name] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: fallback

    fun bool(name: String, fallback: Boolean): Boolean =
        (_doc.value[name] as? JsonPrimitive)?.booleanOrNull ?: fallback

    fun int(name: String, fallback: Int): Int =
        (_doc.value[name] as? JsonPrimitive)?.intOrNull ?: fallback

    fun float(name: String, fallback: Float): Float =
        (_doc.value[name] as? JsonPrimitive)?.floatOrNull ?: fallback

    fun list(name: String): List<String> =
        (_doc.value[name] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()

    fun obj(name: String): JsonObject = _doc.value[name] as? JsonObject ?: JsonObject(emptyMap())

    /** "dark", "light", "ash", "onyx" or "system"; the app follows the same names as the web. */
    val theme: String get() = string("theme", "dark")

    /** The chosen language, or null to follow the phone. Shared with the web client. */
    val locale: String? get() = string("locale", "").ifEmpty { null }

    val messageDisplay: String get() = string("messageDisplay", "cozy")

    val fontScale: Float get() = float("fontScale", 1f)

    val linkPreviews: Boolean get() = bool("linkPreviews", true)

    val imagePreviews: Boolean get() = bool("imagePreviews", true)

    val reducedMotion: Boolean get() = bool("reducedMotion", false)

    val skinTone: Int get() = int("skinTone", 0)

    val recentEmoji: List<String> get() = list("recentEmoji")

    val mutedChannels: List<String> get() = (obj("notifications")["muted"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()

    val soundsOn: Boolean get() = (obj("notifications")["sounds"] as? JsonPrimitive)?.booleanOrNull ?: true

    /**
     * "all", "mentions" or "none" for one channel: its own setting, else the
     * server's, else the default. A server channel defaults to mentions only —
     * a busy server that notified on every message would make the phone
     * useless, which is why the web client resolves it the same way.
     */
    fun notificationLevel(channelId: String, serverId: String? = null): String {
        val per = obj("notifications")["perChannel"] as? JsonObject
        (per?.get(channelId) as? JsonPrimitive)?.content?.let { return it }
        if (serverId != null) {
            (per?.get(serverId) as? JsonPrimitive)?.content?.let { return it }
            return "mentions"
        }
        return "all"
    }

    /** Whether a conversation is silenced, by itself or by its server. */
    fun isMuted(channelId: String, serverId: String? = null): Boolean {
        val muted = mutedChannels
        return channelId in muted || (serverId != null && serverId in muted)
    }

    fun draft(channelId: String): String =
        (obj("drafts")[channelId] as? JsonPrimitive)?.content.orEmpty()

    fun setDraft(channelId: String, text: String) {
        val drafts = obj("drafts").toMutableMap()
        if (text.isBlank()) drafts.remove(channelId) else drafts[channelId] = JsonPrimitive(text)
        put("drafts", JsonObject(drafts))
    }

    fun rememberEmoji(shortcode: String) {
        val recents = listOf(shortcode) + recentEmoji.filterNot { it == shortcode }
        put("recentEmoji", JsonArray(recents.take(40).map { JsonPrimitive(it) }))
    }

    val serverOrder: List<String> get() = list("serverPositions")

    fun setServerOrder(ids: List<String>) = put("serverPositions", JsonArray(ids.map { JsonPrimitive(it) }))

    val collapsedCategories: List<String> get() = list("collapsedCategories")

    fun toggleCategory(id: String) {
        val current = collapsedCategories
        val next = if (id in current) current - id else current + id
        put("collapsedCategories", JsonArray(next.map { JsonPrimitive(it) }))
    }

    // --- device-only settings ---------------------------------------------

    fun deviceBool(name: String, fallback: Boolean): Boolean = prefs.getBoolean(name, fallback)

    fun setDeviceBool(name: String, value: Boolean) = prefs.edit().putBoolean(name, value).apply()

    fun deviceString(name: String, fallback: String): String = prefs.getString(name, fallback) ?: fallback

    fun setDeviceString(name: String, value: String) = prefs.edit().putString(name, value).apply()

    fun deviceInt(name: String, fallback: Int): Int = prefs.getInt(name, fallback)

    fun setDeviceInt(name: String, value: Int) = prefs.edit().putInt(name, value).apply()
}
