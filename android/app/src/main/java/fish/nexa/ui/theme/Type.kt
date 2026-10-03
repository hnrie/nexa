package fish.nexa.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import fish.nexa.R

/**
 * Wix Madefor, cut twice for screens (web/src/styles/fonts.css): the Text cut
 * for everything people read and tap, the Display cut, tighter and finer, for
 * names and titles. The Classic choice in Appearance is Onest with Mona Sans
 * drawn 115% wide. All are variable fonts, so every weight the web asks for
 * (650, 660 ...) is drawn at exactly that weight.
 */
object NexaFonts {
    private val WEIGHTS = listOf(300, 400, 450, 500, 550, 600, 650, 660, 700, 750, 800)

    private fun family(res: Int, italicRes: Int? = null, width: Float? = null): FontFamily = FontFamily(
        WEIGHTS.map { w ->
            Font(res, FontWeight(w), FontStyle.Normal, variationSettings = if (width != null) FontVariation.Settings(FontVariation.weight(w), FontVariation.width(width)) else FontVariation.Settings(FontVariation.weight(w)))
        } + (italicRes?.let { ir -> WEIGHTS.map { w -> Font(ir, FontWeight(w), FontStyle.Italic, variationSettings = FontVariation.Settings(FontVariation.weight(w))) } } ?: emptyList()),
    )

    val text: FontFamily by lazy { family(R.font.wix_madefor_text, R.font.wix_madefor_text_italic) }
    val display: FontFamily by lazy { family(R.font.wix_madefor_display) }
    val mono: FontFamily by lazy { FontFamily(listOf(400, 600, 700).map { w -> Font(R.font.jetbrains_mono, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w))) }) }
    val classicText: FontFamily by lazy { family(R.font.onest) }
    val classicDisplay: FontFamily by lazy { family(R.font.mona_sans, width = 115f) }
}

/** The type the web uses, size for size (px in its CSS is sp here, times the account's Text Size). */
@Immutable
data class NexaType(val text: FontFamily, val display: FontFamily, val mono: FontFamily, val scale: Float) {
    fun sp(px: Float): TextUnit = (px * scale).sp

    /** Messages and most reading: 16 at 1.375. */
    val body get() = TextStyle(fontFamily = text, fontSize = sp(16f), lineHeight = sp(22f), fontWeight = FontWeight(400))
    val bodySmall get() = TextStyle(fontFamily = text, fontSize = sp(14f), lineHeight = sp(19.25f), fontWeight = FontWeight(400))
    val label get() = TextStyle(fontFamily = text, fontSize = sp(13f), fontWeight = FontWeight(650), letterSpacing = 0.005.em)
    val hint get() = TextStyle(fontFamily = text, fontSize = sp(12f), lineHeight = sp(16.5f), fontWeight = FontWeight(400))
    val input get() = TextStyle(fontFamily = text, fontSize = sp(16f), fontWeight = FontWeight(400))
    val button get() = TextStyle(fontFamily = text, fontSize = sp(14.5f), fontWeight = FontWeight(600), letterSpacing = 0.005.em)
    val buttonLarge get() = TextStyle(fontFamily = text, fontSize = sp(16f), fontWeight = FontWeight(600), letterSpacing = 0.005.em)
    val buttonSmall get() = TextStyle(fontFamily = text, fontSize = sp(14f), fontWeight = FontWeight(600), letterSpacing = 0.005.em)
    val name get() = TextStyle(fontFamily = display, fontSize = sp(16f), lineHeight = sp(22f), fontWeight = FontWeight(600))
    val timestamp get() = TextStyle(fontFamily = text, fontSize = sp(12f), fontWeight = FontWeight(450))
    val title get() = TextStyle(fontFamily = display, fontSize = sp(29f), lineHeight = sp(31.9f), fontWeight = FontWeight(700), letterSpacing = (-0.014).em)
    val headerTitle get() = TextStyle(fontFamily = display, fontSize = sp(16f), fontWeight = FontWeight(650))
    val sheetTitle get() = TextStyle(fontFamily = display, fontSize = sp(17f), fontWeight = FontWeight(660))
    val heading get() = TextStyle(fontFamily = display, fontSize = sp(20f), lineHeight = sp(26f), fontWeight = FontWeight(700))
    val code get() = TextStyle(fontFamily = mono, fontSize = sp(14f), lineHeight = sp(20f))
}
