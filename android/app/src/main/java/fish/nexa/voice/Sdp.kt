package fish.nexa.voice

import org.webrtc.SessionDescription

/**
 * The one thing calls change in SDP (web/src/voice/opus.ts): every Opus
 * payload type of every audio section in a description applied as the remote
 * one asks for DTX and 48 kbps. An encoder takes both from the other side's
 * description, and each exchange applies them again, so one untuned
 * description would switch DTX off.
 */
object Sdp {
    /** The bitrate a voice is sent at, in bits per second. */
    const val VOICE_BITRATE = 48_000

    private val WANTED = linkedMapOf("usedtx" to "1", "maxaveragebitrate" to VOICE_BITRATE.toString())
    private val RTPMAP = Regex("^a=rtpmap:(\\d+) opus/48000", RegexOption.IGNORE_CASE)
    private val FMTP = Regex("^a=fmtp:(\\d+) (.*)$")

    /** An fmtp line's parameters with ours set, in the order they came. */
    private fun withOurs(params: String): String {
        val out = ArrayList<String>()
        val seen = HashSet<String>()
        for (part in params.split(";")) {
            val p = part.trim()
            if (p.isEmpty()) continue
            val key = p.split("=")[0].trim().lowercase()
            if (key in WANTED) {
                if (!seen.add(key)) continue
                out += "$key=${WANTED[key]}"
            } else out += p
        }
        for ((key, value) in WANTED) if (key !in seen) out += "$key=$value"
        return out.joinToString(";")
    }

    fun tuneOpus(sdp: String): String {
        if (!Regex("opus/48000", RegexOption.IGNORE_CASE).containsMatchIn(sdp)) return sdp
        val eol = if (sdp.contains("\r\n")) "\r\n" else "\n"
        val lines = sdp.split(eol)
        val out = ArrayList<String>()
        // per media section: the Opus payload types it maps, and those it gave an fmtp line
        var opus = LinkedHashMap<String, Int>()
        var tuned = HashSet<String>()
        fun closeSection() {
            // an Opus mapping with no fmtp line of its own gets one, just after it
            val missing = opus.entries.filter { it.key !in tuned }.sortedByDescending { it.value }
            for ((pt, at) in missing) out.add(at + 1, "a=fmtp:$pt ${withOurs("")}")
            opus = LinkedHashMap()
            tuned = HashSet()
        }
        for (line in lines) {
            if (line.startsWith("m=")) closeSection()
            val map = RTPMAP.find(line)
            if (map != null) {
                out += line
                opus[map.groupValues[1]] = out.size - 1
                continue
            }
            val fmtp = FMTP.find(line)
            if (fmtp != null && fmtp.groupValues[1] in opus) {
                tuned += fmtp.groupValues[1]
                out += "a=fmtp:${fmtp.groupValues[1]} ${withOurs(fmtp.groupValues[2])}"
                continue
            }
            out += line
        }
        // the last section ends with the description; a trailing empty line stays last
        val trailing = if (out.isNotEmpty() && out.last() == "") out.removeAt(out.size - 1) else null
        closeSection()
        if (trailing != null) out += trailing
        return out.joinToString(eol)
    }

    /** A description to apply as the remote one, tuned. Rollbacks pass as they are. */
    fun tunedRemote(desc: SessionDescription): SessionDescription =
        if (desc.type == SessionDescription.Type.ROLLBACK || desc.description.isNullOrEmpty()) desc
        else SessionDescription(desc.type, tuneOpus(desc.description))

    fun typeOf(wire: String): SessionDescription.Type? = when (wire) {
        "offer" -> SessionDescription.Type.OFFER
        "answer" -> SessionDescription.Type.ANSWER
        "pranswer" -> SessionDescription.Type.PRANSWER
        "rollback" -> SessionDescription.Type.ROLLBACK
        else -> null
    }

    fun wireOf(type: SessionDescription.Type): String = when (type) {
        SessionDescription.Type.OFFER -> "offer"
        SessionDescription.Type.ANSWER -> "answer"
        SessionDescription.Type.PRANSWER -> "pranswer"
        SessionDescription.Type.ROLLBACK -> "rollback"
    }
}
