package xyz.evilion.chat.media

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import xyz.evilion.chat.crypto.AttachmentMeta
import xyz.evilion.chat.crypto.Bytes
import xyz.evilion.chat.crypto.FileCrypto
import xyz.evilion.chat.net.Api
import java.io.File

/**
 * Attachments on this device.
 *
 * The server only ever holds the encrypted bytes; the key travels inside the
 * message. What lands here is the decrypted file, in the app's cache, so an
 * image or video is decrypted once however often it is shown. The cache is
 * trimmed oldest-first and goes away with the app's data.
 */
object AttachmentStore {
    private const val TAG = "Attachments"
    private const val CACHE_LIMIT = 768L * 1024 * 1024

    private lateinit var dir: File
    private val locks = mutableMapOf<String, Mutex>()
    private val locksGuard = Mutex()

    fun init(context: Context) {
        dir = File(context.cacheDir, "attachments").apply { mkdirs() }
    }

    fun cached(meta: AttachmentMeta): File? = fileFor(meta).takeIf { it.exists() && it.length() > 0 }

    private fun fileFor(meta: AttachmentMeta): File {
        val safe = meta.name.takeLast(48).replace(Regex("[^A-Za-z0-9._-]"), "_")
        return File(dir, "${meta.blobId}-$safe")
    }

    /**
     * The decrypted file, downloading it if this device does not have it yet.
     * Two views of the same attachment wait on one download.
     */
    suspend fun file(meta: AttachmentMeta, onProgress: ((Long, Long) -> Unit)? = null): File {
        cached(meta)?.let { return it }
        val lock = locksGuard.withLock { locks.getOrPut(meta.blobId) { Mutex() } }
        return lock.withLock {
            cached(meta)?.let { return@withLock it }
            withContext(Dispatchers.IO) {
                val key = Bytes.unb64(meta.key)
                val dest = fileFor(meta)
                Api.openStream(Media.attachment(meta.blobId).removePrefix(Api.baseUrl)).use { stream ->
                    FileCrypto.decryptToFile(stream.input, key, dest) { done -> onProgress?.invoke(done, meta.size) }
                }
                trim()
                dest
            }
        }
    }

    /** Drops the oldest files once the cache is over its limit. */
    private fun trim() {
        runCatching {
            val files = dir.listFiles()?.sortedBy { it.lastModified() } ?: return
            var total = files.sumOf { it.length() }
            for (f in files) {
                if (total <= CACHE_LIMIT) break
                total -= f.length()
                f.delete()
            }
        }.onFailure { Log.w(TAG, "could not trim the cache", it) }
    }

    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }

    fun usage(): Long = dir.listFiles()?.sumOf { it.length() } ?: 0
}
