package xyz.evilion.chat.ui.server

import xyz.evilion.chat.ui.icons.Lucide
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import xyz.evilion.chat.data.AppState
import xyz.evilion.chat.data.P
import xyz.evilion.chat.data.Permissions
import xyz.evilion.chat.data.Session
import xyz.evilion.chat.data.has
import xyz.evilion.chat.data.toPerm
import xyz.evilion.chat.net.AuditEntry
import xyz.evilion.chat.net.Ban
import xyz.evilion.chat.net.Invite
import xyz.evilion.chat.net.Role
import xyz.evilion.chat.net.ServersApi
import xyz.evilion.chat.ui.Layer
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.Route
import xyz.evilion.chat.ui.common.Avatar
import xyz.evilion.chat.ui.common.ServerIcon
import xyz.evilion.chat.ui.theme.chatColors

/** A server's settings: what it is, who is in it, and who may do what. */
@Composable
fun ServerSettingsScreen(serverId: String, startPage: String) {
    val colors = chatColors
    var page by remember { mutableStateOf(startPage) }
    val servers by AppState.servers.collectAsState()
    val state = servers[serverId] ?: run {
        LaunchedEffect(serverId) { Nav.go(Route.Chat(null, null)) }
        return
    }
    val perms = state.myPermissions

    Column(Modifier.fillMaxSize().background(colors.bgBase)) {
        Row(
            Modifier.fillMaxWidth().background(colors.bgRaised).statusBarsPadding().height(52.dp).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Lucide.ArrowLeft, "Back", tint = colors.icon,
                modifier = Modifier.size(24.dp).clickable {
                    if (page == "overview") Nav.openChannel(serverId, AppState.channelsOf(serverId).firstOrNull { it.isText }?.id)
                    else page = "overview"
                },
            )
            Spacer(Modifier.width(16.dp))
            Text(state.server.name, color = colors.textStrong, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }

        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).navigationBarsPadding()) {
            when (page) {
                "members" -> MembersPage(serverId)
                "roles" -> RolesPage(serverId)
                "invites" -> InvitesPage(serverId)
                "bans" -> BansPage(serverId)
                "audit" -> AuditPage(serverId)
                else -> OverviewPage(serverId) { page = it }
            }
        }
    }
}

@Composable
private fun OverviewPage(serverId: String, go: (String) -> Unit) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val servers by AppState.servers.collectAsState()
    val state = servers[serverId] ?: return
    val perms = state.myPermissions
    var name by remember(serverId) { mutableStateOf(state.server.name) }
    var description by remember(serverId) { mutableStateOf(state.server.description) }
    var busy by remember { mutableStateOf(false) }
    val isOwner = state.server.ownerId == AppState.me.value?.id

    Column(Modifier.fillMaxWidth().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ServerIcon(serverId, state.server.name, state.server.iconId, 64.dp)
            Spacer(Modifier.width(16.dp))
            Column {
                Text("${state.memberCount} members", color = colors.textMuted, fontSize = 13.sp)
                Text("${AppState.channelsOf(serverId).size} channels", color = colors.textMuted, fontSize = 13.sp)
            }
        }
        Spacer(Modifier.height(20.dp))
        if (perms.has(P.MANAGE_SERVER)) {
            OutlinedTextField(
                value = name, onValueChange = { name = it }, label = { Text("Server name") }, singleLine = true,
                colors = fieldColors(), modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = description, onValueChange = { description = it }, label = { Text("Description") },
                colors = fieldColors(), modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = {
                    busy = true
                    scope.launch {
                        runCatching {
                            val updated = ServersApi.patch(serverId, buildJsonObject {
                                put("name", name)
                                put("description", description)
                            })
                            AppState.updateServer(serverId) { it.copy(server = updated) }
                            Session.toasts.emit("Saved.")
                        }.onFailure { Session.toasts.emit(it.message ?: "That did not save.") }
                        busy = false
                    }
                },
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(containerColor = colors.brand, contentColor = colors.onBrand),
            ) { Text("Save") }
            Spacer(Modifier.height(20.dp))
        }

        NavRow("Members") { go("members") }
        if (perms.has(P.MANAGE_ROLES)) NavRow("Roles") { go("roles") }
        if (perms.has(P.CREATE_INSTANT_INVITE)) NavRow("Invites") { go("invites") }
        if (perms.has(P.BAN_MEMBERS)) NavRow("Bans") { go("bans") }
        if (perms.has(P.VIEW_AUDIT_LOG)) NavRow("Audit log") { go("audit") }

        Spacer(Modifier.height(24.dp))
        if (isOwner) {
            Button(
                onClick = {
                    scope.launch {
                        runCatching {
                            ServersApi.delete(serverId)
                            AppState.removeServer(serverId)
                            Nav.go(Route.Chat(null, null))
                        }.onFailure { Session.toasts.emit(it.message ?: "That did not work.") }
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = colors.danger, contentColor = Color.White),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Delete server") }
        } else {
            Button(
                onClick = {
                    scope.launch {
                        runCatching {
                            ServersApi.leave(serverId)
                            AppState.removeServer(serverId)
                            Nav.go(Route.Chat(null, null))
                        }.onFailure { Session.toasts.emit(it.message ?: "That did not work.") }
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = colors.danger, contentColor = Color.White),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Leave server") }
        }
    }
}

@Composable
private fun NavRow(label: String, onClick: () -> Unit) {
    val colors = chatColors
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = colors.text, fontSize = 15.sp, modifier = Modifier.weight(1f))
        Text("›", color = colors.textMuted, fontSize = 18.sp)
    }
}

