package fish.nexa.voice

import android.util.Log
import org.webrtc.FrameDecryptor
import org.webrtc.FrameEncryptor

/**
 * The call frame crypto in native code (cpp/frame): the web's sealed-frame
 * format byte for byte, run by libwebrtc on every encoded frame before it is
 * packetised and on every assembled frame before it is decoded.
 */
object FrameCryptoNative {
    private const val TAG = "FrameCrypto"

    /** Whether the library loaded; a build without it cannot make an encrypted call. */
    val loaded: Boolean by lazy {
        try {
            System.loadLibrary("nexa_native")
            true
        } catch (e: Throwable) {
            Log.e(TAG, "the native call library did not load", e)
            false
        }
    }

    external fun nativeCreateKeys(): Long
    external fun nativeSetKeys(handle: Long, indices: IntArray, keys: Array<ByteArray>, sendIndex: Int)
    external fun nativeReleaseKeys(handle: Long)
    external fun nativeCreateEncryptor(handle: Long): Long
    external fun nativeCreateDecryptor(handle: Long): Long
    external fun nativeReleaseEncryptor(ptr: Long)
    external fun nativeReleaseDecryptor(ptr: Long)

    /** [sealed, opened, dropped, oversize] for every sender and receiver of one call. */
    external fun nativeStats(handle: Long): LongArray

    /** [frames seen, frames opened, picture too large (0/1)] of one receiver. */
    external fun nativeDecryptorCounts(ptr: Long): LongArray

    external fun nativeSealForTest(key: ByteArray, index: Int, iv: ByteArray, video: Boolean, plain: ByteArray): ByteArray?
    external fun nativeOpenForTest(key: ByteArray, video: Boolean, sealed: ByteArray): ByteArray?
}

/**
 * The keys one call seals and opens with, shared by all of its encryptors and
 * decryptors. Rekeying swaps the set behind a lock that lets frames read at
 * the same time.
 */
class FrameKeys {
    private val lock = Any()
    private var handle: Long = if (FrameCryptoNative.loaded) FrameCryptoNative.nativeCreateKeys() else 0L

    fun set(keys: VoiceKeys?) = synchronized(lock) {
        if (handle == 0L) return@synchronized
        val list = keys?.keys.orEmpty()
        FrameCryptoNative.nativeSetKeys(handle, list.map { it.first }.toIntArray(), list.map { it.second }.toTypedArray(), if (list.isEmpty()) -1 else keys!!.send)
    }

    fun encryptor(): NativeFrameEncryptor? = synchronized(lock) { if (handle == 0L) null else NativeFrameEncryptor(handle) }
    fun decryptor(): NativeFrameDecryptor? = synchronized(lock) { if (handle == 0L) null else NativeFrameDecryptor(handle) }

    /** [sealed, opened, dropped, oversize]. */
    fun stats(): LongArray = synchronized(lock) { if (handle == 0L) LongArray(4) else FrameCryptoNative.nativeStats(handle) }

    fun release() = synchronized(lock) {
        if (handle != 0L) FrameCryptoNative.nativeReleaseKeys(handle)
        handle = 0
    }
}

/**
 * A `webrtc::FrameEncryptorInterface*` a sender is handed. The C++ object is
 * reference-counted and the sender holds a reference of its own, so this one
 * is let go exactly once.
 */
class NativeFrameEncryptor(keys: Long) : FrameEncryptor {
    private var pointer = FrameCryptoNative.nativeCreateEncryptor(keys)

    override fun getNativeFrameEncryptor(): Long = pointer

    @Synchronized
    fun release() {
        val held = pointer
        pointer = 0
        if (held != 0L) FrameCryptoNative.nativeReleaseEncryptor(held)
    }
}

/** A `webrtc::FrameDecryptorInterface*` for a pulled track, and what it has seen. */
class NativeFrameDecryptor(keys: Long) : FrameDecryptor {
    private var pointer = FrameCryptoNative.nativeCreateDecryptor(keys)

    override fun getNativeFrameDecryptor(): Long = pointer

    /** [frames seen, frames opened, picture too large (0/1)]. */
    @Synchronized
    fun counts(): LongArray = if (pointer == 0L) LongArray(3) else FrameCryptoNative.nativeDecryptorCounts(pointer)

    @Synchronized
    fun release() {
        val held = pointer
        pointer = 0
        if (held != 0L) FrameCryptoNative.nativeReleaseDecryptor(held)
    }
}
