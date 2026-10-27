package fish.nexa.ui.people

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.Perms
import fish.nexa.net.Member
import fish.nexa.ui.Time
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ChoiceList
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.dialogs.PickBox
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.shell.Names
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.rgbColor
import fish.nexa.ui.theme.ring
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * MemberActionModal: kick, ban, time out or edit the roles of one member,
 * each a sheet that says who it is about and what it does.
 */
object MemberActions {
    enum class Kind { ROLES, TIMEOUT, KICK, BAN }

    fun open(serverId: String, userId: String, kind: Kind) {
        lateinit var layer: Layer
        layer = Layer("memberAction", replaces = "memberAction") { close -> MemberActionSheet(layer, serverId, userId, kind, close) }
        Layers.open(layer)
    }

    suspend fun setRole(serverId: String, userId: String, roleId: String, on: Boolean) {
        val m = Nexa.api.request(if (on) "PUT" else "DELETE", "/servers/$serverId/members/$userId/roles/$roleId", Member.serializer())
        Nexa.servers.upsertMember(m)
    }

    suspend fun kick(serverId: String, userId: String, reason: String?) {
        val q = reason?.let { "?reason=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: ""
        Nexa.api.request("DELETE", "/servers/$serverId/members/$userId$q")
        Nexa.servers.removeMember(serverId, userId)
    }

    suspend fun ban(serverId: String, userId: String, reason: String?, deleteDays: Int) {
        Nexa.api.request("PUT", "/servers/$serverId/bans/$userId", buildJsonObject {
            if (reason != null) put("reason", reason)
            put("delete_message_days", deleteDays)
        })
        Nexa.servers.removeMember(serverId, userId)
    }

    suspend fun timeout(serverId: String, userId: String, until: Long?) {
        val m = Nexa.api.request("PATCH", "/servers/$serverId/members/$userId", Member.serializer(), buildJsonObject {
            if (until != null) put("timeout_until", until) else put("timeout_until", JsonNull)
        })
        Nexa.servers.upsertMember(m)
    }
}

private fun durations() = listOf(
    60L to t("server.memberAction.60Seconds"),
    300L to t("server.memberAction.5Minutes"),
    600L to t("server.memberAction.10Minutes"),
    3600L to t("modals.customStatus.1Hour"),
    86400L to t("modals.groupInvite.1Day"),
    604800L to t("server.memberAction.1Week"),
)

/** Who the sheet is about: their picture, name and username, set apart. */
@Composable
private fun MemberHead(serverId: String, userId: String, name: String) {
    val c = Nx.colors
    val user = Nexa.users.get(userId)
    val member = Nexa.servers.get(serverId)?.members?.get(userId)
    Row(
        Modifier
            .fillMaxWidth()
            .ring(Radii.Md, c.borderSubtle)
            .background(mixOklab(c.bgFloating, c.bgBase, 0.6f), Radii.Md)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(userId, name, member?.avatarId ?: user?.avatarId, 40.dp)
        Column(Modifier.weight(1f)) {
            Txt(name, style = Nx.type.body.copy(fontWeight = FontWeight(500)), color = c.textStrong, maxLines = 1)
            Txt("@" + (user?.username ?: userId), style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1)
        }
    }
}

@Composable
private fun Hint(text: String, fine: Boolean = false) {
    Txt(
        text,
        style = if (fine) Nx.type.hint else Nx.type.bodySmall.copy(lineHeight = Nx.type.sp(19.6f)),
        color = Nx.colors.textMuted,
    )
}

@Composable
private fun MemberActionSheet(layer: Layer, serverId: String, userId: String, kind: MemberActions.Kind, close: () -> Unit) {
    val servers by Nexa.servers.byId.collectAsState()
    val st = servers[serverId] ?: return
    val member = st.members[userId]
    val user = Nexa.users.get(userId)
    val name = member?.nickname?.ifBlank { null } ?: Names.display(user)
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    fun run(job: suspend () -> Unit) {
        busy = true
        scope.launch {
            try {
                job()
                close()
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("server.memberAction.thatDidnTWork")), "error")
            } finally {
                busy = false
            }
        }
    }
    when (kind) {
        MemberActions.Kind.ROLES -> RolesSheet(layer, serverId, userId, name, close)
        MemberActions.Kind.TIMEOUT -> {
            val until = member?.timeoutUntil
            val timedOut = until != null && until > System.currentTimeMillis()
            var duration by remember { mutableLongStateOf(600L) }
            Sheet(
                layer,
                title = if (timedOut) t("server.memberAction.removeTimeoutFrom", "name" to name) else t("server.memberAction.timeOutNamed", "name" to name),
                heading = { fish.nexa.ui.chat.PersonHeading(fish.nexa.ui.chat.PersonWords(if (timedOut) t("server.memberAction.removeTimeoutFrom", "name" to fish.nexa.ui.chat.PERSON_SLOT) else t("server.memberAction.timeOutNamed", "name" to fish.nexa.ui.chat.PERSON_SLOT), listOf(userId to name), serverId)) },
                maxWidth = 440.dp,
                footer = {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                        NxButton(t("chat.editMessage.cancel"), close, kind = ButtonKind.GHOST)
                        NxButton(if (timedOut) t("server.memberAction.removeTimeout") else t("server.memberAction.timeOut"), {
                            run { MemberActions.timeout(serverId, userId, if (timedOut) null else System.currentTimeMillis() + duration * 1000) }
                        }, kind = ButtonKind.DANGER, loading = busy)
                    }
                },
            ) {
                MemberHead(serverId, userId, name)
                if (timedOut) Hint(t("server.memberAction.timedOutUntil", "when" to Time.full(until!!)))
                else {
                    Hint(t("server.memberAction.timedOutMembersCannotSendMessages"))
                    ChoiceList(t("server.memberAction.duration"), durations(), duration) { duration = it }
                }
            }
        }
        MemberActions.Kind.KICK, MemberActions.Kind.BAN -> {
            val ban = kind == MemberActions.Kind.BAN
            var reason by remember { mutableStateOf("") }
            var days by remember { mutableIntStateOf(0) }
            Sheet(
                layer,
                title = if (ban) t("server.memberAction.banNamed", "name" to name) else t("server.memberAction.kickNamed", "name" to name),
                heading = { fish.nexa.ui.chat.PersonHeading(fish.nexa.ui.chat.PersonWords(if (ban) t("server.memberAction.banNamed", "name" to fish.nexa.ui.chat.PERSON_SLOT) else t("server.memberAction.kickNamed", "name" to fish.nexa.ui.chat.PERSON_SLOT), listOf(userId to name), serverId)) },
                maxWidth = 440.dp,
                footer = {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                        NxButton(t("chat.editMessage.cancel"), close, kind = ButtonKind.GHOST)
                        NxButton(if (ban) t("server.members.ban") else t("server.members.kick"), {
                            val why = reason.trim().ifEmpty { null }
                            run { if (ban) MemberActions.ban(serverId, userId, why, days) else MemberActions.kick(serverId, userId, why) }
                        }, kind = ButtonKind.DANGER, loading = busy)
                    }
                },
            ) {
                MemberHead(serverId, userId, name)
                Hint(if (ban) t("server.memberAction.confirmBan", "name" to name) else t("server.memberAction.confirmKick", "name" to name))
                Hint(t("server.memberAction.theServerSEncryptionKeysRotate"), fine = true)
                NxTextField(reason, { reason = it.take(512) }, label = t("server.memberAction.reasonOptional"), capitalize = true)
                if (ban) ChoiceList(
                    t("server.memberAction.deleteMessageHistory"),
                    listOf(0 to t("server.memberAction.donTDeleteAny"), 1 to t("server.memberAction.previous24Hours"), 7 to t("server.memberAction.previous7Days")),
                    days,
                ) { days = it }
            }
        }
    }
}

