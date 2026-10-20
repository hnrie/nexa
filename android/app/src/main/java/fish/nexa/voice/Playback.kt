package fish.nexa.voice

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.webrtc.AudioTrack
import org.webrtc.AudioTrackSink
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Other people's call audio (web/src/voice/playback.ts): each person's voice
 * at their own volume (up to 200 %), muted just here, silenced by deafen, and
 * held silent until its first frame is known to have opened; a screen share's
 * sound at its own volume, playing only while the share is watched. Who is
 * speaking comes from the level of what arrives.
 */
/** Everyone else's level while a Priority Speaker talks (playback.ts PRIORITY_DUCK): about 12 dB down. */
const val PRIORITY_DUCK = 0.25

class Playback(private val scope: CoroutineScope, private val onSpeaking: (String, Boolean) -> Unit) {
    /** Hears a remote track's decoded audio and keeps the loudest 10 ms since it was last asked. */
    private class LevelSink : AudioTrackSink {
        @Volatile private var peak = 0f

        override fun onData(audioData: ByteBuffer, bitsPerSample: Int, sampleRate: Int, numberOfChannels: Int, numberOfFrames: Int, absoluteCaptureTimestampMs: Long) {
            if (bitsPerSample != 16 || numberOfFrames <= 0) return
            val b = audioData.duplicate().order(ByteOrder.nativeOrder())
            val n = numberOfFrames * max(1, numberOfChannels)
            var sum = 0.0
            var count = 0
            for (i in 0 until n) {
                if (b.remaining() < 2) break
                val s = b.short / 32768.0
                sum += s * s
                count++
            }
            if (count == 0) return
            val level = minOf(1.0, sqrt(sum / count) * 4).toFloat()
            if (level > peak) peak = level
        }

        fun take(): Float {
            val p = peak
            peak = 0f
            return p
        }
    }

    private class VoiceOut(val track: AudioTrack, val sink: LevelSink, val gate: SpeakingGate = SpeakingGate(), var speaking: Boolean = false)

    private val voices = HashMap<String, VoiceOut>()
    private val screens = HashMap<String, AudioTrack>()
    private var outputMuted = false
    private var masterVolume = 100
    private var volumes = mapOf<String, Int>()
    private var localMutes = setOf<String>()
    /** People a moderator muted or deafened in the server: silent here too, should their app keep sending. */
    private val modMutes = HashSet<String>()
    /** People talking as Priority Speaker: while one of them is heard, everyone else is turned down. */
    private val priority = HashSet<String>()
    private var streamVolumes = mapOf<String, Int>()
    private var streamMutes = setOf<String>()
    private val watching = HashSet<String>()
    /** Sound held silent until it is known to be opened: "voice:<id>", "screen:<id>". */
    private val held = HashSet<String>()
    private var timer: Job? = null
    private var interrupted = false

    private fun effectiveGain(userId: String): Double {
        if (outputMuted || interrupted || userId in localMutes || userId in modMutes || "voice:$userId" in held) return 0.0
        return ((volumes[userId] ?: 100) / 100.0) * (masterVolume / 100.0) * duck(userId)
    }

    /** How far someone is turned down while a Priority Speaker other than them is talking. */
    private fun duck(userId: String): Double =
        if (priority.any { it != userId && voices[it]?.speaking == true }) PRIORITY_DUCK else 1.0

    private fun screenGain(userId: String): Double {
        if (userId !in watching || outputMuted || interrupted || userId in streamMutes || "screen:$userId" in held) return 0.0
        return ((streamVolumes[userId] ?: 100) / 100.0) * (masterVolume / 100.0) * duck("")
    }

    private fun apply() {
        for ((id, out) in voices) runCatching { out.track.setVolume(effectiveGain(id)) }
        for ((id, t) in screens) runCatching { t.setVolume(screenGain(id)) }
    }

