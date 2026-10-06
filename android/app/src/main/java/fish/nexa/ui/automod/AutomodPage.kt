package fish.nexa.ui.automod

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.Automod
import fish.nexa.data.AutomodAction
import fish.nexa.data.AutomodConfig
import fish.nexa.data.AutomodEvent
import fish.nexa.data.AutomodRule
import fish.nexa.data.P
import fish.nexa.net.PublicUser
import fish.nexa.net.wireJson
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxCheckbox
import fish.nexa.ui.components.NxSlider
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.NxToggle
import fish.nexa.ui.components.ToggleRow
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.server.Field
import fish.nexa.ui.server.Form
import fish.nexa.ui.server.H5
import fish.nexa.ui.server.Hint
import fish.nexa.ui.server.LoadFailed
import fish.nexa.ui.server.Loading
import fish.nexa.ui.server.PageTitle
import fish.nexa.ui.server.SaveState
import fish.nexa.ui.server.SelectField
import fish.nexa.ui.server.SettingsPage
import fish.nexa.ui.server.surfaceCard
import fish.nexa.ui.shell.ChannelGlyph
import fish.nexa.ui.shell.Names
import fish.nexa.ui.shell.confirm
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.mixSrgb
import fish.nexa.ui.theme.rgbColor
import fish.nexa.ui.theme.ring
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/** What a kind of rule is, in the order they are offered (automod/kinds.ts). */
class KindInfo(val kind: String, val icon: String, val server: Boolean, val tryable: Boolean, val defaults: () -> Triple<String, AutomodConfig, List<AutomodAction>>)

private val BLOCK = listOf(AutomodAction("block"))

val KINDS = listOf(
    KindInfo("flagged_words", "MessageSquareWarning", false, true) { Triple(t("automod.kind.flagged_words"), AutomodConfig(lists = listOf("profanity", "slurs", "sexual"), evasion = true), BLOCK) },
    KindInfo("words", "SpellCheck", false, true) { Triple(t("automod.kind.words"), AutomodConfig(words = emptyList(), regex = emptyList(), allow = emptyList(), evasion = true), BLOCK) },
    KindInfo("spam", "Fish", false, true) { Triple(t("automod.kind.spam"), AutomodConfig(scams = true, shadyLinks = true, repeats = true, zalgo = true, walls = false), BLOCK) },
    KindInfo("links", "Link2Off", false, true) { Triple(t("automod.kind.links"), AutomodConfig(mode = "all", allow = emptyList()), BLOCK) },
    KindInfo("invites", "TicketX", false, true) { Triple(t("automod.kind.invites"), AutomodConfig(), BLOCK) },
    KindInfo("personal", "MailWarning", false, true) { Triple(t("automod.kind.personal"), AutomodConfig(emails = true, phones = true, ips = true, cards = true), BLOCK) },
    KindInfo("caps", "CaseUpper", false, true) { Triple(t("automod.kind.caps"), AutomodConfig(percent = 70, minLength = 10), BLOCK) },
    KindInfo("emoji_spam", "SmilePlus", false, true) { Triple(t("automod.kind.emoji_spam"), AutomodConfig(max = 10), BLOCK) },
    KindInfo("attachments", "FileWarning", false, false) { Triple(t("automod.kind.attachments"), AutomodConfig(extensions = listOf("exe", "scr", "bat", "cmd", "msi", "vbs", "js", "ps1", "jar", "apk", "lnk", "hta")), BLOCK) },
    KindInfo("mentions", "AtSign", true, false) { Triple(t("automod.kind.mentions"), AutomodConfig(max = 5, raid = true), BLOCK) },
    KindInfo("flood", "Zap", true, false) { Triple(t("automod.kind.flood"), AutomodConfig(messages = 5, seconds = 5), BLOCK) },
    KindInfo("profile", "IdCard", true, true) { Triple(t("automod.kind.profile"), AutomodConfig(lists = listOf("slurs", "sexual"), words = emptyList(), names = true, bio = true, evasion = true), listOf(AutomodAction("quarantine"))) },
)

fun kindInfo(kind: String) = KINDS.firstOrNull { it.kind == kind }

/** The ready-made lists, by name, as they are offered. */
val LISTS = listOf("profanity", "slurs", "sexual")

fun listLabel(name: String) = t("automod.list.$name")

/** How long, said the way the timeout menu says it. */
val TIMEOUTS = listOf(60, 300, 600, 3600, 86400, 604800)

/** A list of words joined into a line starts with a capital, in the languages that have them. */
private fun capitalized(s: String) = s.replaceFirstChar { it.titlecase() }

