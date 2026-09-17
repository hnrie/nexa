package xyz.evilion.chat.ui

import kotlinx.coroutines.flow.MutableStateFlow

/** Where the app is. The shell is one screen; everything else is a layer over it. */
sealed interface Route {
    data class Chat(val serverId: String?, val channelId: String?) : Route
    data object Friends : Route
    data class Settings(val page: String = "root") : Route
    data class ServerSettings(val serverId: String, val page: String = "overview") : Route
    data class Invite(val code: String, val fragment: String? = null) : Route
    data class GuestCall(val code: String) : Route
    data class StickerPack(val id: String) : Route
}

/** Sheets and overlays that sit above the current route. */
sealed interface Layer {
    data class Profile(val userId: String, val serverId: String? = null) : Layer
    data class Members(val channelId: String) : Layer
    data class Pins(val channelId: String) : Layer
    data class Search(val channelId: String) : Layer
    data class ChannelSettings(val channelId: String) : Layer
    data class InviteSheet(val channelId: String) : Layer
    data class ImageViewer(val url: String, val name: String) : Layer
    /** `video` starts the call with the camera already on, as the web's video button does. */
    data class Call(val channelId: String, val video: Boolean = false) : Layer
    data object CreateServer : Layer
    data object NewMessage : Layer
}

object Nav {
    val route = MutableStateFlow<Route>(Route.Chat(null, null))
    val layers = MutableStateFlow<List<Layer>>(emptyList())

    fun go(next: Route) {
        route.value = next
    }

    fun openChannel(serverId: String?, channelId: String?) {
        route.value = Route.Chat(serverId, channelId)
    }

    /**
     * Opens a layer, unless one of the same kind is already open.
     *
     * Two call screens are two full-screen dialogs over one call, each with its
     * own renderers, each joining and each starting the foreground service —
     * and closing one leaves the other. Tapping the phone icon and then the
     * video icon was enough, because they differ only in a flag.
     */
    fun push(layer: Layer) {
        val open = layers.value
        if (open.any { it.sameKind(layer) }) return
        layers.value = open + layer
    }

    /** Whether two layers are the same thing on screen, ignoring how it was opened. */
    private fun Layer.sameKind(other: Layer): Boolean = when {
        this is Layer.Call && other is Layer.Call -> channelId == other.channelId
        else -> this == other
    }

    fun pop() {
        layers.value = layers.value.dropLast(1)
    }

    fun popTo(layer: Layer) {
        layers.value = layers.value.filterNot { it == layer }
    }

    fun clearLayers() {
        layers.value = emptyList()
    }
}
