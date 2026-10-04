package org.webrtc

import android.media.MediaCodecList

/**
 * Debug builds only (CallTestHooks SOFTAVC): libwebrtc's encoders with H.264
 * added from Google's software AVC encoder, driven through MediaCodec just as
 * a phone's hardware encoder is. An emulator has no hardware encoder, and
 * libwebrtc offers H.264 only from one, so this is how an emulator shares its
 * screen in H.264 the way a phone does. It sits in libwebrtc's package for the
 * MediaCodec plumbing it reuses, which is not public.
 */
object SoftAvcForTests {
    private const val CODEC = "c2.android.avc.encoder"

    fun factory(egl: EglBase.Context): VideoEncoderFactory {
        val base = DefaultVideoEncoderFactory(egl, true, true)
        val info = MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.firstOrNull { it.name == CODEC && it.isEncoder } ?: return base
        val caps = info.getCapabilitiesForType("video/avc")
        val surface = MediaCodecUtils.selectColorFormat(MediaCodecUtils.TEXTURE_COLOR_FORMATS, caps)
        val yuv = MediaCodecUtils.selectColorFormat(MediaCodecUtils.ENCODER_COLOR_FORMATS, caps)
        val avc = VideoCodecInfo("H264", mapOf("level-asymmetry-allowed" to "1", "packetization-mode" to "1", "profile-level-id" to "42e01f"), listOf("L1T1"))
        return object : VideoEncoderFactory {
            override fun getSupportedCodecs(): Array<VideoCodecInfo> = base.supportedCodecs.filter { it.name != "H264" }.toTypedArray() + avc

            override fun createEncoder(codec: VideoCodecInfo): VideoEncoder? =
                if (codec.name == "H264") {
                    HardwareVideoEncoder(MediaCodecWrapperFactoryImpl(), CODEC, VideoCodecMimeType.H264, surface, yuv, codec.params, 3600, 0, BaseBitrateAdjuster(), egl as EglBase14.Context)
                } else {
                    base.createEncoder(codec)
                }
        }
    }
}