/** What a rule looks for, in one line. */
fun ruleSummary(rule: AutomodRule): String {
    val c = rule.config
    fun n(l: List<String>?) = l?.size ?: 0
    return when (rule.kind) {
        "flagged_words" -> {
            val lists = (c.lists ?: emptyList()).joinToString(", ") { listLabel(it) }
            if (n(c.allow) > 0) t("automod.summary.flaggedAllow", "lists" to lists, "count" to n(c.allow)) else t("automod.summary.flagged", "lists" to lists)
        }
        "words" -> {
            val words = if (n(c.words) > 0) t("automod.summary.wordsCount", "count" to n(c.words)) else ""
            val patterns = if (n(c.regex) > 0) t("automod.summary.patternsCount", "count" to n(c.regex)) else ""
            if (words.isNotEmpty() && patterns.isNotEmpty()) t("automod.summary.wordsAndPatterns", "words" to words, "patterns" to patterns)
            else capitalized(words.ifEmpty { patterns }).ifEmpty { t("automod.summary.noWords") }
        }
        "spam" -> capitalized(listOfNotNull(
            t("automod.spam.scams").takeIf { c.scams == true }, t("automod.spam.shady").takeIf { c.shadyLinks == true }, t("automod.spam.repeats").takeIf { c.repeats == true },
            t("automod.spam.zalgo").takeIf { c.zalgo == true }, t("automod.spam.walls").takeIf { c.walls == true },
        ).joinToString(", "))
        "links" -> when {
            c.mode == "list" -> t("automod.summary.linksList", "count" to n(c.domains))
            n(c.allow) > 0 -> t("automod.summary.linksAllBut", "count" to n(c.allow))
            else -> t("automod.summary.linksAll")
        }
        "invites" -> t("automod.summary.invites")
        "personal" -> capitalized(listOfNotNull(
            t("automod.personal.emails").takeIf { c.emails == true }, t("automod.personal.phones").takeIf { c.phones == true },
            t("automod.personal.ips").takeIf { c.ips == true }, t("automod.personal.cards").takeIf { c.cards == true },
        ).joinToString(", "))
        "caps" -> t("automod.summary.caps", "percent" to (c.percent ?: 70), "length" to (c.minLength ?: 10))
        "emoji_spam" -> t("automod.summary.emoji", "count" to (c.max ?: 10))
        "attachments" -> (c.extensions ?: emptyList()).take(8).joinToString(" ") { ".$it" } + if (n(c.extensions) > 8) " +${n(c.extensions) - 8}" else ""
        "mentions" -> if (c.raid == true) t("automod.summary.mentionsRaid", "count" to (c.max ?: 5)) else t("automod.summary.mentions", "count" to (c.max ?: 5))
        "flood" -> t("automod.summary.flood", "count" to (c.messages ?: 5), "seconds" to (c.seconds ?: 5))
        "profile" -> t("automod.summary.profile", "parts" to listOfNotNull(t("automod.profile.names").takeIf { c.names != false }, t("automod.profile.bio").takeIf { c.bio == true }).joinToString(", "))
        else -> ""
    }
}

/** What a rule does, each in a word or two. */
fun actionLabels(actions: List<AutomodAction>): List<String> = actions.mapNotNull { a ->
    when (a.type) {
        "block" -> t("automod.do.block")
        "alert" -> t("automod.do.alertIn", "channel" to "#" + (a.channelId?.let { Nexa.channels.get(it)?.name } ?: "?"))
        "timeout" -> if ((a.after ?: 1) > 1) t("automod.do.timeoutAfter", "time" to Time.shortDuration((a.seconds ?: 60).toDouble()), "count" to (a.after ?: 1))
        else t("automod.do.timeout", "time" to Time.shortDuration((a.seconds ?: 60).toDouble()))
        "quarantine" -> t("automod.do.quarantine")
        else -> null
    }
}

/** Words typed one to a line (or with commas between), as a rule keeps them. */
fun splitWords(text: String) = text.split('\n', ',').map { it.trim() }.filter { it.isNotEmpty() }

/** Patterns, one to a line: commas belong to the pattern. */
fun splitLines(text: String) = text.split('\n').map { it.trim() }.filter { it.isNotEmpty() }

/** Whether a pattern is one this app can read (the server checks it further). */
fun patternProblem(p: String): String? {
    if (runCatching { java.util.regex.Pattern.compile(p) }.isFailure) return t("automod.editor.badPattern", "pattern" to p)
    if (Regex("""\(\?[=!<]""").containsMatchIn(p)) return t("automod.editor.noLookaround", "pattern" to p)
    if (Regex("""\\[1-9]""").containsMatchIn(p)) return t("automod.editor.noBackref", "pattern" to p)
    return null
}

@Serializable
private data class Stats(val since: Long = 0, val rules: List<StatRow> = emptyList())

@Serializable
private data class StatRow(@SerialName("rule_id") val ruleId: String? = null, @SerialName("rule_name") val ruleName: String = "", @SerialName("rule_kind") val ruleKind: String = "", val count: Int = 0)

private sealed interface View {
    data object List : View
    data object Pick : View
    data class Edit(val rule: AutomodRule?, val kind: String) : View
}

/**
 * AutomodPage.tsx: the rules a server's members' apps apply to messages as
 * they are written (messages are end-to-end encrypted, so nobody else can
 * read them) and the ones the server applies to pings, floods, names and
 * titles, with what each did this week; and the log of what AutoMod did.
 */
