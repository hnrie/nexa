package fish.nexa.markdown

import fish.nexa.ui.markdown.MarkdownColors
import fish.nexa.ui.markdown.Rgb
import fish.nexa.ui.markdown.Shortcodes
import fish.nexa.ui.markdown.TwemojiFiles
import fish.nexa.ui.markdown.Zalgo
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.BeforeClass
import org.junit.Test

/** Coloured text, shortcodes, zalgo and Twemoji's file names, against the web. */
class ColorEmojiVectorsTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun assets() = Vectors.useAssets()
    }

    private fun JsonObject.s(k: String): String? = this[k]?.takeIf { it !is JsonNull }?.jsonPrimitive?.contentOrNull

    private fun rgb(a: JsonArray) = Rgb(a[0].jsonPrimitive.double, a[1].jsonPrimitive.double, a[2].jsonPrimitive.double)

    @Test
    fun colorSpecs() {
        val cases = Vectors["colorSpec"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("parseColorSpec / colorToken / formatColorSpec", cases) { c ->
            val raw = c.s("raw")!!
            val spec = MarkdownColors.parseSpec(raw)
            val want = c["spec"]!!.takeIf { it !is JsonNull }?.jsonObject
            val specOk = if (want == null) spec == null else spec != null && spec.fg == want.s("fg") && spec.bg == want.s("bg")
            val tokenOk = MarkdownColors.token(raw) == c.s("token")
            val formatOk = (spec?.let { MarkdownColors.formatSpec(it) }) == c.s("formatted")
            if (specOk && tokenOk && formatOk) null else "raw ${Vectors.show(raw)}: web $c kotlin spec $spec token ${MarkdownColors.token(raw)}"
        }
    }

    @Test
    fun paint() {
        val cases = Vectors["paint"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("paintColor / swatchColor", cases) { c ->
            val surface = c["surface"]!!.jsonObject
            val s = MarkdownColors.Surface(rgb(surface["bg"]!!.jsonArray), rgb(surface["text"]!!.jsonArray))
            val swatch = c.s("swatch")
            if (swatch != null) {
                val got = MarkdownColors.swatch(swatch, s)
                if (got == c.s("out")) null else "swatch $swatch on $surface: web ${c["out"]} kotlin $got"
            } else {
                val got = MarkdownColors.paint(c.s("fg"), c.s("bg"), s)
                val out = c["out"]!!.jsonObject
                if (got.color == out.s("color") && got.background == out.s("background")) null
                else "fg ${c["fg"]} bg ${c["bg"]} on $surface: web $out kotlin $got"
            }
        }
    }

    @Test
    fun shortcodes() {
        val names = Vectors["shortcodes"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("shortcodeToEmoji", names) { c ->
            val got = Shortcodes.toEmoji(c.s("name")!!)
            if (got == c.s("emoji")) null else "name ${c.s("name")}: web ${c.s("emoji")} kotlin $got"
        }
        val reverse = Vectors["reverse"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("emojiShortcode", reverse) { c ->
            val got = Shortcodes.nameOf(c.s("emoji")!!)
            if (got == c.s("name")) null else "emoji ${c.s("emoji")}: web ${c.s("name")} kotlin $got"
        }
        val might = Vectors["might"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("mightHaveShortcode", might) { c ->
            val got = Shortcodes.mightHaveShortcode(c.s("text")!!)
            if (got == c["value"]!!.jsonPrimitive.boolean) null else "text ${Vectors.show(c.s("text")!!)}: web ${c["value"]} kotlin $got"
        }
    }

    @Test
    fun zalgo() {
        val cases = Vectors["zalgo"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("hasZalgo / clampZalgo", cases) { c ->
            val text = c.s("text")!!
            val ok = Zalgo.has(text) == c["has"]!!.jsonPrimitive.boolean && Zalgo.clamp(text) == c.s("clamped")
            if (ok) null else "text ${Vectors.show(text)}: web $c kotlin ${Zalgo.has(text)} ${Vectors.show(Zalgo.clamp(text))}"
        }
    }

    @Test
    fun twemojiFiles() {
        val cases = Vectors["twemoji"].jsonArray.map { it.jsonObject }
        Vectors.expectAll("twemojiFiles", cases) { c ->
            val got = TwemojiFiles.files(c.s("text")!!)
            val want = c["files"]!!.jsonArray.map { it.jsonPrimitive.content }
            if (got == want) null else "text ${Vectors.show(c.s("text")!!)}: web $want kotlin $got"
        }
    }
}
