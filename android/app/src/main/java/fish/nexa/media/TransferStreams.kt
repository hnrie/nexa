package fish.nexa.media

import fish.nexa.crypto.FileCrypto
import java.io.InputStream
import java.io.IOException
import java.io.PipedInputStream
import java.io.PipedOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** Keep the connection reading during decryption and disk writes, at most one chunk ahead. */
internal suspend fun <T> withReadAhead(input: InputStream, read: (InputStream) -> T): T = coroutineScope {
    val pipe = PipedInputStream(FileCrypto.CHUNK)
    val sink = PipedOutputStream(pipe)
    val producer = async(Dispatchers.IO) {
        sink.use {
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                it.write(buffer, 0, n)
                // PipedInputStream otherwise wakes a waiting reader on a one
                // second timer. Wake it with each network read instead.
                it.flush()
            }
        }
    }
    try {
        val result = runInterruptible(Dispatchers.IO) { read(pipe) }
        producer.await()
        result
    } catch (err: IOException) {
        // A cancelled pipe read throws InterruptedIOException. Keep user
        // cancellation distinct from an actual network/disk failure.
        currentCoroutineContext().ensureActive()
        throw err
    } finally {
        producer.cancel()
        input.close()
        pipe.close()
        sink.close()
    }
}
