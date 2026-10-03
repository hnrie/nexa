package fish.nexa.ui.nexa

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import coil3.compose.AsyncImage
import fish.nexa.Nexa
import fish.nexa.data.BugMessage
import fish.nexa.data.CaseMessage
import fish.nexa.data.FeedItem
import fish.nexa.data.MemberBug
import fish.nexa.data.MemberCase
import fish.nexa.data.NexaFile
import fish.nexa.data.NexaInbox
import fish.nexa.data.NexaPerson
import fish.nexa.data.PrivateFiles
import fish.nexa.net.ApiError
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.bugs.openBugReport
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.markdown.Markdown
import fish.nexa.ui.markdown.MarkdownView
import fish.nexa.ui.markdown.RenderCtx
import fish.nexa.ui.media.LightboxItem
import fish.nexa.ui.media.openLightbox
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.profile.NexaAvatar
import fish.nexa.ui.profile.OfficialBadge
import fish.nexa.ui.shell.NavButton
import fish.nexa.ui.shell.openProfile
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.mixSrgb
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.shadowLow
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.launch

// ---------------------------------------------------------------------------
// small pieces (NexaBits.tsx)

/** personName: who someone is, by name, or that they are gone or unknown. */
fun personName(p: NexaPerson?): String = when {
    p == null -> t("names.unknownUser")
    p.deleted -> t("nexa.deletedUser")
    else -> p.displayName.ifBlank { p.username }
}

/** PersonChip: someone's picture and name, a way to their profile when there is one. */
@Composable
fun PersonChip(id: String, size: Dp = 20.dp, withUsername: Boolean = false) {
    val c = Nx.colors
    val people by NexaInbox.people.collectAsState()
    val p = people[id] ?: Nexa.users.get(id)?.let { NexaPerson(it.id, it.username, it.displayName, it.avatarId, it.flags) }
    val name = personName(p)
    val open = p != null && !p.deleted
    Row(
        Modifier
            .clip(Radii.Xs)
            .then(if (open) Modifier.pressable(remember { MutableInteractionSource() }) { openProfile(id) }.semantics { contentDescription = t("nexa.viewProfile") + ", " + name } else Modifier),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (p != null && p.flags and 16L != 0L) NexaAvatar(size) else Avatar(id, name, p?.avatarId, size)
        Txt(name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1)
        if (withUsername && p != null && !p.deleted && p.username.isNotEmpty()) Txt("@" + p.username, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1)
    }
}

/** A coloured chip that says where something stands. */
@Composable
fun ToneChip(label: String, tone: String) {
    val c = Nx.colors
    val (fg, bg) = when (tone) {
        "warn" -> c.textWarning to c.warning.copy(alpha = 0.14f)
        "danger" -> c.textDanger to c.danger.copy(alpha = 0.14f)
        "done" -> c.positive to c.positive.copy(alpha = 0.14f)
        "info" -> c.textBrand to c.brand.copy(alpha = 0.16f)
        else -> c.textSubtle to c.bgActive
    }
    Box(Modifier.height(22.dp).background(bg, RoundedCornerShape(11.dp)).padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
        Txt(label, style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = fg, maxLines = 1)
    }
}

/** The red count on a thread's button: what the team wrote that has not been read. */
@Composable
private fun Pill(n: Int) {
    val c = Nx.colors
    Box(Modifier.padding(start = 6.dp).heightIn(min = 18.dp).widthIn(min = 18.dp).background(c.danger, RoundedCornerShape(9.dp)).padding(horizontal = 5.dp), contentAlignment = Alignment.Center) {
        Txt(n.toString(), style = Nx.type.hint.copy(fontSize = Nx.type.sp(11f), fontWeight = FontWeight(700)), color = c.onDanger)
    }
}

