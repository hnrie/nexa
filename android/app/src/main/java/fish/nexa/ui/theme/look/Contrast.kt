package fish.nexa.ui.theme.look

/**
 * lib/look/contrast.ts: what has to read on what. The same rules check the
 * gallery's presets and warn in the theme builder. A backdrop is a token, or
 * a see-through token over a solid one (a row lit up under the finger).
 */
object Contrast {
    /** A token, or `over` laid on `under`. */
    data class Backdrop(val over: String, val under: String? = null)

    data class Rule(val token: String, val on: List<Backdrop>, val min: Double)

    data class Issue(val token: String, val ratio: Double, val min: Double, val against: Backdrop)

    private fun b(t: String) = Backdrop(t)
    private fun b(over: String, under: String) = Backdrop(over, under)

    private val PANELS = listOf("bg-base", "bg-raised", "bg-surface", "bg-floating", "bg-input", "bg-composer", "embed-bg", "spoiler-revealed").map { b(it) }
    private val LIT = listOf(b("bg-selected", "bg-base"), b("bg-active", "bg-surface"), b("bg-message-hover", "bg-raised"), b("bg-hover", "bg-floating"), b("mention-bg", "bg-raised"))
    private val EVERYWHERE = PANELS + LIT
    private val READING = listOf(b("bg-raised"), b("bg-surface"), b("bg-floating"), b("embed-bg"), b("bg-message-hover", "bg-raised"))
    private val SIDEBAR = listOf(b("bg-base"), b("bg-selected", "bg-base"), b("bg-hover", "bg-base"))
    private val STATUS = listOf(b("bg-raised"), b("bg-base"), b("bg-surface"), b("bg-floating"))
    private val CODE = listOf(b("code-bg"))

    val RULES: List<Rule> = listOf(
        Rule("text-strong", EVERYWHERE, 4.5),
        Rule("text", EVERYWHERE, 4.5),
        Rule("text-subtle", EVERYWHERE, 4.5),
        Rule("text-muted", EVERYWHERE, 4.5),
        Rule("text-channel", SIDEBAR, 4.5),
        Rule("text-placeholder", listOf(b("bg-input"), b("bg-composer")), 4.5),
        Rule("icon", EVERYWHERE, 3.0),
        Rule("link", READING, 4.5),
        Rule("text-brand", PANELS, 4.5),
        Rule("focus-ring", PANELS, 3.0),
        Rule("mention-fg", listOf(b("mention-bg", "bg-raised"), b("mention-bg-hover", "bg-raised")), 4.5),
        Rule("on-brand", listOf(b("brand"), b("brand-hover"), b("brand-active")), 4.5),
        Rule("on-positive", listOf(b("positive"), b("positive-hover")), 4.5),
        Rule("on-danger", listOf(b("danger"), b("danger-hover")), 4.5),
        Rule("on-warning", listOf(b("warning")), 4.5),
        Rule("text-danger", EVERYWHERE, 4.5),
        Rule("text-warning", EVERYWHERE, 4.5),
        Rule("status-online", STATUS, 4.5),
        Rule("status-idle", STATUS, 4.5),
        Rule("status-dnd", STATUS, 4.5),
        Rule("status-offline", STATUS, 4.5),
        Rule("tooltip-text", listOf(b("tooltip-bg")), 4.5),
        Rule("code-keyword", CODE, 4.5),
        Rule("code-string", CODE, 4.5),
        Rule("code-number", CODE, 4.5),
        Rule("code-comment", CODE, 4.5),
        Rule("code-title", CODE, 4.5),
        Rule("code-type", CODE, 4.5),
        Rule("code-variable", CODE, 4.5),
    )

    /** The solid colour a backdrop is, in this theme. */
    fun backdropColour(tokens: TokenMap, b: Backdrop): String =
        if (b.under == null) Colour.flatten(tokens.getValue(b.over), "#000000")
        else Colour.flatten(tokens.getValue(b.over), Colour.flatten(tokens.getValue(b.under), "#000000"))

    /** Every token that does not read where it is drawn, worst case per token. */
    fun issues(tokens: TokenMap): List<Issue> {
        val worst = LinkedHashMap<String, Issue>()
        for (rule in RULES) {
            val fg = Colour.flatten(tokens.getValue(rule.token), backdropColour(tokens, rule.on[0]))
            for (b in rule.on) {
                val ratio = Colour.contrast(fg, backdropColour(tokens, b))
                if (ratio + 1e-9 >= rule.min) continue
                val have = worst[rule.token]
                // judged by how far short it falls, so a 4.4 against 4.5 is not listed ahead of a 2.1 against 3
                if (have == null || ratio / rule.min < have.ratio / have.min) worst[rule.token] = Issue(rule.token, ratio, rule.min, b)
            }
        }
        return worst.values.toList()
    }

    /** The same theme with every issue it can mend mended; a fill no text can read on is moved instead. */
    fun fix(tokens: TokenMap): TokenMap {
        val out = LinkedHashMap(tokens)
        repeat(2) {
            for (rule in RULES) {
                val bgs = rule.on.map { backdropColour(out, it) }
                val current = Colour.parseColour(out.getValue(rule.token)) ?: continue
                val fg = Colour.toHex(current.rgb)
                if (bgs.all { Colour.contrast(fg, it) >= rule.min }) continue
                val tuned = Colour.ensureContrast(fg, bgs, rule.min)
                out[rule.token] = tuned
                if (bgs.all { Colour.contrast(tuned, it) >= rule.min }) continue
                for (b in rule.on) {
                    if (b.under != null || Colour.contrast(tuned, backdropColour(out, b)) >= rule.min) continue
                    val o = Colour.hexToOklch(Colour.toHex(Colour.parseColour(out.getValue(b.over))!!.rgb))!!
                    val away = if ((Colour.hexToOklch(tuned)?.l ?: 1.0) > o.l) -1 else 1
                    var l = o.l
                    var i = 0
                    while (i < 50 && Colour.contrast(tuned, Colour.oklchToHex(o.copy(l = l))) < rule.min) {
                        l += away * 0.02
                        i++
                    }
                    out[b.over] = Colour.oklchToHex(o.copy(l = l))
                }
            }
        }
        return out
    }
}
