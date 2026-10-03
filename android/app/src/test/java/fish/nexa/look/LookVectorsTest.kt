package fish.nexa.look

import fish.nexa.ui.theme.look.Colour
import fish.nexa.ui.theme.look.Contrast
import fish.nexa.ui.theme.look.CustomThemes
import fish.nexa.ui.theme.look.Derive
import fish.nexa.ui.theme.look.Looks
import fish.nexa.ui.theme.look.Presets
import fish.nexa.ui.theme.look.SimpleColours
import fish.nexa.ui.theme.look.ThemeSource
import fish.nexa.ui.theme.look.TokenMap
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.zip.GZIPInputStream

/**
 * The theme engine against the web's own answers (android/tools/look_vectors.ts):
 * every preset's 61 colours, and seeded random inputs through every function a
 * theme or an accent is worked out with. Exact strings, not near misses: a
 * colour one step off on the phone is a different colour.
 */
class LookVectorsTest {
    private val data: JsonObject by lazy {
        val stream = LookVectorsTest::class.java.classLoader!!.getResourceAsStream("web-look-vectors.json.gz")!!
        GZIPInputStream(stream).use { Json.parseToJsonElement(it.readBytes().decodeToString()) as JsonObject }
    }

    private fun list(key: String) = data[key]!!.jsonArray.map { it.jsonObject }
    private fun JsonObject.s(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull
    private fun tokens(e: JsonElement): Map<String, String> = e.jsonObject.mapValues { it.value.jsonPrimitive.content }

    @Test
    fun presets() {
        for ((id, want) in data["presets"]!!.jsonObject) assertEquals(id, tokens(want), Presets.tokens(id))
    }

    @Test
    fun derive() {
        for ((i, v) in list("derive").withIndex()) {
            val input = v["input"]!!.jsonObject
            val d = Derive.deriveTheme(SimpleColours(input.s("background")!!, input.s("accent")!!, input.s("text"), input.s("scheme")!!), v["high"]!!.jsonPrimitive.boolean)
            val label = "case $i $input"
            assertEquals(label, tokens(v["tokens"]!!), d.tokens)
            assertEquals(label, v.s("background"), d.background)
            val adjusted = v["adjusted"]!!.jsonObject
            assertEquals(label, adjusted["background"]!!.jsonPrimitive.boolean, d.adjustedBackground)
            assertEquals(label, adjusted["accent"]!!.jsonPrimitive.boolean, d.adjustedAccent)
            assertEquals(label, adjusted["text"]!!.jsonPrimitive.boolean, d.adjustedText)
        }
    }

    @Test
    fun backgrounds() {
        for (v in list("fit")) {
            assertEquals("$v", v.s("fit"), Derive.fitBackground(v.s("bg")!!, v.s("scheme")!!, v["high"]!!.jsonPrimitive.boolean))
            assertEquals("$v", v.s("flip"), Derive.flipBackground(v.s("bg")!!, v.s("scheme")!!))
        }
    }

    @Test
    fun accents() {
        for (v in list("accents")) {
            val want = (v["vars"] as? JsonObject)?.let { o -> o.entries.associate { it.key.removePrefix("--") to it.value.jsonPrimitive.content } }
            assertEquals("$v", want, Looks.accentVarsOn(v.s("accent")!!, v.s("surface")!!, v.s("scheme")!!))
        }
    }

    @Test
    fun colourMaths() {
        for (v in list("ensure")) {
            val bgs = v["bgs"]!!.jsonArray.map { it.jsonPrimitive.content }
            assertEquals("$v", v.s("out"), Colour.ensureContrast(v.s("colour")!!, bgs, v["target"]!!.jsonPrimitive.double))
        }
        for (v in list("mix")) assertEquals("$v", v.s("out"), Colour.mixOk(v.s("a")!!, v.s("b")!!, v["t"]!!.jsonPrimitive.double))
        for (v in list("luminances")) {
            val side = when (v.s("side")) {
                "atLeast" -> Colour.Side.AT_LEAST
                "atMost" -> Colour.Side.AT_MOST
                else -> Colour.Side.NEAREST
            }
            assertEquals("$v", v.s("out"), Colour.withLuminance(v.s("c")!!, v["target"]!!.jsonPrimitive.double, side))
        }
        for (v in list("tune")) assertEquals("$v", v.s("out"), Colour.tuneForContrast(v.s("c")!!, v.s("bg")!!, v["target"]!!.jsonPrimitive.double))
    }

    @Test
    fun parsing() {
        for (v in list("parse")) {
            val got = Colour.parseColour(v.s("v")!!)
            val want = v["out"] as? JsonObject
            if (want == null) {
                assertEquals(v.s("v"), null, got)
                continue
            }
            val rgb = want["rgb"]!!.jsonArray.map { it.jsonPrimitive.double }
            assertEquals(v.s("v"), rgb, listOf(got!!.rgb.r, got.rgb.g, got.rgb.b))
            assertEquals(v.s("v"), want["alpha"]!!.jsonPrimitive.double, got.alpha, 0.0)
        }
    }

    @Test
    fun contrastRules() {
        for ((i, v) in list("issues").withIndex()) {
            val t: TokenMap = tokens(v["tokens"]!!)
            val got = Contrast.issues(t).associateBy { it.token }
            val want = v["issues"]!!.jsonArray.map { it.jsonObject }
            assertEquals("case $i", want.map { it.s("token") }.toSet(), got.keys)
            for (w in want) {
                val g = got.getValue(w.s("token")!!)
                assertEquals("case $i ${w.s("token")}", w["ratio"]!!.jsonPrimitive.double, g.ratio, 1e-12)
                assertEquals("case $i ${w.s("token")}", w["min"]!!.jsonPrimitive.double, g.min, 0.0)
                val against = w["against"]!!
                val backdrop = if (against is JsonArray) Contrast.Backdrop(against[0].jsonPrimitive.content, against[1].jsonPrimitive.content) else Contrast.Backdrop(against.jsonPrimitive.content)
                assertEquals("case $i ${w.s("token")}", backdrop, g.against)
            }
            assertEquals("case $i", tokens(v["fixed"]!!), Contrast.fix(t))
        }
    }

    @Test
    fun customThemes() {
        val c = data["custom"]!!.jsonObject
        val sanitized = CustomThemes.sanitizeAll(c["raw"])
        assertEquals(c["sanitized"]!!.jsonArray.map { it.jsonObject }, sanitized.map { CustomThemes.toJson(it) })
        val resolved = c["resolved"]!!.jsonArray.map { it.jsonObject }
        for ((i, t) in sanitized.withIndex()) {
            val r = CustomThemes.resolve(t)
            assertEquals(t.id, tokens(resolved[i]["tokens"]!!), r.tokens)
            assertEquals(t.id, resolved[i].s("scheme"), r.scheme)
            assertEquals(t.id, c["exported"]!!.jsonArray[i].jsonPrimitive.content, CustomThemes.export(t))
        }
    }

    @Test
    fun imports() {
        for (v in list("imports")) {
            val want = v["out"]!!.jsonObject
            when (val got = CustomThemes.import(v.s("text")!!, "Imported Theme")) {
                is CustomThemes.Imported.Failed -> assertEquals(v.s("text"), want.s("error"), got.error)
                is CustomThemes.Imported.Ok -> {
                    val theme = CustomThemes.toJson(got.theme.copy(id = "x"))
                    assertEquals(v.s("text"), want["theme"]!!.jsonObject, theme)
                }
            }
        }
    }

    @Test
    fun looks() {
        val customs = CustomThemes.sanitizeAll(data["custom"]!!.jsonObject["raw"])
        for (v in list("looks")) {
            val pair = v["pair"] as? JsonObject
            val look = Looks.resolve(v.s("theme")!!, false, pair?.s("dark"), pair?.s("light"), customs)
            val want = v["look"]!!.jsonObject
            assertEquals("$v", want.s("id"), look.id)
            assertEquals("$v", want.s("scheme"), look.scheme)
            assertEquals("$v", want.s("classic"), look.classic)
            assertEquals("$v", want["underlineLinks"]!!.jsonPrimitive.boolean, look.underlineLinks)
            assertEquals("$v", (want["tokens"] as? JsonObject)?.let { tokens(it) }, look.tokens)
            assertEquals("$v", v.s("hardest"), Looks.hardestSurface(look))
        }
    }

    @Test
    fun simpleSourcesKeepTheirColours() {
        val t = CustomThemes.sanitizeAll(data["custom"]!!.jsonObject["raw"]).first()
        val s = t.source as ThemeSource.Simple
        assertEquals("#102030", s.colours.background)
        assertEquals(JsonNull, CustomThemes.toJson(t)["source"]!!.jsonObject["text"])
    }
}