/** A secondary button with an icon, words and maybe an unread count (the thread buttons). */
@Composable
fun ThreadButton(label: String, unread: Int, onClick: () -> Unit) {
    val c = Nx.colors
    val shape = Radii.Xs
    Row(
        Modifier
            .heightIn(min = 40.dp)
            .shadowLow(shape, c)
            .ring(shape, c.border)
            .background(c.bgSurface, shape)
            .background(fish.nexa.ui.theme.sheen(c), shape)
            .topEdge(shape, c.edgeLight)
            .clip(shape)
            .pressable(remember { MutableInteractionSource() }, onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon("MessagesSquare", c.text, size = 16.dp)
        Txt(label, style = Nx.type.buttonSmall, color = c.text)
        if (unread > 0) Pill(unread)
    }
}

/** A raised card, as the Nexa conversation draws its items. */
private fun Modifier.nexaCard(radius: androidx.compose.ui.graphics.Shape, bg: Color, edge: Color, c: fish.nexa.ui.theme.NexaColors): Modifier =
    this.shadowLow(radius, c).ring(radius, edge).background(bg, radius).topEdge(radius, c.edgeLight)

// ---------------------------------------------------------------------------
// moderation words (lib/moderation.ts)

private fun detailsBool(d: kotlinx.serialization.json.JsonObject, k: String) = (d[k] as? kotlinx.serialization.json.JsonPrimitive)?.content == "true"
private fun detailsStr(d: kotlinx.serialization.json.JsonObject, k: String) = (d[k] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content
private fun detailsList(d: kotlinx.serialization.json.JsonObject, k: String): List<kotlinx.serialization.json.JsonElement> = (d[k] as? kotlinx.serialization.json.JsonArray) ?: emptyList()
private fun detailsFields(d: kotlinx.serialization.json.JsonObject): List<String> = detailsList(d, "fields").mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
private fun detailsNew(d: kotlinx.serialization.json.JsonObject, f: String) = ((d["new"] as? kotlinx.serialization.json.JsonObject)?.get(f) as? kotlinx.serialization.json.JsonPrimitive)?.content
private fun detailsOld(d: kotlinx.serialization.json.JsonObject, f: String) = ((d["old"] as? kotlinx.serialization.json.JsonObject)?.get(f) as? kotlinx.serialization.json.JsonPrimitive)?.content

fun severity(action: String): String = when (action) {
    "ban", "delete" -> "danger"
    "mute", "field_reset", "avatar_remove", "server_reset", "expression_takedown" -> "warn"
    else -> "info"
}

fun actionIcon(action: String): String = when (action) {
    "avatar_remove" -> "ImageOff"
    "field_reset" -> "Eraser"
    "server_reset" -> "ServerCog"
    "expression_takedown" -> "Sticker"
    "mute" -> "MessageSquareOff"
    "ban" -> "Ban"
    "delete" -> "UserX"
    else -> "KeyRound"
}

fun noticeTitle(action: String, d: kotlinx.serialization.json.JsonObject): String = when (action) {
    "avatar_remove" -> when {
        detailsBool(d, "avatar") && detailsBool(d, "banner") -> t("nexa.notice.titleAvatarAndBanner")
        detailsBool(d, "banner") -> t("nexa.notice.titleBanner")
        else -> t("nexa.notice.titleAvatar")
    }
    "field_reset" -> t("nexa.notice.titleFieldReset")
    "server_reset" -> t("nexa.notice.titleServerReset")
    "expression_takedown" -> when {
        detailsBool(d, "deleted") -> if (detailsStr(d, "pack_kind") == "emoji") t("nexa.notice.titleEmojiPackRemoved") else t("nexa.notice.titleStickerPackRemoved")
        detailsList(d, "emojis").isNotEmpty() -> t("nexa.notice.titleServerEmoji")
        detailsList(d, "stickers").isNotEmpty() && detailsFields(d).isEmpty() -> if (detailsStr(d, "pack_kind") == "emoji") t("nexa.notice.titlePackEmoji") else t("nexa.notice.titlePackStickers")
        else -> t("nexa.notice.titlePack")
    }
    "mute" -> t("nexa.notice.titleMute")
    "ban" -> t("nexa.notice.titleBan")
    else -> t("nexa.notice.titleDelete")
}

private fun noticeExplainer(c: MemberCase): String {
    val d = c.details
    return when (c.action) {
        "avatar_remove" -> t("nexa.notice.explainAvatar")
        "field_reset" -> if ("username" in detailsFields(d)) t("nexa.notice.explainUsername") else t("nexa.notice.explainFields")
        "server_reset" -> t("nexa.notice.explainServer", "name" to (detailsStr(d, "server_name") ?: ""))
        "expression_takedown" -> when {
            detailsBool(d, "deleted") -> t("nexa.notice.explainPackRemoved", "name" to (detailsStr(d, "pack_name") ?: ""))
            detailsList(d, "emojis").isNotEmpty() -> t("nexa.notice.explainServerEmoji", "name" to (detailsStr(d, "server_name") ?: ""))
            detailsFields(d).isNotEmpty() -> t("nexa.notice.explainPackParts", "name" to (detailsStr(d, "pack_name") ?: ""))
            detailsStr(d, "pack_kind") == "emoji" -> t("nexa.notice.explainPackEmoji", "name" to (detailsStr(d, "pack_name") ?: ""))
            else -> t("nexa.notice.explainPackItems", "name" to (detailsStr(d, "pack_name") ?: ""))
        }
        "mute" -> t("nexa.notice.explainMute")
        "ban" -> if (c.expiresAt == null) t("nexa.notice.explainBanPermanent") else t("nexa.notice.explainBan")
        else -> t("nexa.notice.explainDelete")
    }
}

/** caseStanding: where a mute or a ban stands, for its chip. */
fun caseStanding(c: MemberCase, now: Long = System.currentTimeMillis()): Pair<String, String>? {
    if (c.action != "mute" && c.action != "ban") return null
    if (c.liftedAt != null) return t("nexa.standing.lifted") to "done"
    if (c.inEffect && (c.expiresAt == null || c.expiresAt > now)) {
        if (c.expiresAt == null) return t("nexa.standing.permanent") to "danger"
        return t("nexa.standing.endsIn", "when" to Time.relativeTo(c.expiresAt)) to (if (c.action == "ban") "danger" else "warn")
    }
    return t("nexa.standing.ended") to "done"
}

/** formatSpan: "1 hour", "3 days", "2 weeks", the largest unit it is a whole number of. */
fun formatSpan(ms: Long): String {
    val minute = 60_000L
    val hour = 60 * minute
    val day = 24 * hour
    val week = 7 * day
    for ((size, key) in listOf(week to "nexa.span.weeks", day to "nexa.span.days", hour to "nexa.span.hours", minute to "nexa.span.minutes")) {
        if (ms >= size && ms % size == 0L) return t(key, "count" to ms / size)
    }
    if (ms >= day) return t("nexa.span.days", "count" to Math.round(ms.toDouble() / day))
    if (ms >= hour) return t("nexa.span.hours", "count" to Math.round(ms.toDouble() / hour))
    return t("nexa.span.minutes", "count" to maxOf(1L, Math.round(ms.toDouble() / minute)))
}

private fun fieldLabel(f: String): String = when (f) {
    "username" -> t("moderation.field.username")
    "display_name" -> t("moderation.field.displayName")
    "about_me" -> t("moderation.field.aboutMe")
    "pronouns" -> t("moderation.field.pronouns")
    "nicknames" -> t("moderation.field.nicknames")
    "typing_style" -> t("moderation.field.typingStyle")
    "widgets" -> t("moderation.field.widgets")
    "server_tag" -> t("moderation.field.serverTagWorn")
    "tag" -> t("moderation.field.serverTag")
    "icon" -> t("moderation.field.serverIcon")
    "banner" -> t("moderation.field.serverBanner")
    "name" -> t("moderation.field.serverName")
    "description" -> t("moderation.field.serverDescription")
    else -> t("moderation.field.status")
}

private fun packFieldLabel(f: String): String = when (f) {
    "name" -> t("moderation.field.packName")
    "description" -> t("moderation.field.packDescription")
    else -> t("moderation.field.packPublic")
}

private val WORD_FIELDS = setOf("status", "nicknames", "description", "icon", "banner", "public")

private fun nowValue(f: String, d: kotlinx.serialization.json.JsonObject): String = when (f) {
    "public" -> t("nexa.notice.madePrivate")
    "status", "nicknames", "description" -> t("nexa.notice.cleared")
    "icon", "banner" -> t("nexa.notice.removedShort")
    "username" -> "@" + (detailsNew(d, "username") ?: "")
    else -> detailsNew(d, f) ?: ""
}

// ---------------------------------------------------------------------------
// the notice card (NoticeCard.tsx)

/**
 * A case, as its notice: what was done, why, by whom, and where it stands.
 * The same card is the Nexa message, the pop-up, the ban screen and the top of
 * the case's thread, so the member reads the same thing wherever they meet it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NoticeCard(c: MemberCase, onOpenThread: (() -> Unit)? = null, bare: Boolean = false, modifier: Modifier = Modifier) {
    val col = Nx.colors
    val tone = severity(c.action)
    val toneColour = when (tone) {
        "danger" -> col.danger
        "warn" -> col.warning
        else -> col.brand
    }
    val shape = Radii.Lg
    val d = c.details
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    Column(
        modifier
            .fillMaxWidth()
            .widthIn(max = 640.dp)
            .nexaCard(shape, col.bgRaised, col.borderSubtle, col)
            .clip(shape)
            .drawBehind {
                val w = 4.dp.toPx()
                drawRect(toneColour, topLeft = Offset(if (rtl) size.width - w else 0f, 0f), size = Size(w, size.height))
            }
            .padding(start = 18.dp, end = 14.dp, top = 14.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (!bare) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                val iconColour = when (tone) {
                    "danger" -> col.danger
                    "warn" -> col.warning
                    else -> col.textBrand
                }
                Box(Modifier.size(36.dp).background(iconColour.copy(alpha = 0.16f), CircleShape), contentAlignment = Alignment.Center) { Icon(actionIcon(c.action), iconColour, size = 18.dp) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Txt(noticeTitle(c.action, d), style = Nx.type.body.copy(fontWeight = FontWeight(700), lineHeight = Nx.type.sp(20.8f)), color = col.textStrong, modifier = Modifier.semantics { heading() })
                    Txt(noticeExplainer(c), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20.3f)), color = col.textSubtle)
                    // on a phone's narrow card, where the case stands goes under the titles
                    caseStanding(c)?.let { (label, t) -> Box(Modifier.padding(top = 4.dp)) { ToneChip(label, t) } }
                }
            }
        }
        // the reason, in the moderator's own words
        Column(
            Modifier.fillMaxWidth().background(col.bgBase, Radii.Sm).border(1.dp, col.borderSubtle, Radii.Sm).padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            Txt(t("nexa.notice.reason"), style = Nx.type.hint.copy(fontWeight = FontWeight(700)), color = col.textMuted, modifier = Modifier.padding(bottom = 4.dp))
            Txt(c.reason, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), lineHeight = Nx.type.sp(21.75f)), color = col.text)
        }
        when (c.action) {
            "avatar_remove" -> DetailLine(null, t("nexa.notice.removed", "what" to listOfNotNull(
                if (detailsBool(d, "avatar")) t("moderation.field.avatar") else null,
                if (detailsBool(d, "banner")) t("moderation.field.banner") else null,
            ).joinToString(", ")))
            "field_reset" -> ChangedFields(d, t("nexa.notice.resetFields")) { fieldLabel(it) }
            "server_reset" -> {
                detailsStr(d, "server_name")?.let { DetailLine("Server", t("nexa.notice.serverNamed", "name" to it)) }
                ChangedFields(d, t("nexa.notice.serverFields")) { fieldLabel(it) }
            }
            "expression_takedown" -> TakenDownParts(d)
        }
        if (c.action == "field_reset" && "username" in detailsFields(d) && detailsNew(d, "username") != null) {
            Callout(t("nexa.notice.signInNote", "next" to (detailsNew(d, "username") ?: ""), "old" to (detailsOld(d, "username") ?: "")))
        }
        if (c.action == "mute" || c.action == "ban") {
            val until = c.expiresAt
            val span = (d["duration_ms"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull()
            DetailLine("Clock", if (until == null) t("nexa.notice.permanent") else t("nexa.notice.duration", "span" to (span?.let { formatSpan(it) } ?: Time.relativeTo(until)), "until" to Time.full(until)))
        }
        if (c.liftedAt != null) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                    Txt(t("nexa.notice.liftedBy"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = col.positive)
                    c.liftedBy?.let { PersonChip(it, 16.dp) }
                    Txt(Time.timestamp(c.liftedAt), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = col.textMuted)
                }
                if (c.liftReason.isNotEmpty()) Txt("“${c.liftReason}”", style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = col.textSubtle)
            }
        }
        // who did it, and which case it is
        FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt(t("nexa.notice.actionedBy"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = col.textMuted)
                PersonChip(c.moderatorId, 18.dp, withUsername = true)
            }
            Txt(t("nexa.notice.caseNumber", "number" to c.number) + " · " + Time.timestamp(c.createdAt), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = col.textMuted, maxLines = 1)
        }
        if (onOpenThread != null) ThreadButton(if (c.action == "delete") t("nexa.notice.viewCase") else t("nexa.notice.openThread"), c.unread, onOpenThread)
    }
}

@Composable
private fun DetailLine(icon: String?, text: String) {
    val c = Nx.colors
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (icon != null) Box(Modifier.padding(top = 3.dp)) { Icon(icon, c.textMuted, size = 14.dp) }
        Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20.3f)), color = c.textSubtle)
    }
}

@Composable
private fun Callout(text: String) {
    val c = Nx.colors
    Txt(
        text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20.3f)), color = c.text,
        modifier = Modifier.fillMaxWidth().background(c.brand.copy(alpha = 0.10f), Radii.Sm).border(1.dp, c.brand.copy(alpha = 0.3f), Radii.Sm).padding(horizontal = 12.dp, vertical = 10.dp),
    )
}

/** The fields a reset took, each with what it says now. */
@Composable
private fun ChangedFields(d: kotlinx.serialization.json.JsonObject, label: String, labelOf: (String) -> String) {
    val fields = detailsFields(d)
    if (fields.isEmpty()) return
    FieldTable(label, fields.map { f -> Triple(labelOf(f), nowValue(f, d), f in WORD_FIELDS) })
}

@Composable
private fun FieldTable(label: String, rows: List<Triple<String, String, Boolean>>) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().border(1.dp, c.borderSubtle, Radii.Sm).semantics { contentDescription = label }) {
        rows.forEachIndexed { i, (name, value, word) ->
            if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
            // a phone's narrow card: the field over its value
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Txt(name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(600)), color = c.textMuted)
                Txt(
                    value,
                    style = if (word) Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(600)) else Nx.type.code.copy(fontSize = Nx.type.sp(13f)),
                    color = c.textStrong,
                )
            }
        }
    }
}

