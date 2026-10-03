package fish.nexa.ui.server

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import fish.nexa.Nexa
import fish.nexa.data.P
import fish.nexa.data.Perms
import fish.nexa.net.Member
import fish.nexa.net.Role as NexaRole
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.ToggleLine
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.MenuItem
import fish.nexa.ui.layers.openMenu
import fish.nexa.ui.shell.Names
import fish.nexa.ui.shell.confirm
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.boxShadow
import fish.nexa.ui.theme.rgbColor
import fish.nexa.ui.theme.sheen
import fish.nexa.ui.theme.topEdge
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.roundToInt

private val SWATCHES = listOf(
    0x1abc9cL, 0x2ecc71L, 0x3498dbL, 0x9b59b6L, 0xe91e63L, 0xf1c40fL, 0xe67e22L, 0xe74c3cL, 0x95a5a6L, 0x607d8bL,
    0x11806aL, 0x1f8b4cL, 0x206694L, 0x71368aL, 0xad1457L, 0xc27c0eL, 0xa84300L, 0x992d22L, 0x979c9fL, 0x546e7aL,
)

data class Positioned(val id: String, val position: Int)

/**
 * rolePositions.ts rolePositionsAfterDrop: the owner renumbers the whole list;
 * anyone else only moves the roles below their own highest, which swap the
 * positions they already hold, so every one stays below the actor's.
 * [roles] is top first, without @everyone. Null when the drop is not allowed.
 */
fun rolePositionsAfterDrop(roles: List<Positioned>, movingId: String, targetId: String, after: Boolean, actorHighest: Int, actorIsOwner: Boolean): List<Positioned>? {
    val pool = if (actorIsOwner) roles else roles.filter { Perms.canManageRole(actorHighest, false, it.position) }
    val moving = pool.firstOrNull { it.id == movingId } ?: return null
    if (movingId == targetId || pool.none { it.id == targetId }) return null
    val list = pool.filter { it.id != movingId }.toMutableList()
    val idx = list.indexOfFirst { it.id == targetId } + (if (after) 1 else 0)
    list.add(idx, moving)
    if (actorIsOwner) return list.mapIndexed { i, r -> Positioned(r.id, list.size - i) }
    val slots = pool.map { it.position }.sortedDescending()
    return list.mapIndexed { i, r -> Positioned(r.id, slots[i]) }
}

/**
 * RolesPage: the roles, highest first (@everyone last, never moving), to
 * create, reorder and pick; the picked one's Display, Permissions and Manage
 * Members tabs. Members can only manage roles below their own highest.
 */
