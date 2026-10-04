package fish.nexa.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.update

/** A short message at the bottom of the screen. */
data class Toast(val id: Long, val text: String, val kind: String = "info")

/**
 * What the person is looking at, as the parts of the app that do not draw
 * anything need to know it: which conversation is open (so a message there is
 * read at once rather than counted), whether the app is on screen, and whether
 * the open conversation is scrolled to its newest message.
 */
class UiState {
    private val _activeChannel = MutableStateFlow<String?>(null)
    val activeChannel: StateFlow<String?> = _activeChannel
    private val _activeServer = MutableStateFlow<String?>(null)
    /** null is Home (direct messages and friends). */
    val activeServer: StateFlow<String?> = _activeServer
    private val _visible = MutableStateFlow(false)
    val visible: StateFlow<Boolean> = _visible
    private val _online = MutableStateFlow(true)
    /**
     * Whether the phone has a network at all. Android knows the moment it
     * goes; the socket only finds out when a heartbeat goes unanswered.
     */
    val online: StateFlow<Boolean> = _online
    private val atBottom = HashMap<String, Boolean>()

    private val _toasts = MutableStateFlow<List<Toast>>(emptyList())
    val toasts: StateFlow<List<Toast>> = _toasts
    private var nextToast = 1L

    private val _events = MutableSharedFlow<String>(extraBufferCapacity = 16)
    /** One-off requests for the UI ("open key change", ...). */
    val events: SharedFlow<String> = _events.asSharedFlow()

    fun open(serverId: String?, channelId: String?) {
        _activeServer.value = serverId
        _activeChannel.value = channelId
    }

    fun setVisible(v: Boolean) {
        _visible.value = v
    }

    fun setOnline(v: Boolean) {
        _online.value = v
    }

    @Synchronized fun setAtBottom(channelId: String, v: Boolean) {
        atBottom[channelId] = v
    }

    /** Open, on screen and scrolled to the newest message: what arrives is read as it arrives. */
    @Synchronized fun readingPresent(channelId: String): Boolean =
        _visible.value && _activeChannel.value == channelId && (atBottom[channelId] ?: true)

    fun toast(text: String, kind: String = "info") {
        val t = Toast(nextToast++, text, kind)
        _toasts.update { (it + t).takeLast(3) }
    }

    fun dismissToast(id: Long) = _toasts.update { list -> list.filter { it.id != id } }

    fun emit(event: String) {
        _events.tryEmit(event)
    }
}
