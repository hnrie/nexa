package fish.nexa.ui.dialogs

import fish.nexa.ui.components.Txt
import fish.nexa.ui.layers.openSheet

// still to be built in this branch; each is replaced by its own file
private fun pending(title: String) = openSheet("pending", title = title) { Txt(title) }

/** Every dialog the shell, the lists and the chat open (ModalHost's kinds), by name. */
object Dialogs {
    fun createServer() = pending("Create Your Server")
    /** A link to a server (landing in one of its channels), carrying its key unless told not to. */
    fun invite(serverId: String, channelId: String?) = open("invite") { layer, close -> InviteSheet(layer, serverId, channelId, close) }

    /**
     * An invite link opened in the app (`/invite/<code>`): where it leads, with
     * Join or Open. [hash] is the link's part after `#`, whose key unlocks the
     * history once joined.
     */
    fun openInvite(code: String, hash: String = "") = open("openInvite") { layer, close -> OpenInviteSheet(layer, code, hash, close) }
    fun createChannel(serverId: String, parentId: String?) = open("createChannel") { layer, close -> CreateChannelSheet(layer, serverId, parentId, close) }
    fun createCategory(serverId: String) = open("createCategory") { layer, close -> CreateCategorySheet(layer, serverId, close) }
    fun serverNotifications(serverId: String) = open("serverNotifications") { layer, close -> ServerNotificationsSheet(layer, serverId, close) }
    /** Your nickname in a server, or (with Manage Nicknames) someone else's. */
    fun serverProfile(serverId: String, userId: String? = null) = open("serverProfile") { layer, close -> ServerProfileSheet(layer, serverId, userId, close) }
    fun editGroup(channelId: String) = pending("Edit Group")
    fun groupInvite(channelId: String) = pending("Invite People")
    fun quickSwitcher() = pending("Find or Start a Conversation")
    fun createDm(initial: List<String> = emptyList(), groupId: String? = null) = openCreateDmDialog(initial, groupId)
    fun customStatus() = pending("Set a Custom Status")
    fun subchat(parentId: String, channelId: String?) = pending("Subchat")
    /** A channel's whole topic, which its header shows one line of. */
    fun channelTopic(channelId: String) = open("channelTopic") { layer, close -> ChannelTopicSheet(layer, channelId, close) }
}