@Composable
fun RolesPage(serverId: String) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    val servers by Nexa.servers.byId.collectAsState()
    val st = servers[serverId] ?: return
    val roles = remember(st.roles) { Nexa.servers.rolesByPosition(st) }
    var selected by remember { mutableStateOf(roles.firstOrNull()?.id ?: serverId) }
    var tab by remember { mutableStateOf("display") }
    var busy by remember { mutableStateOf(false) }
    val role = st.roles[selected] ?: st.roles[serverId] ?: return
    val meId = Nexa.users.meId ?: ""
    val (myHighest, iAmOwner) = Nexa.servers.memberHighest(st, meId)
    val editable = role.id == serverId || Perms.canManageRole(myHighest, iAmOwner, role.position)
    LaunchedEffect(st.roles.keys) { if (selected !in st.roles) selected = serverId }
    val movable = roles.filter { it.id != serverId }

    suspend fun applyPositions(positions: List<Positioned>?): Boolean {
        if (positions == null) return false
        return try {
            val body = JsonArray(positions.map { p -> buildJsonObject { put("id", p.id); put("position", p.position) } })
            val list = Nexa.api.request("PATCH", "/servers/$serverId/roles", ListSerializer(NexaRole.serializer()), body)
            list.forEach { Nexa.servers.upsertRole(it) }
            true
        } catch (e: Exception) {
            Nexa.ui.toast(describeError(e, t("server.roles.couldNotReorderRoles")), "error")
            false
        }
    }

    fun move(id: String, delta: Int) {
        val at = movable.indexOfFirst { it.id == id }
        val target = movable.getOrNull(at + delta) ?: return
        val pos = rolePositionsAfterDrop(movable.map { Positioned(it.id, it.position) }, id, target.id, delta > 0, myHighest, iAmOwner)
        scope.launch {
            if (applyPositions(pos)) {
                val list = Nexa.servers.rolesByPosition(Nexa.servers.get(serverId)).filter { it.id != serverId }
                val index = list.indexOfFirst { it.id == id } + 1
                Nexa.ui.toast(t("reorder.nameIsNowIndexOfCount", "name" to (st.roles[id]?.name ?: ""), "index" to index, "count" to list.size))
            }
        }
    }

    fun create() {
        busy = true
        scope.launch {
            try {
                val r = Nexa.api.request("POST", "/servers/$serverId/roles", NexaRole.serializer(), buildJsonObject { put("name", t("server.roles.newRole")) })
                Nexa.api.get("/servers/$serverId/roles", ListSerializer(NexaRole.serializer())).forEach { Nexa.servers.upsertRole(it) }
                Nexa.servers.upsertRole(r)
                selected = r.id
                tab = "display"
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("server.roles.couldNotCreateTheRole")), "error")
            } finally {
                busy = false
            }
        }
    }

    // @everyone has no member list to manage, however it got picked
    val view = if (tab == "members" && role.id == serverId) "display" else tab
    val inner: @Composable () -> Unit = {
        PageTitle(t("server.members.roles"), Modifier.padding(bottom = 0.dp))
        Hint(t("server.roles.useRolesToGroupYourMembers"), Modifier.padding(bottom = 16.dp))
        NxButton(t("server.roles.createRole"), { Holds.unlessUnsaved { create() } }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM, icon = "Plus", loading = busy)
        if (movable.size > 1) Hint(t("android.server.reorderHint"), Modifier.padding(top = 8.dp, bottom = 4.dp))
        RoleList(st.server.id, roles, role.id, myHighest, iAmOwner, st.memberCount, st.members.values,
            onPick = { id ->
                if (id != selected) Holds.unlessUnsaved {
                    selected = id
                    if (id == serverId && tab == "members") tab = "display"
                }
            },
            onMove = ::move,
            onDrop = { moving, target, after ->
                scope.launch { applyPositions(rolePositionsAfterDrop(movable.map { Positioned(it.id, it.position) }, moving, target, after, myHighest, iAmOwner)) }
            },
        )
        Tabs(
            listOfNotNull(
                "display" to t("server.roles.display"),
                "permissions" to t("server.channelSettings.permissions"),
                if (role.id != serverId) "members" to t("server.roles.manageMembers") else null,
            ),
            view,
        ) { next -> Holds.unlessUnsaved { tab = next } }
    }
    key(role.id, view) {
        when (view) {
            "permissions" -> PermissionsTab(role, editable, st.myPermissions, inner)
            "members" -> MembersTab(role, serverId, editable, inner)
            else -> DisplayTab(role, editable, role.id == serverId, inner) { selected = serverId }
        }
    }
}

