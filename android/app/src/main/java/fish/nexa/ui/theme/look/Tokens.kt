package fish.nexa.ui.theme.look

/** A whole theme: a value for every token, as #rrggbb or #rrggbbaa (lib/look/tokens.ts). */
typealias TokenMap = Map<String, String>

/**
 * Every colour a theme sets, grouped the way the theme builder lists them;
 * names are the web's custom properties without their dashes.
 */
object Tokens {
    val GROUPS: List<Pair<String, List<String>>> = listOf(
        "backgrounds" to listOf("bg-base", "bg-raised", "bg-surface", "bg-floating", "bg-input", "bg-composer", "embed-bg", "bg-overlay"),
        "interaction" to listOf("bg-hover", "bg-selected", "bg-active", "bg-message-hover", "scroll-thumb", "scroll-thumb-hover"),
        "text" to listOf("text-strong", "text", "text-subtle", "text-muted", "text-channel", "text-placeholder", "icon", "link"),
        "accent" to listOf("brand", "brand-hover", "brand-active", "on-brand", "text-brand", "focus-ring", "mention-bg", "mention-bg-hover", "mention-fg"),
        "borders" to listOf("border-subtle", "border", "border-strong"),
        "status" to listOf("positive", "positive-hover", "on-positive", "warning", "text-warning", "on-warning", "danger", "danger-hover", "on-danger", "text-danger", "status-online", "status-idle", "status-dnd", "status-offline"),
        "content" to listOf("tooltip-bg", "tooltip-text", "spoiler", "spoiler-revealed", "code-bg", "code-border", "code-keyword", "code-string", "code-number", "code-comment", "code-title", "code-type", "code-variable"),
    )

    val ALL: List<String> = GROUPS.flatMap { it.second }
    private val SET = ALL.toSet()
    fun isToken(name: String) = name in SET

    /** The ones meant to be see-through; every other token is stored and drawn solid. */
    val ALPHA = setOf("bg-overlay", "bg-hover", "bg-selected", "bg-active", "bg-message-hover", "scroll-thumb", "scroll-thumb-hover", "mention-bg", "mention-bg-hover", "border-subtle", "border", "border-strong", "code-border")

    fun groupOf(token: String): String = GROUPS.first { token in it.second }.first

    /** A value as a theme stores it, or null when it is not a colour. */
    fun normalise(value: String): String? = Colour.parseColour(value)?.let { Colour.toThemeHex(it.rgb, it.alpha) }

    val CLASSIC_IDS = listOf("dark", "light", "ash", "onyx")
    fun isClassic(id: String) = id in CLASSIC_IDS

    private val DARK_CSS = mapOf(
        "bg-base" to "#1c1825", "bg-raised" to "#221d2b", "bg-surface" to "#2b2636", "bg-floating" to "#282331",
        "bg-input" to "#15121c", "bg-composer" to "#2b2636", "bg-hover" to "rgba(166, 156, 196, 0.08)",
        "bg-selected" to "rgba(166, 156, 196, 0.13)", "bg-active" to "rgba(166, 156, 196, 0.17)",
        "bg-message-hover" to "rgba(166, 156, 196, 0.05)", "bg-overlay" to "rgba(6, 3, 14, 0.74)",
        "text" to "#f0edf7", "text-strong" to "#ffffff", "text-subtle" to "#d0cadb", "text-muted" to "#b0a8bf",
        "text-channel" to "#a39bb3", "text-placeholder" to "#928ba5", "icon" to "#bcb4cb", "brand" to "#8000ff",
        "brand-hover" to "#6a00d6", "brand-active" to "#5600ac", "on-brand" to "#ffffff", "on-danger" to "#ffffff",
        "on-positive" to "#ffffff", "on-warning" to "#111214", "focus-ring" to "#b77aff", "link" to "#86b8f7",
        "text-brand" to "#c6a4ff", "mention-bg" to "rgba(128, 0, 255, 0.24)", "mention-bg-hover" to "rgba(128, 0, 255, 0.38)",
        "mention-fg" to "#e0d0ff", "positive" to "#2d8550", "positive-hover" to "#256e42", "warning" to "#fdb833",
        "text-warning" to "#fdb833", "danger" to "#d1343b", "danger-hover" to "#b02a31", "text-danger" to "#ff8a8e",
        "status-online" to "#46b56e", "status-idle" to "#f0b232", "status-dnd" to "#ff7075", "status-offline" to "#a39cb1",
        "border-subtle" to "rgba(166, 156, 196, 0.11)", "border" to "rgba(166, 156, 196, 0.19)", "border-strong" to "rgba(166, 156, 196, 0.4)",
        "scroll-thumb" to "rgba(166, 156, 196, 0.24)", "scroll-thumb-hover" to "rgba(166, 156, 196, 0.42)",
        "spoiler" to "#7d768a", "spoiler-revealed" to "#15121c", "code-bg" to "#15121c", "code-border" to "rgba(166, 156, 196, 0.12)",
        "code-keyword" to "#c678dd", "code-string" to "#98c379", "code-number" to "#d19a66", "code-comment" to "#8d939e",
        "code-title" to "#61afef", "code-type" to "#e5c07b", "code-variable" to "#e06c75", "embed-bg" to "#272231",
        "tooltip-bg" to "#0e0b14", "tooltip-text" to "#f5f3fa",
    )