    fun attachVoice(userId: String, track: AudioTrack, isHeld: Boolean) {
        if (voices[userId]?.track === track) return setHeld(userId, "voice", isHeld)
        detachVoice(userId)
        if (isHeld) held += "voice:$userId" else held -= "voice:$userId"
        val sink = LevelSink()
        runCatching { track.addSink(sink) }
        runCatching { track.setEnabled(true) }
        voices[userId] = VoiceOut(track, sink)
        runCatching { track.setVolume(effectiveGain(userId)) }
        ensureTimer()
    }

    fun detachVoice(userId: String) {
        val out = voices.remove(userId) ?: return
        runCatching { out.track.removeSink(out.sink) }
        if (out.speaking) {
            onSpeaking(userId, false)
            if (userId in priority) apply()
        }
    }

    fun attachScreenAudio(userId: String, track: AudioTrack, isHeld: Boolean) {
        if (screens[userId] === track) return setHeld(userId, "screen", isHeld)
        if (isHeld) held += "screen:$userId" else held -= "screen:$userId"
        screens[userId] = track
        runCatching { track.setEnabled(true) }
        runCatching { track.setVolume(screenGain(userId)) }
    }

    fun detachScreenAudio(userId: String) {
        screens.remove(userId)?.let { runCatching { it.setVolume(0.0) } }
    }

    /** Lets sound go (or holds it) once its first frame is known to open. */
    fun setHeld(userId: String, kind: String, on: Boolean) {
        val key = "$kind:$userId"
        if (on == key in held) return
        if (on) held += key else held -= key
        apply()
    }

    fun setVolumes(mix: Mix) {
        volumes = mix.volumes
        localMutes = mix.localMutes
        streamVolumes = mix.streamVolumes
        streamMutes = mix.streamMutes
        apply()
    }

    fun setWatching(userId: String, on: Boolean) {
        if (on) watching += userId else watching -= userId
        apply()
    }

    fun setOutputMuted(on: Boolean) {
        outputMuted = on
        apply()
    }

    /** A moderator's mute or deafen of someone, from the call's voice states. */
    fun setModMuted(userId: String, on: Boolean) {
        if (on == userId in modMutes) return
        if (on) modMutes += userId else modMutes -= userId
        apply()
    }

    /** Whether someone is talking as Priority Speaker now, from the call's voice states. */
    fun setPriority(userId: String, on: Boolean) {
        if (on == userId in priority) return
        if (on) priority += userId else priority -= userId
        apply()
    }

    /** Something else took the audio: quiet until it comes back. */
    fun setInterrupted(on: Boolean) {
        interrupted = on
        apply()
    }

    fun setMasterVolume(pct: Int) {
        masterVolume = pct.coerceIn(0, 200)
        apply()
    }

    /** Every 100 ms, lit while someone's sound can be heard; never for someone muted here or not yet opened. */
    private fun ensureTimer() {
        if (timer?.isActive == true) return
        timer = scope.launch {
            while (isActive) {
                delay(100)
                val now = System.currentTimeMillis()
                for ((id, out) in voices) {
                    val loud = out.gate.update(out.sink.take() > SpeakingGate.AUDIBLE_LEVEL, now)
                    val on = loud && id !in localMutes && id !in modMutes && "voice:$id" !in held
                    if (on != out.speaking) {
                        out.speaking = on
                        onSpeaking(id, on)
                        if (id in priority) apply()
                    }
                }
            }
        }
    }

    fun close() {
        timer?.cancel()
        for (id in voices.keys.toList()) detachVoice(id)
        screens.clear()
        held.clear()
    }
}

/** How long a ring stays lit after the last loud reading, and the level above which sound can be heard (speaking.ts). */
class SpeakingGate(private val holdMs: Long = HOLD_MS) {
    private var until = 0L

    fun update(loud: Boolean, now: Long): Boolean {
        if (loud) until = now + holdMs
        return now < until
    }

    fun reset() {
        until = 0
    }

    companion object {
        const val HOLD_MS = 600L
        const val AUDIBLE_LEVEL = 0.004f
    }
}
