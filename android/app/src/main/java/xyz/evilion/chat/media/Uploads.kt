package xyz.evilion.chat.media

import android.content.ContentResolver
import android.content.Context
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import xyz.evilion.chat.crypto.AttachmentMeta
import xyz.evilion.chat.crypto.Bytes
import xyz.evilion.chat.crypto.FileCrypto
import xyz.evilion.chat.net.ApiException
import xyz.evilion.chat.net.AttachmentRef
import xyz.evilion.chat.net.UploadsApi
import java.io.ByteArrayOutputStream
import java.io.InputStream

/** A file the user picked, with what the composer needs to show it. */
data class PickedFile(
    val uri: Uri,
    val name: String,
    val size: Long,
    val mime: String,
    val width: Int? = null,
    val height: Int? = null,
    val durationMs: Long? = null,
    val spoiler: Boolean = false,
)

/**
 * Sending files.
 *
 * Nothing leaves the device in the clear: each file is encrypted in 4 MiB
 * chunks under a key of its own, and that key travels inside the message, so
 * the server stores bytes it cannot read. A file too large for one request
 * goes up a piece at a time and resumes where it left off.
 */
object Uploads {
    /** What one request may carry; the rest goes up in pieces. */
    private const val DEFAULT_SINGLE = 90L * 1024 * 1024
    private const val DEFAULT_CHUNK = 32L * 1024 * 1024
    private const val TRIES = 4

    fun describe(context: Context, uri: Uri): PickedFile {
        val resolver = context.contentResolver
        var name = "file"
        var size = 0L
        resolver.query(uri, null, null, null, null)?.use { c ->
            val nameAt = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeAt = c.getColumnIndex(OpenableColumns.SIZE)
            if (c.moveToFirst()) {
                if (nameAt >= 0) name = c.getString(nameAt) ?: name
                if (sizeAt >= 0 && !c.isNull(sizeAt)) size = c.getLong(sizeAt)
            }
        }
        val mime = resolver.getType(uri) ?: "application/octet-stream"
        if (size == 0L) {
            size = runCatching { resolver.openFileDescriptor(uri, "r")?.use { it.statSize } }.getOrNull() ?: 0L
        }
        var width: Int? = null
        var height: Int? = null
        var duration: Long? = null
        if (mime.startsWith("image/")) {
            runCatching {
                val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
                if (opts.outWidth > 0) {
                    width = opts.outWidth
                    height = opts.outHeight
                }
            }
        } else if (mime.startsWith("video/") || mime.startsWith("audio/")) {
            runCatching {
                MediaMetadataRetriever().use { r ->
                    r.setDataSource(context, uri)
                    duration = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                    width = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
                    height = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
                }
            }
        }
        return PickedFile(uri, name, size, mime, width, height, duration)
    }

    /** Whether a file fits this server's limit once encrypted, which is what it measures. */
    fun fits(size: Long, maxBytes: Long): Boolean = FileCrypto.encryptedSize(size) <= maxBytes

    /**
     * Encrypts and sends one file, then hands back the metadata that rides
     * inside the message.
     */
    suspend fun send(
        context: Context,
        channelId: String,
        file: PickedFile,
        singleLimit: Long = DEFAULT_SINGLE,
        chunkLimit: Long = DEFAULT_CHUNK,
        onProgress: (Float) -> Unit = {},
    ): Pair<AttachmentMeta, AttachmentRef> = withContext(Dispatchers.IO) {
        val key = FileCrypto.newFileKey()
        val baseIv = FileCrypto.newBaseIv()
        val total = FileCrypto.encryptedSize(file.size)
        val reader = ChunkReader(context.contentResolver, file.uri, file.size)
        val result = reader.use {
            if (total <= singleLimit) {
                val body = ByteArrayOutputStream(total.toInt())
                FileCrypto.encryptChunks(key, baseIv, 0, FileCrypto.chunkCount(file.size), { i -> reader.chunk(i) }, body)
                UploadsApi.attachment(channelId, body.toByteArray()) { sent, _ -> onProgress(sent.toFloat() / total) }
            } else {
                inPieces(channelId, reader, file.size, key, baseIv, chunkLimit, onProgress)
            }
        }
        val meta = AttachmentMeta(
            blobId = result.blobId,
            name = file.name,
            type = file.mime,
            size = file.size,
            key = Bytes.b64(key),
            width = file.width,
            height = file.height,
            spoiler = file.spoiler,
            duration = file.durationMs?.let { it / 1000.0 },
        )
        meta to AttachmentRef(result.blobId, result.size)
    }

