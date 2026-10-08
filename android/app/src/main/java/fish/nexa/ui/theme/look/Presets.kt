package fish.nexa.ui.theme.look

/** A theme in the gallery (lib/look/presets.ts). */
data class Preset(val id: String, val nameKey: String, val scheme: String, val group: String, val underlineLinks: Boolean)

/**
 * The gallery's themes: the four classic ones the web's stylesheet draws, and
 * sixteen worked out from a background and an accent by [Derive], each a
 * whole palette with every text colour at AA or better.
 */
object Presets {
    private class Recipe(val id: String, val nameKey: String, val group: String, val background: String, val accent: String, val scheme: String, val high: Boolean = false, val underline: Boolean = false)

    private val RECIPES = listOf(
        Recipe("nexa", "look.presets.nexa", "dark", "#211a30", "#8000ff", "dark"),
        Recipe("midnight", "look.presets.midnight", "dark", "#151c2e", "#4466ee", "dark"),
        Recipe("forest", "look.presets.forest", "dark", "#18221d", "#2e8052", "dark"),
        Recipe("rose", "look.presets.rose", "dark", "#261b21", "#c93d6b", "dark"),
        Recipe("amber", "look.presets.amber", "dark", "#241e16", "#eaa23a", "dark"),
        Recipe("ocean", "look.presets.ocean", "dark", "#10202a", "#127f91", "dark"),
        Recipe("nexa-light", "look.presets.nexaLight", "light", "#fbf9ff", "#7400f0", "light"),
        Recipe("sky", "look.presets.sky", "light", "#f5f8ff", "#2f5fe0", "light"),
        Recipe("forest-light", "look.presets.forestLight", "light", "#f6faf5", "#1d7c47", "light"),
        Recipe("rose-light", "look.presets.roseLight", "light", "#fff7f9", "#c0245b", "light"),
        Recipe("amber-light", "look.presets.amberLight", "light", "#fffaf0", "#a85a00", "light"),
        Recipe("ocean-light", "look.presets.oceanLight", "light", "#f3fafc", "#08707f", "light"),
        Recipe("greyscale", "look.presets.greyscale", "plain", "#262626", "#d6d6d6", "dark", underline = true),
        Recipe("greyscale-light", "look.presets.greyscaleLight", "plain", "#fafafa", "#404040", "light", underline = true),
        Recipe("contrast", "look.presets.contrast", "plain", "#000000", "#c4a1ff", "dark", high = true, underline = true),
        Recipe("contrast-light", "look.presets.contrastLight", "plain", "#ffffff", "#5a00c8", "light", high = true, underline = true),
    )

    private val CLASSIC_NAMES = mapOf(
        "dark" to "settings.appearance.themeDark",
        "light" to "settings.appearance.themeLight",
        "ash" to "settings.appearance.themeAsh",
        "onyx" to "settings.appearance.themeOnyx",
    )

    /** Every theme in the gallery but Sync with System, in the order it shows them. */
    val ALL: List<Preset> = Tokens.CLASSIC_IDS.map { Preset(it, CLASSIC_NAMES.getValue(it), if (it == "light") "light" else "dark", "classic", false) } +
        RECIPES.map { Preset(it.id, it.nameKey, it.scheme, it.group, it.underline) }

    private val BY_ID = ALL.associateBy { it.id }
    private val RECIPE_BY_ID = RECIPES.associateBy { it.id }
    private val made = java.util.concurrent.ConcurrentHashMap<String, TokenMap>()

    fun byId(id: String): Preset? = BY_ID[id]

    /** A card in the gallery (presetCards): a theme and its light version, switched between on the card; [light] and [dark] null for one with only one version. */
    data class Card(val preset: Preset, val light: Preset?, val dark: Preset?)

    fun cards(groups: List<String>): List<Card> {
        val inGroups = ALL.filter { it.group in groups }
        val ids = inGroups.map { it.id }.toSet()
        return inGroups
            .filter { !(it.id.endsWith("-light") && it.id.removeSuffix("-light") in ids) }
            .map { p ->
                val light = if (p.scheme == "dark" && "${p.id}-light" in ids) BY_ID.getValue("${p.id}-light") else null
                Card(p, light, if (light != null) p else null)
            }
    }

    /** The colours a derived preset is made from, for a custom theme that starts from it in simple mode. */
    fun colours(id: String): SimpleColours? = RECIPE_BY_ID[id]?.let { SimpleColours(it.background, it.accent, null, it.scheme) }

    /** A preset's whole palette, worked out the first time it is asked for. */
    fun tokens(id: String): TokenMap? {
        Tokens.CLASSIC[id]?.let { return it }
        made[id]?.let { return it }
        val r = RECIPE_BY_ID[id] ?: return null
        val t = Derive.deriveTheme(SimpleColours(r.background, r.accent, null, r.scheme), r.high).tokens
        made[id] = t
        return t
    }
}
