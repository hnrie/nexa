package fish.nexa.ui.chat

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import fish.nexa.R

/** The name style fonts (data/NameStyle FONTS), each one cut declared at every weight so none is thickened by hand. */
object NameFonts {
    private val families = HashMap<String, FontFamily>()

    private fun res(id: String): Int? = when (id) {
        "comic" -> R.font.name_comic
        "fraunces" -> R.font.name_fraunces
        "playfair" -> R.font.name_playfair
        "dmserif" -> R.font.name_dmserif
        "youngserif" -> R.font.name_youngserif
        "syne" -> R.font.name_syne
        "bricolage" -> R.font.name_bricolage
        "spacegrotesk" -> R.font.name_spacegrotesk
        "outfit" -> R.font.name_outfit
        "lexend" -> R.font.name_lexend
        "sora" -> R.font.name_sora
        "rubik" -> R.font.name_rubik
        "fredoka" -> R.font.name_fredoka
        "comfortaa" -> R.font.name_comfortaa
        "baloo" -> R.font.name_baloo
        "quicksand" -> R.font.name_quicksand
        "bungee" -> R.font.name_bungee
        "righteous" -> R.font.name_righteous
        "chewy" -> R.font.name_chewy
        "shrikhand" -> R.font.name_shrikhand
        "titan" -> R.font.name_titan
        "orbitron" -> R.font.name_orbitron
        "pacifico" -> R.font.name_pacifico
        "lobster" -> R.font.name_lobster
        "kalam" -> R.font.name_kalam
        "patrick" -> R.font.name_patrick
        "caveat" -> R.font.name_caveat
        "pixelify" -> R.font.name_pixelify
        "spacemono" -> R.font.name_spacemono
        else -> null
    }

    @Synchronized
    fun family(id: String): FontFamily? {
        families[id]?.let { return it }
        val r = res(id) ?: return null
        return FontFamily((100..900 step 100).map { Font(r, FontWeight(it)) }).also { families[id] = it }
    }
}
