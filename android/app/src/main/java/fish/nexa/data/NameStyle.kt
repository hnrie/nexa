package fish.nexa.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlin.random.Random

/**
 * lib/nameStyle.ts: how someone's display name is drawn to everyone, one of
 * the fonts below (res/font/name_<id>.ttf, made by android/tools/name_fonts.py
 * from the web's own files), an effect and its colours (0xRRGGBB). In a server
 * a coloured role still colours the name; the font always shows. The lists
 * are the web's, in the same order.
 */
data class NameStyle(val font: String, val effect: String, val colors: List<Long>, val animated: Boolean? = null) {
    fun toJson(): JsonObject = buildJsonObject {
        if (font.isNotEmpty()) put("font", font)
        animated?.let { put("animated", it) }
        put("effect", effect)
        putJsonArray("colors") { colors.forEach { add(JsonPrimitive(it)) } }
    }

    val isAnimated get() = animated ?: (effect in listOf("aurora", "holo", "neon", "flame"))

    val isPlain get() = font.isEmpty() && effect == "solid" && colors.isEmpty()

    /** A font on offer: how much it is scaled so its lowercase letters (Bungee's capitals) are as tall as the app font's, and its name. */
    data class Font(val id: String, val scale: Float, val label: String)

    /** An effect, how many colours it takes, and the colours it starts with when picked; `paid` ones come with a plan (data/Plans). */
    data class Effect(val id: String, val min: Int, val max: Int, val start: List<Long>, val paid: Boolean = false)

