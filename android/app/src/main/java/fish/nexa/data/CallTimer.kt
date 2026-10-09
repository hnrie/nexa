package fish.nexa.data

import fish.nexa.net.VoiceState

/** How long a call has been going (the web's lib/callTimer.ts). */
object CallTimer {
    /**
     * When the call in a channel began (server ms), or null when nobody is in
     * it. The server says so on every voice state (`call_since`, the same for
     * all of them); a server from before that said nothing, and then the
     * earliest `joined_at` of the people still there stands in for it.
     */
    fun since(byUser: Map<String, VoiceState>, channelId: String): Long? {
        var since = 0L
        var earliest = Long.MAX_VALUE
        var any = false
        for (st in byUser.values) {
            if (st.channelId != channelId) continue
            any = true
            if (st.callSince > since) since = st.callSince
            if (st.joinedAt in 1 until earliest) earliest = st.joinedAt
        }
        if (!any) return null
        if (since > 0) return since
        return earliest.takeIf { it != Long.MAX_VALUE }
    }

    /** Whole seconds a call has run at `now` (server ms), never below zero. */
    fun seconds(since: Long, now: Long): Long = maxOf(0L, (now - since) / 1000)
}
