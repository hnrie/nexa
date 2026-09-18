package xyz.evilion.chat.voice

import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnectionFactory
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule
import xyz.evilion.chat.data.SettingsStore

/**
 * What one camera or screen capture owns.
 *
 * The [helper] is the part that used to go missing: it owns a `HandlerThread`
 * and an EGL surface, and `startCapture` made one every time the camera was
 * turned on. Twenty toggles in a long call left twenty live threads behind, and
 * eventually the process with them. Whoever starts a capture now holds all
 * three pieces and lets go of them in the order libwebrtc needs: capturer,
 * then track, then source, then helper.
 */
class Capture(
    val capturer: VideoCapturer,
    val source: VideoSource,
    val track: VideoTrack,
    val helper: SurfaceTextureHelper,
) {
    /**
     * Stops and disposes everything, in the one order that is safe.
     *
     * A source disposed before the track that points at it, or a helper
     * disposed while the capturer is still handing it frames, is a native
     * crash with nothing in Kotlin to show for it, so every step is guarded
     * and the order is fixed rather than left to the caller.
     */
    fun release() {
        runCatching { capturer.stopCapture() }
        runCatching { capturer.dispose() }
        runCatching { track.dispose() }
        runCatching { source.dispose() }
        runCatching { helper.dispose() }
    }
}

/**
 * The WebRTC stack for this process: one factory, one EGL context, and the
 * microphone and camera that calls take their media from.
 *
 * Echo cancellation and noise suppression use the phone's own, where it has
 * them, which is what every other calling app on Android does and what makes
 * a speakerphone call usable.
 */
object VoiceEngine {
    private const val TAG = "VoiceEngine"

    private var appContext: Context? = null

    val eglBase: EglBase by lazy { EglBase.create() }

    val factory: PeerConnectionFactory by lazy {
        val context = requireNotNull(appContext) { "VoiceEngine.init was not called" }
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setFieldTrials("WebRTC-Audio-Allow-Opus-Dtx/Enabled/")
                .createInitializationOptions(),
        )
        val audioModule = JavaAudioDeviceModule.builder(context)
            .setUseHardwareAcousticEchoCanceler(SettingsStore.deviceBool("echoCancellation", true))
            .setUseHardwareNoiseSuppressor(SettingsStore.deviceBool("noiseSuppression", true))
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .createAudioDeviceModule()
        PeerConnectionFactory.builder()
            .setAudioDeviceModule(audioModule)
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    fun context(): Context = requireNotNull(appContext)