/** What an expression takedown took: which pack or server, the items by name, and whether the pictures are blocked. */
@Composable
private fun TakenDownParts(d: kotlinx.serialization.json.JsonObject) {
    val emojis = detailsList(d, "emojis").mapNotNull { ((it as? kotlinx.serialization.json.JsonObject)?.get("name") as? kotlinx.serialization.json.JsonPrimitive)?.content }
    val stickers = detailsList(d, "stickers").mapNotNull { ((it as? kotlinx.serialization.json.JsonObject)?.get("name") as? kotlinx.serialization.json.JsonPrimitive)?.content }
    val items = if (emojis.isNotEmpty()) emojis.map { ":$it:" } else stickers
    val emoji = emojis.isNotEmpty() || detailsStr(d, "pack_kind") == "emoji"
    val pack = detailsStr(d, "pack_name")
    val server = detailsStr(d, "server_name")
    if (pack != null || server != null) DetailLine(if (pack != null) "Sticker" else "Server", if (pack != null) t("nexa.notice.packNamed", "name" to pack) else t("nexa.notice.serverNamed", "name" to (server ?: "")))
    if (items.isNotEmpty()) FieldTable(t("nexa.notice.takenDownItems"), listOf(Triple(
        if (emoji) t("nexa.notice.emojiCount", "count" to items.size) else t("nexa.notice.stickerCount", "count" to items.size),
        items.joinToString(", "), true,
    )))
    if (!detailsBool(d, "deleted")) ChangedFields(d, t("nexa.notice.packFields")) { packFieldLabel(it) }
    if (detailsBool(d, "blocked")) Callout(t("nexa.notice.picturesBlocked"))
}

// ---------------------------------------------------------------------------
// the Nexa conversation (NexaPage.tsx)