/** Edit Roles: every role below your own to give or take, each in its colour; the change is made as it is ticked. */
@Composable
private fun RolesSheet(layer: Layer, serverId: String, userId: String, name: String, close: () -> Unit) {
    val c = Nx.colors
    val servers by Nexa.servers.byId.collectAsState()
    val st = servers[serverId] ?: return
    val member = st.members[userId]
    val meId = Nexa.users.meId
    val mine = if (meId != null) Nexa.servers.memberHighest(st, meId) else 0 to false
    val roles = Nexa.servers.rolesByPosition(st).filter { it.id != serverId }
    val optimistic = remember { mutableStateMapOf<String, Boolean>() }
    val scope = rememberCoroutineScope()
    fun toggle(roleId: String, on: Boolean) {
        optimistic[roleId] = on
        scope.launch {
            try {
                MemberActions.setRole(serverId, userId, roleId, on)
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("server.memberAction.couldNotChangeRoles")), "error")
            } finally {
                optimistic.remove(roleId)
            }
        }
    }
    Sheet(layer, title = t("server.memberAction.editRoles"), maxWidth = 440.dp, footer = {
        NxButton(t("modals.serverNotifications.done"), close, block = true)
    }) {
        MemberHead(serverId, userId, name)
        if (roles.isEmpty()) Hint(t("server.memberAction.thisServerHasNoRolesYet"))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            for (r in roles) {
                val on = optimistic[r.id] ?: (member?.roleIds?.contains(r.id) == true)
                val allowed = Perms.canManageRole(mine.first, mine.second, r.position)
                val interaction = remember { MutableInteractionSource() }
                val pressed by interaction.collectIsPressedAsState()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 46.dp)
                        .clip(Radii.Xs)
                        .background(if (pressed) c.bgHover else Color.Transparent)
                        .alpha(if (allowed) 1f else 0.5f)
                        .pressable(interaction, enabled = allowed, role = Role.Checkbox) { toggle(r.id, !on) }
                        .semantics { stateDescription = if (on) "checked" else "unchecked" }
                        .padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    PickBox(on)
                    Box(Modifier.size(12.dp).background(if (r.color != 0L) rgbColor(r.color) else c.textMuted, CircleShape))
                    Txt(r.name, style = Nx.type.body.copy(fontSize = Nx.type.sp(15f), fontWeight = FontWeight(500)), color = c.text, maxLines = 1)
                }
            }
        }
    }
}