    /** The microphone, with the processing the settings ask for. */
    fun createAudioTrack(id: String): Pair<AudioSource, AudioTrack> {
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", SettingsStore.deviceBool("echoCancellation", true).toString()))
            mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", SettingsStore.deviceBool("noiseSuppression", true).toString()))
            mandatory.add(MediaConstraints.KeyValuePair("googAutoGainControl", SettingsStore.deviceBool("autoGain", true).toString()))
        }
        val source = factory.createAudioSource(constraints)
        return source to factory.createAudioTrack(id, source)
    }

    /** What a camera tells the call about itself while it is running. */
    interface CameraEvents {
        /** The camera stopped and will not come back by itself: revoked, taken, or broken. */
        fun onLost(reason: String)
    }

    /**
     * The front camera by default, falling back to whatever the phone has.
     *
     * Every one of these callbacks used to be `= Unit`, so a camera the system
     * took away — the permission revoked in Settings, another app opening it,
     * Android 11+ cutting it off in the background — left the button lit, the
     * transceiver sending nothing and no message anywhere. What is lost is
     * reported now, and the call turns the camera off rather than pretending.
     */
    fun createCameraCapturer(front: Boolean = true, events: CameraEvents? = null): VideoCapturer? {
        val enumerator = Camera2Enumerator(context())
        val names = enumerator.deviceNames
        val wanted = names.firstOrNull { if (front) enumerator.isFrontFacing(it) else enumerator.isBackFacing(it) }
            ?: names.firstOrNull()
            ?: return null
        return enumerator.createCapturer(wanted, object : CameraVideoCapturer.CameraEventsHandler {
            override fun onCameraError(error: String?) {
                Log.w(TAG, "camera error: $error")
                events?.onLost(error.orEmpty())
            }

            override fun onCameraDisconnected() {
                Log.w(TAG, "camera disconnected")
                events?.onLost("disconnected")
            }

            override fun onCameraFreezed(error: String?) {
                Log.w(TAG, "camera froze: $error")
                events?.onLost(error.orEmpty())
            }

            override fun onCameraOpening(cameraName: String?) = Unit
            override fun onFirstFrameAvailable() = Unit
            override fun onCameraClosed() = Unit
        })
    }

    /**
     * Starts a capturer and wraps it in a track.
     *
     * Anything that fails part-way lets go of what it already made: a camera
     * that refuses to open after its source exists used to leak the source,
     * the helper and its thread on every attempt.
     */
    fun startCapture(capturer: VideoCapturer, width: Int, height: Int, fps: Int): Capture {
        val source = factory.createVideoSource(capturer.isScreencast)
        var helper: SurfaceTextureHelper? = null
        var track: VideoTrack? = null
        try {
            helper = SurfaceTextureHelper.create("capture", eglBase.eglBaseContext)
            capturer.initialize(helper, context(), source.capturerObserver)
            capturer.startCapture(width, height, fps)
            track = factory.createVideoTrack("v${System.nanoTime()}", source)
            return Capture(capturer, source, track, helper)
        } catch (e: Throwable) {
            runCatching { capturer.stopCapture() }
            runCatching { capturer.dispose() }
            track?.let { runCatching { it.dispose() } }
            runCatching { source.dispose() }
            helper?.let { runCatching { it.dispose() } }
            throw e
        }
    }

    // --- the phone's own audio ---------------------------------------------

    /**
     * Whether the call may use the speakers just now.
     *
     * A cellular call, a navigation prompt or an alarm takes the focus away;
     * the call goes quiet in both directions until it comes back, rather than
     * talking over whatever took it.
     */
    var onFocusChange: ((Boolean) -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private var focusRequest: AudioFocusRequest? = null
    private var routeCallback: AudioDeviceCallback? = null
    private var wantSpeaker = true
    private var inCall = false

    private fun audio(): AudioManager = context().getSystemService(Context.AUDIO_SERVICE) as AudioManager

    /** Puts the phone into call mode, so volume keys and routing behave. */
    fun enterCallAudio(speaker: Boolean) {
        val manager = audio()
        wantSpeaker = speaker
        runCatching { manager.mode = AudioManager.MODE_IN_COMMUNICATION }
        if (!inCall) {
            inCall = true
            takeFocus(manager)
            watchDevices(manager)
        }
        route(manager)
    }

    fun leaveCallAudio() {
        val manager = audio()
        inCall = false
        routeCallback?.let { runCatching { manager.unregisterAudioDeviceCallback(it) } }
        routeCallback = null
        if (Build.VERSION.SDK_INT >= 31) runCatching { manager.clearCommunicationDevice() }
        @Suppress("DEPRECATION")
        runCatching { manager.isSpeakerphoneOn = false }
        dropFocus(manager)
        runCatching { manager.mode = AudioManager.MODE_NORMAL }
    }

    /**
     * Asks for the audio focus every other calling app asks for.
     *
     * Without it Spotify plays over the call, a navigation prompt talks over
     * whoever is speaking, and nothing is told to resume when the call ends.
     */
    private fun takeFocus(manager: AudioManager) {
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        val listener = AudioManager.OnAudioFocusChangeListener { change ->
            when (change) {
                AudioManager.AUDIOFOCUS_GAIN -> onFocusChange?.invoke(true)
                AudioManager.AUDIOFOCUS_LOSS,
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK,
                -> onFocusChange?.invoke(false)
            }
        }
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener(listener, main)
            .setWillPauseWhenDucked(true)
            .build()
        focusRequest = request
        // A phone that refuses the focus still makes the call; it is the other
        // app that then keeps playing, which is worse than silence but is not
        // worth refusing to connect over.
        runCatching { manager.requestAudioFocus(request) }
            .onFailure { Log.w(TAG, "could not take the audio focus", it) }
    }

    private fun dropFocus(manager: AudioManager) {
        focusRequest?.let { runCatching { manager.abandonAudioFocusRequest(it) } }
        focusRequest = null
    }

    /**
     * Sends the call to the speaker, the earpiece or a headset.
     *
     * `isSpeakerphoneOn` is deprecated and, with a Bluetooth headset paired,
     * either ignored or undone a moment later — which is why pairing AirPods
     * and joining a call played out of the phone. API 31 and up name the
     * device instead, and a headset wins over the earpiece because someone who
     * put one on meant it.
     */
    private fun route(manager: AudioManager) {
        if (Build.VERSION.SDK_INT < 31) {
            @Suppress("DEPRECATION")
            runCatching { manager.isSpeakerphoneOn = wantSpeaker }
            return
        }
        val devices = runCatching { manager.availableCommunicationDevices }.getOrNull().orEmpty()
        val headset = devices.firstOrNull { it.type in HEADSETS }
        val wanted = when {
            headset != null && (!wantSpeaker || headset.type in WIRED) -> headset
            wantSpeaker -> devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            else -> devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
        } ?: return
        // A Bluetooth route wants BLUETOOTH_CONNECT on some phones; where it is
        // refused the system's own choice is better than no sound at all.
        val ok = runCatching { manager.setCommunicationDevice(wanted) }.getOrDefault(false)
        if (!ok) {
            Log.w(TAG, "could not route the call to ${wanted.type}")
            @Suppress("DEPRECATION")
            runCatching { manager.isSpeakerphoneOn = wantSpeaker }
        }
    }

    /** A headset plugged in or unplugged mid-call moves the call with it. */
    private fun watchDevices(manager: AudioManager) {
        val callback = object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) {
                if (inCall) route(manager)
            }

            override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) {
                if (inCall) route(manager)
            }
        }
        routeCallback = callback
        runCatching { manager.registerAudioDeviceCallback(callback, main) }
    }

    private val WIRED = setOf(
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_USB_HEADSET,
    )

    private val HEADSETS = WIRED + setOf(
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_BLE_HEADSET,
    )

    /** Whether the phone would let this call talk to a Bluetooth headset. */
    fun mayUseBluetooth(): Boolean =
        Build.VERSION.SDK_INT < 31 ||
            ContextCompat.checkSelfPermission(context(), android.Manifest.permission.BLUETOOTH_CONNECT) ==
            PackageManager.PERMISSION_GRANTED
}

/**
 * A `webrtc::FrameEncryptorInterface*` the sender can be handed.
 *
 * The pointer is cleared when it is let go of. The C++ object is
 * reference-counted and the sender holds one of those references, so releasing
 * twice — which one refactor of the drop path would have caused — frees an
 * object still in use, and the frames after that are written into freed memory.
 */
class NativeFrameEncryptor(keys: Long) : org.webrtc.FrameEncryptor {
    private var pointer = FrameCryptoNative.nativeCreateEncryptor(keys)

    override fun getNativeFrameEncryptor(): Long = pointer

    @Synchronized
    fun release() {
        val held = pointer
        pointer = 0
        if (held != 0L) FrameCryptoNative.nativeReleaseEncryptor(held)
    }
}

/** A `webrtc::FrameDecryptorInterface*` for a pulled track. */
class NativeFrameDecryptor(keys: Long) : org.webrtc.FrameDecryptor {
    private var pointer = FrameCryptoNative.nativeCreateDecryptor(keys)

    override fun getNativeFrameDecryptor(): Long = pointer

    @Synchronized
    fun release() {
        val held = pointer
        pointer = 0
        if (held != 0L) FrameCryptoNative.nativeReleaseDecryptor(held)
    }
}