    /**
     * A file too big for one request, a piece at a time. Each piece is a whole
     * number of chunks, so a piece sent again after a dropped connection comes
     * out identical, and the server says how much has landed.
     */
    private suspend fun inPieces(
        channelId: String,
        reader: ChunkReader,
        size: Long,
        key: ByteArray,
        baseIv: ByteArray,
        chunkLimit: Long,
        onProgress: (Float) -> Unit,
    ): xyz.evilion.chat.net.BlobResult {
        val total = FileCrypto.encryptedSize(size)
        val chunks = FileCrypto.chunkCount(size)
        val session = UploadsApi.create(total)
        val limit = minOf(if (session.chunkSize > 0) session.chunkSize else chunkLimit, chunkLimit)
        val perPiece = maxOf(1, ((limit - FileCrypto.HEADER_LEN) / FileCrypto.FRAME_LEN).toInt())
        var sent = 0L
        try {
            var first = 0
            while (first < chunks) {
                val count = minOf(perPiece, chunks - first)
                val start = if (first == 0) 0L else FileCrypto.frameOffset(first)
                val end = minOf(total, FileCrypto.frameOffset(first + count))
                check(sent == start) { "The upload lost its place." }
                val body = ByteArrayOutputStream((end - start).toInt())
                FileCrypto.encryptChunks(key, baseIv, first, count, { i -> reader.chunk(i) }, body)
                val bytes = body.toByteArray()
                var tries = 0
                while (sent < end) {
                    try {
                        val from = sent
                        val piece = if (sent == start) bytes else bytes.copyOfRange((sent - start).toInt(), bytes.size)
                        val reply = UploadsApi.chunk(session.id, sent, piece) { loaded, _ ->
                            onProgress((from + loaded).toFloat() / total)
                        }
                        check(reply.received > sent && reply.received <= end) { "The server lost track of this upload." }
                        sent = reply.received
                    } catch (e: Exception) {
                        val landed = runCatching { UploadsApi.status(session.id).received }.getOrNull()
                        if (landed == null || landed < start || landed > end) throw e
                        if (landed > sent) tries = 0 else tries++
                        if (tries >= TRIES) throw e
                        sent = landed
                        if (sent < end) delay(400L * tries)
                    }
                    onProgress(sent.toFloat() / total)
                }
                first += count
            }
            check(sent == total) { "The upload came out a different size than expected." }
            return finish(session.id)
        } catch (e: Exception) {
            runCatching { UploadsApi.cancel(session.id) }
            throw e
        }
    }

    /** Finishing twice gives back the same file, so a lost reply is asked for again. */
    private suspend fun finish(id: String): xyz.evilion.chat.net.BlobResult {
        var tries = 1
        while (true) {
            try {
                return UploadsApi.finish(id)
            } catch (e: Exception) {
                val refused = e is ApiException && e.status in 1..499
                if (refused || tries >= TRIES) throw e
                delay(400L * tries)
                tries++
            }
        }
    }
}

/**
 * Reads one 4 MiB chunk of a picked file at a time. Content providers hand out
 * a seekable descriptor where they can, and a stream that is read forward
 * where they cannot.
 */
class ChunkReader(
    private val resolver: ContentResolver,
    private val uri: Uri,
    private val size: Long,
) : AutoCloseable {
    private var stream: InputStream? = null
    private var position = 0L

    fun chunk(index: Int): ByteArray {
        val start = index.toLong() * FileCrypto.CHUNK
        val length = minOf(FileCrypto.CHUNK.toLong(), size - start).coerceAtLeast(0).toInt()
        val out = ByteArray(length)
        var input = stream
        if (input == null || position > start) {
            input?.close()
            input = resolver.openInputStream(uri) ?: throw IllegalStateException("That file could not be read.")
            stream = input
            position = 0
        }
        while (position < start) {
            val skipped = input.skip(start - position)
            if (skipped <= 0) {
                // some providers refuse to skip; read it away instead
                val waste = ByteArray(minOf(1 shl 16, (start - position).toInt()))
                val n = input.read(waste)
                if (n <= 0) throw IllegalStateException("That file ended sooner than expected.")
                position += n
            } else {
                position += skipped
            }
        }
        var at = 0
        while (at < length) {
            val n = input.read(out, at, length - at)
            if (n <= 0) break
            at += n
            position += n
        }
        return if (at == length) out else out.copyOf(at)
    }

    override fun close() {
        stream?.close()
        stream = null
    }
}
