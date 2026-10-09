package fish.nexa.voice

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/**
 * Whether a call's pictures are on screen anywhere (the web's videoShown.ts):
 * a call view of it is open while the app is in front, or the app floats in
 * picture in picture. While they are not, the transport stops pulling
 * cameras and shares (SfuTransport.setVideoShown): a share watched and then
 * left behind, or a phone put away mid-call, otherwise kept bringing in video
 * nobody saw, on mobile data and battery. Voices, and a share's sound, keep
 * coming either way.
 */
object VideoShown {
    private val _open = MutableStateFlow<Map<String, Int>>(emptyMap())
    /** The call views open, by channel. */
    val open: StateFlow<Map<String, Int>> = _open

    /** A call view of `channelId` is on screen; call what this returns when it goes. */
    fun viewOpen(channelId: String): () -> Unit {
        _open.update { it + (channelId to (it[channelId] ?: 0) + 1) }
        var shut = false
        return {
            if (!shut) {
                shut = true
                _open.update {
                    val n = (it[channelId] ?: 1) - 1
                    if (n > 0) it + (channelId to n) else it - channelId
                }
            }
        }
    }

    /** Whether `channelId`'s pictures are on screen, given what is open, whether the app is in front, and whether it floats. */
    fun shown(open: Map<String, Int>, channelId: String, inFront: Boolean, floating: Boolean): Boolean =
        floating || (inFront && (open[channelId] ?: 0) > 0)
}
