package fish.nexa

import fish.nexa.crypto.Bytes
import fish.nexa.crypto.DecryptError
import fish.nexa.crypto.FileCrypto
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class FileCompletenessTest {
    @Test fun preparedPiecesMatchTheWholeFileIncludingTheShortLastChunk() {
        val plain = ByteArray(2 * FileCrypto.CHUNK + 17) { (it * 31).toByte() }
        val key = Bytes.random(32)
        val iv = FileCrypto.newBaseIv()
        val file = File.createTempFile("nexa-transfer-", ".bin")
        try {
            file.writeBytes(plain)
            RandomAccessFile(file, "r").use { source ->
                val first = FileCrypto.encryptChunks(source, plain.size.toLong(), key, iv, 0, 2)
                val last = FileCrypto.encryptChunks(source, plain.size.toLong(), key, iv, 2, 1)
                assertArrayEquals(FileCrypto.encryptBytes(plain, key, iv), first + last)
            }
        } finally {
            file.delete()
        }
    }

    @Test fun aWholeAuthenticatedChunkDoesNotProveTheFileIsComplete() {
        val plain = ByteArray(FileCrypto.CHUNK + 1)
        val key = Bytes.random(32)
        val encrypted = FileCrypto.encryptBytes(plain, key)
        val prefix = encrypted.copyOf(FileCrypto.encryptedSize(FileCrypto.CHUNK.toLong()).toInt())
        assertThrows(DecryptError::class.java) {
            FileCrypto.decryptStream(prefix.inputStream(), key, ByteArrayOutputStream(), expectedSize = plain.size.toLong())
        }
        val out = ByteArrayOutputStream()
        assertEquals(plain.size.toLong(), FileCrypto.decryptStream(encrypted.inputStream(), key, out, expectedSize = plain.size.toLong()))
    }
}