@Composable
private fun fieldColors() = TextFieldDefaults.colors(
    focusedContainerColor = chatColors.bgInput,
    unfocusedContainerColor = chatColors.bgInput,
    focusedTextColor = chatColors.text,
    unfocusedTextColor = chatColors.text,
    focusedLabelColor = chatColors.textMuted,
    unfocusedLabelColor = chatColors.textMuted,
    cursorColor = chatColors.brand,
)

@Composable
private fun MembersPage(serverId: String) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val servers by AppState.servers.collectAsState()
    val state = servers[serverId] ?: return
    val me = AppState.me.value
    val myHighest = Permissions.highestPosition(state.roles.values, state.me)
    val isOwner = state.server.ownerId == me?.id

    LaunchedEffect(serverId) {
        runCatching {
            val members = ServersApi.members(serverId, limit = 200)
            AppState.updateServer(serverId) { s -> s.copy(members = s.members + members.associateBy { it.userId }) }
        }
    }

    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        for (member in state.members.values.sortedBy { AppState.nameFor(it.userId, serverId).lowercase() }) {
            val user = AppState.user(member.userId)
            val targetHighest = Permissions.highestPosition(state.roles.values, member)
            val canAct = Permissions.canActOn(myHighest, targetHighest, isOwner, member.userId == state.server.ownerId)
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(member.userId, user?.name ?: "?", user?.avatarId, 36.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(AppState.nameFor(member.userId, serverId), color = colors.text, fontSize = 15.sp)
                    Text(
                        member.roleIds.mapNotNull { state.roles[it]?.name }.joinToString(", ").ifEmpty { "No roles" },
                        color = colors.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                if (canAct && state.myPermissions.has(P.KICK_MEMBERS)) {
                    Text(
                        "Kick", color = colors.danger, fontSize = 13.sp,
                        modifier = Modifier.clickable {
                            scope.launch { runCatching { ServersApi.kick(serverId, member.userId) } }
                        }.padding(8.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun RolesPage(serverId: String) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    val servers by AppState.servers.collectAsState()
    val state = servers[serverId] ?: return
    var editing by remember { mutableStateOf<Role?>(null) }
    var newName by remember { mutableStateOf("") }

    val role = editing
    if (role != null) {
        var permissions by remember(role.id) { mutableStateOf(role.permissions.toPerm()) }
        var name by remember(role.id) { mutableStateOf(role.name) }
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text("Editing ${role.name}", color = colors.textStrong, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Spacer(Modifier.height(12.dp))
            if (role.id != serverId) {
                OutlinedTextField(
                    value = name, onValueChange = { name = it }, label = { Text("Role name") }, singleLine = true,
                    colors = fieldColors(), modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
            }
            for ((group, items) in P.GROUPS) {
                Text(group.uppercase(), color = colors.textMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
                for (item in items) {
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = permissions.has(item.bit),
                            onCheckedChange = { on ->
                                permissions = if (on) permissions or item.bit else permissions and item.bit.inv()
                            },
                            colors = CheckboxDefaults.colors(checkedColor = colors.brand),
                        )
                        Column(Modifier.weight(1f)) {
                            Text(item.label, color = colors.text, fontSize = 14.sp)
                            Text(item.description, color = colors.textMuted, fontSize = 11.sp)
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        scope.launch {
                            runCatching {
                                val updated = ServersApi.patchRole(serverId, role.id, buildJsonObject {
                                    put("name", name)
                                    put("permissions", permissions.toString())
                                })
                                AppState.updateServer(serverId) { it.copy(roles = it.roles + (updated.id to updated)) }
                                editing = null
                            }.onFailure { Session.toasts.emit(it.message ?: "That did not save.") }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = colors.brand, contentColor = colors.onBrand),
                ) { Text("Save") }
                Button(
                    onClick = { editing = null },
                    colors = ButtonDefaults.buttonColors(containerColor = colors.bgSurface, contentColor = colors.text),
                ) { Text("Cancel") }
            }
        }
        return
    }

    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = newName, onValueChange = { newName = it }, label = { Text("New role") }, singleLine = true,
                colors = fieldColors(), modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Icon(
                Lucide.Plus, "Create role", tint = colors.brand,
                modifier = Modifier.size(28.dp).clickable(enabled = newName.isNotBlank()) {
                    scope.launch {
                        runCatching {
                            val created = ServersApi.createRole(serverId, buildJsonObject { put("name", newName.trim()) })
                            AppState.updateServer(serverId) { it.copy(roles = it.roles + (created.id to created)) }
                            newName = ""
                        }.onFailure { Session.toasts.emit(it.message ?: "That did not work.") }
                    }
                },
            )
        }
        Spacer(Modifier.height(12.dp))
        for (r in state.roles.values.sortedByDescending { it.position }) {
            Row(
                Modifier.fillMaxWidth().clickable { editing = r }.padding(vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(12.dp).clip(RoundedCornerShape(6.dp))
                        .background(if (r.color != 0) Color(0xFF000000.toInt() or r.color) else colors.textMuted),
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    if (r.id == serverId) "@everyone" else r.name,
                    color = colors.text, fontSize = 15.sp, modifier = Modifier.weight(1f),
                )
                if (r.id != serverId) {
                    Icon(
                        Lucide.Trash2, "Delete role", tint = colors.danger,
                        modifier = Modifier.size(18.dp).clickable {
                            scope.launch {
                                runCatching {
                                    ServersApi.deleteRole(serverId, r.id)
                                    AppState.updateServer(serverId) { it.copy(roles = it.roles - r.id) }
                                }
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun InvitesPage(serverId: String) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    var invites by remember { mutableStateOf<List<Invite>?>(null) }
    LaunchedEffect(serverId) { runCatching { invites = ServersApi.invites(serverId) } }

    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        when {
            invites == null -> CircularProgressIndicator(color = colors.brand, modifier = Modifier.size(24.dp))
            invites!!.isEmpty() -> Text("No invites yet.", color = colors.textMuted, fontSize = 14.sp)
            else -> for (invite in invites!!) {
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(invite.code, color = colors.text, fontSize = 15.sp)
                        Text(
                            "${invite.uses} uses" + (if (invite.maxUses > 0) " of ${invite.maxUses}" else ""),
                            color = colors.textMuted, fontSize = 12.sp,
                        )
                    }
                    Text(
                        "Revoke", color = colors.danger, fontSize = 13.sp,
                        modifier = Modifier.clickable {
                            scope.launch {
                                runCatching { ServersApi.deleteInvite(invite.code) }
                                invites = runCatching { ServersApi.invites(serverId) }.getOrNull()
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun BansPage(serverId: String) {
    val colors = chatColors
    val scope = rememberCoroutineScope()
    var bans by remember { mutableStateOf<List<Ban>?>(null) }
    LaunchedEffect(serverId) { runCatching { bans = ServersApi.bans(serverId) } }

    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        when {
            bans == null -> CircularProgressIndicator(color = colors.brand, modifier = Modifier.size(24.dp))
            bans!!.isEmpty() -> Text("Nobody is banned.", color = colors.textMuted, fontSize = 14.sp)
            else -> for (ban in bans!!) {
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(AppState.nameFor(ban.userId, serverId), color = colors.text, fontSize = 15.sp)
                        if (ban.reason.isNotEmpty()) Text(ban.reason, color = colors.textMuted, fontSize = 12.sp)
                    }
                    Text(
                        "Unban", color = colors.textBrand, fontSize = 13.sp,
                        modifier = Modifier.clickable {
                            scope.launch {
                                runCatching { ServersApi.unban(serverId, ban.userId) }
                                bans = runCatching { ServersApi.bans(serverId) }.getOrNull()
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun AuditPage(serverId: String) {
    val colors = chatColors
    var entries by remember { mutableStateOf<List<AuditEntry>?>(null) }
    LaunchedEffect(serverId) { runCatching { entries = ServersApi.auditLog(serverId) } }

    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        when {
            entries == null -> CircularProgressIndicator(color = colors.brand, modifier = Modifier.size(24.dp))
            entries!!.isEmpty() -> Text("Nothing has happened yet.", color = colors.textMuted, fontSize = 14.sp)
            else -> for (entry in entries!!) {
                Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                    Text(
                        "${AppState.nameFor(entry.actorId, serverId)} · ${entry.action.replace('_', ' ')}",
                        color = colors.text, fontSize = 14.sp,
                    )
                    Text(
                        xyz.evilion.chat.ui.chat.dayLabel(entry.createdAt) + " " + xyz.evilion.chat.ui.chat.shortTime(entry.createdAt) +
                            (if (entry.reason.isNotEmpty()) " · ${entry.reason}" else ""),
                        color = colors.textMuted, fontSize = 12.sp,
                    )
                }
            }
        }
    }
}
