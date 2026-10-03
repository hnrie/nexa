package fish.nexa.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.IconButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.components.pressable
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.Sheet
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import fish.nexa.ui.theme.panel
import fish.nexa.voice.VoiceLocal
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The dock under the drawer: the call you are in (when you are) above your user panel. */
@Composable
fun Dock(modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        fish.nexa.ui.voice.VoiceStatus()
        UserPanel()
    }
}

/**
 * UserPanel.module.css on a phone: two rows in a raised panel. You (avatar
 * with your dot, name, status line) open the status sheet; under it the
 * microphone, headphones, activity and settings buttons, spread evenly.
 */
@Composable
fun UserPanel() {
    val c = Nx.colors
    val me by Nexa.users.me.collectAsState()
    val presences by Nexa.presence.byId.collectAsState()
    val local by VoiceLocal.state.collectAsState()
    val user = me ?: return
    val status = presences[user.id]?.status ?: user.presencePref.let { if (it == "invisible") "invisible" else "online" }
    val shape = Radii.Md
    Column(Modifier.fillMaxWidth().panel(shape, c, c.bgSurface).padding(4.dp)) {
        val interaction = remember { MutableInteractionSource() }
        val pressed by interaction.collectIsPressedAsState()
        Row(
            Modifier
                .fillMaxWidth()
                .height(44.dp)
                .background(if (pressed) c.bgHover else Color.Transparent, Radii.Sm)
                .pressable(interaction) { openStatusSheet() }
                .padding(start = 4.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Avatar(user.id, user.name, user.avatarId, 32.dp, status = status, speaking = fish.nexa.voice.Speaking.isSpeaking(user.id))
            Column(Modifier.weight(1f)) {
                Txt(user.name, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14.5f), fontWeight = FontWeight(650)), color = c.textStrong, maxLines = 1)
                Txt(customStatus(user.id) ?: presenceWord(status), style = Nx.type.hint.copy(lineHeight = Nx.type.sp(14.4f)), color = c.textMuted, maxLines = 1)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            DockButton(if (local.muted) "MicOff" else "Mic", if (local.muted) t("voice.voice.unmute") else t("voice.voice.mute"), off = local.muted) { VoiceLocal.toggleMute() }
            DockButton(if (local.deafened) "HeadphoneOff" else "Headphones", if (local.deafened) t("shell.user.undeafen") else t("shell.user.deafen"), off = local.deafened) { VoiceLocal.toggleDeafen() }
            val sharing = (Nexa.settings.doc.value["shareActivity"] as? kotlinx.serialization.json.JsonPrimitive)?.content != "false"
            DockButton("Gamepad2", t("settings.privacy.shareMyActivity"), off = !sharing) { Nexa.settings.patch(buildJsonObject { put("shareActivity", !sharing) }) }
            DockButton("Settings", t("settings.settings.userSettings"), off = false) { openSettings() }
        }
    }
}

fun presenceWord(status: String): String = when (status) {
    "online" -> t("shell.user.online")
    "idle" -> t("shell.user.idle")
    "dnd" -> t("shell.user.doNotDisturb")
    "invisible" -> t("shell.user.invisible")
    else -> t("chat.memberList.offline")
}

@Composable
private fun DockButton(icon: String, label: String, off: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    Box(
        Modifier
            .size(40.dp)
            .clip(Radii.Sm)
            .background(if (off) c.danger.copy(alpha = 0.16f) else Color.Transparent),
        contentAlignment = Alignment.Center,
    ) {
        IconButton(icon, label, onClick, tint = if (off) c.textDanger else c.icon, size = 40.dp, iconSize = 20.dp)
    }
}

