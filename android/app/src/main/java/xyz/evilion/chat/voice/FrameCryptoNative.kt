package xyz.evilion.chat.voice

/**
 * The native side of call frame encryption.
 *
 * Calls go through Cloudflare's SFU, which ends WebRTC's own encryption, so
 * frames are sealed again with the conversation key before they leave the
 * device. The browser does this with insertable streams; the same hook here is
 * `RtpSender.setFrameEncryptor`, which takes a pointer to a C++ object, so the
 * format itself lives in src/main/cpp.
 */
object FrameCryptoNative {
    private var loaded = false

    @Synchronized
    fun load(): Boolean {
        if (!loaded) {
            runCatching { System.loadLibrary("evilion_frame_crypto") }
                .onSuccess { loaded = true }
                .onFailure { loaded = false }
        }
        return loaded
    }

    /** A call's keys, shared by every sender and receiver in it. */
    external fun nativeCreateKeys(): Long

    /** Replaces the keys: one per epoch this device holds, and which one seals. */
    external fun nativeSetKeys(handle: Long, indices: IntArray, keys: Array<ByteArray>, sendIndex: Int)

    external fun nativeReleaseKeys(handle: Long)

    /** A `webrtc::FrameEncryptorInterface*` for RtpSender.setFrameEncryptor. */
    external fun nativeCreateEncryptor(handle: Long): Long

    /** A `webrtc::FrameDecryptorInterface*` for RtpReceiver.setFrameDecryptor. */
    external fun nativeCreateDecryptor(handle: Long): Long

    external fun nativeReleaseEncryptor(pointer: Long)

    external fun nativeReleaseDecryptor(pointer: Long)

    /** [sealed, opened, dropped] since the keys were made. */
    external fun nativeStats(handle: Long): LongArray
}
