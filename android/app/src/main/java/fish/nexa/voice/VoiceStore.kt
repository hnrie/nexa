package fish.nexa.voice

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import fish.nexa.Nexa
import fish.nexa.net.VoiceState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import org.json.JSONObject
import org.webrtc.VideoTrack

/** How one person in the call is reached (RTCPeerConnectionState). */
enum class PeerState { NEW, CONNECTING, CONNECTED, DISCONNECTED, FAILED, CLOSED }

/** This device's own link to the call: coming up the first time, up, or down and on its way back. */
enum class CallConnection { CONNECTING, CONNECTED, RECONNECTING }

/** The call's round trip (ms) and the share of packets lost since the last reading. */
@Immutable
data class Quality(val rtt: Double, val loss: Double) {
    /** good, ok or bad, as the web grades a call's link. */
    val level: String get() = if (loss > 0.05 || rtt > 400) "bad" else if (rtt > 150) "ok" else "good"
}

/** An incoming call ringing on this device. */
@Immutable
data class Ring(val from: String, val at: Long)

/**
 * The call this device is in, as the screen shows it (web stores/voice.ts):
 * reset when the call ends. Mute and deafen live in [VoiceLocal]; volumes and
 * local mutes, which outlast a call, in [Voice.mix].
 */
@Immutable
data class CallState(
    /** This device's state as the server acknowledged it; null until it does. */
    val mine: VoiceState? = null,
    /** The channel being joined, before the server confirms. */
    val joining: String? = null,
    val peers: Map<String, PeerState> = emptyMap(),
    /** Whose voice is arriving. */
    val remoteAudio: Set<String> = emptySet(),
    val remoteVideo: Map<String, VideoTrack> = emptyMap(),
    val remoteScreen: Map<String, VideoTrack> = emptyMap(),
    val localVideo: VideoTrack? = null,
    /** The camera faces the person (its picture is shown mirrored, as a mirror would). */
    val localFront: Boolean = true,
    val localScreen: VideoTrack? = null,
    val quality: Quality? = null,
    /** A tile up front: "user:camera" or "user:screen". */
    val focused: String? = null,
    /** Whose screen shares this device chose to watch. */
    val watching: Set<String> = emptySet(),
    /** Pictures over the size cap, as "user:video" or "user:screen". */
    val tooLarge: Set<String> = emptySet(),
    val error: String? = null,
    /** The call started, but the microphone never opened. */
    val micBlocked: Boolean = false,
    /** The conversation this device is calling, while nobody has picked up. */
    val calling: String? = null,
    val connection: CallConnection? = null,
    /** A conversation's call everyone else left; it hangs up by itself unless someone comes back. */
    val leftAlone: String? = null,
    /** Push to talk's button is held. */
    val pttHeld: Boolean = false,
    /** Something else took the audio (a phone call, an alarm); the call is quiet both ways until it comes back. */
    val interrupted: Boolean = false,
)

/** Volumes and local mutes, kept per account and across calls. */
@Immutable
data class Mix(
    val volumes: Map<String, Int> = emptyMap(),
    val streamVolumes: Map<String, Int> = emptyMap(),
    val localMutes: Set<String> = emptySet(),
    val streamMutes: Set<String> = emptySet(),
)

object Voice {
    val state = MutableStateFlow(CallState())
    val ringing = MutableStateFlow<Map<String, Ring>>(emptyMap())
    val mix = MutableStateFlow(Mix())

    /** My input level, 0..1, for the meters. */
    val level = MutableStateFlow(0f)

    private val _speaking = MutableStateFlow<Set<String>>(emptySet())
    val speaking: StateFlow<Set<String>> = _speaking

    fun update(fn: (CallState) -> CallState) = state.update(fn)

    fun setSpeaking(userId: String, on: Boolean) = _speaking.update { s ->
        if (on == userId in s) s else if (on) s + userId else s - userId
    }

    fun clearSpeaking(userId: String? = null) = _speaking.update { if (userId == null) emptySet() else it - userId }

    /** Everything that belonged to the call; mute, deafen, volumes and rings stay. */
    fun resetSession() {
        state.value = CallState()
        _speaking.value = emptySet()
        level.value = 0f
    }

    fun setRinging(channelId: String, from: String?) = ringing.update { r ->
        if (from == null) r - channelId else r + (channelId to Ring(from, System.currentTimeMillis()))
    }

    fun setWatching(userId: String, on: Boolean) = state.update { s ->
        val key = "$userId:screen"
        if (on) s.copy(watching = s.watching + userId, focused = key)
        else s.copy(watching = s.watching - userId, focused = if (s.focused == key) null else s.focused)
    }

