package fish.nexa.ui.moderation

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import fish.nexa.data.ModEvent
import fish.nexa.data.ModUser
import fish.nexa.data.Moderation
import fish.nexa.ui.Time
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.shell.confirm
import fish.nexa.ui.shell.copyText
import fish.nexa.ui.shell.openProfile
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.ring
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val PAGE = 60

/** Why the viewer cannot act on an account, in a sentence ("" when they can). */
fun blockedText(b: String): String = when (b) {
    "self" -> t("moderation.blocked.self")
    "owner" -> t("moderation.blocked.owner")
    "staff" -> t("moderation.blocked.staff")
    else -> ""
}

/**
 * Every account on Nexa, as cards (UserGrid.tsx): who they are, where they
 * stand, and the two ways in: act on them, or read their cases.
 */
@Composable
fun UsersTab() {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var q by remember { mutableStateOf("") }
    var show by remember { mutableStateOf("all") }
    var sort by remember { mutableStateOf("newest") }
    val users = remember { mutableStateListOf<ModUser>() }
    var loaded by remember { mutableStateOf(false) }
    var cursor by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var request by remember { mutableStateOf(0) }

    fun load(from: String) {
        val id = ++request
        loading = true
        failed = false
        scope.launch {
            try {
                val (page, next) = Moderation.users(q, show, sort, from, PAGE)
                if (id != request) return@launch
                if (from.isEmpty()) users.clear()
                users.addAll(page.filter { u -> users.none { it.id == u.id } })
                cursor = next
                loaded = true
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                if (id == request) failed = true
            } finally {
                if (id == request) loading = false
            }
        }
    }

    /** Reads one account again after something happened to it; a deleted one leaves the grid. */
    fun refresh(id: String) {
        scope.launch {
            try {
                val r = Moderation.user(id)
                val i = users.indexOfFirst { it.id == id }
                if (i >= 0) users[i] = r.user
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                users.removeAll { it.id == id }
            }
        }
    }

    val list = rememberLazyListState()
    // A new search, filter or order starts the list again, from its top (typing
    // waits a moment). The old list's pages stop at once: its cursor means
    // nothing in the new order, and a page still coming would land in the new list.
    LaunchedEffect(q, show, sort) {
        request++
        cursor = ""
        if (q.isNotEmpty()) delay(250)
        loaded = false
        users.clear()
        list.scrollToItem(0)
        load("")
    }
    LaunchedEffect(Unit) {
        Moderation.events.collect { e ->
            when (e) {
                is ModEvent.Case -> if (users.any { it.id == e.case.userId }) refresh(e.case.userId)
                is ModEvent.Log -> e.entry.targetId?.let { tid -> if (e.entry.action.startsWith("admin_") && users.any { it.id == tid }) refresh(tid) }
                else -> Unit
            }
        }
    }

    // the next page loads as the end of the list comes into view; after a failed page it waits to be asked
    val nearEnd by remember { derivedStateOf { list.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= list.layoutInfo.totalItemsCount - 4 } == true } }
    LaunchedEffect(nearEnd, cursor, loading, failed) { if (nearEnd && cursor.isNotEmpty() && !loading && !failed && loaded) load(cursor) }

    val shows = listOf(
        "all" to t("moderation.show.all"), "online" to t("moderation.show.online"), "cases" to t("moderation.show.cases"),
        "muted" to t("moderation.show.muted"), "banned" to t("moderation.show.banned"), "staff" to t("moderation.show.staff"), "disabled" to t("moderation.show.disabled"),
    )
    LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PanelPad, verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item("tools") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SearchField(q, { q = it }, t("moderation.searchUsers"), Modifier.fillMaxWidth())
                ChipRow(t("moderation.show.label")) { for ((id, label) in shows) ModChip(label, show == id, { show = id }) }
                SortField(listOf("newest" to t("moderation.sort.newest"), "oldest" to t("moderation.sort.oldest"), "name" to t("moderation.sort.name")), sort) { sort = it }
            }
        }
        when {
            !loaded && !failed -> item("loading") { LoadingRow() }
            failed && users.isEmpty() -> item("failed") { LoadFailed({ load("") }, loading) }
            users.isEmpty() -> item("empty") {
                EmptyState("Users", if (q.isNotEmpty()) t("moderation.noMatches") else t("moderation.noneHere")) {
                    if (q.isNotEmpty() || show != "all") NxButton(t("moderation.clearFilters"), { q = ""; show = "all" }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
                }
            }
            else -> items(users, key = { it.id }) { u ->
                UserCard(u, onModerate = { openModerate(u, null) { cs -> if (cs.action == "delete") users.removeAll { it.id == cs.userId } else refresh(cs.userId) } }, onMenu = { userMenu(u) { refresh(u.id) } })
            }
        }
        if (failed && users.isNotEmpty() && cursor.isNotEmpty()) item("retry") {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { NxButton(t("moderation.retry"), { load(cursor) }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, loading = loading) }
        }
        if (loading && loaded) item("more") { LoadingRow() }
    }
}