    private val LIGHT_CSS = mapOf(
        "bg-base" to "#f4f2fb", "bg-raised" to "#ffffff", "bg-surface" to "#eae8f3", "bg-floating" to "#ffffff",
        "bg-input" to "#ebe9f4", "bg-composer" to "#edebf5", "embed-bg" to "#f5f3fb", "bg-overlay" to "rgba(28, 18, 50, 0.46)",
        "bg-hover" to "rgba(101, 94, 125, 0.09)", "bg-selected" to "rgba(101, 94, 125, 0.14)", "bg-active" to "rgba(101, 94, 125, 0.2)",
        "bg-message-hover" to "rgba(101, 94, 125, 0.05)", "scroll-thumb" to "rgba(101, 94, 125, 0.32)", "scroll-thumb-hover" to "rgba(101, 94, 125, 0.52)",
        "text-strong" to "#1f1c28", "text" to "#2e2c37", "text-subtle" to "#595565", "text-muted" to "#595667",
        "text-channel" to "#5f5b6c", "text-placeholder" to "#6c6877", "icon" to "#514d5f", "link" to "#0062c0",
        "text-brand" to "#6a00d6", "focus-ring" to "#8000ff", "mention-bg" to "rgba(128, 0, 255, 0.16)",
        "mention-bg-hover" to "rgba(128, 0, 255, 0.32)", "mention-fg" to "#4a1a8f",
        "border-subtle" to "rgba(141, 136, 162, 0.26)", "border" to "rgba(141, 136, 162, 0.38)", "border-strong" to "rgba(141, 136, 162, 0.52)",
        "positive" to "#1f7d47", "positive-hover" to "#196a3c", "warning" to "#bb7300", "text-warning" to "#7a4b00",
        "danger" to "#d1343b", "danger-hover" to "#b02a31", "text-danger" to "#ab1e29", "status-online" to "#2a7044",
        "status-idle" to "#845a06", "status-dnd" to "#c0222c", "status-offline" to "#6b6776", "tooltip-bg" to "#282336",
        "tooltip-text" to "#f7f6fa", "spoiler" to "#93909e", "spoiler-revealed" to "#eae8f3", "code-bg" to "#f5f3fb",
        "code-border" to "rgba(141, 136, 162, 0.26)", "code-keyword" to "#cf222e", "code-string" to "#0a3069",
        "code-number" to "#0550ae", "code-comment" to "#636b75", "code-title" to "#7a3fd4", "code-type" to "#116329",
        "code-variable" to "#953800",
    )

    private val ASH_CSS = mapOf(
        "bg-base" to "#18191d", "bg-raised" to "#1d1e23", "bg-surface" to "#27282e", "bg-floating" to "#24252b",
        "bg-input" to "#111215", "bg-composer" to "#27282e", "embed-bg" to "#24252b", "bg-overlay" to "rgba(0, 0, 0, 0.72)",
        "bg-hover" to "rgba(200, 202, 215, 0.07)", "bg-selected" to "rgba(200, 202, 215, 0.12)", "bg-active" to "rgba(200, 202, 215, 0.16)",
        "bg-message-hover" to "rgba(200, 202, 215, 0.045)", "scroll-thumb" to "rgba(200, 202, 215, 0.22)", "scroll-thumb-hover" to "rgba(200, 202, 215, 0.4)",
        "text" to "#eeeef1", "text-subtle" to "#cacbd2", "text-muted" to "#aeafb8", "text-channel" to "#9fa0aa",
        "text-placeholder" to "#8c8e98", "icon" to "#b6b7c0", "border-subtle" to "rgba(200, 202, 215, 0.1)",
        "border" to "rgba(200, 202, 215, 0.17)", "border-strong" to "rgba(200, 202, 215, 0.36)", "text-danger" to "#ff8d90",
        "status-offline" to "#a0a1ab", "tooltip-bg" to "#0b0b0d", "spoiler" to "#7c7d86", "spoiler-revealed" to "#111215",
        "code-bg" to "#111215", "code-border" to "rgba(200, 202, 215, 0.1)",
    )

    private val ONYX_CSS = mapOf(
        "bg-base" to "#000000", "bg-raised" to "#000000", "bg-surface" to "#141218", "bg-floating" to "#16141b",
        "bg-input" to "#0c0b10", "bg-composer" to "#141218", "embed-bg" to "#121016", "bg-hover" to "rgba(255, 255, 255, 0.06)",
        "bg-selected" to "rgba(255, 255, 255, 0.1)", "bg-active" to "rgba(255, 255, 255, 0.14)", "bg-message-hover" to "rgba(255, 255, 255, 0.04)",
        "text-strong" to "#ffffff", "text" to "#dcdae0", "text-subtle" to "#c4c1ca", "text-muted" to "#a19eaa",
        "text-channel" to "#96939f", "text-placeholder" to "#86838f", "border-subtle" to "rgba(255, 255, 255, 0.1)",
        "border" to "rgba(255, 255, 255, 0.16)", "border-strong" to "rgba(255, 255, 255, 0.34)", "spoiler-revealed" to "#141218",
        "code-bg" to "#0c0b10",
    )

    private fun normaliseMap(m: Map<String, String>): TokenMap = ALL.associateWith { t -> m.getValue(t).let { normalise(it) ?: it } }

    /** The classic themes' full token sets, the dark one's under each, as the stylesheet's cascade gives them. */
    val CLASSIC: Map<String, TokenMap> = mapOf(
        "dark" to normaliseMap(DARK_CSS),
        "light" to normaliseMap(DARK_CSS + LIGHT_CSS),
        "ash" to normaliseMap(DARK_CSS + ASH_CSS),
        "onyx" to normaliseMap(DARK_CSS + ONYX_CSS),
    )
}