@Composable
fun AutomodPage(serverId: String) {
    val c = Nx.colors
    val st = Nexa.servers.get(serverId)
    val mayEdit = Nexa.servers.canI(st, P.MANAGE_SERVER)
    var tab by remember { mutableStateOf(if (mayEdit) "rules" else "log") }
    var rules by remember { mutableStateOf<List<AutomodRule>?>(null) }
    var failed by remember { mutableStateOf(false) }
    val counts = remember { mutableStateMapOf<String, Int>() }
    var view by remember { mutableStateOf<View>(View.List) }
    // back from a rule (or from choosing a kind) is the list of rules, not out of AutoMod
    androidx.activity.compose.BackHandler(enabled = view != View.List) {
        fish.nexa.ui.server.Holds.unlessUnsaved { view = View.List }
    }
    var reload by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(reload) {
        if (!mayEdit) return@LaunchedEffect
        failed = false
        try {
            rules = Automod.allRules(serverId)
            runCatching { Nexa.api.get("/servers/$serverId/automod/stats", Stats.serializer()) }.getOrNull()?.let { s ->
                counts.clear()
                for (r in s.rules) r.ruleId?.let { counts[it] = r.count }
            }
        } catch (_: Exception) {
            failed = true
        }
    }
    LaunchedEffect(serverId) {
        Nexa.session.events.collect { e ->
            val o = e.d as? JsonObject ?: return@collect
            val sid = (o["server_id"] as? JsonPrimitive)?.contentOrNull
            if (sid != serverId) return@collect
            if (e.t == "automod_rules_update") reload += 1
            if (e.t == "automod_event") (o["rule_id"] as? JsonPrimitive)?.contentOrNull?.let { id -> counts[id] = (counts[id] ?: 0) + 1 }
        }
    }
    fun toggle(rule: AutomodRule, on: Boolean) {
        rules = rules?.map { if (it.id == rule.id) it.copy(enabled = on) else it }
        scope.launch {
            try {
                Nexa.api.request("PATCH", "/servers/$serverId/automod/rules/${rule.id}", buildJsonObject { put("enabled", on) })
            } catch (e: Exception) {
                rules = rules?.map { if (it.id == rule.id) it.copy(enabled = !on) else it }
                Nexa.ui.toast(describeError(e, t("automod.editor.saveFailed")), "error")
            }
        }
    }

    (view as? View.Edit)?.let { v ->
        RuleEditor(serverId, v.rule, v.kind) {
            view = View.List
            reload += 1
        }
        return
    }

    SettingsPage {
        // `.intro`: drawn up under the title, 14.5 at 1.5
        PageTitle(t("automod.title"), gap = 10.dp)
        Txt(t("automod.page.intro"), style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), lineHeight = Nx.type.sp(21.75f)), color = c.textMuted, modifier = Modifier.padding(bottom = 12.dp))
        if (mayEdit) fish.nexa.ui.components.UnderlineTabs(listOf("rules" to t("automod.page.rules"), "log" to t("automod.page.log")), tab, t("automod.title"), Modifier.padding(bottom = 20.dp)) { tab = it }
        when {
            tab == "log" -> AutomodLog(serverId)
            view == View.Pick -> KindPicker(rules ?: emptyList(), onPick = { view = View.Edit(null, it) }, onCancel = { view = View.List })
            else -> {
                val list = rules
                when {
                    failed -> LoadFailed(t("automod.page.failed")) { reload += 1 }
                    list == null -> Loading(t("chat.pins.loading"))
                    list.isEmpty() -> Column(
                        Modifier.fillMaxWidth().surfaceCard(c, Radii.Md).padding(horizontal = 16.dp, vertical = 22.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Txt(t("automod.page.none"), style = Nx.type.body.copy(fontWeight = FontWeight(700)), color = c.textStrong)
                        Txt(t("automod.page.noneHint"), style = Nx.type.bodySmall, color = c.textMuted, align = androidx.compose.ui.text.style.TextAlign.Center)
                    }
                    else -> {
                        val total = counts.values.sum()
                        Row(Modifier.padding(bottom = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Txt(total.toString(), style = Nx.type.title.copy(fontSize = Nx.type.sp(24f)), color = c.textStrong)
                            Txt(t("automod.page.weekTotal", "count" to total), style = Nx.type.bodySmall, color = c.textMuted)
                        }
                        Column(Modifier.fillMaxWidth().surfaceCard(c, Radii.Md)) {
                            for ((i, r) in list.withIndex()) {
                                if (i > 0) Box(Modifier.fillMaxWidth().padding(horizontal = 14.dp).heightIn(min = 1.dp).background(c.borderSubtle))
                                RuleRow(r, counts[r.id] ?: 0, onOpen = { view = View.Edit(r, r.kind) }) { toggle(r, it) }
                            }
                        }
                    }
                }
                if (rules != null) Box(Modifier.padding(top = 14.dp)) {
                    NxButton(t("automod.page.add"), { view = View.Pick }, icon = "Plus")
                }
            }
        }
    }
}

@Composable
private fun KindIcon(info: KindInfo?, size: androidx.compose.ui.unit.Dp = 40.dp) {
    val c = Nx.colors
    Box(
        Modifier.size(size).background(if (info?.server == true) mixSrgb(c.bgActive, c.brand, 0.18f) else c.bgActive, RoundedCornerShape(10.dp)),
        contentAlignment = Alignment.Center,
    ) { if (info != null) Icon(info.icon, if (info.server) c.textBrand else c.textStrong, size = 20.dp) }
}

@Composable
private fun RuleRow(rule: AutomodRule, count: Int, onOpen: () -> Unit, onToggle: (Boolean) -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        Modifier
            .fillMaxWidth()
            .background(if (pressed) c.bgHover else Color.Transparent)
            .padding(start = 14.dp, end = 10.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(Modifier.weight(1f).pressable(interaction, onClick = onOpen), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            KindIcon(kindInfo(rule.kind))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Txt(rule.name, style = Nx.type.body.copy(fontWeight = FontWeight(650)), color = if (rule.enabled) c.textStrong else c.textMuted, maxLines = 1)
                Txt(ruleSummary(rule), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 2)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    for ((i, label) in actionLabels(rule.actions).withIndex()) DoChip(label, rule.actions.getOrNull(i)?.type ?: "")
                }
            }
        }
        Column(horizontalAlignment = Alignment.End, modifier = Modifier.semantics { contentDescription = t("automod.page.weekCountLong", "count" to count) }) {
            Txt(count.toString(), style = Nx.type.body.copy(fontWeight = FontWeight(700)), color = c.textStrong)
            Txt(t("automod.page.thisWeek"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(11.5f)), color = c.textMuted, maxLines = 1)
        }
        NxToggle(rule.enabled, onToggle, label = if (rule.enabled) t("automod.page.turnOff", "name" to rule.name) else t("automod.page.turnOn", "name" to rule.name))
    }
}

@Composable
private fun DoChip(label: String, kind: String) {
    val c = Nx.colors
    val (fg, bg) = when (kind) {
        "block" -> c.textDanger to c.danger.copy(alpha = 0.16f)
        "timeout", "quarantine" -> c.textWarning to c.warning.copy(alpha = 0.16f)
        else -> c.text to c.bgActive
    }
    Txt(label, style = Nx.type.hint.copy(fontSize = Nx.type.sp(11.5f), fontWeight = FontWeight(650)), color = fg, maxLines = 1, modifier = Modifier.background(bg, RoundedCornerShape(999.dp)).padding(horizontal = 8.dp, vertical = 1.dp))
}

