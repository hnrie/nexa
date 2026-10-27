package fish.nexa.ui.server

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.P
import fish.nexa.net.Member
import fish.nexa.net.PublicUser
import fish.nexa.net.wireJson
import fish.nexa.ui.Icon
import fish.nexa.ui.Time
import fish.nexa.ui.chat.outranks
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.people.MemberActions
import fish.nexa.ui.profile.AccountFlags
import fish.nexa.ui.profile.NexaOwner
import fish.nexa.ui.shell.Names
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.delay
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

private const val PAGE = 50

/**
 * MembersPage: everyone in the server, oldest first, with their roles and the
 * actions this person may take on them (roles, time out, kick, ban). A large
 * server's members are read in pages behind it; a search asks the server for
 * the ones not here yet.
 */
@Composable
fun MembersPage(serverId: String) {
    val servers by Nexa.servers.byId.collectAsState()
    val st = servers[serverId] ?: return
    val s = Nexa.servers
    // moderators get the page with its filters and Mod View; everyone else the plain list
    val moderator = listOf(P.MANAGE_SERVER, P.MANAGE_ROLES, P.MANAGE_NICKNAMES, P.KICK_MEMBERS, P.BAN_MEMBERS, P.MODERATE_MEMBERS).any { s.canI(st, it) }
    if (moderator) ModMembers(serverId) else PlainMembers(serverId)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PlainMembers(serverId: String) {
    val c = Nx.colors
    val servers by Nexa.servers.byId.collectAsState()
    val users by Nexa.users.byId.collectAsState()
    val st = servers[serverId] ?: return
    var q by remember { mutableStateOf("") }
    var shown by remember { mutableIntStateOf(PAGE) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var capped by remember { mutableStateOf(false) }
    val meId = Nexa.users.meId
    val complete = st.membersComplete

    suspend fun page(query: String?, after: String?, limit: Int): List<Member> {
        val qs = buildString {
            append("limit=$limit")
            if (after != null) append("&after=$after")
            if (query != null) append("&q=" + java.net.URLEncoder.encode(query, "UTF-8"))
        }
        val res = Nexa.api.get("/servers/$serverId/members?$qs") as JsonObject
        Nexa.users.upsert(wireJson.decodeFromJsonElement(ListSerializer(PublicUser.serializer()), res["users"] ?: JsonArray(emptyList())))
        return wireJson.decodeFromJsonElement(ListSerializer(Member.serializer()), res["members"] ?: JsonArray(emptyList()))
    }

    // up to twenty pages of a thousand, read one after another
    LaunchedEffect(serverId, complete, attempt) {
        if (complete) return@LaunchedEffect
        failed = false
        try {
            var after: String? = null
            for (i in 0 until 20) {
                val list = page(null, after, 1000)
                Nexa.servers.addMembers(serverId, list, list.size < 1000)
                if (list.size < 1000) return@LaunchedEffect
                after = list.last().userId
            }
            capped = true
        } catch (_: Exception) {
            failed = true
        }
    }
    // with the list incomplete, a search also asks the server, which searches them all
    LaunchedEffect(q, complete) {
        val query = q.trim()
        if (complete || query.length < 2) return@LaunchedEffect
        delay(250)
        runCatching { Nexa.servers.addMembers(serverId, page(query, null, 100), null) }
    }

    val rows = remember(st.members, users, q) {
        val query = q.trim().lowercase()
        st.members.values
            .map { m -> Triple(m, Names.member(serverId, m.userId), users[m.userId]?.username ?: "") }
            .filter { (_, name, username) -> query.isEmpty() || name.lowercase().contains(query) || username.contains(query) }
            .sortedBy { it.first.joinedAt }
    }
    val s = Nexa.servers
    val canKick = s.canI(st, P.KICK_MEMBERS)
    val canBan = s.canI(st, P.BAN_MEMBERS)
    val canTimeout = s.canI(st, P.MODERATE_MEMBERS)
    val canRoles = s.canI(st, P.MANAGE_ROLES)

    SettingsPage {
        PageTitle(t("server.members.membersCount", "count" to st.memberCount))
        NxTextField(q, { q = it; shown = PAGE }, placeholder = t("server.channelSettings.searchMembers"), modifier = Modifier.padding(bottom = 12.dp).semantics { contentDescription = t("server.channelSettings.searchMembers") })
        if (failed) Row(Modifier.padding(bottom = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(t("server.members.notEveryMemberCouldBeLoaded"), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textDanger, modifier = Modifier.weight(1f))
            NxButton(t("chat.messageList.tryAgain"), { attempt++ }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
        }
        if (!complete && !failed) Hint(if (capped) t("server.members.showingFirstMembers") else t("server.members.stillLoadingTheRestOfThe"), Modifier.padding(bottom = 12.dp))
        if (rows.isEmpty() && q.isNotBlank() && (complete || failed)) Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(t("friends.nobodyHereMatches", "query" to q.trim()), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted)
            NxButton(t("friends.clearTheSearch"), { q = "" }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
        }
        for ((m, name, username) in rows.take(shown)) {
            val above = m.userId != meId && outranks(serverId, m.userId)
            val timedOut = (m.timeoutUntil ?: 0) > System.currentTimeMillis()
            val roles = m.roleIds.mapNotNull { st.roles[it] }
            val editRoles = canRoles && (above || m.userId == meId)
            val actions = buildList {
                if (editRoles) add(Triple("Shield", t("server.members.editRoles"), MemberActions.Kind.ROLES))
                if (canTimeout && above) add(Triple("Clock", if (timedOut) t("server.members.removeTimeout") else t("server.members.timeout"), MemberActions.Kind.TIMEOUT))
                if (canKick && above) add(Triple("UserMinus", t("server.members.kick"), MemberActions.Kind.KICK))
                if (canBan && above) add(Triple("Ban", t("server.members.ban"), MemberActions.Kind.BAN))
            }
            val shape = Radii.Md
            // `.memberRow`: the picture, then who and their roles, then what can be done, at the end
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(bottom = 6.dp)
                    .ring(shape, c.borderSubtle)
                    .background(c.bgSurface, shape)
                    .background(sheen(c), shape)
                    .topEdge(shape, c.edgeLight)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Avatar(m.userId, name, m.avatarId ?: users[m.userId]?.avatarId, 40.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        fish.nexa.ui.chat.PersonName(m.userId, name, serverId = serverId, style = Nx.type.body.copy(fontWeight = FontWeight(600)), color = c.text, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                        if (st.server.ownerId == m.userId && !NexaOwner.isOwner(m.userId)) Icon("Crown", c.warning, size = 14.dp, label = t("server.members.owner"))
                        fish.nexa.ui.shell.OwnerMarks(m.userId)
                        if (timedOut) Icon("Clock", c.danger, size = 14.dp, label = t("server.members.timedOut"))
                    }
                    Txt("@$username · " + t("server.members.joinedOn", "when" to Time.dateDivider(m.joinedAt)), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1)
                    if (roles.isNotEmpty() || editRoles) FlowRow(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        for (r in roles) RoleChip(r.name, r.color)
                        if (editRoles) RoleChip("+", null, label = t("server.channelSettings.addRole")) { MemberActions.open(serverId, m.userId, MemberActions.Kind.ROLES) }
                    }
                }
                if (actions.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                    for ((icon, label, kind) in actions) ActionButton(icon, label, danger = kind != MemberActions.Kind.ROLES) { MemberActions.open(serverId, m.userId, kind) }
                }
            }
        }
        if (rows.size > shown) Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
            NxButton(t("server.members.showMoreLeft", "count" to rows.size - shown), { shown += PAGE }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
        }
    }
}

/** A role on a member (RoleChips `.chip`): an outlined pill, its colour as a dot, then its name; or the "+" that adds one. */
@Composable
private fun RoleChip(name: String, color: Long?, label: String? = null, onClick: (() -> Unit)? = null) {
    val c = Nx.colors
    val shape = RoundedCornerShape(999.dp)
    Row(
        Modifier
            .height(24.dp)
            .then(if (onClick != null) Modifier.size(width = 28.dp, height = 24.dp) else Modifier)
            .ring(shape, c.border)
            .background(c.bgSurface, shape)
            .clip(shape)
            .then(if (onClick != null) Modifier.pressable(remember { MutableInteractionSource() }, onClick = onClick) else Modifier)
            .then(if (label != null) Modifier.semantics { contentDescription = label } else Modifier)
            .padding(start = if (onClick != null) 0.dp else 5.dp, end = if (onClick != null) 0.dp else 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = if (onClick != null) Arrangement.Center else Arrangement.spacedBy(4.dp),
    ) {
        if (onClick == null) Box(Modifier.size(12.dp).background(if (color != null && color != 0L) Color(0xFF000000 or color) else c.textMuted, CircleShape))
        Txt(name, style = Nx.type.hint.copy(fontWeight = FontWeight(500)), color = c.text, maxLines = 1)
    }
}

/** One of a member's actions: a 40 dp icon button, red when pressed for the ones that remove. */
@Composable
private fun ActionButton(icon: String, label: String, danger: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .size(40.dp)
            .clip(Radii.Xs)
            .background(if (pressed) (if (danger) c.danger else c.bgActive) else Color.Transparent)
            .pressable(interaction, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, if (pressed && danger) c.onDanger else c.icon, size = 18.dp) }
}
