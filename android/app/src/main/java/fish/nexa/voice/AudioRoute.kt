package fish.nexa.voice

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import fish.nexa.Nexa
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Where a call's sound goes on the phone: the speaker, the earpiece, a wired
 * headset or a Bluetooth one, with the phone in call mode so the volume keys
 * set the call's volume. It never takes the audio focus: music or a video in
 * another app plays on beside the call, and the call keeps its microphone.
 * A headset put on mid-call takes the call; one taken off hands it back.
 */
object AudioRoute {
    private const val TAG = "AudioRoute"

    /** How often a call checks whether the phone is ringing or in a phone call. */
    private const val PHONE_CHECK_MS = 1_000L

    enum class Kind { SPEAKER, EARPIECE, WIRED, BLUETOOTH, USB, OTHER }

    /** One place the call can play; `id` is the system's device id (0 for the speaker or earpiece before API 31). */
    data class Device(val id: Int, val kind: Kind, val name: String)

    private val _devices = MutableStateFlow<List<Device>>(emptyList())
    val devices: StateFlow<List<Device>> = _devices
    private val _current = MutableStateFlow<Device?>(null)
    val current: StateFlow<Device?> = _current

    /** Told when a phone call takes the audio away (false), and when it gives it back (true). */
    @Volatile var onFocus: ((Boolean) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private var inCall = false
    private var chosen: Device? = null
    /** A phone call holds the audio: the call is quiet both ways until it ends. */
    private var phoneBusy = false
    private var callback: AudioDeviceCallback? = null
    private var proximity: PowerManager.WakeLock? = null
    @Volatile private var videoShowing = false

    private fun audio(): AudioManager = Nexa.app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private fun prefs() = Nexa.app.getSharedPreferences("voice", Context.MODE_PRIVATE)

    /** The speaker unless the person chose the earpiece last time. */
    private var preferSpeaker: Boolean
        get() = prefs().getBoolean("callSpeaker", true)
        set(v) = prefs().edit().putBoolean("callSpeaker", v).apply()

    fun enter() = main.post {
        val am = audio()
        callMode(am)
        if (!inCall) {
            inCall = true
            chosen = null
            watch(am)
            phoneCheck.run()
        }
        refresh()
    }

    fun leave() = main.post {
        if (!inCall) return@post
        inCall = false
        val am = audio()
        callback?.let { runCatching { am.unregisterAudioDeviceCallback(it) } }
        callback = null
        if (Build.VERSION.SDK_INT >= 31) runCatching { am.clearCommunicationDevice() }
        @Suppress("DEPRECATION")
        runCatching {
            if (am.isBluetoothScoOn) am.stopBluetoothSco()
            am.isSpeakerphoneOn = false
        }
        phoneBusy = false
        main.removeCallbacks(phoneCheck)
        runCatching { am.mode = AudioManager.MODE_NORMAL }
        setProximity(false)
        _current.value = null
        _devices.value = emptyList()
    }

    /** The person picked where the call plays. */
    fun choose(device: Device) = main.post {
        chosen = device
        if (device.kind == Kind.SPEAKER) preferSpeaker = true
        if (device.kind == Kind.EARPIECE) preferSpeaker = false
        route()
    }

    /** Video on screen keeps the screen on even at the ear. */
    fun setVideoShowing(on: Boolean) {
        videoShowing = on
        main.post { updateProximity() }
    }

    /** In call mode while the call holds the audio: routing and the volume keys are the call's. */
    private fun callMode(am: AudioManager) = runCatching { am.mode = AudioManager.MODE_IN_COMMUNICATION }

    /** The phone is ringing or in a phone call (the system's own modes for them). */
    private fun phoneInCall(am: AudioManager): Boolean = when (am.mode) {
        AudioManager.MODE_RINGTONE, AudioManager.MODE_IN_CALL -> true
        else -> Build.VERSION.SDK_INT >= 30 && am.mode == AudioManager.MODE_CALL_SCREENING
    }

    /**
     * Looks every [PHONE_CHECK_MS] whether a phone call holds the phone. Not asking
     * for the audio focus, the call is told nothing when one rings or starts.
     */
    private val phoneCheck: Runnable = object : Runnable {
        override fun run() {
            main.removeCallbacks(this)
            if (!inCall) return
            setPhoneBusy(phoneInCall(audio()))
            main.postDelayed(this, PHONE_CHECK_MS)
        }
    }

    private fun setPhoneBusy(busy: Boolean) {
        if (busy == phoneBusy) return
        phoneBusy = busy
        // the phone call left the phone in its own mode
        if (!busy) callMode(audio())
        onFocus?.invoke(!busy)
    }

    private fun watch(am: AudioManager) {
        val cb = object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) {
                // a headset put on takes the call
                if (added?.any { kindOf(it) in setOf(Kind.WIRED, Kind.BLUETOOTH, Kind.USB) } == true) chosen = null
                refresh()
            }

            override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) {
                if (removed?.any { it.id == chosen?.id } == true) chosen = null
                refresh()
            }
        }
        callback = cb
        runCatching { am.registerAudioDeviceCallback(cb, main) }
    }

    private fun kindOf(d: AudioDeviceInfo): Kind = when (d.type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> Kind.SPEAKER
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> Kind.EARPIECE
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> Kind.WIRED
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET -> Kind.BLUETOOTH
        AudioDeviceInfo.TYPE_USB_HEADSET -> Kind.USB
        else -> Kind.OTHER
    }

    private fun refresh() {
        if (!inCall) return
        val am = audio()
        val list = if (Build.VERSION.SDK_INT >= 31) {
            runCatching { am.availableCommunicationDevices }.getOrNull().orEmpty().map { Device(it.id, kindOf(it), it.productName?.toString().orEmpty()) }
        } else {
            val outs = runCatching { am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList() }.getOrNull().orEmpty()
            val extra = outs.filter { kindOf(it) in setOf(Kind.WIRED, Kind.BLUETOOTH, Kind.USB) }.map { Device(it.id, kindOf(it), it.productName?.toString().orEmpty()) }
            listOf(Device(0, Kind.SPEAKER, ""), Device(-1, Kind.EARPIECE, "")) + extra
        }
        // one entry per kind of built-in device; headsets each by name
        _devices.value = list.filter { it.kind != Kind.OTHER }.distinctBy { if (it.kind == Kind.SPEAKER || it.kind == Kind.EARPIECE) it.kind.name else "${it.kind}:${it.id}" }
        route()
    }

    /** Sends the call to the chosen device; or a headset someone has on; or the speaker or earpiece as last chosen. */
    private fun route() {
        if (!inCall) return
        val am = audio()
        val list = _devices.value
        val headset = list.firstOrNull { it.kind == Kind.WIRED || it.kind == Kind.USB } ?: list.firstOrNull { it.kind == Kind.BLUETOOTH }
        val want = chosen?.takeIf { c -> list.any { it.id == c.id && it.kind == c.kind } }
            ?: headset
            ?: list.firstOrNull { it.kind == if (preferSpeaker) Kind.SPEAKER else Kind.EARPIECE }
            ?: list.firstOrNull { it.kind == Kind.SPEAKER }
            ?: return
        if (Build.VERSION.SDK_INT >= 31) {
            val info = runCatching { am.availableCommunicationDevices }.getOrNull()?.firstOrNull { it.id == want.id }
            val ok = info != null && runCatching { am.setCommunicationDevice(info) }.getOrDefault(false)
            if (!ok) {
                Log.w(TAG, "could not route the call to ${want.kind}")
                @Suppress("DEPRECATION")
                runCatching { am.isSpeakerphoneOn = want.kind == Kind.SPEAKER }
            }
        } else {
            @Suppress("DEPRECATION")
            runCatching {
                if (want.kind == Kind.BLUETOOTH) {
                    am.isSpeakerphoneOn = false
                    am.startBluetoothSco()
                    am.isBluetoothScoOn = true
                } else {
                    if (am.isBluetoothScoOn) am.stopBluetoothSco()
                    am.isSpeakerphoneOn = want.kind == Kind.SPEAKER
                }
            }
        }
        _current.value = want
        updateProximity()
    }

    private fun updateProximity() = setProximity(inCall && _current.value?.kind == Kind.EARPIECE && !videoShowing)

    /** At the ear, the screen goes dark so a cheek does not press anything. */
    private fun setProximity(on: Boolean) {
        val pm = Nexa.app.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (on) {
            if (proximity == null && pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
                proximity = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "nexa:call-proximity").apply {
                    setReferenceCounted(false)
                    acquire(4 * 60 * 60 * 1000L)
                }
            }
        } else {
            proximity?.let { runCatching { it.release(PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY) } }
            proximity = null
        }
    }
}
