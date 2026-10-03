package fish.nexa.ui.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fish.nexa.Nexa
import fish.nexa.net.Channel
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.NxTextField
import fish.nexa.ui.components.Txt
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.nav.Nav
import fish.nexa.ui.nav.Route
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import kotlinx.coroutines.launch

/**
 * ConfirmModal: a question, what it does, and the one button that does it
 * (red when it cannot be undone), with Cancel beside it.
 */
fun confirm(title: String, body: String, confirmLabel: String, danger: Boolean = true, onConfirm: suspend () -> Unit) {
    openSheet("confirm", title = title, footer = { close ->
        var busy by remember { mutableStateOf(false) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, androidx.compose.ui.Alignment.End)) {
            NxButton(t("chat.editMessage.cancel"), close, kind = ButtonKind.GHOST)
            NxButton(confirmLabel, {
                busy = true
                Nexa.scope.launch {
                    try {
                        onConfirm()
                        close()
                    } catch (e: Exception) {
                        Nexa.ui.toast(describeError(e), "error")
                    } finally {
                        busy = false
                    }
                }
            }, kind = if (danger) ButtonKind.DANGER else ButtonKind.PRIMARY, loading = busy)
        }
    }) {
        Txt(body, style = Nx.type.body.copy(lineHeight = Nx.type.sp(23f)), color = Nx.colors.text)
    }
}

fun confirmLeaveServer(serverId: String) {
    val name = Nexa.servers.get(serverId)?.server?.name ?: ""
    confirm(t("sidebar.serverMenu.leaveNamed", "name" to name), t("sidebar.serverMenu.areYouSureYouWantToLeave", "name" to name), t("sidebar.serverMenu.leaveServer")) {
        Nexa.api.request("POST", "/servers/$serverId/leave")
        Nexa.servers.remove(serverId)
        Nav.go(Route.Friends, replace = true)
    }
}

fun confirmLeaveGroup(channelId: String) {
    val ch = Nexa.channels.get(channelId) ?: return
    confirm(t("sidebar.dmMenu.leaveNamed", "name" to Names.channel(ch)), t("sidebar.dmMenu.youStopReceivingMessagesFromThis"), t("chat.groupMemberMenu.leaveGroup")) {
        Nexa.api.request("DELETE", "/channels/$channelId")
        if ((Nav.route as? Route.Dm)?.channelId == channelId) Nav.go(Route.Friends, replace = true)
    }
}

fun confirmDeleteChannel(ch: Channel) {
    if (ch.isCategory) confirm(t("sidebar.serverMenu.deleteCategory"), t("sidebar.serverMenu.deleteTheCategoryNamed", "name" to ch.name), t("sidebar.serverMenu.deleteCategory")) {
        Nexa.api.request("DELETE", "/channels/${ch.id}")
    } else confirm(t("sidebar.serverMenu.deleteChannel"), t("sidebar.serverMenu.areYouSureYouWantToDeleteChannel", "name" to ch.name), t("sidebar.serverMenu.deleteChannel")) {
        Nexa.api.request("DELETE", "/channels/${ch.id}")
    }
}

fun confirmLogout() {
    confirm(t("settings.settings.logOut"), t("settings.settings.areYouSureYouWantTo"), t("settings.settings.logOut")) {
        Nexa.auth.logout()
        Nav.reset()
    }
}

// The dialogs below open the screens that are built in their own files.
fun openCreateServer() = fish.nexa.ui.dialogs.Dialogs.createServer()
fun openInvite(serverId: String, channelId: String?) = fish.nexa.ui.dialogs.Dialogs.invite(serverId, channelId)
fun openServerSettings(serverId: String) = fish.nexa.ui.server.ServerSettings.open(serverId)
fun openCreateChannel(serverId: String, parentId: String?) = fish.nexa.ui.dialogs.Dialogs.createChannel(serverId, parentId)
fun openCreateCategory(serverId: String) = fish.nexa.ui.dialogs.Dialogs.createCategory(serverId)
fun openServerNotifications(serverId: String) = fish.nexa.ui.dialogs.Dialogs.serverNotifications(serverId)
fun openServerProfile(serverId: String) = fish.nexa.ui.dialogs.Dialogs.serverProfile(serverId)
fun openEditGroup(channelId: String) = fish.nexa.ui.dialogs.Dialogs.editGroup(channelId)
fun openGroupInvite(channelId: String) = fish.nexa.ui.dialogs.Dialogs.groupInvite(channelId)
fun openProfile(userId: String) = fish.nexa.ui.profile.Profiles.open(userId)
fun openChannelSettings(channelId: String) = fish.nexa.ui.server.ChannelSettings.open(channelId)
fun openQuickSwitcher() = fish.nexa.ui.dialogs.Dialogs.quickSwitcher()
fun openCreateDm() = fish.nexa.ui.dialogs.Dialogs.createDm()
fun openCustomStatus() = fish.nexa.ui.dialogs.Dialogs.customStatus()
fun openSettings() = fish.nexa.ui.settings.Settings.open()
fun joinVoice(channelId: String) = fish.nexa.voice.Calls.join(channelId)
