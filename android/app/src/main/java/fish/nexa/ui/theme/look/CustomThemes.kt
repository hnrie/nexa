package fish.nexa.ui.theme.look

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/** A theme someone made (lib/look/types.ts CustomTheme). */
data class CustomTheme(val id: String, val name: String, val source: ThemeSource, val overrides: Map<String, String>)

/** Where a custom theme's colours start: a few picked ones, or a theme of the gallery. */
sealed interface ThemeSource {
    data class Simple(val colours: SimpleColours) : ThemeSource
    data class FromPreset(val id: String) : ThemeSource
}

data class ResolvedTheme(val tokens: TokenMap, val scheme: String)

/**
 * lib/look/customTheme.ts: reading custom themes from the settings (every
 * field checked, since they arrive from every device and version), working
 * out their palettes, and sharing them as files.
 */
object CustomThemes {
    const val MAX = 30
    const val MAX_NAME = 48
    private const val FORMAT = 1
    private val ID = Regex("^custom-[a-z0-9]{8}$")

    fun isCustomId(id: String) = ID.matches(id)

    fun newId(): String {
        val bytes = ByteArray(8).also { java.security.SecureRandom().nextBytes(it) }
        return "custom-" + bytes.joinToString("") { "abcdefghijklmnopqrstuvwxyz0123456789"[(it.toInt() and 0xff) % 36].toString() }
    }

    private fun str(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    /** A colour as a solid token holds it: any alpha dropped. */
    private fun solid(value: JsonElement?): String? = str(value)?.let { Colour.parseColour(it) }?.let { Colour.toHex(it.rgb) }

    /** A token's value, or null when it is not a colour that token can take. */
    fun tokenValue(token: String, value: String?): String? {
        if (value == null || value.length > 40) return null
        return if (token in Tokens.ALPHA) Tokens.normalise(value) else Colour.parseColour(value)?.let { Colour.toHex(it.rgb) }
    }

    private fun sanitizeSimple(v: JsonObject): SimpleColours? {
        val background = solid(v["background"]) ?: return null
        val accent = solid(v["accent"]) ?: return null
        val s = str(v["scheme"])
        val scheme = if (s == "light" || s == "dark") s else Derive.schemeOf(background)
        return SimpleColours(background, accent, solid(v["text"]), scheme)
    }

    private fun sanitizeOverrides(v: JsonElement?): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        val o = v as? JsonObject ?: return out
        for ((k, value) in o) {
            val name = k.removePrefix("--")
            if (!Tokens.isToken(name)) continue
            tokenValue(name, str(value))?.let { out[name] = it }
        }
        return out
    }

    fun sanitize(v: JsonElement?): CustomTheme? {
        val r = v as? JsonObject ?: return null
        val id = str(r["id"])?.takeIf { isCustomId(it) } ?: return null
        val name = str(r["name"])?.trim()?.let { jsSlice(it, MAX_NAME) } ?: ""
        val src = r["source"] as? JsonObject
        val source: ThemeSource = when {
            src != null && str(src["kind"]) == "simple" -> sanitizeSimple(src)?.let { ThemeSource.Simple(it) }
            src != null && str(src["kind"]) == "preset" && str(src["id"])?.let { Presets.byId(it) } != null -> ThemeSource.FromPreset(str(src["id"])!!)
            else -> null
        } ?: return null
        return CustomTheme(id, name, source, sanitizeOverrides(r["overrides"]))
    }

    fun sanitizeAll(v: JsonElement?): List<CustomTheme> {
        val list = v as? JsonArray ?: return emptyList()
        val seen = HashSet<String>()
        val out = ArrayList<CustomTheme>()
        for (item in list) {
            val t = sanitize(item) ?: continue
            if (!seen.add(t.id)) continue
            out += t
            if (out.size >= MAX) break
        }
        return out
    }

    /** `.slice(0, n)` on UTF-16 units, as the web cuts names. */
    private fun jsSlice(s: String, n: Int) = if (s.length <= n) s else s.substring(0, n)

    /** A theme as the settings keep it. */
    fun toJson(t: CustomTheme): JsonObject = buildJsonObject {
        put("id", t.id)
        put("name", t.name)
        put("source", when (val s = t.source) {
            is ThemeSource.Simple -> buildJsonObject {
                put("kind", "simple")
                put("background", s.colours.background)
                put("accent", s.colours.accent)
                put("text", s.colours.text?.let { JsonPrimitive(it) } ?: JsonNull)
                put("scheme", s.colours.scheme)
            }
            is ThemeSource.FromPreset -> buildJsonObject {
                put("kind", "preset")
                put("id", s.id)
            }
        })
        put("overrides", JsonObject(t.overrides.mapValues { JsonPrimitive(it.value) }))
    }

    /** The palette a source gives, before any colour set by hand. */
    fun sourceTokens(source: ThemeSource): TokenMap = when (source) {
        is ThemeSource.Simple -> Derive.deriveTheme(source.colours).tokens
        is ThemeSource.FromPreset -> Presets.tokens(source.id) ?: Tokens.CLASSIC.getValue("dark")
    }

