package xyz.evilion.chat.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
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

    fun init(context: Context) {
        prefs = context.getSharedPreferences("device", Context.MODE_PRIVATE)
    }

    private fun key(): ByteArray? = KeyService.identity?.let { Kdf.settingsKey(it.privateKey) }

    fun load(blob: String?, version: Int) {
        this.version = version
        val k = key()
        if (blob.isNullOrEmpty() || k == null) {
            _doc.value = JsonObject(emptyMap())
            return
        }
        _doc.value = decrypt(k, blob) ?: JsonObject(emptyMap())
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

    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = Session.scope.launch {
            delay(600)
            flush()
        }
    }

    suspend fun flush(): Boolean {
        val k = key() ?: return false
        return runCatching {
            val saved = UsersApi.putSettings(encrypt(k, _doc.value), version + 1)
            version = saved.version
            true
        }.getOrDefault(false)
    }

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

    val messageDisplay: String get() = string("messageDisplay", "cozy")

    val fontScale: Float get() = float("fontScale", 1f)

    val linkPreviews: Boolean get() = bool("linkPreviews", true)

    val imagePreviews: Boolean get() = bool("imagePreviews", true)

    val reducedMotion: Boolean get() = bool("reducedMotion", false)

    val skinTone: Int get() = int("skinTone", 0)

    val recentEmoji: List<String> get() = list("recentEmoji")

    val mutedChannels: List<String> get() = (obj("notifications")["muted"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()

    val soundsOn: Boolean get() = (obj("notifications")["sounds"] as? JsonPrimitive)?.booleanOrNull ?: true

    /** "all", "mentions" or "none" for one channel. */
    fun notificationLevel(channelId: String): String {
        val per = obj("notifications")["perChannel"] as? JsonObject
        return (per?.get(channelId) as? JsonPrimitive)?.content ?: "all"
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