/** What a new rule can look for: read in members' apps, or by the server itself. */
@Composable
private fun KindPicker(existing: List<AutomodRule>, onPick: (String) -> Unit, onCancel: () -> Unit) {
    val c = Nx.colors
    for ((i, group) in listOf(t("automod.page.appKinds") to KINDS.filter { !it.server }, t("automod.page.serverKinds") to KINDS.filter { it.server }).withIndex()) {
        val (head, kinds) = group
        // `.kindGroup`: 14/650 in the muted colour
        Txt(
            head,
            style = Nx.type.body.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(650)),
            color = c.textMuted,
            modifier = Modifier.padding(top = if (i == 0) 0.dp else 18.dp, bottom = 8.dp).semantics { heading() },
        )
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (k in kinds) {
                val has = existing.count { it.kind == k.kind }
                val interaction = remember { MutableInteractionSource() }
                val pressed by interaction.collectIsPressedAsState()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(Radii.Md)
                        .surfaceCard(c, Radii.Md, if (pressed) c.border else c.borderSubtle)
                        .pressable(interaction) { onPick(k.kind) }
                        .padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    KindIcon(k)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Txt(t("automod.kind.${k.kind}"), style = Nx.type.body.copy(fontWeight = FontWeight(650)), color = c.textStrong)
                        Txt(t("automod.kindDesc.${k.kind}"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18f)), color = c.textMuted)
                        if (has > 0) Txt(t("automod.page.alreadyHave", "count" to has), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted)
                    }
                }
            }
        }
    }
    Box(Modifier.padding(top = 14.dp)) { NxButton(t("chat.editMessage.cancel"), onCancel, kind = ButtonKind.GHOST) }
}

// ---------------------------------------------------------------------------
// one rule (RuleEditor.tsx)

/** A rule as it is being written: the words of its lists as they are typed. */
private data class Draft(
    val name: String,
    val enabled: Boolean,
    val config: AutomodConfig,
    val actions: List<AutomodAction>,
    val exemptRoles: List<String>,
    val exemptChannels: List<String>,
    val wordsText: String,
    val regexText: String,
    val allowText: String,
    val domainsText: String,
    val extText: String,
)

private fun draftOf(rule: AutomodRule?, kind: String): Draft {
    val def = kindInfo(kind)!!.defaults()
    val name = rule?.name ?: def.first
    val c = rule?.config ?: def.second
    return Draft(
        name, rule?.enabled ?: true, c, rule?.actions ?: def.third, rule?.exemptRoles ?: emptyList(), rule?.exemptChannels ?: emptyList(),
        (c.words ?: emptyList()).joinToString("\n"), (c.regex ?: emptyList()).joinToString("\n"), (c.allow ?: emptyList()).joinToString("\n"),
        (c.domains ?: emptyList()).joinToString("\n"), (c.extensions ?: emptyList()).joinToString(", "),
    )
}

/** The config as it will be saved, from what is typed. */
private fun configOf(kind: String, d: Draft): AutomodConfig {
    var c = d.config
    if (kind == "words" || kind == "profile") c = c.copy(words = splitWords(d.wordsText), regex = splitLines(d.regexText))
    if (kind == "words" || kind == "flagged_words" || kind == "profile") c = c.copy(allow = splitWords(d.allowText))
    if (kind == "links") c = c.copy(allow = splitWords(d.allowText), domains = splitWords(d.domainsText))
    if (kind == "attachments") c = c.copy(extensions = splitWords(d.extText).map { it.removePrefix(".").lowercase() })
    return c
}

private fun ruleOf(kind: String, d: Draft, base: AutomodRule?): AutomodRule = (base ?: AutomodRule()).copy(
    name = d.name.trim().ifEmpty { kindInfo(kind)!!.defaults().first },
    kind = kind, enabled = d.enabled, config = configOf(kind, d), actions = d.actions,
    exemptRoles = d.exemptRoles, exemptChannels = d.exemptChannels,
)