    companion object {
        val PLAIN = NameStyle("", "solid", emptyList())

        val FONTS = listOf(
            Font("", 1.0f, ""),
            Font("comic", 1.0f, "Comic"),
            Font("fraunces", 1.02f, "Fraunces"),
            Font("playfair", 0.95f, "Playfair"),
            Font("dmserif", 1.02f, "DM Serif"),
            Font("youngserif", 0.98f, "Young Serif"),
            Font("syne", 0.99f, "Syne"),
            Font("bricolage", 0.94f, "Bricolage"),
            Font("spacegrotesk", 0.99f, "Space Grotesk"),
            Font("outfit", 1.02f, "Outfit"),
            Font("lexend", 0.93f, "Lexend"),
            Font("sora", 0.9f, "Sora"),
            Font("rubik", 0.95f, "Rubik"),
            Font("fredoka", 0.99f, "Fredoka"),
            Font("comfortaa", 0.9f, "Comfortaa"),
            Font("baloo", 1.01f, "Baloo"),
            Font("quicksand", 0.92f, "Quicksand"),
            Font("bungee", 0.99f, "Bungee"),
            Font("righteous", 0.94f, "Righteous"),
            Font("chewy", 0.9f, "Chewy"),
            Font("shrikhand", 0.93f, "Shrikhand"),
            Font("titan", 0.85f, "Titan"),
            Font("orbitron", 0.85f, "Orbitron"),
            Font("pacifico", 1.05f, "Pacifico"),
            Font("lobster", 0.94f, "Lobster"),
            Font("kalam", 0.93f, "Kalam"),
            Font("patrick", 1.05f, "Patrick Hand"),
            Font("caveat", 1.34f, "Caveat"),
            Font("pixelify", 1.07f, "Pixelify"),
            Font("spacemono", 0.99f, "Space Mono"),
        )

        val EFFECTS = listOf(
            Effect("solid", 0, 1, listOf()),
            Effect("gradient", 2, 2, listOf(0x5ec8c0L, 0xf2c58bL)),
            Effect("glow", 1, 1, listOf(0xb46cffL)),
            Effect("ink", 1, 1, listOf(0xff5ca8L)),
            Effect("pop", 1, 1, listOf(0x2fd27aL)),
            Effect("candy", 2, 4, listOf(0xf7a8d0L, 0xa8dcf7L, 0xc3b1f5L, 0xb6f0c9L)),
            Effect("aurora", 2, 5, listOf(0xf29a4aL, 0x6ee38aL, 0xf6e05eL, 0xe85bc8L, 0x6a6af2L)),
            Effect("chrome", 1, 1, listOf(0x9fb6d6L)),
            Effect("holo", 1, 1, listOf(0xa98bffL), paid = true),
            Effect("neon", 1, 1, listOf(0x3df0ffL), paid = true),
            Effect("flame", 2, 2, listOf(0xff4d1aL, 0xffd23fL), paid = true),
        )

        /** Ready-made colours for the effects that take more than one. */
        val PALETTES: Map<String, List<List<Long>>> = mapOf(
            "gradient" to listOf(listOf(0x5ec8c0L, 0xf2c58bL), listOf(0xc86bffL, 0x4f7cf2L), listOf(0xf0a3b8L, 0xc67be0L), listOf(0xe2513fL, 0xb98cf2L), listOf(0x45b86aL, 0x9fe6eeL), listOf(0xf09a4aL, 0xd65ad8L)),
            "candy" to listOf(listOf(0xf7a8d0L, 0xa8dcf7L, 0xc3b1f5L, 0xb6f0c9L), listOf(0xf06fb8L, 0xe0559fL, 0xf5a3d4L, 0xcc6aa8L), listOf(0xf6c28bL, 0xf09a76L, 0xee7f7fL, 0xdc6f8aL), listOf(0xd3ef7aL, 0xa6dc6eL, 0x82c96dL, 0x63b36aL), listOf(0x8ab8f8L, 0xa2e1d6L, 0x9b96eaL, 0x7fcde9L), listOf(0xca82f8L, 0xa86bf0L, 0xd45ed8L, 0x8a6cf2L)),
            "flame" to listOf(listOf(0xff4d1aL, 0xffd23fL), listOf(0xe0124aL, 0xff8a3dL), listOf(0x6a5cffL, 0x3fe0ffL), listOf(0x2fd27aL, 0xe6ff6bL), listOf(0xd65ad8L, 0xffb3e6L), listOf(0x2b6cf2L, 0xb8f0ffL)),
            "aurora" to listOf(listOf(0xf29a4aL, 0x6ee38aL, 0xf6e05eL, 0xe85bc8L, 0x6a6af2L), listOf(0xe6533cL, 0xf4cf62L, 0xa45df0L), listOf(0x8a1d1dL, 0xe55b2bL, 0xf2b23aL), listOf(0x8fdcf2L, 0xc69cf5L, 0xf29bd6L), listOf(0x47c98aL, 0x4a8cf2L, 0x7a4ef0L), listOf(0xd8f2a0L, 0xf2e19aL, 0xf4bfd9L)),
        )

        /** A colour for each one-colour swatch. */
        val SWATCHES = listOf(0xf7339fL, 0x2fd27aL, 0x2b9cf2L, 0xc63cf5L, 0xe0124aL, 0xf2482aL, 0xd4a817L)

        fun effect(id: String): Effect = EFFECTS.first { it.id == id }

        /** A style as sent, read defensively: anything malformed is the plain name (null). */
        fun read(x: JsonElement?): NameStyle? {
            val raw = x as? JsonObject ?: return null
            val font = (raw["font"] as? JsonPrimitive)?.contentOrNull?.takeIf { f -> FONTS.any { it.id == f } } ?: ""
            val effect = (raw["effect"] as? JsonPrimitive)?.contentOrNull?.takeIf { e -> EFFECTS.any { it.id == e } } ?: "solid"
            val spec = effect(effect)
            val colors = (raw["colors"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.longOrNull?.takeIf { c -> c in 0..0xFFFFFF } }?.take(spec.max) ?: emptyList()
            if (colors.size < spec.min) return null
            val out = NameStyle(font, effect, colors, (raw["animated"] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull)
            return if (out.isPlain) null else out
        }

        /** The same style with another effect, keeping the colours that still fit and filling the rest from its start. */
        fun withEffect(style: NameStyle?, effect: String): NameStyle {
            val spec = effect(effect)
            var colors = (style?.colors ?: emptyList()).take(spec.max)
            if (colors.size < spec.min || (colors.isEmpty() && effect != "solid")) colors = spec.start
            return NameStyle(style?.font ?: "", effect, colors, style?.animated)
        }

        /** A style as words a moderator reads: its effect, its font and its colours. */
        fun text(style: NameStyle?): String {
            if (style == null) return ""
            val font = FONTS.firstOrNull { it.id == style.font && it.id.isNotEmpty() }?.label
            return (listOf(fish.nexa.ui.t("nameStyle.effects.${style.effect}"), font) + style.colors.map { "#" + it.toString(16).padStart(6, '0') }).filterNotNull().joinToString(" ")
        }

        /** Something to try: a font, an effect and colours picked at random. */
        /** Something to try; the paid effects only with a plan. */
        fun surprise(rand: Random = Random.Default, paid: Boolean = false): NameStyle {
            val effect = EFFECTS.drop(1).filter { paid || !it.paid }.random(rand).id
            val colors = PALETTES[effect]?.random(rand) ?: listOf(SWATCHES.random(rand))
            return NameStyle(FONTS.random(rand).id, effect, colors)
        }
    }
}