/** A header with Nexa's picture, name and badge (and a way back on the thread pages). */
@Composable
private fun NexaHeader(back: Boolean, title: String, sub: String, trailing: @Composable () -> Unit = {}) {
    val c = Nx.colors
    Row(
        Modifier
            .fillMaxWidth()
            .height(52.dp)
            .background(fish.nexa.ui.theme.sheen(c))
            .drawBehind { drawRect(c.borderSubtle, topLeft = Offset(0f, size.height - 1.dp.toPx()), size = Size(size.width, 1.dp.toPx())) }
            .padding(start = if (back) 6.dp else 18.dp, end = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (back) {
            val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
            Box(
                Modifier.size(44.dp).clip(Radii.Xs).pressable(remember { MutableInteractionSource() }) { Nav.go(Route.NexaConvo, replace = true) }.semantics { contentDescription = t("nexa.backToNexa") },
                contentAlignment = Alignment.Center,
            ) { Box(Modifier.graphicsLayer { scaleX = if (rtl) -1f else 1f }) { Icon("ChevronLeft", c.icon, size = 22.dp) } }
        } else NavButton()
        NexaAvatar(24.dp)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt(title, style = Nx.type.headerTitle.copy(fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                if (!back) OfficialBadge(compact = false)
            }
            Txt(sub, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1)
        }
        trailing()
    }
}

@Composable
fun NexaPage() {
    val c = Nx.colors
    val feed by NexaInbox.feed.collectAsState()
    val more by NexaInbox.feedMore.collectAsState()
    val loading by NexaInbox.feedLoading.collectAsState()
    val standing by NexaInbox.standing.collectAsState()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val life by lifecycle.currentStateAsState()
    var readHere by remember { mutableStateOf(false) }
    LaunchedEffect(feed == null) { if (feed == null) NexaInbox.loadFeed() }
    // looking at the conversation is reading it, while it is in front of someone
    LaunchedEffect(feed != null, standing?.unread, life) {
        if (feed != null && (standing?.unread ?: 0) > 0 && life.isAtLeast(Lifecycle.State.RESUMED)) {
            readHere = true
            NexaInbox.markSeen(keepMarks = true)
        }
    }
    DisposableEffect(Unit) { onDispose { if (readHere) NexaInbox.clearMarks() } }

    Column(Modifier.fillMaxSize()) {
        NexaHeader(back = false, title = "Nexa", sub = t("nexa.headerSub")) {
            // a phone keeps Report a Bug to its icon
            Box(
                Modifier.size(44.dp).clip(Radii.Xs).pressable(remember { MutableInteractionSource() }) { openBugReport("nexa") }.semantics { contentDescription = t("bugs.report") },
                contentAlignment = Alignment.Center,
            ) { Icon("Bug", c.icon, size = 22.dp) }
        }
        val list = feed
        // newest at the bottom, where the eye starts, as in any conversation
        val rows = remember(list) {
            val out = ArrayList<Any>()
            list?.forEachIndexed { i, it ->
                val prev = list.getOrNull(i - 1)
                if (prev == null || !Time.sameDay(prev.at, it.at)) out += DayMark(it.at)
                out += it
            }
            out.reversed()
        }
        val state = rememberLazyListState()
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = state, reverseLayout = true, verticalArrangement = Arrangement.Top, contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp)) {
            when {
                list == null -> item("loading") { Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) { Spinner(size = 24.dp) } }
                list.isEmpty() -> item("empty") { Txt(t("nexa.empty"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 32.dp)) }
                else -> for (r in rows) {
                    when (r) {
                        is DayMark -> item("day" + r.at) { DayDivider(r.at) }
                        is FeedItem -> item(r.key) { FeedEntry(r) }
                    }
                }
            }
            item("top") {
                if (more) Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                    NxButton(t("nexa.loadOlder"), { NexaInbox.loadOlder() }, kind = ButtonKind.GHOST, size = ButtonSize.SM, loading = loading)
                } else Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 32.dp, bottom = 12.dp)) {
                    NexaAvatar(80.dp)
                    Row(Modifier.padding(top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Txt("Nexa", style = Nx.type.title.copy(fontSize = Nx.type.sp(22f), fontWeight = FontWeight(800)), color = c.textStrong)
                        OfficialBadge(compact = false)
                    }
                    Txt(t("nexa.intro"), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), lineHeight = Nx.type.sp(22.5f)), color = c.textSubtle, modifier = Modifier.widthIn(max = 560.dp))
                }
            }
        }
        // the note at the foot: nobody writes here, each notice and report has its own thread
        Row(
            Modifier
                .navigationBarsPadding()
                .padding(start = 16.dp, end = 16.dp, bottom = 16.dp)
                .fillMaxWidth()
                .nexaCard(Radii.Md, c.bgRaised, c.borderSubtle, c)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon("Info", c.textMuted, size = 18.dp)
            Txt(t("nexa.footer"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textSubtle)
        }
    }
}

private data class DayMark(val at: Long)

/** A line with the date where a new day starts: in the conversation as a pill (the chat's), in a thread as plain words (`.dayDivider`). */
@Composable
private fun DayDivider(at: Long, pill: Boolean = true) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = if (pill) 0.dp else 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(1.dp).background(c.borderSubtle))
        if (pill) Box(Modifier.padding(horizontal = 8.dp).ring(RoundedCornerShape(999.dp), c.borderSubtle).background(c.bgRaised, RoundedCornerShape(999.dp)).padding(horizontal = 10.dp, vertical = 3.dp)) {
            Txt(Time.dateDivider(at), style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.textMuted)
        } else Txt(Time.dateDivider(at), style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.textMuted, modifier = Modifier.padding(horizontal = 8.dp))
        Box(Modifier.weight(1f).height(1.dp).background(c.borderSubtle))
    }
}