/** One rule, written or rewritten: what it looks for, a box to try it on, what it does about what it finds, and who it leaves alone. */
@Composable
private fun RuleEditor(serverId: String, rule: AutomodRule?, kind: String, onDone: () -> Unit) {
    val c = Nx.colors
    val info = kindInfo(kind) ?: return
    val st = Nexa.servers.get(serverId)
    val channels by Nexa.channels.byId.collectAsState()
    val saved = remember { draftOf(rule, kind) }
    var d by remember { mutableStateOf(saved) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var sample by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    // the ready-made lists, for trying them out here
    val presetsHere by produceState(0, kind) { if (kind == "flagged_words" || kind == "spam" || kind == "profile") { Automod.presets(); value = 1 } }
    val mayTimeout = Nexa.servers.canI(st, P.MODERATE_MEMBERS)
    fun body(x: Draft) = wireJson.encodeToString(AutomodRule.serializer(), ruleOf(kind, x, rule))
    val dirty = rule == null || body(d) != body(saved)
    val textChannels = channels.values.filter { it.serverId == serverId && (it.isText || it.isAnnouncement) }.sortedBy { it.position }
    val exemptable = channels.values.filter { it.serverId == serverId && (it.isText || it.isAnnouncement || it.isForum || it.isVoice) }.sortedBy { it.position }
    val roles = Nexa.servers.rolesByPosition(st).filter { it.id != serverId }
    fun action(type: String) = d.actions.firstOrNull { it.type == type }
    fun setAction(type: String, on: Boolean, patch: (AutomodAction) -> AutomodAction = { it }) {
        val rest = d.actions.filter { it.type != type }
        d = d.copy(actions = if (!on) rest else rest + patch(action(type) ?: AutomodAction(type)))
    }
    fun setConfig(fn: (AutomodConfig) -> AutomodConfig) {
        d = d.copy(config = fn(d.config))
    }
    val patternIssue = splitLines(d.regexText).firstNotNullOfOrNull { patternProblem(it) }
    @Suppress("UNUSED_EXPRESSION") presetsHere
    val tryResult = if (info.tryable && sample.isNotBlank()) Automod.tryRule(ruleOf(kind, d, rule), sample) else null

    fun save() {
        problem = null
        when {
            patternIssue != null -> problem = patternIssue
            d.actions.isEmpty() -> problem = t("automod.editor.needAction")
            action("alert")?.let { it.channelId == null } == true -> problem = t("automod.editor.needAlertChannel")
        }
        if (problem != null) return
        busy = true
        scope.launch {
            try {
                val r = ruleOf(kind, d, rule)
                val json = buildJsonObject {
                    put("name", r.name)
                    put("kind", r.kind)
                    put("enabled", r.enabled)
                    put("config", wireJson.encodeToJsonElement(AutomodConfig.serializer(), r.config))
                    put("actions", wireJson.encodeToJsonElement(ListSerializer(AutomodAction.serializer()), r.actions))
                    put("exempt_roles", kotlinx.serialization.json.JsonArray(r.exemptRoles.map { JsonPrimitive(it) }))
                    put("exempt_channels", kotlinx.serialization.json.JsonArray(r.exemptChannels.map { JsonPrimitive(it) }))
                }
                if (rule != null) Nexa.api.request("PATCH", "/servers/$serverId/automod/rules/${rule.id}", json)
                else Nexa.api.request("POST", "/servers/$serverId/automod/rules", json)
                Nexa.ui.toast(if (rule != null) t("automod.editor.saved") else t("automod.editor.created"), "success")
                onDone()
            } catch (e: Exception) {
                problem = describeError(e, t("automod.editor.saveFailed"))
            } finally {
                busy = false
            }
        }
    }
    fun remove() {
        val r = rule ?: return
        confirm(t("automod.editor.deleteTitle"), t("automod.editor.deleteBody", "name" to r.name), t("automod.editor.delete")) {
            try {
                Nexa.api.request("DELETE", "/servers/$serverId/automod/rules/${r.id}")
                onDone()
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("automod.editor.deleteFailed")), "error")
            }
        }
    }

    SettingsPage(SaveState(dirty, busy, { if (rule != null) d = saved else onDone() }, ::save, if (rule != null) t("automod.editor.save") else t("automod.editor.create"))) {
        Row(
            Modifier.heightIn(min = 44.dp).pressable(remember { MutableInteractionSource() }) { fish.nexa.ui.server.Holds.unlessUnsaved(onDone) }.padding(end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon("ChevronLeft", c.textMuted, size = 18.dp)
            Txt(t("automod.title"), style = Nx.type.bodySmall.copy(fontWeight = FontWeight(600)), color = c.textMuted)
        }
        Row(Modifier.padding(top = 6.dp, bottom = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            KindIcon(info)
            Txt(if (rule != null) t("automod.editor.editTitle") else t("automod.kind.$kind"), style = Nx.type.title.copy(fontSize = Nx.type.sp(24f), lineHeight = Nx.type.sp(28f)), color = c.textStrong)
        }
        Form {
            NxTextField(d.name, { d = d.copy(name = it.take(100)) }, label = t("automod.editor.name"), capitalize = true)
            ToggleRow(d.enabled, { d = d.copy(enabled = it) }, t("automod.editor.enabled"), if (info.server) t("automod.editor.enabledServer") else t("automod.editor.enabledApps"))

            Section(t("automod.editor.looksFor"), t("automod.kindDesc.$kind")) {
                if (kind == "flagged_words" || kind == "profile") Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    for (name in LISTS) Check((d.config.lists ?: emptyList()).contains(name), listLabel(name), t("automod.listDesc.$name")) { on ->
                        setConfig { it.copy(lists = if (on) (it.lists ?: emptyList()) + name else (it.lists ?: emptyList()) - name) }
                    }
                }
                if (kind == "words" || kind == "profile") {
                    Field(t("automod.editor.words"), hint = t("automod.editor.wordsHint")) {
                        NxTextField(d.wordsText, { d = d.copy(wordsText = it) }, placeholder = t("automod.editor.wordsPlaceholder"), singleLine = false, minLines = 4, mono = true, monoSize = 13.5f)
                    }
                    Field(t("automod.editor.patterns"), hint = t("automod.editor.patternsHint"), error = patternIssue) {
                        NxTextField(d.regexText, { d = d.copy(regexText = it) }, placeholder = "(?:buy|cheap)\\s+followers", singleLine = false, minLines = 3, mono = true, monoSize = 13.5f)
                    }
                }
                if (kind == "words" || kind == "flagged_words" || kind == "profile") {
                    Field(t("automod.editor.allow"), hint = t("automod.editor.allowHint")) {
                        NxTextField(d.allowText, { d = d.copy(allowText = it) }, placeholder = t("automod.editor.allowPlaceholder"), singleLine = false, minLines = 3, mono = true, monoSize = 13.5f)
                    }
                    ToggleRow(d.config.evasion != false, { v -> setConfig { it.copy(evasion = v) } }, t("automod.editor.evasion"), t("automod.editor.evasionDesc"), rule = kind == "profile")
                }
                if (kind == "profile") Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Check(d.config.names != false, t("automod.profile.namesLong")) { v -> setConfig { it.copy(names = v) } }
                    Check(d.config.bio == true, t("automod.profile.bioLong")) { v -> setConfig { it.copy(bio = v) } }
                }
                if (kind == "spam") Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Check(d.config.scams == true, t("automod.spam.scamsLong"), t("automod.spam.scamsDesc")) { v -> setConfig { it.copy(scams = v) } }
                    Check(d.config.shadyLinks == true, t("automod.spam.shadyLong"), t("automod.spam.shadyDesc")) { v -> setConfig { it.copy(shadyLinks = v) } }
                    Check(d.config.repeats == true, t("automod.spam.repeatsLong"), t("automod.spam.repeatsDesc")) { v -> setConfig { it.copy(repeats = v) } }
                    Check(d.config.zalgo == true, t("automod.spam.zalgoLong"), t("automod.spam.zalgoDesc")) { v -> setConfig { it.copy(zalgo = v) } }
                    Check(d.config.walls == true, t("automod.spam.wallsLong"), t("automod.spam.wallsDesc")) { v -> setConfig { it.copy(walls = v) } }
                }
                if (kind == "links") {
                    fish.nexa.ui.components.ChoiceCard(d.config.mode != "list", t("automod.links.all"), t("automod.links.allDesc"), radioFirst = true) { setConfig { it.copy(mode = "all") } }
                    fish.nexa.ui.components.ChoiceCard(d.config.mode == "list", t("automod.links.list"), t("automod.links.listDesc"), radioFirst = true) { setConfig { it.copy(mode = "list") } }
                    if (d.config.mode == "list") Field(t("automod.links.blocked"), hint = t("automod.links.sitesHint")) {
                        NxTextField(d.domainsText, { d = d.copy(domainsText = it) }, placeholder = "example.com\nbadsite.net", singleLine = false, minLines = 3, keyboardType = KeyboardType.Uri)
                    } else Field(t("automod.links.allowed"), hint = t("automod.links.sitesHint")) {
                        NxTextField(d.allowText, { d = d.copy(allowText = it) }, placeholder = "youtube.com\ngithub.com", singleLine = false, minLines = 3, keyboardType = KeyboardType.Uri, mono = true, monoSize = 13.5f)
                    }
                }
                if (kind == "personal") Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Check(d.config.emails == true, t("automod.personal.emailsLong")) { v -> setConfig { it.copy(emails = v) } }
                    Check(d.config.phones == true, t("automod.personal.phonesLong")) { v -> setConfig { it.copy(phones = v) } }
                    Check(d.config.ips == true, t("automod.personal.ipsLong")) { v -> setConfig { it.copy(ips = v) } }
                    Check(d.config.cards == true, t("automod.personal.cardsLong")) { v -> setConfig { it.copy(cards = v) } }
                }
                if (kind == "caps") {
                    Field(t("automod.caps.percent", "percent" to (d.config.percent ?: 70))) {
                        NxSlider((d.config.percent ?: 70).toFloat(), { v -> setConfig { it.copy(percent = (Math.round(v / 5f) * 5)) } }, 50f..100f)
                    }
                    NumberField(t("automod.caps.length"), d.config.minLength ?: 10, 1, 2000) { v -> setConfig { it.copy(minLength = v) } }
                }
                if (kind == "emoji_spam" || kind == "mentions") NumberField(
                    if (kind == "mentions") t("automod.mentions.max") else t("automod.emoji.max"),
                    d.config.max ?: (if (kind == "mentions") 5 else 10), 1, if (kind == "mentions") 50 else 200,
                ) { v -> setConfig { it.copy(max = v) } }
                if (kind == "mentions") ToggleRow(d.config.raid == true, { v -> setConfig { it.copy(raid = v) } }, t("automod.mentions.raid"), t("automod.mentions.raidDesc"), rule = false)
                if (kind == "flood") Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.weight(1f)) { NumberField(t("automod.flood.messages"), d.config.messages ?: 5, 2, 50) { v -> setConfig { it.copy(messages = v) } } }
                    Box(Modifier.weight(1f)) { NumberField(t("automod.flood.seconds"), d.config.seconds ?: 5, 1, 600) { v -> setConfig { it.copy(seconds = v) } } }
                }
                if (kind == "attachments") Field(t("automod.files.endings"), hint = t("automod.files.endingsHint")) {
                    NxTextField(d.extText, { d = d.copy(extText = it) }, singleLine = false, minLines = 3, mono = true, monoSize = 13.5f)
                }
            }

            if (info.tryable) Section(t("automod.try.title"), if (kind == "profile") t("automod.try.hintProfile") else t("automod.try.hint")) {
                NxTextField(sample, { sample = it }, placeholder = if (kind == "profile") t("automod.try.placeholderProfile") else t("automod.try.placeholder"), singleLine = false, minLines = 3, autoCorrect = true)
                if (sample.isNotBlank()) {
                    val hit = tryResult != null
                    Row(
                        Modifier.fillMaxWidth().background(if (hit) c.danger.copy(alpha = 0.14f) else c.positive.copy(alpha = 0.14f), Radii.Sm).padding(12.dp)
                            .semantics { liveRegion = LiveRegionMode.Polite },
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(if (hit) "ShieldAlert" else "CircleCheck", if (hit) c.textDanger else c.positive, size = 16.dp)
                        Txt(if (hit) t("automod.try.caught", "why" to automodReason(kind, tryResult)) else t("automod.try.clear"), style = Nx.type.bodySmall, color = c.text)
                    }
                }
            }

            Section(t("automod.editor.does"), null) {
                if (kind != "profile") {
                    ToggleRow(action("block") != null, { v -> setAction("block", v) }, t("automod.do.blockLong"), if (info.server) t("automod.do.blockServerDesc") else t("automod.do.blockDesc"))
                    action("block")?.let { a ->
                        Field(t("automod.do.message"), hint = t("automod.do.messageHint", "count" to (150 - (a.message ?: "").length))) {
                            NxTextField(a.message ?: "", { v -> setAction("block", true) { it.copy(message = v.take(150)) } }, placeholder = t("automod.do.messagePlaceholder"))
                        }
                    }
                }
                if (kind == "profile") ToggleRow(action("quarantine") != null, { v -> setAction("quarantine", v) }, t("automod.do.quarantineLong"), if (mayTimeout) t("automod.do.quarantineDesc") else t("automod.do.needModerate"), enabled = mayTimeout)
                ToggleRow(action("alert") != null, { v -> setAction("alert", v) { it.copy(channelId = it.channelId ?: textChannels.firstOrNull()?.id) } }, t("automod.do.alertLong"), t("automod.do.alertDesc"))
                action("alert")?.let { a ->
                    Field(t("automod.do.alertChannel")) {
                        SelectField(textChannels.map { it.id to "#${it.name}" }, a.channelId ?: "", { v -> setAction("alert", true) { it.copy(channelId = v) } }, title = t("automod.do.alertChannel"))
                    }
                }
                if (kind != "profile") {
                    ToggleRow(action("timeout") != null, { v -> setAction("timeout", v) { it.copy(seconds = it.seconds ?: 600, after = it.after ?: 1) } }, t("automod.do.timeoutLong"), if (mayTimeout) t("automod.do.timeoutDesc") else t("automod.do.needModerate"), enabled = mayTimeout)
                    action("timeout")?.let { a ->
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Box(Modifier.weight(1f)) {
                                Field(t("automod.do.timeoutFor")) {
                                    SelectField(TIMEOUTS.map { it to Time.shortDuration(it.toDouble()) }, a.seconds ?: 600, { v -> setAction("timeout", true) { it.copy(seconds = v) } }, title = t("automod.do.timeoutFor"))
                                }
                            }
                            Box(Modifier.weight(1f)) {
                                Field(t("automod.do.timeoutWhen")) {
                                    SelectField(listOf(1, 2, 3, 4, 5, 10).map { it to if (it == 1) t("automod.do.first") else t("automod.do.nth", "count" to it) }, a.after ?: 1, { v -> setAction("timeout", true) { it.copy(after = v) } }, title = t("automod.do.timeoutWhen"))
                                }
                            }
                        }
                    }
                }
            }

            Section(t("automod.editor.skips"), t("automod.editor.skipsNote")) {
                Field(t("automod.editor.skipRoles")) {
                    SelectField(listOf("" to t("automod.editor.addRole")) + roles.filter { it.id !in d.exemptRoles }.map { it.id to it.name }, "", { v -> if (v.isNotEmpty()) d = d.copy(exemptRoles = (d.exemptRoles + v).take(50)) }, title = t("automod.editor.skipRoles"))
                }
                if (d.exemptRoles.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (id in d.exemptRoles) {
                        val r = st?.roles?.get(id)
                        Pick(r?.name ?: t("automod.editor.goneRole"), { Box(Modifier.size(10.dp).background(if (r != null && r.color != 0L) rgbColor(r.color) else c.textMuted, CircleShape)) }) {
                            d = d.copy(exemptRoles = d.exemptRoles - id)
                        }
                    }
                }
                Field(t("automod.editor.skipChannels")) {
                    SelectField(listOf("" to t("automod.editor.addChannel")) + exemptable.filter { it.id !in d.exemptChannels }.map { it.id to it.name }, "", { v -> if (v.isNotEmpty()) d = d.copy(exemptChannels = (d.exemptChannels + v).take(50)) }, title = t("automod.editor.skipChannels"))
                }
                if (d.exemptChannels.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (id in d.exemptChannels) {
                        val ch = channels[id]
                        Pick(ch?.name ?: t("automod.editor.goneChannel"), { if (ch != null) ChannelGlyph(ch, 14.dp, c.textMuted) }) {
                            d = d.copy(exemptChannels = d.exemptChannels - id)
                        }
                    }
                }
            }
            problem?.let { Txt(it, style = Nx.type.bodySmall.copy(fontWeight = FontWeight(550)), color = c.textDanger, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive }) }
            if (rule != null) NxButton(t("automod.editor.delete"), ::remove, kind = ButtonKind.GHOST, icon = "Trash2")
        }
    }
}

