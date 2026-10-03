package fish.nexa.data

import fish.nexa.ui.t
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlin.random.Random

/**
 * lib/typingStyle.ts: how someone types, shown in place of the plain dots
 * when they are the only one typing: up to three emoji (standard, a server's
 * own, or an uploaded typing picture "img:<id>"), how they move, and their own
 * words or one of the presets.
 */
data class TypingStyle(val emoji: List<String>, val motion: String, val preset: String? = null, val words: String? = null) {
    fun toJson(): JsonObject = buildJsonObject {
        putJsonArray("emoji") { emoji.forEach { add(JsonPrimitive(it)) } }
        put("motion", motion)
        if (!words.isNullOrEmpty()) put("words", words) else if (!preset.isNullOrEmpty()) put("preset", preset)
    }

    companion object {
        val PRESETS = listOf("yapping", "cooking", "plotting", "rambling", "overthinking", "daydreaming", "meowing", "essay", "tea", "thinking")
        val MOTIONS = listOf("wave", "pulse", "wiggle", "still")
        const val MAX_EMOJI = 3
        const val MAX_WORDS = 32
        private val CUSTOM = Regex("^<(a?):([A-Za-z0-9_]{1,32}):(\\d{1,20})>$")
        private val IMAGE = Regex("^img:(\\d{1,20})$")

        fun image(token: String): String? = IMAGE.find(token)?.groupValues?.get(1)

        data class Custom(val id: String, val name: String, val animated: Boolean)

        fun custom(token: String): Custom? = CUSTOM.find(token)?.let { Custom(it.groupValues[3], it.groupValues[2], it.groupValues[1] == "a") }

        fun read(x: JsonElement?): TypingStyle? {
            val raw = x as? JsonObject ?: return null
            val emoji = (raw["emoji"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
                ?.filter { it.isNotEmpty() && it.length <= 64 }?.take(MAX_EMOJI) ?: emptyList()
            val motion = (raw["motion"] as? JsonPrimitive)?.contentOrNull?.takeIf { it in MOTIONS } ?: "wave"
            val words = (raw["words"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.take(MAX_WORDS) ?: ""
            val preset = (raw["preset"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it in PRESETS } ?: ""
            if (emoji.isEmpty() && words.isEmpty() && preset.isEmpty()) return null
            return TypingStyle(emoji, motion, preset = if (words.isEmpty() && preset.isNotEmpty()) preset else null, words = words.ifEmpty { null })
        }

        fun same(a: TypingStyle?, b: TypingStyle?): Boolean {
            fun norm(s: TypingStyle?) = s?.let { listOf(it.emoji, it.motion, it.words ?: "", if (it.words != null) "" else (it.preset ?: "")) }
            return norm(a) == norm(b)
        }

        /** The sentence a style types with: its own words, a preset, or the plain one. */
        fun wordsKey(style: TypingStyle?): Pair<String, String?> = when {
            !style?.words.isNullOrEmpty() -> "typing.own" to style!!.words
            !style?.preset.isNullOrEmpty() -> "typing.presets.${style!!.preset}" to null
            else -> "chat.typingBar.oneTyping" to null
        }

        fun presetLabel(preset: String): String = t(if (preset.isNotEmpty()) "typing.presets.$preset" else "chat.typingBar.oneTyping", "a" to "").trim()

        fun text(style: TypingStyle?): String {
            if (style == null) return ""
            val emoji = style.emoji.map { e -> if (image(e) != null) "🖼️" else custom(e)?.let { ":${it.name}:" } ?: e }
            return (emoji + (style.words ?: style.preset?.let { presetLabel(it) } ?: "")).filter { it.isNotEmpty() }.joinToString(" ")
        }

        private val SETS = listOf(
            listOf("🐸", "☕", "✨"), listOf("🔥", "🔥", "🔥"), listOf("🍳", "🧂", "👩‍🍳"), listOf("🧠", "💭", "🌀"),
            listOf("🐱", "🧶", "💤"), listOf("🌙", "⭐", "☁️"), listOf("🎮", "🕹️", "👾"), listOf("📚", "✍️", "🤓"),
            listOf("🫖", "🍰", "👀"), listOf("🦆", "🍞", "🌊"), listOf("🌸", "🍓", "🎀"), listOf("⚡", "🚀", "💥"),
            listOf("🐝", "🌻", "🍯"), listOf("🎧", "🎶", "💜"),
        )

        /** Surprise Me: a set of emoji, a motion and a preset, each different from before. */
        fun surprise(before: TypingStyle?, random: Random = Random.Default): TypingStyle {
            fun <T> pick(list: List<T>, not: T?): T {
                val pool = if (list.size > 1 && not != null) list.filter { it != not } else list
                return pool[random.nextInt(pool.size)]
            }
            val set = pick(SETS, SETS.firstOrNull { before != null && it.joinToString("") == before.emoji.joinToString("") })
            val motion = pick(MOTIONS.filter { it != "still" }, before?.motion)
            val preset = pick(PRESETS, before?.preset)
            return TypingStyle(set, motion, preset = preset)
        }
    }
}
