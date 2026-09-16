package xyz.evilion.chat.media

import android.content.Context
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.decode.DataSource
import coil3.decode.ImageSource
import coil3.disk.DiskCache
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.SourceFetchResult
import coil3.gif.AnimatedImageDecoder
import coil3.key.Keyer
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.Options
import coil3.request.crossfade
import okio.FileSystem
import okio.Path.Companion.toOkioPath
import xyz.evilion.chat.crypto.AttachmentMeta
import xyz.evilion.chat.net.Api

/**
 * Pictures.
 *
 * Avatars, emoji and stickers are ordinary URLs the server serves in the
 * clear. Attachments are not: they are fetched with this account's token,
 * decrypted with the key from the message, and only then handed to the
 * decoder, so an image is never written anywhere in a form the server could
 * read.
 */
object Images {
    fun install(context: Context) {
        SingletonImageLoader.setSafe { platform -> loader(platform, context) }
    }

    private fun loader(platform: PlatformContext, context: Context): ImageLoader =
        ImageLoader.Builder(platform)
            .components {
                add(OkHttpNetworkFetcherFactory(callFactory = { Api.http }))
                add(AttachmentFetcher.Factory())
                add(Keyer<AttachmentMeta> { data, _ -> "attachment:${data.blobId}" })
                add(AnimatedImageDecoder.Factory())
            }
            .memoryCache {
                MemoryCache.Builder().maxSizePercent(platform, 0.20).build()
            }
            .diskCache {
                // Only public pictures are cached here; attachments keep their own,
                // which is cleared with the app's data.
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve("images").toOkioPath())
                    .maxSizeBytes(192L * 1024 * 1024)
                    .build()
            }
            .crossfade(true)
            .build()
}

/** Decrypts an attachment before the decoder ever sees it. */
class AttachmentFetcher(private val meta: AttachmentMeta) : Fetcher {
    override suspend fun fetch(): FetchResult {
        val file = AttachmentStore.file(meta)
        return SourceFetchResult(
            source = ImageSource(file = file.toOkioPath(), fileSystem = FileSystem.SYSTEM),
            mimeType = meta.type,
            dataSource = DataSource.DISK,
        )
    }

    class Factory : Fetcher.Factory<AttachmentMeta> {
        override fun create(data: AttachmentMeta, options: Options, imageLoader: ImageLoader): Fetcher =
            AttachmentFetcher(data)
    }
}