    /** Its whole palette, and its scheme as the main background ends up. */
    fun resolve(theme: CustomTheme): ResolvedTheme {
        val tokens = LinkedHashMap(sourceTokens(theme.source))
        for ((k, v) in theme.overrides) if (Tokens.isToken(k)) tokens[k] = v
        val raised = Colour.parseColour(tokens.getValue("bg-raised"))?.rgb ?: Colour.Rgb(0.0, 0.0, 0.0)
        return ResolvedTheme(tokens, if (Colour.luminance(Colour.toHex(raised)) > 0.18) "light" else "dark")
    }

    /** The palette of any theme the gallery can show. */
    fun themeTokens(id: String, customs: List<CustomTheme>): TokenMap? =
        Presets.tokens(id) ?: Seasonal.tokens(id) ?: if (isCustomId(id)) customs.firstOrNull { it.id == id }?.let { resolve(it).tokens } else null

    /** Links underlined in it: when it starts from a preset that asks for that. */
    fun underlines(t: CustomTheme): Boolean = (t.source as? ThemeSource.FromPreset)?.let { Presets.byId(it.id)?.underlineLinks } == true

    private val pretty = Json { prettyPrint = true; prettyPrintIndent = "  " }

    /** The theme as a file to share (`{slug}.nexa-theme.json`), in the web's format. */
    fun export(theme: CustomTheme): String {
        val (tokens, scheme) = resolve(theme)
        val doc = buildJsonObject {
            put("nexaTheme", FORMAT)
            put("name", theme.name)
            put("scheme", scheme)
            when (val s = theme.source) {
                is ThemeSource.Simple -> put("simple", buildJsonObject {
                    put("background", s.colours.background)
                    put("accent", s.colours.accent)
                    put("text", s.colours.text?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("scheme", s.colours.scheme)
                })
                is ThemeSource.FromPreset -> put("basedOn", s.id)
            }
            if (theme.overrides.isNotEmpty()) put("overrides", JsonObject(theme.overrides.mapValues { JsonPrimitive(it.value) }))
            put("colors", JsonObject(Tokens.ALL.associateWith { JsonPrimitive(tokens.getValue(it)) }))
        }
        return pretty.encodeToString(JsonElement.serializer(), doc)
    }

    /** The file name a theme is shared under (ThemeBuilder's): letters, digits and dashes. */
    fun fileName(name: String): String {
        val slug = java.text.Normalizer.normalize(name, java.text.Normalizer.Form.NFKD).lowercase()
            .replace(Regex("[^\\p{L}\\p{N}]+"), "-").removePrefix("-").removeSuffix("-").let { jsSlice(it, 40) }
        return "${slug.ifEmpty { "theme" }}.nexa-theme.json"
    }

    sealed interface Imported {
        data class Ok(val theme: CustomTheme) : Imported
        data class Failed(val error: String) : Imported
    }

    /** A theme from a shared file: its few colours, or the preset it was built on, or failing both its full palette. */
    fun import(text: String, fallbackName: String): Imported {
        val doc = try {
            Json.parseToJsonElement(text)
        } catch (_: Exception) {
            return Imported.Failed("notJson")
        }
        val d = doc as? JsonObject ?: return Imported.Failed("notTheme")
        val format = (d["nexaTheme"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
        if (format != null && format > FORMAT) return Imported.Failed("newer")
        val name = jsSlice(str(d["name"])?.trim()?.takeIf { it.isNotEmpty() } ?: fallbackName, MAX_NAME)
        val overrides = sanitizeOverrides(d["overrides"])
        val simple = (d["simple"] as? JsonObject)?.let { sanitizeSimple(it) }
        if (simple != null) return Imported.Ok(CustomTheme(newId(), name, ThemeSource.Simple(simple.copy(background = Derive.fitBackground(simple.background, simple.scheme))), overrides))
        val basedOn = str(d["basedOn"])
        if (basedOn != null && Presets.byId(basedOn) != null) return Imported.Ok(CustomTheme(newId(), name, ThemeSource.FromPreset(basedOn), overrides))
        val colours = sanitizeOverrides(d["colors"] ?: d["colours"])
        if (colours.isEmpty()) return Imported.Failed("notTheme")
        val raised = colours["bg-raised"] ?: colours["bg-base"]
        val s = str(d["scheme"])
        val scheme = if (s == "light" || s == "dark") s else raised?.let { Derive.schemeOf(it) } ?: "dark"
        val base = if (scheme == "light") "light" else "dark"
        // only what differs from the base is kept, which is what the editor shows as changed
        val classic = Tokens.CLASSIC.getValue(base)
        val diff = LinkedHashMap(colours).apply { putAll(overrides) }.filter { (k, v) -> classic[k] != v }
        return Imported.Ok(CustomTheme(newId(), name, ThemeSource.FromPreset(base), diff))
    }
}
