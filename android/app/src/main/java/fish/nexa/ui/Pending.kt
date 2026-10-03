// TEMPORARY entry points for screens still being built. Every object in this file is replaced by
// its real implementation in its own package before release (tracked in the progress log).
package fish.nexa.ui.dialogs

import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.components.Txt

private fun pending(title: String) = openSheet("pending", title = title) { Txt(title) }

object Dialogs {
    fun createServer() = pending("Create Your Server")
    fun invite(serverId: String, channelId: String?) = pending("Invite People")
    fun createChannel(serverId: String, parentId: String?) = pending("Create Channel")
    fun createCategory(serverId: String) = pending("Create Category")
    fun serverNotifications(serverId: String) = pending("Notification Settings")
    fun serverProfile(serverId: String) = pending("Edit Server Profile")
    fun editGroup(channelId: String) = pending("Edit Group")
    fun groupInvite(channelId: String) = pending("Invite People")
    fun quickSwitcher() = pending("Find or Start a Conversation")
    fun createDm() = pending("Select Friends")
    fun customStatus() = pending("Set a Custom Status")
}
