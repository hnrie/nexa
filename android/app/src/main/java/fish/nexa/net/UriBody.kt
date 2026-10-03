package fish.nexa.net

import android.net.Uri
import fish.nexa.Nexa
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody
import okio.BufferedSink

/**
 * A file from the phone's storage as a request body, read as it is sent and
 * counted as it goes (api.upload's onProgress), for uploads that show how far
 * they are.
 */
class UriBody(private val uri: Uri, type: String, private val size: Long, private val onProgress: (Float) -> Unit) : RequestBody() {
    private val media: MediaType? = type.toMediaTypeOrNull()

    override fun contentType(): MediaType? = media
    override fun contentLength(): Long = if (size > 0) size else -1

    override fun writeTo(sink: BufferedSink) {
        Nexa.app.contentResolver.openInputStream(uri)?.use { input ->
            val buf = ByteArray(64 * 1024)
            var sent = 0L
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                sink.write(buf, 0, n)
                sent += n
                if (size > 0) onProgress((sent.toFloat() / size).coerceAtMost(1f))
            }
        } ?: throw java.io.IOException("unreadable")
    }
}
