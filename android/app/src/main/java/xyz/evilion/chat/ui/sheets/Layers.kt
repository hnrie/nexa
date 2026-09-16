package xyz.evilion.chat.ui.sheets

import androidx.compose.runtime.Composable
import xyz.evilion.chat.ui.Layer
import xyz.evilion.chat.ui.Nav
import xyz.evilion.chat.ui.voice.CallScreen

/** Whatever is on top of the shell right now, in the order it was opened. */
@Composable
fun AppLayers(layers: List<Layer>) {
    for (layer in layers) {
        when (layer) {
            is Layer.Profile -> ProfileSheet(layer.userId, layer.serverId) { Nav.popTo(layer) }
            is Layer.Members -> MembersSheet(layer.channelId) { Nav.popTo(layer) }
            is Layer.Pins -> PinsSheet(layer.channelId) { Nav.popTo(layer) }
            is Layer.Search -> SearchSheet(layer.channelId) { Nav.popTo(layer) }
            is Layer.ChannelSettings -> ChannelSettingsSheet(layer.channelId) { Nav.popTo(layer) }
            is Layer.InviteSheet -> InviteSheet(layer.channelId) { Nav.popTo(layer) }
            is Layer.ImageViewer -> ImageViewerLayer(layer.url, layer.name) { Nav.popTo(layer) }
            is Layer.Call -> CallScreen(layer.channelId, layer.video) { Nav.popTo(layer) }
            is Layer.CreateServer -> CreateServerSheet { Nav.popTo(layer) }
            is Layer.NewMessage -> NewMessageSheet { Nav.popTo(layer) }
        }
    }
}
