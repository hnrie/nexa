package xyz.evilion.chat.ui

import kotlinx.coroutines.flow.MutableStateFlow

/** Where the app is. The shell is one screen; everything else is a layer over it. */
sealed interface Route {
    data class Chat(val serverId: String?, val channelId: String?) : Route
    data object Friends : Route
    data class Settings(val page: String = "root") : Route
    data class ServerSettings(val serverId: String, val page: String = "overview") : Route
    data class Invite(val code: String, val fragment: String? = null) : Route
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

/**
 * A message the app has been asked to go to.
 *
 * `at` is only there to make two requests for the same message different
 * values, so asking twice scrolls twice instead of doing nothing the second
 * time.
 */
data class Jump(val channelId: String, val messageId: String, val at: Long = System.currentTimeMillis())

object Nav {
    val route = MutableStateFlow<Route>(Route.Chat(null, null))
    val layers = MutableStateFlow<List<Layer>>(emptyList())
    val jump = MutableStateFlow<Jump?>(null)

    /** Where `back` returns to; one deep, which is all any screen here needs. */
    private var previous: Route = Route.Chat(null, null)

    fun go(next: Route) {
        if (next != route.value) previous = route.value
        route.value = next
    }

    /**
     * Back to whatever was open before this route.
     *
     * A sticker-pack link opened from a conversation used to close onto the
     * empty "No conversation open" screen, which is not where anybody was.
     */
    fun back() {
        route.value = previous
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

    /**
     * Goes to a message: the reply line above a message, a search result and a
     * pinned message all point at one, and all three used to be inert.
     * `ChatScreen` picks this up, fetches back to it if it is not in memory,
     * scrolls to it and flashes it, which is what the web client does.
     */
    fun jumpTo(channelId: String, messageId: String) {
        jump.value = Jump(channelId, messageId)
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
