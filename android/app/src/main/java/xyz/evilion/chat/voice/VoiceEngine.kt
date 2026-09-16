package xyz.evilion.chat.voice

import android.content.Context
import android.media.AudioManager
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
 * The WebRTC stack for this process: one factory, one EGL context, and the
 * microphone and camera that calls take their media from.
 *
 * Echo cancellation and noise suppression use the phone's own, where it has
 * them, which is what every other calling app on Android does and what makes
 * a speakerphone call usable.
 */
object VoiceEngine {
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
                android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
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

    /** The front camera by default, falling back to whatever the phone has. */
    fun createCameraCapturer(front: Boolean = true): VideoCapturer? {
        val enumerator = Camera2Enumerator(context())
        val names = enumerator.deviceNames
        val wanted = names.firstOrNull { if (front) enumerator.isFrontFacing(it) else enumerator.isBackFacing(it) }
            ?: names.firstOrNull()
            ?: return null
        return enumerator.createCapturer(wanted, object : CameraVideoCapturer.CameraEventsHandler {
            override fun onCameraError(error: String?) = Unit
            override fun onCameraDisconnected() = Unit
            override fun onCameraFreezed(error: String?) = Unit
            override fun onCameraOpening(cameraName: String?) = Unit
            override fun onFirstFrameAvailable() = Unit
            override fun onCameraClosed() = Unit
        })
    }

    fun startCapture(capturer: VideoCapturer, width: Int, height: Int, fps: Int): Pair<VideoSource, VideoTrack> {
        val source = factory.createVideoSource(capturer.isScreencast)
        val helper = SurfaceTextureHelper.create("capture", eglBase.eglBaseContext)
        capturer.initialize(helper, context(), source.capturerObserver)
        capturer.startCapture(width, height, fps)
        val track = factory.createVideoTrack("v${System.nanoTime()}", source)
        return source to track
    }

    /** Puts the phone into call mode, so volume keys and routing behave. */
    fun enterCallAudio(speaker: Boolean) {
        val manager = context().getSystemService(Context.AUDIO_SERVICE) as AudioManager
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        @Suppress("DEPRECATION")
        manager.isSpeakerphoneOn = speaker
    }

    fun leaveCallAudio() {
        val manager = context().getSystemService(Context.AUDIO_SERVICE) as AudioManager
        @Suppress("DEPRECATION")
        manager.isSpeakerphoneOn = false
        manager.mode = AudioManager.MODE_NORMAL
    }
}

/** A `webrtc::FrameEncryptorInterface*` the sender can be handed. */
class NativeFrameEncryptor(keys: Long) : org.webrtc.FrameEncryptor {
    private val pointer = FrameCryptoNative.nativeCreateEncryptor(keys)

    override fun getNativeFrameEncryptor(): Long = pointer

    fun release() {
        if (pointer != 0L) FrameCryptoNative.nativeReleaseEncryptor(pointer)
    }
}

/** A `webrtc::FrameDecryptorInterface*` for a pulled track. */
class NativeFrameDecryptor(keys: Long) : org.webrtc.FrameDecryptor {
    private val pointer = FrameCryptoNative.nativeCreateDecryptor(keys)

    override fun getNativeFrameDecryptor(): Long = pointer

    fun release() {
        if (pointer != 0L) FrameCryptoNative.nativeReleaseDecryptor(pointer)
    }
}