/** One item of the conversation from Nexa: who it is from, what kind it is, when it came, then the item. */
@Composable
private fun FeedEntry(it: FeedItem) {
    val c = Nx.colors
    val kind = when (it) {
        is FeedItem.News -> t("nexa.kind.announcement")
        is FeedItem.Lift -> t("nexa.kind.update")
        is FeedItem.Notice -> t("nexa.kind.notice")
        is FeedItem.Bug -> t("bugs.feed.kindReport")
        is FeedItem.BugLine -> if (it.status) t("bugs.feed.kindUpdate") else t("bugs.feed.kindReply")
    }
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        NexaAvatar(40.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt("Nexa", style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(600)), color = c.textStrong)
                OfficialBadge(compact = true)
                Txt(kind, style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.textMuted, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                Txt(Time.timestamp(it.at), style = Nx.type.timestamp, color = c.textMuted, maxLines = 1)
            }
            when (it) {
                is FeedItem.Notice -> NoticeCard(it.case, onOpenThread = { Nav.go(Route.NexaCase(it.case.id)) })
                is FeedItem.Lift -> LiftItem(it.case)
                is FeedItem.News -> AnnouncementCard(it.announcement)
                is FeedItem.Bug, is FeedItem.BugLine -> BugFeedEntry(it) { id -> Nav.go(Route.NexaBug(id)) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LiftItem(case: MemberCase) {
    val c = Nx.colors
    FlowRow(
        Modifier
            .widthIn(max = 640.dp)
            .fillMaxWidth()
            .background(mixSrgb(c.bgRaised, c.positive, 0.10f), Radii.Md)
            .border(1.dp, c.positive.copy(alpha = 0.3f), Radii.Md)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Icon("LockOpen", c.positive, size = 18.dp)
        Txt(
            if (case.action == "ban") t("nexa.liftedBan", "number" to case.number) else t("nexa.liftedMute", "number" to case.number),
            style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.text,
        )
        case.liftedBy?.let { PersonChip(it, 16.dp) }
        if (case.liftReason.isNotEmpty()) Txt("“${case.liftReason}”", style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textSubtle)
    }
}

@Composable
private fun AnnouncementCard(a: fish.nexa.data.Announcement) {
    val c = Nx.colors
    Column(
        Modifier.widthIn(max = 640.dp).fillMaxWidth().nexaCard(Radii.Lg, c.bgRaised, c.borderSubtle, c).padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        if (a.title.isNotEmpty()) Row(Modifier.padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon("Megaphone", c.textStrong, size = 18.dp)
            Txt(a.title, style = Nx.type.body.copy(fontWeight = FontWeight(700)), color = c.textStrong, modifier = Modifier.semantics { heading() })
        }
        MarkdownView(a.body, RenderCtx(surface = c.bgRaised))
        Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Txt(t("nexa.postedBy"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted)
            PersonChip(a.authorId, 18.dp, withUsername = true)
        }
    }
}

// ---------------------------------------------------------------------------
// bug reports in the conversation (BugFeed.tsx) and at the top of their thread (BugReportCard.tsx)

fun bugStatusLabel(s: String): String = when (s) {
    "open" -> t("bugs.status.open")
    "in_progress" -> t("bugs.status.inProgress")
    "resolved" -> t("bugs.status.resolved")
    "wont_fix" -> t("bugs.status.wontFix")
    else -> t("bugs.status.closed")
}

private fun bugStatusTone(s: String): String = when (s) {
    "open" -> "info"
    "in_progress" -> "warn"
    "resolved" -> "done"
    else -> ""
}

private fun bugNumber(n: Long) = t("bugs.number", "number" to n)

/** A report's status, as a small coloured label with its dot. */
@Composable
fun BugStatusChip(status: String) {
    val c = Nx.colors
    val (fg, bg) = when (bugStatusTone(status)) {
        "info" -> c.textBrand to c.brand.copy(alpha = 0.16f)
        "warn" -> c.textWarning to c.warning.copy(alpha = 0.14f)
        "done" -> c.positive to c.positive.copy(alpha = 0.14f)
        else -> c.textSubtle to c.bgActive
    }
    Row(Modifier.height(22.dp).background(bg, RoundedCornerShape(11.dp)).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Box(Modifier.size(7.dp).background(fg, CircleShape))
        Txt(bugStatusLabel(status), style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = fg, maxLines = 1)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BugFeedEntry(it: FeedItem, onOpen: (String) -> Unit) {
    val c = Nx.colors
    val b = when (it) {
        is FeedItem.Bug -> it.bug
        is FeedItem.BugLine -> it.bug
        else -> return
    }
    if (it is FeedItem.BugLine && it.status) {
        val done = bugStatusTone(it.message.body) == "done"
        FlowRow(
            Modifier
                .widthIn(max = 640.dp)
                .fillMaxWidth()
                .nexaCard(Radii.Lg, if (done) mixSrgb(c.bgRaised, c.positive, 0.10f) else c.bgRaised, if (done) c.positive.copy(alpha = 0.3f) else c.borderSubtle, c)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            Icon("CircleDot", if (done) c.positive else c.textMuted, size = 18.dp)
            Txt(t("bugs.feed.statusChanged", "number" to bugNumber(b.number), "status" to bugStatusLabel(it.message.body)), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.text)
            PersonChip(it.message.authorId, 16.dp)
            Txt(
                t("bugs.feed.view"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(600)), color = c.link,
                modifier = Modifier.clip(Radii.Xs).pressable(remember { MutableInteractionSource() }) { onOpen(b.id) }.padding(vertical = 4.dp),
            )
        }
        return
    }
    Column(
        Modifier.widthIn(max = 640.dp).fillMaxWidth().nexaCard(Radii.Lg, c.bgRaised, c.borderSubtle, c).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (it is FeedItem.BugLine) {
            Txt(t("bugs.feed.replied", "number" to bugNumber(b.number)), style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(700)), color = c.textStrong)
            Txt(b.subject, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1, modifier = Modifier.padding(top = 0.dp))
            Txt(
                Markdown.plainText(Markdown.parse(it.message.body), fish.nexa.ui.chat.AppNames),
                style = Nx.type.body.copy(fontSize = Nx.type.sp(14.5f), lineHeight = Nx.type.sp(21.75f)), color = c.text, maxLines = 4,
                modifier = Modifier.drawBehind { drawRect(c.borderStrong, size = Size(3.dp.toPx(), size.height)) }.padding(start = 12.dp, top = 2.dp, bottom = 2.dp),
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Txt(t("nexa.thread.sentBy"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted)
                PersonChip(it.message.authorId, 16.dp)
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                Txt(b.subject, style = Nx.type.body.copy(fontSize = Nx.type.sp(15.5f), fontWeight = FontWeight(700), lineHeight = Nx.type.sp(20.9f)), color = c.textStrong, modifier = Modifier.weight(1f))
                BugStatusChip(b.status)
            }
            Txt(Markdown.plainText(Markdown.parse(b.description), fish.nexa.ui.chat.AppNames), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20.3f)), color = c.textSubtle, maxLines = 2)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Txt(t("bugs.feed.youSent", "number" to bugNumber(b.number)), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted)
                if (b.attachments.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon("Paperclip", c.textMuted, size = 13.dp)
                    Txt(t("bugs.card.files", "count" to b.attachments.size), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted)
                }
            }
        }
        ThreadButton(t("bugs.feed.openThread"), b.unread) { onOpen(b.id) }
    }
}

/** A report as it opens its thread: subject and status, what was written, its files and device details. */
@Composable
private fun BugReportCard(report: MemberBug) {
    val c = Nx.colors
    Column(
        Modifier.widthIn(max = 720.dp).fillMaxWidth().nexaCard(Radii.Lg, c.bgRaised, c.borderSubtle, c).padding(horizontal = 16.dp, vertical = 14.dp)
            .semantics { contentDescription = t("bugs.card.label", "number" to bugNumber(report.number)) },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Box(Modifier.size(36.dp).background(c.brand.copy(alpha = 0.14f), CircleShape), contentAlignment = Alignment.Center) { Icon("Bug", c.textBrand, size = 18.dp) }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Txt(report.subject, style = Nx.type.body.copy(fontSize = Nx.type.sp(17f), fontWeight = FontWeight(700), lineHeight = Nx.type.sp(22.1f)), color = c.textStrong)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Txt(bugNumber(report.number), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted)
                    Txt(Time.timestamp(report.createdAt), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted)
                }
                Box(Modifier.padding(top = 2.dp)) { BugStatusChip(report.status) }
            }
        }
        MarkdownView(report.description, RenderCtx(surface = c.bgRaised))
        if (report.attachments.isNotEmpty()) NexaGallery(report.attachments, "bugs")
        BugFacts(report.context)
    }
}

@Composable
private fun BugFacts(context: kotlinx.serialization.json.JsonObject) {
    val c = Nx.colors
    val rows = remember(context) { fish.nexa.ui.bugs.factRows(context) }
    if (rows.isEmpty()) {
        Txt(t("bugs.card.noDetails"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted)
        return
    }
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            Modifier.clip(Radii.Xs).pressable(remember { MutableInteractionSource() }) { open = !open }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Txt(if (open) t("bugs.card.hideDetails") else t("bugs.card.showDetails"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), fontWeight = FontWeight(600)), color = c.link)
            Icon(if (open) "ChevronUp" else "ChevronDown", c.link, size = 15.dp)
        }
        if (open) Column(
            Modifier.fillMaxWidth().background(c.bgBase, Radii.Sm).border(1.dp, c.borderSubtle, Radii.Sm).padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for ((label, value) in rows) Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Txt(label, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, modifier = Modifier.width(110.dp))
                Txt(value, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.text, modifier = Modifier.weight(1f))
            }
        }
    }
}

