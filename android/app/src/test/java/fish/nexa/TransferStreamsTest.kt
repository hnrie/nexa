package fish.nexa

import fish.nexa.crypto.Bytes
import fish.nexa.crypto.FileCrypto
import fish.nexa.media.withReadAhead
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test

class TransferStreamsTest {
    @Test fun decryptsWhileReadingAheadAndKeepsTheExactFile() = runBlocking {
        val plain = ByteArray(2 * FileCrypto.CHUNK + 123) { (it * 31).toByte() }
        val key = Bytes.random(32)
        val ciphertext = FileCrypto.encryptBytes(plain, key)
        val output = ByteArrayOutputStream()
        withReadAhead(ByteArrayInputStream(ciphertext)) {
            FileCrypto.decryptStream(it, key, output, expectedSize = plain.size.toLong())
        }
        assertArrayEquals(plain, output.toByteArray())
    }

    @Test fun buffersOnlyOneChunkAndClosesTheSourceWhenTheConsumerFails() {
        val got = AtomicInteger()
        val filled = CountDownLatch(1)
        var closed = false
        val source = object : InputStream() {
            override fun read(): Int = error("bulk reads only")
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                val n = got.addAndGet(len)
                if (n >= FileCrypto.CHUNK) filled.countDown()
                return len
            }
            override fun close() { closed = true }
        }
        val failure = IOException("disk full")
        val caught = assertThrows(IOException::class.java) {
            runBlocking {
                withReadAhead(source) {
                    assertTrue(filled.await(5, TimeUnit.SECONDS))
                    assertTrue(got.get() <= FileCrypto.CHUNK + 65536)
                    throw failure
                }
            }
        }
        assertEquals(failure.message, caught.message)
        assertTrue(closed)
    }

    @Test fun propagatesNetworkFailureInsteadOfSavingATruncatedFile() {
        val failure = IOException("connection lost")
        val source = object : InputStream() {
            override fun read(): Int = throw failure
        }
        val caught = assertThrows(IOException::class.java) {
            runBlocking { withReadAhead(source) { it.readBytes() } }
        }
        assertEquals(failure.message, caught.message)
    }

    @Test fun cancellationClosesAConnectionBlockedOnReading() = runBlocking {
        val started = CountDownLatch(1)
        val closed = CountDownLatch(1)
        val source = object : InputStream() {
            override fun read(): Int {
                started.countDown()
                check(closed.await(5, TimeUnit.SECONDS)) { "the source was not closed" }
                return -1
            }
            override fun close() { closed.countDown() }
        }
        val job = launch(Dispatchers.Default) { withReadAhead(source) { it.read() } }
        assertTrue(withContext(Dispatchers.IO) { started.await(5, TimeUnit.SECONDS) })
        withTimeout(5000) { job.cancelAndJoin() }
        assertEquals(0, closed.count)
    }
}
