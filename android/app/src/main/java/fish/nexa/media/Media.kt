package fish.nexa.media

import android.content.Context
import android.os.Build
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.annotation.ExperimentalCoilApi
import coil3.decode.DataSource
import coil3.decode.ImageSource
import coil3.disk.DiskCache
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.SourceFetchResult
import coil3.gif.AnimatedImageDecoder
import coil3.gif.GifDecoder
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.Options
import coil3.svg.SvgDecoder
import coil3.video.VideoFrameDecoder
import fish.nexa.Nexa
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.DecryptError
import fish.nexa.crypto.FileCrypto
import fish.nexa.net.ApiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Request
import okio.FileSystem
import okio.Path.Companion.toOkioPath
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Pictures and files. Public pictures (avatars, icons, banners, emoji,
 * stickers) are plain HTTPS through Coil with its caches. Attachments are
 * end-to-end encrypted: they are fetched with the session's token, checked
 * against the size the message gave, decrypted chunk by chunk into a cache
 * only this app can read (cleared on sign-out), and drawn from there.
 */
object Media {
    /** The smallest power of two at least css x density, 16..1024 (users.ts sized()). */
    fun sized(css: Int, density: Float): Int {
        val want = css * density.coerceIn(1f, 3f)
        var n = 16
        while (n < want && n < 1024) n *= 2
        return n
    }

    private fun base() = Nexa.api.baseUrl

    fun avatarUrl(id: String?, css: Int, density: Float): String? = id?.let { "${base()}/media/avatar/$it?size=${sized(css, density)}" }
    fun bannerUrl(id: String?, css: Int, density: Float): String? = id?.let { "${base()}/media/banner/$it?size=${sized(css, density)}" }
    fun iconUrl(id: String?, css: Int, density: Float): String? = id?.let { "${base()}/media/icon/$it?size=${sized(css, density)}" }
    fun emojiUrl(blobId: String, css: Int, density: Float, still: Boolean = false): String =
        "${base()}/media/emoji/$blobId?size=${sized(css, density)}" + if (still) "&still=1" else ""
    fun stickerUrl(blobId: String, css: Int, density: Float): String = "${base()}/media/sticker/$blobId?size=${sized(css, density)}"
    fun tagUrl(id: String, css: Int, density: Float): String = "${base()}/media/tag/$id?size=${sized(css, density).coerceIn(16, 128)}"
    fun typingUrl(id: String, css: Int, density: Float): String = "${base()}/media/typing/$id?size=${sized(css, density)}"
    fun widgetUrl(id: String, css: Int, density: Float): String = "${base()}/media/widget/$id?size=${sized(css, density)}"

    /** A link a message carries: absolute, or a path on this server. */
    fun absolute(url: String): String = if (url.startsWith("/")) base() + url else url

    lateinit var loader: ImageLoader
        private set

    private lateinit var cacheDir: File

    @OptIn(ExperimentalCoilApi::class)
    fun init(context: Context) {
        cacheDir = File(context.cacheDir, "decrypted").apply { mkdirs() }
        loader = ImageLoader.Builder(context)
            .components {
                add(OkHttpNetworkFetcherFactory(callFactory = { Nexa.api.http }))
                add(EncryptedFetcher.Factory())
                if (Build.VERSION.SDK_INT >= 28) add(AnimatedImageDecoder.Factory()) else add(GifDecoder.Factory())
                add(SvgDecoder.Factory())
                add(VideoFrameDecoder.Factory())
            }
            .memoryCache { MemoryCache.Builder().maxSizePercent(context, 0.22).build() }
            .diskCache { DiskCache.Builder().directory(File(context.cacheDir, "pictures").toOkioPath()).maxSizeBytes(256L * 1024 * 1024).build() }
            .build()
    }

    // ---- encrypted attachments ----

    private val locks = ConcurrentHashMap<String, Mutex>()

    /** The decrypted file for an attachment, fetched and opened once and then kept in the private cache. */
    suspend fun decrypted(blobId: String, keyB64: String, size: Long?, onProgress: ((Long, Long) -> Unit)? = null): File {
        val out = File(cacheDir, blobId)
        if (out.exists() && out.length() > 0) return out
        val lock = locks.getOrPut(blobId) { Mutex() }
        return lock.withLock {
            if (out.exists() && out.length() > 0) return@withLock out
            withContext(Dispatchers.IO) {
                val key = Bytes.unb64(keyB64)
                val req = Nexa.api.requestBuilder("/media/attachments/$blobId").get().build()
                val res = Nexa.api.await(Nexa.api.transfer.newCall(req))
                res.use { r ->
                    if (!r.isSuccessful) throw ApiError(r.code, "http_${r.code}", "The file could not be downloaded.")
                    val len = r.body.contentLength()
                    if (size != null && len >= 0 && r.header("Content-Encoding") == null && len != size) {
                        throw DecryptError("file: the server sent a file of another size")
                    }
                    val tmp = File(cacheDir, "$blobId.part")
                    try {
                        tmp.outputStream().buffered(1 shl 16).use { os ->
                            FileCrypto.decryptStream(r.body.byteStream().buffered(1 shl 16), key, os) { done -> onProgress?.invoke(done, size ?: len) }
                        }
                        if (!tmp.renameTo(out)) throw java.io.IOException("could not keep the file")
                    } finally {
                        tmp.delete()
                    }
                }
                out
            }
        }
    }

    /** A webhook's plain file: fetched with the token and kept as it is. */
    suspend fun plain(blobId: String): File {
        val out = File(cacheDir, "plain-$blobId")
        if (out.exists() && out.length() > 0) return out
        return withContext(Dispatchers.IO) {
            val req = Nexa.api.requestBuilder("/media/attachments/$blobId").get().build()
            Nexa.api.await(Nexa.api.transfer.newCall(req)).use { r ->
                if (!r.isSuccessful) throw ApiError(r.code, "http_${r.code}", "The file could not be downloaded.")
                val tmp = File(cacheDir, "plain-$blobId.part")
                tmp.outputStream().use { r.body.byteStream().copyTo(it) }
                tmp.renameTo(out)
            }
            out
        }
    }

    /** Seeds the cache with a file this device just sent, so it shows without downloading it back. */
    fun seed(blobId: String, plainFile: File) {
        val out = File(cacheDir, blobId)
        if (!out.exists()) plainFile.copyTo(out, overwrite = true)
    }

    fun clear() {
        cacheDir.listFiles()?.forEach { it.delete() }
        try {
            loader.memoryCache?.clear()
        } catch (_: Exception) {
        }
    }
}

/** What Coil is asked to draw for an encrypted picture. */
data class EncryptedImage(val blobId: String, val key: String, val size: Long?, val plain: Boolean = false)

class EncryptedFetcher(private val data: EncryptedImage, private val options: Options) : Fetcher {
    override suspend fun fetch(): FetchResult {
        val file = if (data.plain) Media.plain(data.blobId) else Media.decrypted(data.blobId, data.key, data.size)
        return SourceFetchResult(
            source = ImageSource(file.toOkioPath(), FileSystem.SYSTEM),
            mimeType = null,
            dataSource = DataSource.DISK,
        )
    }

    class Factory : Fetcher.Factory<EncryptedImage> {
        override fun create(data: EncryptedImage, options: Options, imageLoader: ImageLoader): Fetcher = EncryptedFetcher(data, options)
    }
}

@Suppress("unused")
private fun PlatformContext.unusedMarker() = Unit
