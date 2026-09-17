package xyz.evilion.chat.i18n

import android.content.Context
import android.content.res.AssetManager
import android.icu.text.NumberFormat
import android.icu.text.PluralRules
import android.icu.util.ULocale
import android.os.LocaleList
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.util.Locale

/**
 * The app's words, out of the same catalogue the web client reads.
 *
 * The web client's locale files are copied into this app's assets at build
 * time, so a string translated once is translated everywhere and the two
 * cannot drift. The rules a real translation needs are the same ones the web
 * client's `i18n/core.ts` describes:
 *
 * - **Plurals.** Each string that counts something carries the forms its
 *   language uses, chosen by ICU, which is the same data Intl.PluralRules has.
 * - **Order.** Values go in by name, never by position, so a language may put
 *   the count first.
 * - **Direction.** Arabic reads right to left, which the tree above asks for
 *   through `LocalLayoutDirection` rather than each string knowing.
 *
 * A key with no translation falls back to English rather than showing the key,
 * so a half-finished language reads as mixed rather than broken.
 */

/** A language the app ships, as the picker shows it. */
data class Language(val tag: String, val endonym: String, val english: String, val rtl: Boolean = false)

/** Every language the app ships, English first. Mirrors web/src/i18n/core.ts. */
val LANGUAGES: List<Language> = listOf(
    Language("en", "English", "English"),
    Language("es", "Español", "Spanish"),
    Language("fr", "Français", "French"),
    Language("de", "Deutsch", "German"),
    Language("pt-BR", "Português (Brasil)", "Portuguese (Brazil)"),
    Language("ru", "Русский", "Russian"),
    Language("ja", "日本語", "Japanese"),
    Language("ko", "한국어", "Korean"),
    Language("zh-CN", "简体中文", "Chinese (Simplified)"),
    Language("hi", "हिन्दी", "Hindi"),
    Language("ar", "العربية", "Arabic", rtl = true),
)

private sealed interface Message {
    /** One string. */
    class Plain(val text: String) : Message

    /** The forms of a string that counts something, keyed by ICU's categories. */
    class Plural(val forms: Map<String, String>) : Message
}

// Android's regex engine is ICU's, which rejects a bare closing brace
private val PLACEHOLDER = Regex("""\{(\w+)\}""")
private val json = Json { ignoreUnknownKeys = true; isLenient = true }

object Strings {
    private var assets: AssetManager? = null
    private var english: Map<String, Message> = emptyMap()
    private var catalog: Map<String, Message> = emptyMap()
    // built when a language is chosen: on a plain JVM (a unit test) there is no
    // ICU, and an object that cannot be created there cannot be tested at all
    private var rules: PluralRules? = null
    private var numbers: NumberFormat? = null

    /** The language in use. */
    var tag: String = "en"
        private set

    /** What was asked for: a tag, or null for "follow the phone". */
    var chosen: String? = null
        private set

    /**
     * Counts the language changes. A tree keyed on this is built again when it
     * changes, which is what makes a piece of interface that remembered its
     * words pick up the new ones.
     */
    var epoch by mutableIntStateOf(0)
        private set

    val rtl: Boolean get() = LANGUAGES.firstOrNull { it.tag == tag }?.rtl == true

    /** Reads English and settles on a language before anything is drawn. Calling it twice changes nothing. */
    fun init(context: Context) {
        if (assets != null) return
        assets = context.applicationContext.assets
        english = read("en")
        catalog = english
        apply("en")
        use(null)
    }

    /**
     * Switches language. `null` follows the phone's own preference, which is
     * what someone who has never chosen expects.
     */
    fun use(wanted: String?) {
        chosen = wanted
        val next = pick(if (wanted != null) listOf(wanted) else deviceLanguages())
        if (next == tag) return
        catalog = if (next == "en") english else read(next)
        apply(next)
        epoch++
    }