/** The ⋯ menu of an account: its profile, its id, and (for another member) staff access and signing in. */
fun userMenu(u: ModUser, onChanged: () -> Unit) {
    val owner = Moderation.ownerId.value == u.id
    val items = ArrayList<MenuItem>()
    items += MenuItem.Action(t("moderation.menu.profile")) { openProfile(u.id) }
    items += MenuItem.Action(t("moderation.menu.copyId"), separatorAfter = true) { copyText(u.id) }
    if (u.blocked != "self" && !owner) {
        val admin = u.isStaff
        val disabled = u.isDisabled
        fun set(adminTo: Boolean? = null, disabledTo: Boolean? = null) = Nexa.scope.launch {
            try {
                Moderation.access(u.id, adminTo, disabledTo)
                onChanged()
                Nexa.ui.toast(t("moderation.accessChanged"), "success")
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("moderation.failed")), "error")
            }
        }
        items += MenuItem.Action(if (admin) t("moderation.menu.removeAdmin") else t("moderation.menu.makeAdmin")) {
            confirm(
                if (admin) t("moderation.menu.removeAdminTitle", "name" to u.displayName) else t("moderation.menu.makeAdminTitle", "name" to u.displayName),
                if (admin) t("moderation.menu.removeAdminBody") else t("moderation.menu.makeAdminBody"),
                if (admin) t("moderation.menu.removeAdmin") else t("moderation.menu.makeAdmin"),
                danger = admin,
            ) {
                Moderation.access(u.id, admin = !admin)
                onChanged()
                Nexa.ui.toast(t("moderation.accessChanged"), "success")
            }
        }
        items += MenuItem.Action(if (disabled) t("moderation.menu.enable") else t("moderation.menu.disable"), danger = !disabled) {
            if (disabled) set(disabledTo = false)
            else confirm(t("moderation.menu.disableTitle", "name" to u.displayName), t("moderation.menu.disableBody"), t("moderation.menu.disable")) {
                Moderation.access(u.id, disabled = true)
                onChanged()
                Nexa.ui.toast(t("moderation.accessChanged"), "success")
            }
        }
    }
    openMenu(items, title = u.displayName)
}

