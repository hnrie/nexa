package fish.nexa.voice

import android.os.Handler
import android.os.Looper
import fish.nexa.Nexa
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.voice.IncomingCallOverlay

/**
 * Where an incoming call shows: in the app, as its sheet, while the app is in
 * front; otherwise the ringing notification (CallNotifications) and, over the
 * lock screen, its full-screen window (CallActivity). It moves between the two
 * as the app comes and goes while the call rings.
 */
internal object IncomingCalls {
    private const val KEY = "incoming-call"
    private val main = Handler(Looper.getMainLooper())

    fun sync(ringing: Map<String, Ring>) {
        main.post {
            val show = ringing.isNotEmpty() && Nexa.ui.visible.value
            val open = Layers.stack.any { it.key == KEY }
            if (show && !open) {
                lateinit var layer: Layer
                layer = Layer(KEY) { IncomingCallOverlay(layer) }
                Layers.open(layer)
            } else if (!show && open) {
                Layers.stack.lastOrNull { it.key == KEY }?.let { Layers.remove(it) }
            }
            // in front of the app, its notification would only repeat the sheet; away from
            // it (the app just went behind something), the notification takes over
            if (show) for (ch in ringing.keys) CallNotifications.cancelRing(ch)
            else for ((ch, r) in ringing) CallNotifications.ring(ch, r.from)
        }
    }

    /** Answered from outside the app: the sheet and the notification go at once. */
    fun answered(channelId: String) {
        CallNotifications.cancelRing(channelId)
    }
}