/** A part of the editor: a heading, what it is about, and its settings, on a card of its own. */
@Composable
private fun Section(head: String, note: String?, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(
        Modifier.fillMaxWidth().surfaceCard(c, Radii.Md).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Txt(head, style = Nx.type.body.copy(fontWeight = FontWeight(700)), color = c.textStrong, modifier = Modifier.semantics { heading() })
        if (note != null) Txt(note, style = Nx.type.bodySmall, color = c.textMuted)
        content()
    }
}

@Composable
private fun Check(checked: Boolean, label: String, desc: String? = null, onChange: (Boolean) -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth()) {
        NxCheckbox(checked, onChange, label)
        if (desc != null) Txt(desc, style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted, modifier = Modifier.padding(start = 34.dp))
    }
}

@Composable
private fun NumberField(label: String, value: Int, min: Int, max: Int, onChange: (Int) -> Unit) {
    var text by remember(value) { mutableStateOf(value.toString()) }
    Field(label) {
        NxTextField(text, { v ->
            text = v.filter { it.isDigit() }.take(4)
            text.toIntOrNull()?.let { onChange(it.coerceIn(min, max)) }
        }, keyboardType = KeyboardType.Number)
    }
}

@Composable
private fun Pick(label: String, lead: @Composable () -> Unit, onRemove: () -> Unit) {
    val c = Nx.colors
    Row(
        Modifier.heightIn(min = 34.dp).background(c.bgActive, RoundedCornerShape(999.dp)).padding(start = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        lead()
        Txt(label, style = Nx.type.bodySmall.copy(fontWeight = FontWeight(600)), color = c.text, maxLines = 1)
        Box(
            Modifier.size(36.dp).pressable(remember { MutableInteractionSource() }, onClick = onRemove).semantics { contentDescription = t("automod.editor.removeSkip", "name" to label) },
            contentAlignment = Alignment.Center,
        ) { Icon("X", c.textMuted, size = 14.dp) }
    }
}

// ---------------------------------------------------------------------------
// the log (AutomodLog.tsx)

@Serializable
private data class Events(val events: List<AutomodEvent> = emptyList(), val users: List<PublicUser> = emptyList())

private val ACTION_KEYS = mapOf("block" to "automod.action.blocked", "timeout" to "automod.action.timedOut", "quarantine" to "automod.action.held", "alert" to "automod.action.alerted")

/** What AutoMod did, newest first, for one person when picked. Opened sealed with the server's key. */
@Composable
private fun AutomodLog(serverId: String) {
    val c = Nx.colors
    var events by remember { mutableStateOf<List<AutomodEvent>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    var person by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    suspend fun load(before: String?) {
        failed = false
        try {
            val q = buildList {
                add("limit=50")
                if (before != null) add("before=$before")
                person?.let { add("user_id=$it") }
            }.joinToString("&")
            val res = Nexa.api.get("/servers/$serverId/automod/events?$q", Events.serializer())
            Nexa.users.upsert(res.users)
            events = if (before != null && events != null) events!! + res.events else res.events
            more = res.events.size == 50
        } catch (_: Exception) {
            failed = true
        }
    }
    LaunchedEffect(person, reload) {
        events = null
        load(null)
    }
    // what AutoMod does while the log is open comes in at the top
    LaunchedEffect(serverId, person) {
        Nexa.session.events.collect { e ->
            if (e.t != "automod_event") return@collect
            val ev = runCatching { wireJson.decodeFromJsonElement(AutomodEvent.serializer(), e.d!!) }.getOrNull() ?: return@collect
            if (ev.serverId != serverId || (person != null && ev.userId != person)) return@collect
            events = events?.let { cur -> if (cur.any { it.id == ev.id }) cur else listOf(ev) + cur }
        }
    }
    person?.let { p ->
        Row(Modifier.padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(t("automod.log.onlyFor", "name" to Names.display(Nexa.users.get(p))), style = Nx.type.bodySmall, color = c.text, modifier = Modifier.weight(1f))
            NxButton(t("automod.log.everyone"), { person = null }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "X")
        }
    }
    val list = events
    when {
        failed && list == null -> LoadFailed(t("automod.log.failed")) { reload += 1 }
        list == null -> Loading(t("chat.pins.loading"))
        // `.empty`: a display-face heading over a short muted line
        list.isEmpty() -> Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Txt(t("automod.log.empty"), style = Nx.type.headerTitle.copy(fontSize = Nx.type.sp(18f), fontWeight = FontWeight(700)), color = c.textStrong, align = androidx.compose.ui.text.style.TextAlign.Center)
            Txt(t("automod.log.emptyHint"), style = Nx.type.bodySmall, color = c.textMuted, align = androidx.compose.ui.text.style.TextAlign.Center)
        }
        else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (ev in list) EventRow(serverId, ev) { person = it }
            if (more) NxButton(t("automod.log.more"), { scope.launch { load(list.lastOrNull()?.id) } }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
        }
    }
}

/** One time a rule acted: who, where, what they wrote (opened here), and what came of it. */
@Composable
private fun EventRow(serverId: String, ev: AutomodEvent, onPerson: (String) -> Unit) {
    val c = Nx.colors
    val user = Nexa.users.get(ev.userId)
    val name = user?.let { Names.display(it) } ?: t("chat.systemMessage.someone")
    val where = ev.channelId?.let { Nexa.channels.get(it) }
    val words by produceState<String?>(if (ev.content == null) null else "\u0000", ev.id) {
        if (ev.content != null) value = Automod.openCaught(serverId, ev.userId, ev.content)
    }
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().surfaceCard(c, Radii.Md).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Avatar(ev.userId, name, user?.avatarId, 32.dp)
            Txt(name, style = Nx.type.body.copy(fontWeight = FontWeight(650)), color = c.textStrong, maxLines = 1, modifier = Modifier.weight(1f).pressable(remember { MutableInteractionSource() }) { onPerson(ev.userId) })
            Txt(Time.timestamp(ev.createdAt), style = Nx.type.timestamp, color = c.textMuted, maxLines = 1)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.background(c.bgActive, RoundedCornerShape(999.dp)).padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                kindInfo(ev.ruleKind)?.let { Icon(it.icon, c.text, size = 12.dp) }
                Txt(ev.ruleName.ifEmpty { t("automod.log.goneRule") }, style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.text, maxLines = 1)
            }
            if (where != null) Txt(t("automod.log.in", "channel" to where.name), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted)
            for (a in ev.actions) DoChip(ACTION_KEYS[a]?.let { t(it) } ?: a, a)
            if (ev.reporterId != null) Txt(t("automod.log.caughtLate"), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted)
        }
        val w = words
        when {
            w == "\u0000" -> Txt(t("automod.alert.opening"), style = Nx.type.hint, color = c.textMuted)
            w != null -> {
                Txt(w, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.text, maxLines = if (open) Int.MAX_VALUE else 5, modifier = Modifier.background(c.bgInput, RoundedCornerShape(6.dp)).padding(10.dp))
                if (w.length > 240 && !open) Txt(t("automod.alert.showAll"), style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.link, modifier = Modifier.pressable(remember { MutableInteractionSource() }) { open = true }.padding(vertical = 6.dp))
            }
            ev.content != null -> Txt(t("automod.alert.cannotOpen"), style = Nx.type.hint, color = c.textMuted)
        }
    }
}