    private fun apply(next: String) {
        tag = next
        rules = runCatching { PluralRules.forLocale(ULocale.forLanguageTag(next)) }.getOrNull()
        numbers = runCatching { NumberFormat.getInstance(ULocale.forLanguageTag(next)) }.getOrNull()
    }

    /**
     * A translated string. `count` picks the plural form and is also available
     * as {count}; anything else fills its own placeholder. Numbers are
     * formatted for the language, so Arabic gets Arabic digits.
     */
    fun t(key: String, vararg args: Pair<String, Any?>): String {
        val message = catalog[key] ?: english[key] ?: return key
        val count = args.firstOrNull { it.first == "count" }?.second
        val template = when (message) {
            is Message.Plain -> message.text
            is Message.Plural -> form(message.forms, count)
        }
        if (args.isEmpty()) return template
        return PLACEHOLDER.replace(template) { m ->
            val name = m.groupValues[1]
            val hit = args.firstOrNull { it.first == name } ?: return@replace m.value
            when (val v = hit.second) {
                null -> ""
                is Number -> numbers?.let { n -> runCatching { n.format(v) }.getOrNull() } ?: v.toString()
                else -> v.toString()
            }
        }
    }

    /**
     * Chooses the form for a count. ICU knows every language's rule; where a
     * language lacks the category a translator filled in, `other` stands in,
     * which is the one every language has.
     */
    private fun form(forms: Map<String, String>, count: Any?): String {
        val n = when (count) {
            is Int -> count.toDouble()
            is Long -> count.toDouble()
            is Number -> count.toDouble()
            else -> 0.0
        }
        val category = rules?.let { runCatching { it.select(n) }.getOrNull() } ?: if (n == 1.0) "one" else "other"
        return forms[category] ?: forms["other"] ?: forms.values.firstOrNull() ?: ""
    }

    /** Whether a key exists at all, for tests and tooling. */
    fun has(key: String): Boolean = catalog.containsKey(key) || english.containsKey(key)

    /**
     * The best language for a list of preferences: an exact match first, then
     * the base language ("pt" for "pt-PT"), then English. The same rule the
     * web client uses, so one account reads the same on both.
     */
    fun pick(preferred: List<String>): String {
        for (raw in preferred) {
            val want = raw.trim()
            if (want.isEmpty()) continue
            LANGUAGES.firstOrNull { it.tag.equals(want, ignoreCase = true) }?.let { return it.tag }
            val base = want.substringBefore('-').lowercase()
            LANGUAGES.firstOrNull { it.tag.lowercase() == base || it.tag.lowercase().startsWith("$base-") }
                ?.let { return it.tag }
        }
        return "en"
    }

    /** What the phone asks for, in order, so a first run is already in the right language. */
    private fun deviceLanguages(): List<String> {
        val out = mutableListOf<String>()
        val list = LocaleList.getDefault()
        for (i in 0 until list.size()) out.add(list.get(i).toLanguageTag())
        if (out.isEmpty()) out.add(Locale.getDefault().toLanguageTag())
        return out
    }

    /** One catalogue out of the assets; an unreadable one leaves English in place. */
    private fun read(tag: String): Map<String, Message> {
        val am = assets ?: return emptyMap()
        val text = runCatching { am.open("locales/$tag.json").use { it.readBytes().decodeToString() } }
            .getOrElse { return emptyMap() }
        val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrElse { return emptyMap() }
        val out = HashMap<String, Message>(root.size * 2)
        for ((key, value) in root) {
            when (value) {
                is JsonPrimitive -> out[key] = Message.Plain(value.content)
                is JsonObject -> {
                    val forms = HashMap<String, String>(value.size * 2)
                    for ((form, text2) in value) (text2 as? JsonPrimitive)?.let { forms[form] = it.content }
                    if (forms.isNotEmpty()) out[key] = Message.Plural(forms)
                }
                else -> {}
            }
        }
        return out
    }
}

/** A translated string, anywhere in the app. */
fun t(key: String, vararg args: Pair<String, Any?>): String = Strings.t(key, *args)