/** The role list: a colour dot, the name and how many hold it; the picked one raised. Rows you may move carry a handle. */
@Composable
private fun RoleList(
    everyoneId: String,
    roles: List<NexaRole>,
    selected: String,
    myHighest: Int,
    iAmOwner: Boolean,
    memberCount: Int,
    members: Collection<Member>,
    onPick: (String) -> Unit,
    onMove: (String, Int) -> Unit,
    onDrop: (String, String, Boolean) -> Unit,
) {
    val c = Nx.colors
    val density = LocalDensity.current.density
    val rowPx = 46f * density
    var dragId by remember { mutableStateOf<String?>(null) }
    var dragDy by remember { mutableFloatStateOf(0f) }
    val movable = roles.filter { it.id != everyoneId }
    val startIndex = movable.indexOfFirst { it.id == dragId }
    val targetIndex = if (startIndex < 0) -1 else (startIndex + (dragDy / rowPx).roundToInt()).coerceIn(0, movable.lastIndex)
    Column(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        for (r in roles) {
            val canDrag = r.id != everyoneId && Perms.canManageRole(myHighest, iAmOwner, r.position)
            val count = if (r.id == everyoneId) memberCount else members.count { r.id in it.roleIds }
            val dragging = r.id == dragId
            val myIndex = movable.indexOfFirst { it.id == r.id }
            val dropHere = dragId != null && !dragging && myIndex == targetIndex && targetIndex != startIndex
            val dropAfter = targetIndex > startIndex
            key(r.id) {
                val interaction = remember { MutableInteractionSource() }
                val pressed by interaction.collectIsPressedAsState()
                val on = r.id == selected
                val shape = Radii.Sm
                Row(
                    Modifier
                        .fillMaxWidth()
                        .zIndex(if (dragging) 2f else 0f)
                        .graphicsLayer { if (dragging) translationY = dragDy; alpha = if (dragging) 0.85f else 1f }
                        .drawBehind {
                            if (dropHere) {
                                val y = if (dropAfter) size.height + 1.dp.toPx() else -1.dp.toPx()
                                drawLine(c.brand, Offset(0f, y), Offset(size.width, y), strokeWidth = 2.dp.toPx())
                            }
                        }
                        .heightIn(min = 44.dp)
                        .then(
                            when {
                                on || dragging -> Modifier.selectedRowFill(shape)
                                pressed -> Modifier.background(c.bgHover, shape)
                                else -> Modifier
                            },
                        )
                        .clip(shape)
                        .pressable(
                            interaction,
                            role = Role.Tab,
                            onLongClick = if (canDrag) ({
                                val items = buildList {
                                    if (myIndex > 0 && Perms.canManageRole(myHighest, iAmOwner, movable[myIndex - 1].position)) add(MenuItem.Action(t("reorder.moveUp")) { onMove(r.id, -1) })
                                    if (myIndex in 0 until movable.lastIndex) add(MenuItem.Action(t("reorder.moveDown")) { onMove(r.id, 1) })
                                }
                                if (items.isNotEmpty()) openMenu(items, title = r.name)
                            }) else null,
                        ) { onPick(r.id) }
                        .semantics { this.selected = on }
                        .padding(start = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    ColorDot(r.color)
                    Txt(r.name, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(550)), color = if (on) c.textStrong else c.textChannel, maxLines = 1, modifier = Modifier.weight(1f))
                    Txt(count.toString(), style = Nx.type.hint, color = c.textMuted)
                    if (canDrag) Box(
                        Modifier
                            .size(44.dp)
                            .pointerInputDrag(
                                onStart = {
                                    NoSwipe.active = true
                                    dragId = r.id
                                    dragDy = 0f
                                },
                                onDrag = { dy -> dragDy += dy },
                                onEnd = {
                                    NoSwipe.active = false
                                    val from = movable.indexOfFirst { it.id == dragId }
                                    val to = if (from < 0) -1 else (from + (dragDy / rowPx).roundToInt()).coerceIn(0, movable.lastIndex)
                                    val id = dragId
                                    dragId = null
                                    dragDy = 0f
                                    if (id != null && from >= 0 && to != from) onDrop(id, movable[to].id, to > from)
                                },
                            )
                            .semantics { contentDescription = t("android.server.dragToReorder", "name" to r.name) },
                        contentAlignment = Alignment.Center,
                    ) { Icon("GripVertical", c.textMuted, size = 18.dp) }
                    else Box(Modifier.size(width = 12.dp, height = 44.dp))
                }
            }
        }
    }
}

/** The picked row: raised on the selected fill, lit along its top (`.roleRow[data-selected]`). */
@Composable
private fun Modifier.selectedRowFill(shape: androidx.compose.ui.graphics.Shape): Modifier {
    val c = Nx.colors
    return this.background(c.bgSelected, shape).background(sheen(c), shape).topEdge(shape, c.edgeLight)
}