/**
 * BugGallery: a report's or a thread line's files, pictures as thumbnails
 * that open full size in the viewer, a recording as a tile that plays there.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NexaGallery(files: List<NexaFile>, kind: String) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    val pictures = files.filter { !it.mime.startsWith("video/") }
    fun nameOf(f: NexaFile) = f.name.ifEmpty { if (f.mime.startsWith("video/")) t("bugs.file.recording") else t("bugs.file.screenshot") }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.semantics { contentDescription = t("bugs.card.files", "count" to files.size) }) {
        for (f in files) {
            val video = f.mime.startsWith("video/")
            var thumb by remember(f.id) { mutableStateOf<java.io.File?>(null) }
            var failed by remember(f.id) { mutableStateOf(false) }
            var tries by remember(f.id) { mutableStateOf(0) }
            if (!video) LaunchedEffect(f.id, tries) {
                failed = false
                thumb = runCatching { PrivateFiles.file(kind, f.id, 512) }.onFailure { failed = true }.getOrNull()
            }
            Box(
                Modifier
                    .width(150.dp)
                    .aspectRatio(4f / 3f)
                    .clip(Radii.Sm)
                    .background(c.bgBase)
                    .border(1.dp, c.borderSubtle, Radii.Sm)
                    .pressable(remember { MutableInteractionSource() }) {
                        if (failed) {
                            tries++
                            return@pressable
                        }
                        scope.launch {
                            try {
                                if (video) {
                                    val file = PrivateFiles.file(kind, f.id)
                                    openLightbox(listOf(LightboxItem(nameOf(f), f.mime, src = android.net.Uri.fromFile(file).toString())), 0)
                                } else {
                                    val full = pictures.map { p -> PrivateFiles.file(kind, p.id) }
                                    openLightbox(pictures.mapIndexed { i, p -> LightboxItem(nameOf(p), p.mime, src = android.net.Uri.fromFile(full[i]).toString()) }, pictures.indexOf(f))
                                }
                            } catch (_: Exception) {
                                Nexa.ui.toast(if (video) t("bugs.card.videoFailed") else t("bugs.card.fileFailed"), "error")
                            }
                        }
                    }
                    .semantics {
                        contentDescription = when {
                            video -> t("bugs.card.playVideo", "name" to nameOf(f), "size" to Time.bytes(f.size))
                            failed -> t("bugs.card.retryPicture", "name" to nameOf(f))
                            else -> t("bugs.card.openPicture", "name" to nameOf(f))
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                when {
                    video -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(Modifier.size(40.dp).background(Color.Black.copy(alpha = 0.5f), CircleShape), contentAlignment = Alignment.Center) { Icon("Play", Color.White, size = 18.dp) }
                        Txt(Time.bytes(f.size), style = Nx.type.hint, color = c.textMuted)
                    }
                    failed -> Icon("ImageOff", c.textMuted, size = 22.dp)
                    thumb != null -> AsyncImage(thumb, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    else -> Spinner(size = 18.dp)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// threads (CaseThread.tsx), shared by the case page and the bug page

/** One line of a thread, whichever kind of thread it is in. */
data class ThreadLine(
    val id: String,
    val authorId: String,
    val kind: String,
    val event: String,
    val body: String,
    val createdAt: Long,
    val files: List<NexaFile> = emptyList(),
)

private fun CaseMessage.line() = ThreadLine(id, authorId, kind, event, body, createdAt, files)
private fun BugMessage.line() = ThreadLine(id, authorId, kind, event, body, createdAt)

private const val MAX_LINE = 2000
private const val MAX_FILES = 4
private const val GROUP_GAP = 7 * 60_000L
private val CASE_TYPES = setOf("image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/webm", "video/quicktime")

private fun systemText(line: ThreadLine, action: String?): Pair<String, String> {
    val who = personName(NexaInbox.people.value[line.authorId])
    val what = if (action == "ban") t("nexa.thread.theBan") else t("nexa.thread.theMute")
    return when (line.event) {
        "status" -> "CircleDot" to t("bugs.thread.statusChanged", "who" to who, "status" to bugStatusLabel(line.body))
        "lifted" -> "LockOpen" to (if (line.body.isNotEmpty()) t("nexa.thread.liftedWithReason", "who" to who, "what" to what, "reason" to line.body) else t("nexa.thread.lifted", "who" to who, "what" to what))
        "closed" -> "CircleCheck" to t("nexa.thread.closed", "who" to who)
        "reopened" -> "RotateCcw" to t("nexa.thread.reopenedByReply")
        "expired" -> "Clock" to t("nexa.thread.expired", "what" to what)
        "replaced" -> "ShieldAlert" to t("nexa.thread.replaced", "number" to line.body)
        else -> "History" to line.body
    }
}

/** A file picked for the next line, with how far its upload is. */
private class Staged(val uri: android.net.Uri, val name: String, val type: String, val size: Long) {
    var progress by mutableStateOf(0f)
    var state by mutableStateOf("uploading")
    var file: NexaFile? = null
    var job: kotlinx.coroutines.Job? = null
}

/**
 * A thread with the team: the header (the notice or the report), the lines
 * grouped as a conversation groups them, and a box to write in, or the note
 * that says why there is none.
 */
@Composable
private fun ThreadView(
    lines: List<ThreadLine>,
    action: String?,
    header: @Composable () -> Unit,
    emptyNote: String,
    placeholder: String,
    composerNote: String,
    closedNote: String?,
    upload: Boolean,
    onSend: (suspend (String, List<NexaFile>) -> Unit)?,
    onSeen: () -> Unit,
) {
    val c = Nx.colors
    val state = rememberLazyListState()
    // newest at the bottom; reading it marks it read
    val rows = remember(lines) {
        val out = ArrayList<Any>()
        lines.forEachIndexed { i, l ->
            val prev = lines.getOrNull(i - 1)
            if (prev == null || !Time.sameDay(prev.createdAt, l.createdAt)) out += DayMark(l.createdAt)
            val grouped = prev != null && l.kind != "system" && prev.kind == l.kind && prev.authorId == l.authorId && Time.sameDay(prev.createdAt, l.createdAt) && l.createdAt - prev.createdAt < GROUP_GAP
            out += l to grouped
        }
        out.reversed()
    }
    LaunchedEffect(lines.lastOrNull()?.id, state.firstVisibleItemIndex) { if (state.firstVisibleItemIndex == 0) onSeen() }
    Column(Modifier.fillMaxSize().imePadding()) {
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = state, reverseLayout = true, verticalArrangement = Arrangement.Top, contentPadding = androidx.compose.foundation.layout.PaddingValues(top = 16.dp, bottom = 12.dp)) {
            if (lines.isEmpty()) item("empty") {
                Txt(emptyNote, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), lineHeight = Nx.type.sp(20.3f)), color = c.textMuted, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 16.dp).widthIn(max = 640.dp))
            }
            for (r in rows) {
                if (r is DayMark) item("day" + r.at) { DayDivider(r.at, pill = false) }
                else {
                    @Suppress("UNCHECKED_CAST") val (line, grouped) = r as Pair<ThreadLine, Boolean>
                    item(line.id) { if (line.kind == "system") SystemLine(line, action) else LineView(line, grouped) }
                }
            }
            item("header") { Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp)) { header() } }
        }
        if (onSend != null) ThreadComposer(placeholder, composerNote, upload, onSend)
        else if (closedNote != null) Row(
            Modifier.fillMaxWidth().drawBehind { drawRect(c.borderSubtle, size = Size(size.width, 1.dp.toPx())) }.navigationBarsPadding().padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon("Lock", c.textMuted, size = 16.dp)
            Txt(closedNote, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted)
        }
    }
}

