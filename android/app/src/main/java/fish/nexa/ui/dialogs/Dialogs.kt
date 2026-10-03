package fish.nexa.ui.dialogs

import fish.nexa.ui.components.Txt
import fish.nexa.ui.layers.openSheet

// still to be built in this branch; each is replaced by its own file
private fun pending(title: String) = openSheet("pending", title = title) { Txt(title) }

/** Every dialog the shell, the lists and the chat open (ModalHost's kinds), by name. */
object Dialogs {
    fun createServer() = pending("Create Your Server")
    fun invite(serverId: String, channelId: String?) = pending("Invite People")
    fun createChannel(serverId: String, parentId: String?) = pending("Create Channel")
    fun createCategory(serverId: String) = pending("Create Category")
    fun serverNotifications(serverId: String) = pending("Notification Settings")
    fun serverProfile(serverId: String, userId: String? = null) = pending("Edit Server Profile")
    fun editGroup(channelId: String) = pending("Edit Group")
    fun groupInvite(channelId: String) = pending("Invite People")
    fun quickSwitcher() = pending("Find or Start a Conversation")
    fun createDm(initial: List<String> = emptyList(), groupId: String? = null) = openCreateDmDialog(initial, groupId)
    fun customStatus() = pending("Set a Custom Status")
    fun subchat(parentId: String, channelId: String?) = pending("Subchat")
}