private fun Modifier.pointerInputDrag(onStart: () -> Unit, onDrag: (Float) -> Unit, onEnd: () -> Unit): Modifier = this.then(
    Modifier.pointerInput(Unit) {
        detectDragGestures(
            onDragStart = { onStart() },
            onDragEnd = { onEnd() },
            onDragCancel = { onEnd() },
        ) { change, amount ->
            change.consume()
            onDrag(amount.y)
        }
    },
)

/** `.tabs`: the words in a row, the open one in strong text over a lit accent line. */
@Composable
fun Tabs(tabs: List<Pair<String, String>>, current: String, onPick: (String) -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().padding(bottom = 20.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            for ((id, label) in tabs) {
                val on = id == current
                Column(
                    Modifier
                        .pressable(remember { MutableInteractionSource() }, role = Role.Tab) { if (!on) onPick(id) }
                        .semantics { selected = on },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Txt(
                        label,
                        style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(600)),
                        color = if (on) c.textStrong else c.textMuted,
                        maxLines = 1,
                        modifier = Modifier.padding(horizontal = 2.dp, vertical = 12.dp),
                    )
                    Box(
                        Modifier
                            .height(2.dp)
                            .fillMaxWidth()
                            .then(if (on) Modifier.boxShadow(RectangleShape, 0f, 10f, c.brand) else Modifier)
                            .background(if (on) c.brand else Color.Transparent),
                    )
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
    }
}

/** The Display tab: name, colour, separate listing, mentions; Delete Role. Drafts with the save bar. */
@Composable
private fun DisplayTab(role: NexaRole, editable: Boolean, everyone: Boolean, header: @Composable () -> Unit, onDeleted: () -> Unit) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(role.name) }
    var color by remember { mutableLongStateOf(role.color) }
    var hoist by remember { mutableStateOf(role.hoist) }
    var mentionable by remember { mutableStateOf(role.mentionable) }
    var busy by remember { mutableStateOf(false) }
    val dirty = name != role.name || color != role.color || hoist != role.hoist || mentionable != role.mentionable
    fun reset() {
        name = role.name
        color = role.color
        hoist = role.hoist
        mentionable = role.mentionable
    }
    fun save() {
        busy = true
        scope.launch {
            try {
                val body = buildJsonObject {
                    if (name != role.name) put("name", name)
                    if (color != role.color) put("color", color)
                    if (hoist != role.hoist) put("hoist", hoist)
                    if (mentionable != role.mentionable) put("mentionable", mentionable)
                }
                val saved = Nexa.api.request("PATCH", "/servers/${role.serverId}/roles/${role.id}", NexaRole.serializer(), body)
                Nexa.servers.upsertRole(saved)
                // the server tidies whitespace in names: show what it kept, or the save bar never goes away
                name = saved.name
                color = saved.color
                hoist = saved.hoist
                mentionable = saved.mentionable
                Nexa.ui.toast(t("server.roles.roleSaved"), "success")
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("server.roles.couldNotSaveTheRole")), "error")
            } finally {
                busy = false
            }
        }
    }
    SettingsPage(SaveState(dirty, busy, ::reset, ::save)) {
        header()
        Form {
            if (!everyone) NxTextField(name, { name = it.take(100) }, label = t("server.roles.roleName"), required = true, enabled = editable, capitalize = true)
            else Hint(t("server.roles.everyoneIsTheBaseRoleEvery"), top = 0.dp)
            Field(t("server.roles.roleColour"), hint = t("server.roles.membersUseTheColourOfTheir")) {
                // the preview chip: the dot and the name as they will look
                Row(
                    Modifier.surfaceCard(c, Radii.Sm).padding(horizontal = 12.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    ColorDot(color)
                    Txt(name.ifBlank { "@everyone" }, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(600)), color = if (color != 0L) rgbColor(color) else c.text, maxLines = 1)
                }
                Wrap(gap = 10.dp) {
                    Swatch(c.bgActive, color == 0L, t("server.roles.default"), editable) { color = 0L }
                    SWATCHES.forEachIndexed { i, sw ->
                        Swatch(rgbColor(sw), color == sw, t("server.roles.colourIndexOfCount", "index" to i + 1, "count" to SWATCHES.size), editable) { color = sw }
                    }
                    CustomSwatch(if (color != 0L && color !in SWATCHES) color else null, editable) {
                        openColourPick(t("server.roles.customColour"), if (color != 0L) color else 0x99aab5L) { picked -> color = picked }
                    }
                }
            }
            Column {
                if (!everyone) ToggleLine(t("server.roles.displayRoleMembersSeparatelyFromOnline"), hoist, { hoist = it }, enabled = editable)
                ToggleLine(t("server.roles.allowAnyoneToMentionThisRole"), mentionable, { mentionable = it }, description = t("server.roles.membersWithMentionEveryoneCanAlways"), enabled = editable)
            }
            if (!everyone && editable) NxButton(t("server.roles.deleteRole"), {
                confirm(t("server.roles.deleteNamed", "name" to role.name), t("server.roles.membersLoseThisRoleAndAny"), t("server.roles.deleteRole")) {
                    Nexa.api.request("DELETE", "/servers/${role.serverId}/roles/${role.id}")
                    Nexa.servers.removeRole(role.serverId, role.id)
                    onDeleted()
                }
            }, kind = ButtonKind.DANGER, size = ButtonSize.SM, icon = "Trash2")
        }
    }
}

