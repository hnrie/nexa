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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.Automod
import fish.nexa.data.ChatMessage
import fish.nexa.data.P
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.chat.ListCtx
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.people.MemberActions
import fish.nexa.ui.shell.ChannelGlyph
import fish.nexa.ui.shell.Names
import fish.nexa.ui.shell.openProfile
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.mixSrgb
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** What an action AutoMod took is called on its alert. */
private fun actionLabel(a: String): String? = when (a) {
    "block" -> t("automod.action.blocked")
    "timeout" -> t("automod.action.timedOut")
    "quarantine" -> t("automod.action.held")
    else -> null
}

/** What a rule looks for, said to the person it stopped (AutomodNotice.tsx automodReason). */
fun automodReason(kind: String, matched: String?): String = when (kind) {
    "words", "flagged_words" -> if (!matched.isNullOrEmpty()) t("automod.reason.words", "word" to matched.trim('*')) else t("automod.reason.wordsPlain")
    "links" -> t("automod.reason.links")
    "invites" -> t("automod.reason.invites")
    "personal" -> t("automod.reason.personal")
    "caps" -> t("automod.reason.caps")
    "emoji_spam" -> t("automod.reason.emoji")
    "attachments" -> if (!matched.isNullOrEmpty()) t("automod.reason.file", "name" to matched) else t("automod.reason.filePlain")
    "spam" -> t("automod.reason.spam")
    "mentions" -> t("automod.reason.mentions")
    "flood" -> t("automod.reason.flood")
    else -> t("automod.reason.other")
}

/**
 * AutomodAlert.tsx: AutoMod's alert in the channel a rule sends them to: who
 * it caught, where, what they wrote (sealed with the server's key, opened
 * here) or what the server saw, what the rule did, and what a moderator can
 * do next.
 */
