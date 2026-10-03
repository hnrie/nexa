package fish.nexa.media

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.FileDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import fish.nexa.Nexa
import fish.nexa.crypto.AttachmentMeta
import fish.nexa.crypto.Bytes
import fish.nexa.crypto.DecryptError
import fish.nexa.crypto.FileCrypto
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * Plays an encrypted attachment while it downloads (lib/videoStream.ts,
 * crypto/streamRange.ts): the player asks for bytes of the plain video, and
 * this fetches only the 4 MiB chunks that hold them, with Range requests and
 * the session's token, checks each one and decrypts it. Seeking fetches from
 * the new place; nothing past what is watched is downloaded. A webhook's
 * plain file streams the same way without the decrypting.
 */
@UnstableApi
class EncryptedDataSource : BaseDataSource(true) {
    private var att: AttachmentMeta? = null
    private var uri: Uri? = null
    private var position = 0L
    private var remaining = 0L
    private var opened = false

    override fun open(dataSpec: DataSpec): Long {
        val a = Streams.attachmentOf(dataSpec.uri) ?: throw DataSourceException(PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND)
        transferInitializing(dataSpec)
        att = a
        uri = dataSpec.uri
        position = dataSpec.position
        if (position > a.size) throw DataSourceException(PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
        remaining = if (dataSpec.length != C.LENGTH_UNSET.toLong()) dataSpec.length else a.size - position
        opened = true
        transferStarted(dataSpec)
        return remaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (remaining == 0L) return C.RESULT_END_OF_INPUT
        val a = att ?: return C.RESULT_END_OF_INPUT
        val i = (position / FileCrypto.CHUNK).toInt()
        val chunk = try {
            Streams.chunk(a, i)
        } catch (e: DecryptError) {
            throw DataSourceException(e, PlaybackException.ERROR_CODE_DECODING_FAILED)
        } catch (e: IOException) {
            throw DataSourceException(e, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED)
        }
        val at = (position - i.toLong() * FileCrypto.CHUNK).toInt()
        if (at >= chunk.size) return C.RESULT_END_OF_INPUT
        val n = minOf(length.toLong(), remaining, (chunk.size - at).toLong()).toInt()
        System.arraycopy(chunk, at, buffer, offset, n)
        position += n
        remaining -= n
        bytesTransferred(n)
        return n
    }

    override fun getUri(): Uri? = uri

    override fun close() {
        if (opened) {
            opened = false
            transferEnded()
        }
        att = null
    }
}

/**
 * What the players read from: attachments by a "nexa-attachment" address
 * that names their blob (their key never leaves this process), opened files
 * from the cache, and link previews' media through the app's connection.
 */
@UnstableApi
object Streams {
    private const val SCHEME = "nexa-attachment"
    private val known = ConcurrentHashMap<String, AttachmentMeta>()

    /** The address a player is given for an attachment. */
    fun uriOf(att: AttachmentMeta): Uri {
        known[att.blobId] = att
        val cached = Media.cached(att.blobId, att.plain)
        return cached?.let { Uri.fromFile(it) } ?: Uri.parse("$SCHEME://${att.blobId}")
    }

    fun attachmentOf(uri: Uri): AttachmentMeta? = if (uri.scheme == SCHEME) known[uri.host ?: ""] else null

    // ---- the chunks, a few kept (ChunkCache), each fetched once however many ask ----

    private class Header(val baseIv: ByteArray)
    private val headers = ConcurrentHashMap<String, Header>()
    private val chunks = object : LinkedHashMap<String, ByteArray>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>?) = size > 4
    }

    private fun fetch(blobId: String, start: Long, end: Long): ByteArray {
        var tries = 0
        while (true) {
            try {
                val req = Nexa.api.requestBuilder("/media/attachments/$blobId").header("Range", "bytes=$start-$end").get().build()
                Nexa.api.transfer.newCall(req).execute().use { r ->
                    if (r.code == 404 || r.code == 403) throw DecryptError("stream: the file is gone")
                    if (!r.isSuccessful) throw IOException("http ${r.code}")
                    val bytes = r.body.bytes()
                    if (r.code == 200) {
                        // a server that ignored the range sent the whole file: take the stretch asked for
                        if (bytes.size <= end) throw IOException("stream: short file")
                        return bytes.copyOfRange(start.toInt(), (end + 1).toInt())
                    }
                    if (bytes.size.toLong() != end - start + 1) throw IOException("stream: the server sent a different stretch than was asked for")
                    return bytes
                }
            } catch (e: DecryptError) {
                throw e
            } catch (e: IOException) {
                if (++tries > 3) throw e
                Thread.sleep(minOf(4000L, 400L shl tries))
            }
        }
    }

    private fun header(att: AttachmentMeta): Header {
        headers[att.blobId]?.let { return it }
        val h = fetch(att.blobId, 0, FileCrypto.HEADER_LEN - 1L)
        if (!(h[0] == 'E'.code.toByte() && h[1] == 'C'.code.toByte() && h[2] == 'F'.code.toByte() && h[3] == '1'.code.toByte())) throw DecryptError("stream: this is not an encrypted file")
        return Header(h.copyOfRange(4, FileCrypto.HEADER_LEN)).also { headers[att.blobId] = it }
    }

    /** Plain chunk [i] of an attachment, fetched and opened. */
    fun chunk(att: AttachmentMeta, i: Int): ByteArray {
        val key = "${att.blobId}:$i"
        synchronized(chunks) { chunks[key] }?.let { return it }
        val lock = synchronized(locks) { locks.getOrPut(key) { Any() } }
        synchronized(lock) {
            synchronized(chunks) { chunks[key] }?.let { return it }
            val plainLen = minOf(FileCrypto.CHUNK.toLong(), att.size - i.toLong() * FileCrypto.CHUNK).toInt()
            val out = if (att.plain) {
                if (plainLen <= 0) ByteArray(0) else fetch(att.blobId, i.toLong() * FileCrypto.CHUNK, i.toLong() * FileCrypto.CHUNK + plainLen - 1)
            } else {
                val iv = header(att).baseIv
                val start = FileCrypto.frameOffset(i)
                val end = start + FileCrypto.LEN_PREFIX + plainLen + Bytes.TAG_LEN - 1
                FileCrypto.decryptFrame(fetch(att.blobId, start, end), Bytes.unb64(att.key), iv, i)
            }
            synchronized(chunks) { chunks[key] = out }
            synchronized(locks) { locks.remove(key) }
            return out
        }
    }

    private val locks = HashMap<String, Any>()

    /** The factory every player uses: attachments by their address, files, and the web by the app's connection. */
    fun factory(): DataSource.Factory = DataSource.Factory {
        Router(EncryptedDataSource(), FileDataSource(), DefaultDataSource(Nexa.app, OkHttpDataSource.Factory(Nexa.api.http).createDataSource()))
    }

    private class Router(private val encrypted: DataSource, private val file: DataSource, private val web: DataSource) : DataSource {
        private var current: DataSource? = null

        override fun addTransferListener(transferListener: androidx.media3.datasource.TransferListener) {
            encrypted.addTransferListener(transferListener)
            file.addTransferListener(transferListener)
            web.addTransferListener(transferListener)
        }

        override fun open(dataSpec: DataSpec): Long {
            val src = when (dataSpec.uri.scheme) {
                SCHEME -> encrypted
                "file" -> file
                else -> web
            }
            current = src
            return src.open(dataSpec)
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int = current?.read(buffer, offset, length) ?: C.RESULT_END_OF_INPUT
        override fun getUri(): Uri? = current?.uri
        override fun close() {
            current?.close()
            current = null
        }
    }
}
