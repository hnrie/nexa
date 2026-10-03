// TEMPORARY: the call engine replaces these before release.
package fish.nexa.voice

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class LocalVoice(val muted: Boolean = false, val deafened: Boolean = false)

/** Mute and deafen, kept in memory only (stores/voiceLocal.ts: starts unmuted). */
object VoiceLocal {
    private val _state = MutableStateFlow(LocalVoice())
    val state: StateFlow<LocalVoice> = _state
    fun toggleMute() { _state.value = _state.value.copy(muted = !_state.value.muted, deafened = if (_state.value.muted) false else _state.value.deafened) }
    fun toggleDeafen() { val d = !_state.value.deafened; _state.value = LocalVoice(muted = d || (_state.value.muted && !_state.value.deafened), deafened = d) }
}

object Speaking { fun isSpeaking(userId: String): Boolean = false }
object Calls { fun join(channelId: String) {} }