@Composable
fun AutomodAlertRow(cm: ChatMessage, ctx: ListCtx) {
    val c = Nx.colors
    val note = cm.m.automod ?: return
    val sid = ctx.server?.server?.id
    val who = cm.authorId
    val name = Names.member(sid, who)
    val where = note.channelId?.let { Nexa.channels.get(it) }
    val caught by produceState<String?>(if (note.content == null) null else "\u0000", note.content, sid) {
        if (note.content != null && sid != null) value = withContext(Dispatchers.Default) { Automod.openCaught(sid, who, note.content) }
    }
    var open by remember { mutableStateOf(false) }
    val detail = when {
        note.ruleKind == "mentions" -> if (note.raid) t("automod.alert.raid", "count" to (note.mentions ?: 0)) else t("automod.alert.mentions", "count" to (note.mentions ?: 0))
        note.ruleKind == "flood" -> t("automod.alert.flood", "count" to (note.messages ?: 0), "seconds" to (note.seconds ?: 0))
        note.title -> t("automod.alert.title", "text" to (note.matched ?: ""))
        note.ruleKind == "profile" -> t("automod.alert.profile", "text" to (note.matched ?: ""))
        else -> null
    }
    val done = note.actions.mapNotNull(::actionLabel)
    val st = ctx.server
    val canTimeout = Nexa.servers.canI(st, P.MODERATE_MEMBERS)
    val canKick = Nexa.servers.canI(st, P.KICK_MEMBERS)
    val canBan = Nexa.servers.canI(st, P.BAN_MEMBERS)
    Box(
        Modifier
            .fillMaxWidth()
            .padding(top = 17.dp)
            .padding(start = 8.dp, end = 8.dp)
            .semantics { contentDescription = t("automod.alert.label", "rule" to note.ruleName) },
    ) {
        Box(
            Modifier
                .padding(start = 4.dp, top = 4.dp)
                .size(40.dp)
                .background(mixSrgb(c.brand, c.bgSurface, 0.78f), CircleShape),
            contentAlignment = Alignment.Center,
        ) { Icon("ShieldCheck", c.focusRing, size = 20.dp) }
        Column(Modifier.fillMaxWidth().padding(start = 56.dp, end = 0.dp, top = 4.dp, bottom = 8.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Txt(t("automod.name"), style = Nx.type.body.copy(fontWeight = FontWeight(600)), color = c.textStrong)
                Txt(
                    note.ruleName, style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.text, maxLines = 1,
                    modifier = Modifier.background(c.bgActive, RoundedCornerShape(999.dp)).padding(horizontal = 8.dp, vertical = 1.dp),
                )
                Txt(Time.timestamp(cm.m.createdAt), style = Nx.type.timestamp, color = c.textMuted)
            }
            // "{who} in {where}", in whatever order the language puts them
            val line = if (where != null && sid != null) t("automod.alert.whoWhere", "who" to "\u0001", "where" to "\u0002") else "\u0001"
            FlowRow(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                for (part in Regex("[\u0001\u0002]|[^\u0001\u0002]+").findAll(line).map { it.value }) when (part) {
                    "\u0001" -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Avatar(who, name, Nexa.users.get(who)?.avatarId, 20.dp)
                        fish.nexa.ui.chat.PersonName(who, name, serverId = sid, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1, modifier = Modifier.pressable(remember { MutableInteractionSource() }) { openProfile(who) })
                    }
                    "\u0002" -> if (where != null && sid != null) Row(
                        Modifier.clip(RoundedCornerShape(4.dp)).pressable(remember { MutableInteractionSource() }) { Nav.go(Route.Server(sid, where.id)) }.padding(horizontal = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        ChannelGlyph(where, 14.dp, c.textStrong)
                        Txt(where.name, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(500)), color = c.textStrong, maxLines = 1)
                    }
                    else -> if (part.isNotBlank()) Txt(part.trim(), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f)), color = c.textMuted, maxLines = 1)
                }
            }
            val text = caught
            when {
                text == "\u0000" -> Txt(t("automod.alert.opening"), style = Nx.type.bodySmall.copy(fontStyle = FontStyle.Italic), color = c.textMuted, modifier = Modifier.padding(top = 6.dp))
                text != null -> {
                    Row(Modifier.padding(top = 6.dp).fillMaxWidth().background(c.bgSurface, RoundedCornerShape(4.dp))) {
                        Box(Modifier.width(3.dp).heightIn(min = 36.dp).background(c.danger))
                        Txt(text, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), lineHeight = Nx.type.sp(21f)), color = c.text, maxLines = if (open) Int.MAX_VALUE else 6, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                    }
                    if (text.length > 280 && !open) Txt(
                        t("automod.alert.showAll"), style = Nx.type.bodySmall.copy(fontWeight = FontWeight(600)), color = c.link,
                        modifier = Modifier.pressable(remember { MutableInteractionSource() }) { open = true }.padding(vertical = 6.dp),
                    )
                }
                note.content != null -> Txt(t("automod.alert.cannotOpen"), style = Nx.type.bodySmall.copy(fontStyle = FontStyle.Italic), color = c.textMuted, modifier = Modifier.padding(top = 6.dp))
            }
            if (detail != null) Txt(detail, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f)), color = c.text, modifier = Modifier.padding(top = 6.dp))
            if (done.isNotEmpty()) FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (d in done) Txt(
                    d, style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.textDanger,
                    modifier = Modifier.background(c.danger.copy(alpha = 0.16f), RoundedCornerShape(999.dp)).padding(horizontal = 8.dp, vertical = 2.dp),
                )
            }
            val jump = note.messageId?.takeIf { note.channelId != null && sid != null }
            if (jump != null || canTimeout || canKick || canBan) FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (jump != null) AlertButton(t("automod.alert.jump")) { Nav.go(Route.Server(sid!!, note.channelId!!, jumpTo = jump)) }
                if (sid != null) {
                    if (canTimeout && "timeout" !in note.actions) AlertButton(t("automod.alert.timeout")) { MemberActions.open(sid, who, MemberActions.Kind.TIMEOUT) }
                    if (canKick) AlertButton(t("automod.alert.kick")) { MemberActions.open(sid, who, MemberActions.Kind.KICK) }
                    if (canBan) AlertButton(t("automod.alert.ban"), danger = true) { MemberActions.open(sid, who, MemberActions.Kind.BAN) }
                }
            }
        }
    }
}

@Composable
private fun AlertButton(label: String, danger: Boolean = false, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .heightIn(min = 36.dp)
            .clip(Radii.Sm)
            .background(if (pressed) c.bgSelected else c.bgActive)
            .pressable(interaction, onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Txt(label, style = Nx.type.buttonSmall.copy(fontSize = Nx.type.sp(13f)), color = if (danger) c.textDanger else c.textStrong) }
}
