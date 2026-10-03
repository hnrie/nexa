// TEMPORARY: replaced by the real server and channel settings screens before release.
package fish.nexa.ui.server

import fish.nexa.ui.components.Txt
import fish.nexa.ui.layers.openSheet

object ServerSettings { fun open(serverId: String) = openSheet("pending", title = "Server Settings") { Txt("Server Settings") } }
object ChannelSettings { fun open(channelId: String) = openSheet("pending", title = "Edit Channel") { Txt("Edit Channel") } }