@Composable
private fun SystemLine(line: ThreadLine, action: String?) {
    val c = Nx.colors
    val (icon, text) = systemText(line, action)
    val tint = when {
        line.event == "lifted" || line.event == "closed" || (line.event == "status" && line.body == "resolved") -> c.positive
        line.event == "replaced" || (line.event == "status" && line.body == "in_progress") -> c.warning
        line.event == "status" && line.body == "open" -> c.textBrand
        else -> c.textMuted
    }
    Row(
        Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp).fillMaxWidth().background(c.bgRaised, Radii.Sm).padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, tint, size = 16.dp)
        Txt(text, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f)), color = c.textSubtle, modifier = Modifier.weight(1f))
        Txt(Time.timestamp(line.createdAt), style = Nx.type.timestamp, color = c.textMuted, maxLines = 1)
    }
}

/** A line: the team's as from Nexa ("sent by" the one who wrote it), the member's as from them. */
@Composable
private fun LineView(line: ThreadLine, grouped: Boolean) {
    val c = Nx.colors
    val staff = line.kind == "staff"
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = if (grouped) 0.dp else 14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.width(36.dp).padding(top = 2.dp)) {
            if (!grouped) {
                if (staff) NexaAvatar(36.dp)
                else {
                    val p = NexaInbox.people.value[line.authorId]
                    Avatar(line.authorId, personName(p), p?.avatarId ?: Nexa.users.get(line.authorId)?.avatarId, 36.dp)
                }
            }
        }
        Column(Modifier.weight(1f)) {
            if (!grouped) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (staff) {
                    Txt("Nexa", style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(600)), color = c.textStrong)
                    OfficialBadge(compact = true)
                    Txt(t("nexa.thread.sentBy"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted)
                    PersonChip(line.authorId, 16.dp)
                } else {
                    val p = NexaInbox.people.value[line.authorId] ?: Nexa.users.get(line.authorId)?.let { NexaPerson(it.id, it.username, it.displayName) }
                    Txt(personName(p), style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(600)), color = c.textStrong, maxLines = 1)
                }
                Txt(Time.timestamp(line.createdAt), style = Nx.type.timestamp, color = c.textMuted, maxLines = 1)
            }
            if (line.body.isNotEmpty()) MarkdownView(line.body, RenderCtx(surface = c.bgCanvas))
            if (line.files.isNotEmpty()) Box(Modifier.padding(top = 6.dp)) { NexaGallery(line.files, "cases") }
        }
    }
}

