package fish.nexa.ui.dialogs

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.data.Invites
import fish.nexa.data.People
import fish.nexa.data.Send
import fish.nexa.net.PublicUser
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Spinner
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.shell.Names
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.brandGradient
import fish.nexa.ui.theme.mixOklab
import fish.nexa.ui.theme.ring
import fish.nexa.ui.theme.sunken
import kotlinx.coroutines.launch

private const val MAX_PICKED = 49

/** Friends, by display name (then username), the way the web lists them. */
fun friendsByName(): List<PublicUser> = Nexa.relationships.byId.value.values
    .filter { it.type == "friend" }
    .map { Nexa.users.get(it.user.id) ?: it.user }
    .sortedWith(compareBy(java.text.Collator.getInstance(fish.nexa.ui.I18n.locale).apply { strength = java.text.Collator.SECONDARY }) { Names.display(it) })

/**
 * CreateDMModal: one friend makes a DM, none or several a group of your own;
 * with a group given, the friends picked are added to it.
 */
fun openCreateDmDialog(initial: List<String> = emptyList(), groupId: String? = null) {
    lateinit var layer: Layer
    layer = Layer("createDM", replaces = null) { close -> CreateDmSheet(layer, initial, groupId, close) }
    Layers.open(layer)
}

@Composable
private fun CreateDmSheet(layer: Layer, initial: List<String>, groupId: String?, close: () -> Unit) {
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    val group = groupId?.let { Nexa.channels.get(it) }
    val adding = group != null
    val picked = remember { mutableStateListOf<String>().apply { addAll(initial.distinct().take(MAX_PICKED)) } }
    var query by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val already = group?.recipientIds?.toSet() ?: emptySet()
    val friends = remember(already) { friendsByName().filter { it.id !in already } }
    val q = query.trim().lowercase().removePrefix("@")
    val shown = if (q.isEmpty()) friends else friends.filter { it.username.lowercase().contains(q) || it.displayName.lowercase().contains(q) }
    val linkOnly = friends.filter { it.id in picked && it.groupLinkOnly }
    val makesGroup = adding || picked.size != 1
    val blocked = makesGroup && !adding && linkOnly.isNotEmpty()
    val joinReq = remember { JoinRequests(groupId ?: "") }

    fun submit() {
        if (busy) return
        busy = true
        scope.launch {
            try {
                if (adding) {
                    for (id in picked) Nexa.api.request("POST", "/channels/${group!!.id}/recipients/$id")
                    close()
                } else {
                    val ch = People.openConversation(picked.toList(), if (picked.size >= 2) name else null)
                    close()
                    Nav.go(Route.Dm(ch.id))
                    Nav.leftOpen = false
                }
            } catch (e: Exception) {
                Nexa.ui.toast(describeError(e, t("modals.createDM.couldNotCreateTheConversation")), "error")
            } finally {
                busy = false
            }
        }
    }

    val label = when {
        adding -> t("modals.createDM.addToGroup")
        picked.size == 1 -> t("modals.createDM.createDm")
        else -> t("modals.createDM.createGroupDm")
    }
    Sheet(layer, title = t("modals.createDM.selectFriends"), maxWidth = 440.dp, footer = {
        NxButton(label, ::submit, block = true, loading = busy, enabled = !blocked && (!adding || picked.isNotEmpty()))
    }) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Txt(
                when {
                    adding -> t("modals.createDM.addAnyoneYouAreFriendsWith")
                    picked.size >= MAX_PICKED -> t("modals.createDM.addTheRestWithAnInvite")
                    else -> t("modals.createDM.pickFriendsToStartAGroup")
                },
                style = Nx.type.hint, color = c.textMuted,
            )
            NxTextField(query, { query = it }, placeholder = t("modals.createDM.typeTheUsernameOfAFriend"), imeAction = ImeAction.Search)
            if (picked.isNotEmpty()) FlowRow(
                Modifier.fillMaxWidth().semantics { contentDescription = t("modals.createDM.chosen") },
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                for (id in picked.toList()) {
                    val u = Nexa.users.get(id) ?: continue
                    val n = Names.display(u)
                    Row(
                        Modifier
                            .height(36.dp)
                            .clip(RoundedCornerShape(999.dp))
                            .background(c.bgActive)
                            .pressable(remember(id) { MutableInteractionSource() }) { picked.remove(id) }
                            .semantics { contentDescription = t("modals.createDM.removeName", "name" to n) }
                            .padding(start = 4.dp, end = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Avatar(u.id, n, u.avatarId, 16.dp)
                        fish.nexa.ui.chat.PersonName(u.id, n, nameStyle = u.nameStyle, style = Nx.type.hint.copy(fontSize = Nx.type.sp(13f)), color = c.text, maxLines = 1)
                        Icon("X", c.textMuted, size = 12.dp)
                    }
                }
            }
            if (blocked) Row(
                Modifier
                    .fillMaxWidth()
                    .ring(Radii.Sm, c.borderSubtle)
                    .background(mixOklab(c.bgFloating, c.bgBase, 0.6f), Radii.Sm)
                    .padding(horizontal = 12.dp, vertical = 9.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon("Link", c.warning, size = 16.dp, modifier = Modifier.padding(top = 1.dp))
                fish.nexa.ui.chat.PersonText(linkOnly.first().id, t("modals.createDM.linkOnlyInGroup", "name" to fish.nexa.ui.chat.PERSON_SLOT), Names.display(linkOnly.first()), style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f), lineHeight = Nx.type.sp(18.2f)), color = c.text)
            }
            if (picked.size >= 2 && !adding) NxTextField(name, { name = it.take(100) }, placeholder = t("modals.createDM.groupNameOptional"), capitalize = true)
            Column(Modifier.fillMaxWidth().padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (shown.isEmpty()) Txt(
                    if (friends.isEmpty()) t("modals.createDM.addSomeFriendsFirst") else t("modals.createDM.noFriendsMatch"),
                    style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f)), color = c.textMuted,
                    align = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                )
                for (u in shown) FriendPickRow(
                    u,
                    checked = u.id in picked,
                    linkOnly = u.groupLinkOnly,
                    adding = adding,
                    joinState = joinReq.stateOf(u.id),
                    onJoinRequest = { joinReq.send(u.id, Names.display(u)) },
                ) {
                    if (u.id in picked) picked.remove(u.id) else if (picked.size < MAX_PICKED) picked += u.id
                }
            }
        }
    }
}