/** The status choices (UserPanel status popover), as a sheet on a phone. */
fun openStatusSheet() {
    lateinit var layer: Layer
    layer = Layer("status") { close ->
        Sheet(layer, closeButton = false) {
            val c = Nx.colors
            val me = Nexa.users.me.value ?: return@Sheet
            val status = Nexa.presence.byId.value[me.id]?.status ?: "online"
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(4.dp)) {
                Avatar(me.id, me.name, me.avatarId, 40.dp, status = status)
                Column {
                    Txt(me.name, style = Nx.type.sheetTitle, color = c.textStrong, maxLines = 1)
                    Txt("@${me.username}", style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(13f)), color = c.textMuted, maxLines = 1)
                }
            }
            StatusOption("Pencil", if (me.statusText.isNotBlank() || me.statusEmoji.isNotBlank()) t("shell.user.editCustomStatus") else t("modals.customStatus.setACustomStatus"), null) {
                close()
                openCustomStatus()
            }
            for ((value, label, sub) in listOf(
                Triple("online", t("shell.user.online"), null),
                Triple("idle", t("shell.user.idle"), null),
                Triple("dnd", t("shell.user.doNotDisturb"), t("shell.user.youWillNotReceiveAnyDesktop")),
                Triple("invisible", t("shell.user.invisible"), t("shell.user.youWillAppearOfflineButKeep")),
            )) {
                StatusOption(null, label, sub, dot = value, chosen = me.presencePref == value || (value == "online" && me.presencePref.isBlank())) {
                    Nexa.session.send("presence", buildJsonObject { put("status", value) })
                    Nexa.users.setMe(me.copy(presencePref = value))
                    close()
                }
            }
            StatusOption("LogOut", t("settings.settings.logOut"), null, danger = true) {
                close()
                confirmLogout()
            }
        }
    }
    Layers.open(layer)
}

@Composable
private fun StatusOption(icon: String?, label: String, sub: String?, dot: String? = null, chosen: Boolean = false, danger: Boolean = false, onClick: () -> Unit) {
    val c = Nx.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        Modifier
            .fillMaxWidth()
            .clip(Radii.Sm)
            .background(if (pressed) c.brand.copy(alpha = 0.2f) else if (chosen) c.bgSelected else Color.Transparent)
            .pressable(interaction, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (icon != null) Icon(icon, if (danger) c.textDanger else c.icon, size = 16.dp, modifier = Modifier.padding(top = 2.dp))
        if (dot != null) fish.nexa.ui.components.PresenceDot(dot, 12.dp, Modifier.padding(top = 4.dp))
        Column(Modifier.weight(1f)) {
            Txt(label, style = Nx.type.bodySmall.copy(fontSize = Nx.type.sp(14f), fontWeight = FontWeight(550)), color = if (danger) c.textDanger else if (pressed) c.textStrong else c.textSubtle)
            if (sub != null) Txt(sub, style = Nx.type.hint, color = c.textMuted)
        }
    }
}

// ---------------------------------------------------------------------------

/** The member list as a drawer from the end side (servers and groups). */
@Composable
fun MemberDrawer() {
    val c = Nx.colors
    val shape = RoundedCornerShape(topStart = Radii.lg, bottomStart = Radii.lg)
    Box(Modifier.fillMaxSize().panel(shape, c, c.bgBase).statusBarsPadding().navigationBarsPadding()) {
        when (val r = Nav.route) {
            is Route.Server -> fish.nexa.ui.chat.MemberList(r.serverId, r.channelId)
            is Route.Dm -> Nexa.channels.get(r.channelId)?.takeIf { it.type == "group_dm" }?.let { fish.nexa.ui.chat.GroupMemberList(it) }
            else -> Unit
        }
    }
}

/** PageHeader.module.css: 52 high, the menu button first on a phone, the title, then actions. */
@Composable
fun PageHeader(title: String, icon: (@Composable () -> Unit)? = null, actions: @Composable () -> Unit = {}) {
    val c = Nx.colors
    Column {
        Row(
            Modifier.fillMaxWidth().height(52.dp).padding(start = 8.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            NavButton()
            icon?.invoke()
            Txt(title, style = Nx.type.headerTitle, color = c.textStrong, maxLines = 1, modifier = Modifier.weight(1f))
            actions()
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.borderSubtle))
    }
}

/** The hamburger that opens the drawer, with a dot when something waits elsewhere. */
@Composable
fun NavButton() {
    val c = Nx.colors
    val reads by Nexa.readStates.byChannel.collectAsState()
    @Suppress("UNUSED_VARIABLE") val touch = reads.size
    IconButton("Menu", t("shell.pageHeader.openNavigation"), { Nav.leftOpen = true }, tint = c.icon, size = 40.dp, iconSize = 22.dp)
}
