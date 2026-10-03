package fish.nexa.voice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import fish.nexa.Nexa
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Debug builds only: what the call tests drive through adb.
 *
 *   am broadcast -a fish.nexa.debug.CALL --es channel ID [--ez video true]
 *   am broadcast -a fish.nexa.debug.LEAVE
 *   am broadcast -a fish.nexa.debug.TONE --ei mode 0..3      (the microphone replaced: 1 tone, 2 tone in phrases, 3 noise)
 *   am broadcast -a fish.nexa.debug.CAMERA
 *   am broadcast -a fish.nexa.debug.WATCH --es user ID --ez on true
 *   am broadcast -a fish.nexa.debug.STATS                    (logged as NexaCallTest)
 *   am broadcast -a fish.nexa.debug.SEAL                     (the frame crypto against the web's vectors)
 *   am broadcast -a fish.nexa.debug.WRONGKEY --ez on true    (this call's frames sealed and opened with wrong keys)
 */
class CallTestHooks : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            "fish.nexa.debug.CALL" -> intent.getStringExtra("channel")?.let { Calls.join(it, intent.getBooleanExtra("video", false)) }
            "fish.nexa.debug.LEAVE" -> Calls.leave()
            "fish.nexa.debug.TONE" -> Denoise.tone = intent.getIntExtra("mode", 0)
            "fish.nexa.debug.CAMERA" -> Calls.toggleCamera()
            "fish.nexa.debug.WATCH" -> intent.getStringExtra("user")?.let { Calls.setWatching(it, intent.getBooleanExtra("on", true)) }
            "fish.nexa.debug.STATS" -> Calls.scope.launch { Log.i(TAG, stats().toString()) }
            "fish.nexa.debug.SEAL" -> Log.i(TAG, "seal " + vectors())
            "fish.nexa.debug.WRONGKEY" -> Calls.scope.launch { Log.i(TAG, "wrongkey " + wrongKeys(intent.getBooleanExtra("on", true))) }
        }
    }

    private suspend fun stats(): JSONObject {
        val st = Voice.state.value
        val s = Engine.current()
        val o = JSONObject()
        o.put("channel", s?.channelId)
        o.put("mine", st.mine?.channelId)
        o.put("connection", st.connection?.name)
        o.put("sfu", s?.transport?.throughSfu)
        o.put("micBlocked", st.micBlocked)
        o.put("muted", VoiceLocal.state.value.muted)
        o.put("deafened", VoiceLocal.state.value.deafened)
        o.put("peers", JSONObject(st.peers.mapValues { it.value.name }))
        o.put("remoteAudio", JSONArray(st.remoteAudio.toList()))
        o.put("remoteVideo", JSONArray(st.remoteVideo.keys.toList()))
        o.put("remoteScreen", JSONArray(st.remoteScreen.keys.toList()))
        o.put("watching", JSONArray(st.watching.toList()))
        o.put("localVideo", st.localVideo != null)
        o.put("localScreen", st.localScreen != null)
        o.put("speaking", JSONArray(Voice.speaking.value.toList()))
        o.put("level", Denoise.level.toDouble())
        o.put("enhanced", Denoise.enhanced)
        o.put("tone", Denoise.tone)
        o.put("quality", st.quality?.let { JSONObject().put("rtt", it.rtt).put("loss", it.loss) })
        o.put("crypto", s?.transport?.cryptoStats()?.let { JSONArray(it.toList()) })
        o.put("route", AudioRoute.current.value?.kind?.name)
        o.put("ringing", JSONArray(Voice.ringing.value.keys.toList()))
        o.put("me", Nexa.users.meId)
        return o
    }

    /** Swaps the SFU call's keys for wrong ones with the same indices (or back), so nothing either side seals can be opened. */
    private fun wrongKeys(on: Boolean): String {
        val s = Engine.current() ?: return "no call"
        val t = s.transport as? SfuTransport ?: return "not through the SFU"
        val k = CallKeys.keysFor(s.channelId) ?: return "no keys"
        val f = SfuTransport::class.java.getDeclaredField("crypto").apply { isAccessible = true }
        val keys = if (on) k.keys.map { (i, b) -> i to ByteArray(b.size) { (b[it].toInt() xor 0x5a).toByte() } } else k.keys
        (f.get(t) as FrameKeys).set(VoiceKeys(keys, k.send, k.version))
        return if (on) "wrong keys in" else "right keys back"
    }

    /** voice.md 5.10: the same key, index and iv must seal to the web's bytes, and open the web's. */
    private fun vectors(): String {
        if (!FrameCryptoNative.loaded) return "the native library did not load"
        fun unhex(h: String) = ByteArray(h.length / 2) { h.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
        fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
        val key = unhex("b12789f29993834f2127e2379c3be51b0351a9ddae44147d3570de350a7cccb9")
        val iv = unhex("a0a1a2a3a4a5a6a701020304")
        val cases = listOf(
            Triple(false, "78112233445566778899", "7816560fedd7eec1b8c3dcd52be211cafd0ccd088c18fed7f020a0a1a2a3a4a5a6a70102030405"),
            Triple(true, "5042009d012a80026801deadbeef0102", "5042009d012a80026801d9d98246838a0127617ebb177e00781ad16ae0ffb006a0a1a2a3a4a5a6a70102030405"),
            Triple(true, "310500aabbccdd", "310500adcff074e5f5692de90bf624c640c6ec3cf8370fa0a1a2a3a4a5a6a70102030405"),
            Triple(false, "78", "78651dfd182da1ad3472a408ee907eacd0a0a1a2a3a4a5a6a70102030405"),
        )
        var ok = 0
        for ((video, plain, sealed) in cases) {
            val mine = FrameCryptoNative.nativeSealForTest(key, 261 and 0xff, iv, video, unhex(plain))
            val opened = FrameCryptoNative.nativeOpenForTest(key, video, unhex(sealed))
            if (mine != null && hex(mine) == sealed && opened != null && hex(opened) == plain) ok++
        }
        val voiceKey = hex(fish.nexa.crypto.Conv.voiceFrameKey(unhex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"), "1234567890123456789"))
        return "$ok/${cases.size} frames match; voiceFrameKey ${if (voiceKey == "b12789f29993834f2127e2379c3be51b0351a9ddae44147d3570de350a7cccb9") "matches" else "DIFFERS $voiceKey"}"
    }

    companion object {
        private const val TAG = "NexaCallTest"
    }
}