@Composable
private fun FriendPickRow(u: PublicUser, checked: Boolean, linkOnly: Boolean, adding: Boolean, joinState: String, onJoinRequest: () -> Unit, onToggle: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val n = Names.display(u)
    val canPick = !(linkOnly && adding)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(Radii.Xs)
            .background(if (pressed) c.bgHover else Color.Transparent)
            .then(if (canPick) Modifier.pressable(interaction, role = Role.Checkbox, onClick = onToggle).semantics { toggleableState = ToggleableState(checked) } else Modifier)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Avatar(u.id, n, u.avatarId, 32.dp)
        fish.nexa.ui.chat.PersonName(u.id, n, nameStyle = u.nameStyle, style = Nx.type.body.copy(fontWeight = FontWeight(500)), color = c.text, maxLines = 1, modifier = Modifier.weight(1f))
        when {
            linkOnly && adding -> JoinRequestButton(n, joinState, onJoinRequest)
            linkOnly -> LinkOnlyTag(n)
            else -> PickBox(checked)
        }
    }
}

/** A 20 dp box in the accent when ticked (the web's native checkbox in --brand). */
@Composable
fun PickBox(checked: Boolean) {
    val c = Nx.colors
    val shape = RoundedCornerShape(5.dp)
    Box(
        Modifier.size(20.dp).then(if (checked) Modifier.background(brandGradient(c), shape) else Modifier.sunken(shape, c).ring(shape, c.border, 1.5.dp)),
        contentAlignment = Alignment.Center,
    ) {
        if (checked) Icon("Check", c.onBrand, size = 14.dp, stroke = 3f)
    }
}

/** LinkOnlyTag: this friend joins group chats only from a link sent to them. */
@Composable
fun LinkOnlyTag(name: String) {
    val c = Nx.colors
    val tip = t("groupAdd.linkOnlyTip", "name" to name)
    Row(
        Modifier
            .height(36.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(c.bgBase)
            .pressable(remember { MutableInteractionSource() }) { Nexa.ui.toast(tip) }
            .semantics { contentDescription = "${t("groupAdd.linkOnly")}. $tip" }
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon("Link", c.textMuted, size = 14.dp)
        Txt(t("groupAdd.linkOnly"), style = Nx.type.hint.copy(fontWeight = FontWeight(600)), color = c.textMuted)
    }
}

/** JoinRequestButton: sends a link-only friend this group's link in a DM, instead of adding them. */
@Composable
fun JoinRequestButton(name: String, state: String, onSend: () -> Unit) {
    val c = Nx.colors
    val done = state == "sent"
    val busy = state == "sending"
    Box(Modifier.semantics {
        contentDescription = if (done) t("groupAdd.joinRequest.sentTo", "name" to name) else t("groupAdd.joinRequest.sendTo", "name" to name)
        if (done) liveRegion = LiveRegionMode.Polite
    }) {
        if (busy) Box(Modifier.widthIn(min = 72.dp).height(32.dp), contentAlignment = Alignment.Center) { Spinner(size = 16.dp) }
        else NxButton(
            if (done) t("groupAdd.joinRequest.sent") else t("groupAdd.joinRequest.send"),
            { if (!done) onSend() },
            kind = if (done) ButtonKind.GHOST else ButtonKind.SECONDARY,
            size = ButtonSize.SM,
            icon = if (done) "Check" else "Link",
        )
    }
}

/**
 * useJoinRequests: one link for the group, made on first use, sent to each
 * link-only friend in a DM with a line saying what it is.
 */
class JoinRequests(private val groupId: String, private val linkOf: (suspend () -> String)? = null) {
    private val states = androidx.compose.runtime.mutableStateMapOf<String, String>()
    private var link: String? = null

    fun stateOf(userId: String) = states[userId] ?: "idle"

    fun send(userId: String, name: String) {
        if (stateOf(userId) != "idle") return
        states[userId] = "sending"
        Nexa.scope.launch {
            try {
                // the link the group's invite sheet shows, when it is open; else one made for these requests
                val url = linkOf?.invoke() ?: link ?: Invites.url(Invites.create(groupId, 604800, 0).code, Invites.keyOf(groupId)).also { link = it }
                val dm = People.openDm(userId)
                val groupName = Nexa.channels.get(groupId)?.name?.trim().orEmpty()
                val literal = groupName.replace(Regex("[\\\\*_~|`<>\\[\\]]")) { "\\" + it.value }
                val intro = if (groupName.isNotEmpty()) t("groupAdd.joinRequest.message", "name" to literal) else t("groupAdd.joinRequest.messageUnnamed")
                Send.sendMessage(dm.id, "$intro\n$url")
                states[userId] = "sent"
            } catch (e: Exception) {
                states.remove(userId)
                Nexa.ui.toast(describeError(e, t("groupAdd.joinRequest.failed", "name" to name)), "error")
            }
        }
    }
}