    fun removePeer(userId: String) = state.update { s ->
        s.copy(
            peers = s.peers - userId,
            remoteAudio = s.remoteAudio - userId,
            remoteVideo = s.remoteVideo - userId,
            remoteScreen = s.remoteScreen - userId,
            watching = s.watching - userId,
            tooLarge = s.tooLarge - "$userId:video" - "$userId:screen",
            focused = if (s.focused?.startsWith("$userId:") == true) null else s.focused,
        )
    }.also { clearSpeaking(userId) }

    // --- per-account volumes ------------------------------------------------

    private var owner: String? = null
    private fun prefs() = Nexa.app.getSharedPreferences("voice", Context.MODE_PRIVATE)

    private fun load(kind: String, userId: String?): Map<String, Int> {
        if (userId == null) return emptyMap()
        val raw = prefs().getString("$kind:$userId", null) ?: return emptyMap()
        return try {
            val o = JSONObject(raw)
            o.keys().asSequence().associateWith { o.optInt(it, 100).coerceIn(0, 200) }
        } catch (_: Exception) {
            emptyMap()
        }
    }

    private fun save(kind: String, values: Map<String, Int>) {
        val id = owner ?: return
        prefs().edit().putString("$kind:$id", JSONObject(values).toString()).apply()
    }

    /** Signing in (or out) swaps in that account's own volume choices. */
    fun useAccount(userId: String?) {
        if (userId == owner) return
        owner = userId
        mix.value = Mix(volumes = load("voiceVolumes", userId), streamVolumes = load("voiceStreamVolumes", userId))
    }

    fun setVolume(userId: String, pct: Int) {
        mix.update { it.copy(volumes = it.volumes + (userId to pct.coerceIn(0, 200))) }
        save("voiceVolumes", mix.value.volumes)
    }

    fun setStreamVolume(userId: String, pct: Int) {
        mix.update { it.copy(streamVolumes = it.streamVolumes + (userId to pct.coerceIn(0, 200))) }
        save("voiceStreamVolumes", mix.value.streamVolumes)
    }

    fun setLocalMute(userId: String, on: Boolean) = mix.update { it.copy(localMutes = if (on) it.localMutes + userId else it.localMutes - userId) }
    fun setStreamMute(userId: String, on: Boolean) = mix.update { it.copy(streamMutes = if (on) it.streamMutes + userId else it.streamMutes - userId) }

    // --- who is where ---------------------------------------------------------

    /** A channel's participants in join order (participantsOf). */
    fun participants(channelId: String, byUser: Map<String, VoiceState> = Nexa.voiceStates.byUser.value): List<VoiceState> =
        byUser.values.filter { it.channelId == channelId }.sortedWith(compareBy<VoiceState>({ it.joinedAt }, { it.userId }))

    fun channelOf(userId: String): String? = Nexa.voiceStates.byUser.value[userId]?.channelId

    /** Someone in a call through a guest link. */
    fun isGuest(v: VoiceState?): Boolean = v != null && (v.guest != null || ((v.user?.flags ?: 0L) and GUEST_FLAG) != 0L)

    const val GUEST_FLAG = 8L

    /** The voice settings, as the synced settings hold them. */
    val settings: JsonObject get() = Nexa.settings.voice
    fun setting(key: String): String? = (settings[key] as? JsonPrimitive)?.content
    fun settingInt(key: String, def: Int): Int = (settings[key] as? JsonPrimitive)?.intOrNull ?: def
    fun settingBool(key: String, def: Boolean): Boolean = (settings[key] as? JsonPrimitive)?.content?.toBooleanStrictOrNull() ?: def
}

/** Mute and deafen belong to the app, not to a call: leaving keeps them (stores/voiceLocal.ts). */
data class LocalVoice(val muted: Boolean = false, val deafened: Boolean = false)

object VoiceLocal {
    private val _state = MutableStateFlow(LocalVoice())
    val state: StateFlow<LocalVoice> = _state

    /** Deafening also mutes, so unmuting undeafens too, or the mic would show on while nothing is sent or heard. */
    fun toggleMute() = _state.update { if (it.muted) LocalVoice(muted = false, deafened = false) else it.copy(muted = true) }

    fun toggleDeafen() = _state.update { if (it.deafened) LocalVoice(muted = false, deafened = false) else LocalVoice(muted = true, deafened = true) }

    fun setMuted(on: Boolean) = _state.update { it.copy(muted = on) }
}

/** Who is speaking now, from what this device hears (voice.md 7.2). */
object Speaking {
    @Composable
    fun isSpeaking(userId: String): Boolean {
        val set by Voice.speaking.collectAsState()
        return userId in set
    }
}