/** The box at the foot of a thread: words, and pictures or videos for a case. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ThreadComposer(placeholder: String, note: String, upload: Boolean, onSend: suspend (String, List<NexaFile>) -> Unit) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val staged = remember { mutableStateListOf<Staged>() }
    val len = text.codePointCount(0, text.length)
    val over = len > MAX_LINE
    val uploading = staged.any { it.state == "uploading" }
    val ready = staged.filter { it.state == "done" }
    val can = (text.isNotBlank() || ready.isNotEmpty()) && !over && !busy && !uploading

    fun stage(uris: List<android.net.Uri>) {
        val resolver = Nexa.app.contentResolver
        for (uri in uris) {
            if (staged.size >= MAX_FILES) {
                Nexa.ui.toast(t("nexa.thread.tooManyFiles", "count" to MAX_FILES), "error")
                break
            }
            val type = (resolver.getType(uri) ?: "").lowercase()
            if (type !in CASE_TYPES) {
                Nexa.ui.toast(t("nexa.thread.fileType"), "error")
                continue
            }
            var name = ""
            var size = 0L
            runCatching {
                resolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME, android.provider.OpenableColumns.SIZE), null, null, null)?.use { cur ->
                    if (cur.moveToFirst()) {
                        name = cur.getString(0) ?: ""
                        size = cur.getLong(1)
                    }
                }
            }
            val s = Staged(uri, name.ifEmpty { t("bugs.file.screenshot") }, type, size)
            staged += s
            s.job = scope.launch {
                try {
                    val q = java.net.URLEncoder.encode(s.name.take(120), "UTF-8")
                    val body = fish.nexa.net.UriBody(uri, type, s.size) { f -> s.progress = f }
                    val req = Nexa.api.requestBuilder("/nexa/cases/attachments?name=$q").post(body).header("Content-Type", type).build()
                    val res = Nexa.api.execute(Nexa.api.http, req, true)
                    s.file = fish.nexa.net.wireJson.decodeFromJsonElement(NexaFile.serializer(), res)
                    s.progress = 1f
                    s.state = "done"
                } catch (e: Exception) {
                    if (e is kotlinx.coroutines.CancellationException) throw e
                    s.state = "failed"
                    Nexa.ui.toast((e as? ApiError)?.message?.takeIf { it.isNotBlank() } ?: t("nexa.thread.uploadFailed"), "error")
                }
            }
        }
    }
    val pick = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.PickMultipleVisualMedia(MAX_FILES)) { uris -> if (uris.isNotEmpty()) stage(uris) }

    fun send() {
        if (!can) return
        busy = true
        val files = staged.filter { it.state == "done" }.mapNotNull { it.file }
        scope.launch {
            try {
                onSend(text.trim(), files)
                text = ""
                staged.clear()
            } catch (e: Exception) {
                Nexa.ui.toast((e as? ApiError)?.message?.takeIf { it.isNotBlank() } ?: t("nexa.thread.couldNotSend"), "error")
            } finally {
                busy = false
            }
        }
    }

    Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
        Row(Modifier.padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon("ShieldAlert", c.textMuted, size = 14.dp)
            Txt(note, style = Nx.type.hint.copy(fontSize = Nx.type.sp(12.5f)), color = c.textMuted)
        }
        if (staged.isNotEmpty()) FlowRow(Modifier.padding(bottom = 8.dp).semantics { contentDescription = t("nexa.thread.filesToSend") }, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (s in staged) Box(
                Modifier.size(72.dp).ring(Radii.Sm, if (s.state == "failed") c.danger else c.borderSubtle, if (s.state == "failed") 2.dp else 1.dp).clip(Radii.Sm).background(c.bgInput),
                contentAlignment = Alignment.Center,
            ) {
                if (s.type.startsWith("video/")) Icon("Film", c.textMuted, size = 22.dp)
                else AsyncImage(s.uri, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().alpha(if (s.state == "failed") 0.45f else 1f))
                if (s.state == "uploading") Box(Modifier.align(Alignment.BottomStart).fillMaxWidth(s.progress.coerceIn(0.02f, 1f)).height(4.dp).background(c.brand))
                Box(
                    Modifier.align(Alignment.TopEnd).size(40.dp).pressable(remember { MutableInteractionSource() }) {
                        s.job?.cancel()
                        staged.remove(s)
                    }.semantics { contentDescription = t("nexa.thread.removeFile", "name" to s.name) },
                    contentAlignment = Alignment.TopEnd,
                ) { Box(Modifier.padding(4.dp).size(28.dp).background(Color.Black.copy(alpha = 0.66f), CircleShape), contentAlignment = Alignment.Center) { Icon("X", Color.White, size = 14.dp) } }
            }
        }
        Row(
            Modifier
                .fillMaxWidth()
                .background(c.bgComposer, Radii.Sm)
                .border(1.dp, if (over) c.danger else Color.Transparent, Radii.Sm)
                .padding(start = if (upload) 2.dp else 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (upload) Box(
                Modifier.size(40.dp).clip(Radii.Xs).pressable(remember { MutableInteractionSource() }, enabled = !busy && staged.size < MAX_FILES) {
                    pick.launch(androidx.activity.result.PickVisualMediaRequest(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                }.semantics { contentDescription = t("nexa.thread.addFiles") },
                contentAlignment = Alignment.Center,
            ) { Icon("ImagePlus", c.icon, size = 20.dp) }
            BasicTextField(
                text, { text = it },
                modifier = Modifier.weight(1f).heightIn(min = 36.dp, max = 240.dp).padding(vertical = 7.dp).semantics { contentDescription = placeholder },
                textStyle = Nx.type.body.copy(fontSize = Nx.type.sp(15f), lineHeight = Nx.type.sp(22f), color = c.text),
                cursorBrush = SolidColor(c.textBrand),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                decorationBox = { inner ->
                    Box {
                        if (text.isEmpty()) Txt(placeholder, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f)), color = c.textPlaceholder, maxLines = 1)
                        inner()
                    }
                },
            )
            if (len > MAX_LINE - 200) Txt((MAX_LINE - len).toString(), style = Nx.type.hint, color = if (over) c.textDanger else c.textMuted, modifier = Modifier.padding(vertical = 9.dp))
            Box(
                Modifier
                    .size(40.dp)
                    .alpha(if (can) 1f else 0.4f)
                    .background(c.brand, Radii.Xs)
                    .clip(Radii.Xs)
                    .pressable(remember { MutableInteractionSource() }, enabled = can) { send() }
                    .semantics { contentDescription = t("nexa.thread.send") },
                contentAlignment = Alignment.Center,
            ) { if (busy) Spinner(c.onBrand, 18.dp) else Icon("SendHorizontal", c.onBrand, size = 18.dp) }
        }
    }
}

// ---------------------------------------------------------------------------
// the case page and the bug page (NexaCasePage.tsx, NexaBugPage.tsx)

@Composable
fun NexaCasePage(caseId: String) {
    val c = Nx.colors
    val threads by NexaInbox.threads.collectAsState()
    val thread = threads[caseId]
    var failed by remember(caseId) { mutableStateOf(false) }
    var attempt by remember(caseId) { mutableStateOf(0) }
    LaunchedEffect(caseId, attempt) {
        if (NexaInbox.threads.value[caseId] != null) return@LaunchedEffect
        failed = false
        runCatching { NexaInbox.loadThread(caseId) }.onFailure { failed = true }
    }
    // opening the case counts as reading its notice
    LaunchedEffect(thread?.case?.acknowledged) {
        if (thread != null && !thread.case.acknowledged) runCatching { NexaInbox.ack(caseId) }
    }
    Column(Modifier.fillMaxSize()) {
        NexaHeader(
            back = true,
            title = thread?.let { t("nexa.notice.caseNumber", "number" to it.case.number) } ?: t("nexa.caseTitle"),
            sub = thread?.let { noticeTitle(it.case.action, it.case.details) } ?: "",
        )
        when {
            thread != null -> {
                val cs = thread.case
                val writable = cs.action != "delete" && cs.status != "closed"
                ThreadView(
                    lines = thread.messages.map { it.line() },
                    action = cs.action,
                    header = { NoticeCard(cs) },
                    emptyNote = t("nexa.thread.emptyMember"),
                    placeholder = t("nexa.thread.placeholder"),
                    composerNote = t("nexa.thread.notEncrypted"),
                    closedNote = if (cs.status == "closed") t("nexa.thread.closedMember") else null,
                    upload = true,
                    onSend = if (writable) ({ body, files -> NexaInbox.reply(caseId, body, files) }) else null,
                    onSeen = { NexaInbox.markThreadRead(caseId) },
                )
            }
            failed -> Missing(t("nexa.caseMissing")) { attempt++ }
            else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Spinner(size = 28.dp) }
        }
    }
}

@Composable
fun NexaBugPage(reportId: String) {
    val threads by NexaInbox.bugThreads.collectAsState()
    val thread = threads[reportId]
    var failed by remember(reportId) { mutableStateOf(false) }
    var attempt by remember(reportId) { mutableStateOf(0) }
    LaunchedEffect(reportId, attempt) {
        if (NexaInbox.bugThreads.value[reportId] != null) return@LaunchedEffect
        failed = false
        runCatching { NexaInbox.loadBugThread(reportId) }.onFailure { failed = true }
    }
    Column(Modifier.fillMaxSize()) {
        NexaHeader(
            back = true,
            title = thread?.let { t("bugs.page.title", "number" to bugNumber(it.report.number)) } ?: t("bugs.page.titleLoading"),
            sub = thread?.report?.subject ?: "",
        ) { thread?.let { BugStatusChip(it.report.status) } }
        when {
            thread != null -> {
                val r = thread.report
                val finished = r.status == "resolved" || r.status == "wont_fix" || r.status == "closed"
                ThreadView(
                    lines = thread.messages.map { it.line() },
                    action = null,
                    header = { BugReportCard(r) },
                    emptyNote = t("bugs.thread.emptyMember"),
                    placeholder = t("bugs.thread.placeholder"),
                    composerNote = t("bugs.thread.notEncrypted") + if (finished) " " + t("bugs.thread.finishedNote", "status" to bugStatusLabel(r.status)) else "",
                    closedNote = null,
                    upload = false,
                    onSend = { body, _ -> NexaInbox.replyBug(reportId, body) },
                    onSeen = { NexaInbox.markBugRead(reportId) },
                )
            }
            failed -> Missing(t("bugs.page.missing")) { attempt++ }
            else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Spinner(size = 28.dp) }
        }
    }
}

/** The ban screen's appeal: the case's thread, words only. */
@Composable
fun BanThread(thread: NexaInbox.CaseThread) {
    val cs = thread.case
    ThreadView(
        lines = thread.messages.map { it.line() },
        action = cs.action,
        header = { NoticeCard(cs) },
        emptyNote = t("nexa.thread.emptyMember"),
        placeholder = t("nexa.thread.placeholder"),
        composerNote = t("nexa.thread.notEncrypted"),
        closedNote = if (cs.status == "closed") t("nexa.thread.closedMember") else null,
        upload = false,
        onSend = if (cs.status != "closed") ({ body, _ -> NexaInbox.reply(cs.id, body, emptyList()) }) else null,
        onSeen = { NexaInbox.markThreadRead(cs.id) },
    )
}

@Composable
private fun Missing(text: String, retry: () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)) {
        Txt(text, style = Nx.type.body, color = c.textMuted)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NxButton(t("chat.messageList.tryAgain"), retry, kind = ButtonKind.SECONDARY)
            NxButton(t("nexa.backToNexa"), { Nav.go(Route.NexaConvo, replace = true) }, kind = ButtonKind.GHOST)
        }
    }
}