/** `.swatch`: a 40 dp rounded square of the colour; chosen, ringed in the strong text colour. */
@Composable
fun Swatch(color: Color, on: Boolean, label: String, enabled: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(12.dp)
    Box(
        Modifier
            .size(40.dp)
            .then(if (on) Modifier.border(2.dp, c.textStrong, RoundedCornerShape(15.dp)).padding(4.dp) else Modifier)
            .background(color, shape)
            .topEdge(shape, Color.White.copy(alpha = 0.22f))
            .clip(shape)
            .alpha(if (enabled) 1f else 0.6f)
            .pressable(remember { MutableInteractionSource() }, enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .semantics {
                selected = on
                contentDescription = label
            },
    )
}

/** The custom colour swatch: dashed until a colour of its own is chosen; opens the picker. */
@Composable
fun CustomSwatch(color: Long?, enabled: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(12.dp)
    Box(
        Modifier
            .size(40.dp)
            .background(if (color != null) rgbColor(color) else c.bgSurface, shape)
            .dashedOutline(c.borderStrong, 12.dp, 2.dp)
            .clip(shape)
            .alpha(if (enabled) 1f else 0.6f)
            .pressable(remember { MutableInteractionSource() }, enabled = enabled, onClick = onClick)
            .semantics { contentDescription = t("server.roles.customColour") },
        contentAlignment = Alignment.Center,
    ) { if (color == null) Icon("Pipette", c.textMuted, size = 16.dp) }
}

/** The Permissions tab: search, Turn All Permissions Off, then the grid. */
@Composable
private fun PermissionsTab(role: NexaRole, editable: Boolean, actorPerms: Long, header: @Composable () -> Unit) {
    val scope = rememberCoroutineScope()
    val original = P.parse(role.permissions)
    var value by remember { mutableLongStateOf(original) }
    var filter by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val admin = P.has(actorPerms, P.ADMINISTRATOR)
    // an administrator holds everything, and so may give anything
    val grantable: Long? = if (admin) null else actorPerms
    fun save() {
        busy = true
        scope.launch {
            try {
                val saved = Nexa.api.request("PATCH", "/servers/${role.serverId}/roles/${role.id}", NexaRole.serializer(), buildJsonObject { put("permissions", value.toULong().toString()) })
                Nexa.servers.upsertRole(saved)
                Nexa.ui.toast(t("server.channelSettings.permissionsSaved"), "success")
            } catch (e: Exception) {
                Nexa.ui.toast((e as? fish.nexa.net.ApiError)?.message ?: t("server.channelSettings.couldNotSavePermissions"), "error")
            } finally {
                busy = false
            }
        }
    }
    SettingsPage(SaveState(value != original, busy, { value = original }, ::save)) {
        header()
        SearchBox(filter, { filter = it }, t("server.roles.searchPermissions"), Modifier.padding(bottom = 12.dp))
        Wrap(Modifier.fillMaxWidth().padding(bottom = 8.dp), gap = 8.dp) {
            Hint(if (admin) t("server.roles.grantHintAll") else t("server.roles.grantHint"), top = 0.dp)
            NxButton(
                t("server.roles.turnAllOff"),
                { value = if (grantable == null) 0L else value and grantable.inv() },
                kind = ButtonKind.GHOST, size = ButtonSize.SM,
                enabled = editable && (if (grantable == null) value != 0L else (value and grantable) != 0L),
            )
        }
        RoleGrid(value, { value = it }, editable, filter, grantable)
    }
}

/** How many members Manage Members shows at a time. */
private const val MEMBERS_PAGE = 50

/** Manage Members: everyone loaded here with Add or Remove, holders first. */
@Composable
private fun MembersTab(role: NexaRole, serverId: String, editable: Boolean, header: @Composable () -> Unit) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    val servers by Nexa.servers.byId.collectAsState()
    val users by Nexa.users.byId.collectAsState()
    val st = servers[serverId] ?: return
    var q by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf<String?>(null) }
    var shown by remember { mutableIntStateOf(MEMBERS_PAGE) }
    val query = q.trim().lowercase()
    data class Holder(val m: Member, val name: String, val username: String, val has: Boolean)
    val all = st.members.values.map { m -> Holder(m, Names.member(serverId, m.userId), users[m.userId]?.username ?: "", role.id in m.roleIds) }
    val holders = all.count { it.has }
    val matching = all.filter { query.isEmpty() || it.name.lowercase().contains(query) || it.username.contains(query) }
        .sortedWith(compareBy<Holder>({ !it.has }, { it.name.lowercase() }))
    fun toggle(userId: String, on: Boolean) {
        busy = userId
        scope.launch {
            try {
                val m = Nexa.api.request(if (on) "PUT" else "DELETE", "/servers/$serverId/members/$userId/roles/${role.id}", Member.serializer())
                Nexa.servers.updateMember(m)
            } catch (e: Exception) {
                Nexa.ui.toast((e as? fish.nexa.net.ApiError)?.message ?: t("server.memberAction.couldNotChangeRoles"), "error")
            } finally {
                busy = null
            }
        }
    }
    SettingsPage {
        header()
        SearchBox(q, { q = it; shown = MEMBERS_PAGE }, t("server.channelSettings.searchMembers"), Modifier.padding(bottom = 12.dp))
        Hint(t("server.roles.holdersCount", "count" to holders), Modifier.padding(bottom = 8.dp), top = 0.dp)
        if (matching.isEmpty() && query.isNotEmpty()) NoMatches(q, { q = "" }, people = true)
        for (x in matching.take(shown)) {
            key(x.m.userId) {
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 6.dp).surfaceCard(c).padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Avatar(x.m.userId, x.name, x.m.avatarId ?: users[x.m.userId]?.avatarId, 32.dp)
                    Column(Modifier.weight(1f)) {
                        Txt(x.name, style = Nx.type.body.copy(fontWeight = FontWeight(600)), color = c.text, maxLines = 1)
                        Txt("@" + x.username, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1)
                    }
                    NxButton(
                        if (x.has) t("server.packEditor.remove") else t("server.roles.addMember"),
                        { toggle(x.m.userId, !x.has) },
                        kind = if (x.has) ButtonKind.SECONDARY else ButtonKind.PRIMARY,
                        size = ButtonSize.SM,
                        enabled = editable && busy != x.m.userId,
                    )
                }
            }
        }
        if (matching.size > shown) Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
            NxButton(t("server.members.showMoreLeft", "count" to matching.size - shown), { shown += MEMBERS_PAGE }, kind = ButtonKind.SECONDARY, size = ButtonSize.SM)
        }
    }
}