/** `.card`: an account, from its banner to what can be done about it. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun UserCard(u: ModUser, onModerate: () -> Unit, onMenu: () -> Unit) {
    val c = Nx.colors
    Nexa.presence.byId.collectAsState().value
    val st = modStatus(u)
    val state = when {
        u.ban != null -> "banned"
        u.mute != null -> "muted"
        else -> null
    }
    val blocked = blockedText(u.blocked)
    Box(Modifier.fillMaxWidth().modCard(c, state).pressable(remember { MutableInteractionSource() }, onLongClick = onMenu) { goPanel("users/${u.id}") }.semantics { contentDescription = u.displayName }) {
        Column(Modifier.fillMaxWidth()) {
            CardBanner(u.bannerId, profileBrush(u.accentColor, u.accentColor2, u.id), 88.dp)
            Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 44.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Txt(u.displayName, style = Nx.type.name.copy(fontSize = Nx.type.sp(17.5f), fontWeight = FontWeight(690)), color = c.textStrong, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                    RankBadge(u.id, u.adminFlags)
                    if (u.awaitingCases > 0) AwaitingDot(t("moderation.awaitingTip", "count" to u.awaitingCases))
                }
                Txt("@" + u.username + if (u.pronouns.isNotEmpty()) " · " + u.pronouns else "", style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f)), color = c.textMuted, maxLines = 1, modifier = Modifier.offset(y = (-3).dp))
                StatusSummary(st)
                // plain words, whatever formatting the about me has: the full profile shows it formatted
                Txt(
                    if (u.aboutMe.isNotEmpty()) previewText(u.aboutMe) else t("moderation.noAbout"),
                    style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13.5f), lineHeight = Nx.type.sp(18.9f), fontStyle = if (u.aboutMe.isEmpty()) FontStyle.Italic else FontStyle.Normal),
                    color = if (u.aboutMe.isEmpty()) c.textPlaceholder else c.textSubtle,
                    maxLines = 2,
                    modifier = Modifier.padding(top = 2.dp).heightIn(min = 37.8.dp),
                )
                FlowRow(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    MetaItem("CalendarDays", t("moderation.joined", "when" to Time.shortDate(u.createdAt)))
                    u.lastSeenAt?.let { MetaItem("Clock", t("moderation.lastSeen", "when" to Time.relative(it))) }
                }
                Row(Modifier.padding(top = 8.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    NxButton(t("moderation.moderate"), onModerate, Modifier.weight(1f), icon = "Gavel", size = ButtonSize.TOUCH, enabled = u.blocked.isEmpty())
                    CasesButton(u.caseCount, Modifier.weight(1f)) { goPanel("users/${u.id}/cases") }
                    ModIconButton("Ellipsis", t("moderation.more"), onMenu)
                }
                // why Moderate is off, said under the card's buttons where there is no pointer to hover with
                if (blocked.isNotEmpty()) Txt(blocked, style = Nx.type.hint.copy(fontSize = Nx.type.sp(12f)), color = c.textMuted, modifier = Modifier.padding(top = 6.dp))
            }
        }
        // the flags on the banner, and the picture where the banner meets the card
        FlowRow(Modifier.align(Alignment.TopEnd).padding(10.dp).widthIn(max = 260.dp), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            u.ban?.let { b -> Flag(b.expiresAt?.let { t("moderation.state.bannedUntil", "when" to Time.relativeTo(it)) } ?: t("moderation.state.bannedForever"), "danger", "Ban") }
            u.mute?.let { m -> Flag(m.expiresAt?.let { t("moderation.state.mutedUntil", "when" to Time.relativeTo(it)) } ?: t("moderation.state.muted"), "warn", "MessageSquareOff") }
            if (u.isDisabled) Flag(t("moderation.state.disabled"), "muted", "UserRoundX")
        }
        Box(
            Modifier
                .padding(start = 14.dp, top = 44.dp)
                .ring(CircleShape, Nx.colors.shadeAt(0.2f))
                .background(cardFill(c), CircleShape)
                .padding(5.dp),
        ) { Avatar(u.id, u.displayName, u.avatarId, 64.dp, status = st.status) }
    }
}

/** Cases, with how many in its pill (`.btnCount`), beside Moderate. */
@Composable
fun CasesButton(count: Int, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(modifier.semantics(mergeDescendants = true) { contentDescription = t("moderation.viewCases", "count" to count) }) {
        NxButton(t("moderation.cases"), onClick, Modifier.fillMaxWidth(), kind = ButtonKind.SECONDARY, size = ButtonSize.TOUCH, icon = "FolderOpen", trailing = { CountPill(count) })
    }
}

/** `.btnCount`: a count on a button, after its label. */
@Composable
fun CountPill(n: Int) {
    val c = Nx.colors
    Box(Modifier.padding(start = 2.dp).background(c.bgActive, androidx.compose.foundation.shape.RoundedCornerShape(8.dp)).padding(horizontal = 6.dp, vertical = 2.dp)) {
        Txt(n.toString(), style = Nx.type.hint.copy(fontSize = Nx.type.sp(12f), fontFeatureSettings = "tnum"), color = c.text, maxLines = 1)
    }
}

/** `.dot`: someone is waiting on the staff, beside their name. */
@Composable
fun AwaitingDot(label: String) {
    val c = Nx.colors
    Box(
        Modifier
            .size(9.dp)
            .ring(CircleShape, c.danger.copy(alpha = 0.25f), 3.dp)
            .background(c.danger, CircleShape)
            .semantics { contentDescription = label },
    )
}
